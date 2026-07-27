using System.Buffers;
using DiNho.Capture.Poc.Export;
using DiNho.Capture.Poc.Logging;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

internal partial class FfmpegEncoder
{
    internal static bool IsAnnexB(byte[] buf, int len)
    {
        if (len < 3) return false;
        if (buf[0] != 0 || buf[1] != 0) return false;
        if (buf[2] == 1) return true;
        return len >= 4 && buf[2] == 0 && buf[3] == 1;
    }

    internal static bool ScanForStartCode(byte[] buf, int len, out int position)
    {
        position = -1;
        int end = len - 2;
        for (int i = 0; i < end; i++)
        {
            if (buf[i] != 0 || buf[i + 1] != 0) continue;
            if (buf[i + 2] == 1) { position = i; return true; }
            if (i + 3 < len && buf[i + 2] == 0 && buf[i + 3] == 1) { position = i; return true; }
        }
        return false;
    }

    internal static int ConvertAnnexBToAvcc(byte[] buf, int length, out int consumed)
    {
        int readPos = 0, writePos = 0;
        int firstScPos = -1;
        for (int i = 0; i < length - 2; i++)
        {
            if (buf[i] != 0) continue;
            if (buf[i + 1] != 0) continue;
            if (buf[i + 2] == 1) { firstScPos = i; break; }
            if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { firstScPos = i; break; }
        }
        bool foundFirstSc = firstScPos != 0;

        while (readPos + 2 < length)
        {
            int scPos = -1, scLen = 3;
            int scanEnd = length - 2;
            for (int i = readPos; i < scanEnd; i++)
            {
                if (buf[i] != 0) continue;
                if (buf[i + 1] != 0) continue;
                if (buf[i + 2] == 1) { scPos = i; scLen = 3; break; }
                if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { scPos = i; scLen = 4; break; }
            }

            if (scPos < 0)
            {
                consumed = readPos;
                return writePos;
            }

            int nalLen = scPos - readPos;
            if (nalLen > 0 && foundFirstSc)
            {
                if (readPos != writePos + 4)
                    System.Buffer.BlockCopy(buf, readPos, buf, writePos + 4, nalLen);
                buf[writePos] = (byte)(nalLen >> 24);
                buf[writePos + 1] = (byte)(nalLen >> 16);
                buf[writePos + 2] = (byte)(nalLen >> 8);
                buf[writePos + 3] = (byte)nalLen;
                writePos += 4 + nalLen;
            }

            readPos = scPos + scLen;
            foundFirstSc = true;
        }

        consumed = readPos;
        return writePos;
    }

    private static int FindAnnexBAccessUnitBoundary(byte[] buf, int len, bool hadSlice)
    {
        int pos = 0;
        bool seenSlice = hadSlice;

        while (pos + 3 < len)
        {
            if (buf[pos] != 0 || buf[pos + 1] != 0) { pos++; continue; }
            int scLen = 0;
            if (buf[pos + 2] == 1) scLen = 3;
            else if (pos + 3 < len && buf[pos + 2] == 0 && buf[pos + 3] == 1) scLen = 4;
            if (scLen == 0) { pos++; continue; }

            int nalStart = pos + scLen;
            if (nalStart >= len) break;

            int nalType = buf[nalStart] & 0x1F;

            bool isAuStart = nalType == 9
                          || nalType == 7
                          || nalType == 8;

            bool isSlice = nalType >= 1 && nalType <= 5;

            if (seenSlice && (isAuStart || isSlice))
                return pos;

            if (isSlice)
                seenSlice = true;

            pos = nalStart + 1;
        }

        return 0;
    }

    private void ParseAnnexBAu(byte[] buf, int length)
    {
        _pendingTooLarge = false;
        int pos = 0;

        while (pos + 3 < length)
        {
            int scLen = 0;
            if (buf[pos] == 0 && buf[pos + 1] == 0)
            {
                if (buf[pos + 2] == 1) scLen = 3;
                else if (pos + 3 < length && buf[pos + 2] == 0 && buf[pos + 3] == 1) scLen = 4;
            }
            if (scLen == 0) { pos++; continue; }

            int nalStart = pos + scLen;
            if (nalStart >= length) break;

            int nalType = buf[nalStart] & 0x1F;
            bool isSlice = nalType >= 1 && nalType <= 5;
            bool isAUD = nalType == 9;

            int nalEnd = length;
            for (int i = nalStart + 1; i < length - 2; i++)
            {
                if (buf[i] != 0 || buf[i + 1] != 0) continue;
                if (buf[i + 2] == 1) { nalEnd = i; break; }
                if (i + 3 < length && buf[i + 2] == 0 && buf[i + 3] == 1) { nalEnd = i; break; }
            }
            int nalLen = nalEnd - nalStart;

            if (_outputFrameIndex == 0 && _frameCount < 10)
                Log.D("FfmpegEncoder", $"ParseAnnexBAu: NAL type={nalType} isSlice={isSlice} isAUD={isAUD} nalLen={nalLen} pos={pos} hadSlice={_hadSlice}");

            if (isAUD)
            {
                if (_hadSlice)
                    EmitPacket();
            }
            else
            {
                if (_cachedAvcc == null && !IsAv1)
                {
                    if (nalType == 7 && _cachedSps == null)
                    {
                        _cachedSps = new byte[nalLen];
                        System.Buffer.BlockCopy(buf, nalStart, _cachedSps, 0, nalLen);
                    }
                    else if (nalType == 8 && _cachedPps == null)
                    {
                        _cachedPps = new byte[nalLen];
                        System.Buffer.BlockCopy(buf, nalStart, _cachedPps, 0, nalLen);
                    }
                    if (_cachedSps != null && _cachedPps != null)
                        _cachedAvcc = ClipExporter.BuildAvcc(_cachedSps, _cachedPps);
                }

                if (isSlice && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAnnexBAu: slice trigger with {_pendingLen}B pending — likely format mismatch");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                if (nalType == 8 && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAnnexBAu: PPS trigger with {_pendingLen}B pending — likely format mismatch");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                AppendPendingAvccNal(buf, nalStart, nalLen);
                if (isSlice) _hadSlice = true;
            }

            pos = nalEnd > nalStart ? nalEnd : nalStart + 1;
        }

        if (_hadSlice && !_pendingTooLarge)
            EmitPacket();
    }

    private void ReaderLoop(CancellationToken ct)
    {
        var buf = ArrayPool<byte>.Shared.Rent(2 * 1024 * 1024);
        bool firstData = true;

        try
        {
            while (!ct.IsCancellationRequested)
            {
                int read = _stdout!.Read(buf, 0, buf.Length);
                if (read == 0)
                {
                    _processFailed = true;
                    _processFailedCause = "reader:stdout_eof";
                    Log.W("FfmpegEncoder", $"stdout EOF after {_frameCount} frames written, {_outputFrameIndex} packets emitted");
                    break;
                }

                if (_disposed) break;

                if (firstData)
                {
                    firstData = false;
                    int rawHexLen = Math.Min(read, 32);
                    var rawHex = Convert.ToHexString(buf.AsSpan(0, rawHexLen));
                    Log.I("FfmpegEncoder", $"reader first data: {read}B, rawHex={rawHex}");
                }

                if (_rawBuf == null)
                {
                    _rawBuf = ArrayPool<byte>.Shared.Rent(Math.Max(512 * 1024, read));
                    _rawLen = 0;
                }
                int need = _rawLen + read;
                if (need > _rawBuf.Length)
                {
                    byte[] newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_rawBuf.Length * 2, need));
                    System.Buffer.BlockCopy(_rawBuf, 0, newBuf, 0, _rawLen);
                    ArrayPool<byte>.Shared.Return(_rawBuf);
                    _rawBuf = newBuf;
                }
                System.Buffer.BlockCopy(buf, 0, _rawBuf, _rawLen, read);
                _rawLen = need;

                if (_pipeFormat == PipeFormat.Unknown && _rawLen >= 4)
                {
                    if ((_rawBuf[0] == 0 && _rawBuf[1] == 0 && _rawBuf[2] == 1) ||
                        (_rawBuf[0] == 0 && _rawBuf[1] == 0 && _rawBuf[2] == 0 && _rawBuf[3] == 1))
                        _pipeFormat = PipeFormat.AnnexB;
                    else
                        _pipeFormat = PipeFormat.Avcc;
                    Log.I("FfmpegEncoder", $"pipe format latched: {_pipeFormat} (codec={_codec}) rawHex={Convert.ToHexString(_rawBuf.AsSpan(0, Math.Min(_rawLen, 8)))}");
                }

                if (_pipeFormat == PipeFormat.Unknown)
                {
                    continue;
                }

                if (_pipeFormat == PipeFormat.AnnexB)
                {
                    int auEnd = FindAnnexBAccessUnitBoundary(_rawBuf, _rawLen, _hadRawSlice);

                    if (auEnd > 0)
                    {
                        ParseAnnexBAu(_rawBuf, auEnd);

                        int tail = _rawLen - auEnd;
                        if (tail > 0)
                            System.Buffer.BlockCopy(_rawBuf, auEnd, _rawBuf, 0, tail);
                        _rawLen = tail;
                        _hadRawSlice = false;
                    }

                    if (_rawLen > 2 * 1024 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"AnnexB raw overflow {_rawLen}B hadRawSlice={_hadRawSlice} — forcing format re-detect");
                        _pipeFormat = PipeFormat.Unknown;
                        _rawLen = 0;
                        _hadRawSlice = false;
                        int drained = 0;
                        while (_inputPtsQueue.TryDequeue(out _)) drained++;
                        Log.W("FfmpegEncoder", $"drained {drained} stale PTS entries");
                    }
                }
                else
                {
                    ParseAvcc(new ReadOnlySpan<byte>(_rawBuf, 0, _rawLen));
                    _rawLen = 0;

                    if (!_hadSlice && _pendingLen > 512 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"AVCC mismatch: pending={_pendingLen}B hadSlice={_hadSlice} — forcing format re-detect");
                        _pipeFormat = PipeFormat.Unknown;
                        _pendingLen = 0;
                        _hadSlice = false;
                        int drained = 0;
                        while (_inputPtsQueue.TryDequeue(out _)) drained++;
                        Log.W("FfmpegEncoder", $"drained {drained} stale PTS entries");
                    }
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (IOException ex)
        {
            _processFailed = true;
            _processFailedCause = "reader:stdout_io_error";
            Log.E("FfmpegEncoder", $"stdout: {ex.Message}");
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buf);
            if (_pendingBuf != null)
            {
                ArrayPool<byte>.Shared.Return(_pendingBuf);
                _pendingBuf = null;
            }
            if (_rawBuf != null)
            {
                ArrayPool<byte>.Shared.Return(_rawBuf);
                _rawBuf = null;
            }
            _pendingLen = 0;
            _rawLen = 0;
            _hadSlice = false;
            LogProcessExit();
        }
    }

    internal void ParseAvcc(ReadOnlySpan<byte> data)
    {
        _pendingTooLarge = false;
        int pos = 0;
        int firstHex = data.Length >= 4 ? (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3] : -1;
        if (!_loggedParseAvcc)
        {
            _loggedParseAvcc = true;
            Log.D("FfmpegEncoder", $"ParseAvcc: dataLen={data.Length} first4Bytes=0x{firstHex:X8} pending={_pendingLen} hadSlice={_hadSlice}");
        }

        while (pos + 4 <= data.Length)
        {
            int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            int totalSize = 4 + nalLen;

            if (nalLen <= 0 || pos + totalSize > data.Length)
            {
                if (pos < data.Length)
                {
                    int tailLen = data.Length - pos;
                    Log.W("FfmpegEncoder", $"ParseAvcc: incomplete NALU at pos={pos} nalLen={nalLen} tailLen={tailLen} — appending to pending");
                    AppendPending(data.Slice(pos));
                }
                break;
            }

            int nalType = IsHevc ? (data[pos + 4] >> 1) & 0x3F : data[pos + 4] & 0x1F;
            bool isSlice = IsHevc ? nalType <= 9 : nalType >= 1 && nalType <= 5;
            bool isAUD = IsHevc ? nalType == 35 : nalType == 9;

            if (_outputFrameIndex == 0 && _frameCount < 10)
                Log.D("FfmpegEncoder", $"ParseAvcc: codec={_codec} NAL type={nalType} isSlice={isSlice} isAUD={isAUD} nalLen={nalLen} pos={pos} hadSlice={_hadSlice}");

            if (isAUD)
            {
                if (_hadSlice)
                    EmitPacket();
            }
            else
            {
                if (_cachedAvcc == null && !IsAv1)
                {
                    int spsType = IsHevc ? 33 : 7;
                    int ppsType = IsHevc ? 34 : 8;
                    if (nalType == spsType && _cachedSps == null)
                    {
                        _cachedSps = new byte[nalLen];
                        data.Slice(pos + 4, nalLen).CopyTo(_cachedSps);
                    }
                    else if (nalType == ppsType && _cachedPps == null)
                    {
                        _cachedPps = new byte[nalLen];
                        data.Slice(pos + 4, nalLen).CopyTo(_cachedPps);
                    }
                    if (_cachedSps != null && _cachedPps != null)
                        _cachedAvcc = ClipExporter.BuildAvcc(_cachedSps, _cachedPps);
                }

                if (isSlice && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAvcc: slice trigger with {_pendingLen}B pending — likely format mismatch");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                int ppsNalType = IsHevc ? 34 : 8;
                if (nalType == ppsNalType && _hadSlice)
                {
                    if (_pendingLen > 200 * 1024)
                    {
                        Log.W("FfmpegEncoder", $"ParseAvcc: PPS trigger with {_pendingLen}B pending — likely format mismatch, skipping emit");
                        _pendingTooLarge = true;
                    }
                    else
                    {
                        EmitPacket();
                    }
                }

                AppendPending(data.Slice(pos, totalSize));
                if (isSlice) _hadSlice = true;
            }

            pos += totalSize;
        }

        if (_hadSlice && !_pendingTooLarge)
            EmitPacket();
    }

    internal void AppendPending(ReadOnlySpan<byte> chunk)
    {
        if (_pendingBuf == null)
        {
            _pendingBuf = ArrayPool<byte>.Shared.Rent(64 * 1024);
            _pendingLen = 0;
        }
        if (_pendingLen > 50 * 1024 * 1024)
        {
            Log.W("FfmpegEncoder", $"AppendPending: pendingLen={_pendingLen} exceeds 50MB — resetting to prevent OOM");
            _pendingLen = 0;
            _hadSlice = false;
        }
        int need = _pendingLen + chunk.Length;
        if (need > _pendingBuf.Length)
        {
            var newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_pendingBuf.Length * 2, need));
            System.Buffer.BlockCopy(_pendingBuf, 0, newBuf, 0, _pendingLen);
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = newBuf;
        }
        chunk.CopyTo(new Span<byte>(_pendingBuf, _pendingLen, chunk.Length));
        _pendingLen += chunk.Length;
    }

    private void AppendPendingAvccNal(byte[] data, int offset, int nalLen)
    {
        if (_pendingLen > 50 * 1024 * 1024)
        {
            Log.W("FfmpegEncoder", $"AppendPendingAvccNal: pendingLen={_pendingLen} exceeds 50MB — resetting to prevent OOM");
            _pendingLen = 0;
            _hadSlice = false;
        }
        int totalSize = 4 + nalLen;
        int need = _pendingLen + totalSize;
        if (_pendingBuf == null)
        {
            _pendingBuf = ArrayPool<byte>.Shared.Rent(Math.Max(64 * 1024, need));
            _pendingLen = 0;
        }
        if (need > _pendingBuf.Length)
        {
            var newBuf = ArrayPool<byte>.Shared.Rent(Math.Max(_pendingBuf.Length * 2, need));
            System.Buffer.BlockCopy(_pendingBuf, 0, newBuf, 0, _pendingLen);
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = newBuf;
        }
        _pendingBuf[_pendingLen] = (byte)(nalLen >> 24);
        _pendingBuf[_pendingLen + 1] = (byte)(nalLen >> 16);
        _pendingBuf[_pendingLen + 2] = (byte)(nalLen >> 8);
        _pendingBuf[_pendingLen + 3] = (byte)nalLen;
        _pendingLen += 4;
        System.Buffer.BlockCopy(data, offset, _pendingBuf, _pendingLen, nalLen);
        _pendingLen += nalLen;
    }

    private bool CheckPendingHasSlice()
    {
        if (_pendingBuf == null || _pendingLen == 0) return false;
        if (IsAv1) return true;
        int pos = 0;
        while (pos + 4 <= _pendingLen)
        {
            int nalLen = (_pendingBuf[pos] << 24) | (_pendingBuf[pos + 1] << 16) | (_pendingBuf[pos + 2] << 8) | _pendingBuf[pos + 3];
            if (nalLen <= 0 || pos + 4 + nalLen > _pendingLen) break;
            int nalType = IsHevc ? (_pendingBuf[pos + 4] >> 1) & 0x3F : _pendingBuf[pos + 4] & 0x1F;
            if (IsHevc ? nalType <= 9 : nalType >= 1 && nalType <= 5) return true;
            pos += 4 + nalLen;
        }
        return false;
    }

    private void EmitPacket()
    {
        if (_pendingLen == 0 || !_hadSlice || _pendingBuf == null) return;
        if (!CheckPendingHasSlice()) return;

        byte[] data = ArrayPool<byte>.Shared.Rent(_pendingLen);
        System.Buffer.BlockCopy(_pendingBuf, 0, data, 0, _pendingLen);

        long dur = 10_000_000L / _frameRate;

        long prevPts = _lastRealPtsTicks;

        long pts = _outputFrameIndex * dur;
        bool usedExtrapolated = false;
        if (_inputPtsQueue.TryDequeue(out var realPts))
        {
            pts = realPts.Ticks;
            _lastRealPtsTicks = pts;
        }
        else if (_lastRealPtsTicks >= 0)
        {
            pts = _lastRealPtsTicks + dur;
            _lastRealPtsTicks = pts;
            usedExtrapolated = true;
        }

        if (prevPts >= 0 && pts <= prevPts)
        {
            pts = prevPts + 1;
            _lastRealPtsTicks = pts;
            Log.W("FfmpegEncoder", $"EmitPacket: corrected non-monotonic pts to {pts / 10000}ms (frameIndex={_outputFrameIndex})");
        }

        if (usedExtrapolated)
            Log.D("FfmpegEncoder", $"EmitPacket: used extrapolated pts {pts/10000}ms (frameIndex={_outputFrameIndex})");

        bool key = CheckKeyFrame(data);

        _outputChannel.Writer.TryWrite(new EncodedPacket(
            data, MediaType.Video,
            TimeSpan.FromTicks(pts), TimeSpan.FromTicks(dur),
            key, isPooled: true, dataLength: _pendingLen, width: _width, height: _height));

        long ptsMs = pts / 10_000;
        if (_outputFrameIndex < 10 || _outputFrameIndex % 300 == 1)
            Log.I("FfmpegEncoder", $"EmitPacket #{_outputFrameIndex} pts={ptsMs}ms len={_pendingLen}B key={key} hadSlice={_hadSlice}");

        _outputFrameIndex++;
        _pendingLen = 0;
        _hadSlice = false;
    }

    private bool CheckKeyFrame(byte[] data)
    {
        if (IsAv1) return false;
        int pos = 0;
        while (pos + 5 <= data.Length)
        {
            int nalLen = (data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3];
            if (nalLen <= 0) break;
            int nalStart = pos + 4;
            if (IsHevc)
            {
                int t = (data[nalStart] >> 1) & 0x3F;
                if (t == 19 || t == 20) return true;
                if (t <= 9) return false;
            }
            else
            {
                int t = data[nalStart] & 0x1F;
                if (t == 5) return true;
                if (t >= 1 && t <= 5) return false;
            }
            pos = nalStart + nalLen;
        }
        return false;
    }
}
