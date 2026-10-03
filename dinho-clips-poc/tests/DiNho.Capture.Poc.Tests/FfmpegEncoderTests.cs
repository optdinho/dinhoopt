using DiNho.Capture.Poc.Encoders;
using System.Diagnostics;
using System.Reflection;
using System.Text.RegularExpressions;
using System.Threading.Channels;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Tests;

public sealed class FfmpegEncoderTests
{
    // ─── Reflection helpers (campos privados de FfmpegEncoder) ─────────

    private static T GetField<T>(FfmpegEncoder encoder, string name)
    {
        var field = typeof(FfmpegEncoder).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        return (T)field!.GetValue(encoder)!;
    }

    private static void SetField(FfmpegEncoder encoder, string name, object? value)
    {
        var field = typeof(FfmpegEncoder).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        field!.SetValue(encoder, value);
    }

    // ─── M2: drops do _outputChannel ──────────────────────────────────

    [Fact]
    public void OutputChannel_WhenOverflowed_IncrementsDroppedPackets()
    {
        using var enc = new FfmpegEncoder();
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");
        Assert.NotNull(channel);

        // Capacidade 256 (DropOldest). Escrever 300 → 44 drops chamando itemDropped.
        for (int i = 0; i < 300; i++)
        {
            var pkt = new EncodedPacket(new byte[] { (byte)i }, MediaType.Video,
                TimeSpan.FromMilliseconds(i), TimeSpan.FromMilliseconds(16), isKeyFrame: false);
            Assert.True(channel.Writer.TryWrite(pkt));
        }

        Assert.Equal(44, GetField<int>(enc, "_droppedPackets"));
    }

    [Fact]
    public void OutputChannel_NoOverflow_ZeroDropped()
    {
        using var enc = new FfmpegEncoder();
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");
        for (int i = 0; i < 100; i++)
        {
            var pkt = new EncodedPacket(new byte[] { (byte)i }, MediaType.Video,
                TimeSpan.FromMilliseconds(i), TimeSpan.FromMilliseconds(16), isKeyFrame: false);
            Assert.True(channel.Writer.TryWrite(pkt));
        }
        Assert.Equal(0, GetField<int>(enc, "_droppedPackets"));
    }

    [Fact]
    public void OutputChannel_DroppedPacket_RetainsNewest()
    {
        // DropOldest: ao encher, o MAIS ANTIGO é descartado — os frames recentes
        // (ponto de save do replay buffer) sobrevivem.
        using var enc = new FfmpegEncoder();
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");

        for (int i = 0; i < 300; i++)
        {
            var pkt = new EncodedPacket(new byte[] { (byte)(i & 0xFF) }, MediaType.Video,
                TimeSpan.FromMilliseconds(i), TimeSpan.FromMilliseconds(16), isKeyFrame: false);
            Assert.True(channel.Writer.TryWrite(pkt));
        }

        var remaining = new List<EncodedPacket>();
        while (channel.Reader.TryRead(out var pkt))
        {
            remaining.Add(pkt);
            pkt.Release();
        }

        Assert.Equal(256, remaining.Count);
        // O pacote 0 (mais antigo) foi dropado; o 299 (mais novo) sobreviveu.
        Assert.True(remaining.All(p => p.Pts > TimeSpan.Zero));
        Assert.Contains(remaining, p => p.Pts == TimeSpan.FromMilliseconds(299));
    }

    // ─── L2: guard no Flush() ─────────────────────────────────────────

    [Fact]
    public void Flush_WhenDisposed_DoesNotRestartFfmpeg()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_disposed", true);
        SetField(enc, "_process", null);

        enc.Flush();

        // Sem respawn: _process continua nulo (StartFfmpeg não é chamado).
        Assert.Null(GetField<object?>(enc, "_process"));
    }

    [Fact]
    public void Flush_WhenProcessNull_DoesNotRestartFfmpeg()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_process", null);

        enc.Flush();

        Assert.Null(GetField<object?>(enc, "_process"));
    }

    [Fact]
    public void Flush_WhenDisposed_StillDrainsPendingOutputs()
    {
        // Mesmo sem reiniciar ffmpeg, os pacotes do channel são drenados para
        // _pendingOutputs (consumido pelo save) — o guard só impede o respawn.
        using var enc = new FfmpegEncoder();
        SetField(enc, "_disposed", true);
        var channel = GetField<Channel<EncodedPacket>>(enc, "_outputChannel");
        var pkt = new EncodedPacket(new byte[] { 0x01 }, MediaType.Video,
            TimeSpan.FromMilliseconds(1), TimeSpan.FromMilliseconds(16), isKeyFrame: true);
        channel.Writer.TryWrite(pkt);

        enc.Flush();

        var pending = GetField<Queue<EncodedPacket>>(enc, "_pendingOutputs");
        Assert.Single(pending);
        while (pending.Count > 0) pending.Dequeue().Release();
    }

    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("h264_amf")]
    [InlineData("libx264")]
    public void CheckFfmpegEncoder_FindsKnownEncoders(string encoder)
    {
        var result = FfmpegEncoder.CheckFfmpegEncoder(encoder);
        Assert.True(result, $"Expected ffmpeg to have {encoder} available");
    }

    [Theory]
    [InlineData("nonexistent_codec_xyz")]
    [InlineData("")]
    [InlineData("  ")]
    public void CheckFfmpegEncoder_ReturnsFalseForUnknown(string encoder)
    {
        var result = FfmpegEncoder.CheckFfmpegEncoder(encoder);
        Assert.False(result);
    }

    // ─── IsAnnexB ───────────────────────────────────────────────────────

    [Fact]
    public void IsAnnexB_StartCode_00_00_01_ReturnsTrue()
    {
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67 };
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_StartCode_00_00_00_01_ReturnsTrue()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x67 };
        Assert.True(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_AvccFormat_ReturnsFalse()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x19, 0x67 };
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_TooShort_ReturnsFalse()
    {
        var buf = new byte[] { 0x00, 0x00 };
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    [Fact]
    public void IsAnnexB_DataWithoutStartCode_ReturnsFalse()
    {
        var buf = new byte[] { 0x67, 0x68, 0x69 };
        Assert.False(FfmpegEncoder.IsAnnexB(buf, buf.Length));
    }

    // ─── ScanForStartCode ───────────────────────────────────────────────

    [Fact]
    public void ScanForStartCode_FindsCodeAtBeginning()
    {
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67, 0x68, 0x69 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_FindsCodeAtOffset()
    {
        var buf = new byte[] { 0x67, 0x00, 0x00, 0x01, 0x68 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(1, pos);
    }

    [Fact]
    public void ScanForStartCode_FindsFourByteCode()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x67 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(0, pos);
    }

    [Fact]
    public void ScanForStartCode_NoCode_ReturnsFalse()
    {
        var buf = new byte[] { 0xAA, 0xBB, 0xCC, 0x01 };
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out _));
    }

    [Fact]
    public void ScanForStartCode_EmptyBuffer_ReturnsFalse()
    {
        Assert.False(FfmpegEncoder.ScanForStartCode([], 0, out _));
    }

    [Fact]
    public void ScanForStartCode_TooShort_ReturnsFalse()
    {
        var buf = new byte[] { 0x00, 0x01 };
        Assert.False(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out _));
    }

    [Fact]
    public void ScanForStartCode_FirstOfMultipleCodes()
    {
        var buf = new byte[] { 0x41, 0x00, 0x00, 0x01, 0x67, 0x00, 0x00, 0x01, 0x68 };
        Assert.True(FfmpegEncoder.ScanForStartCode(buf, buf.Length, out var pos));
        Assert.Equal(1, pos);
    }

    // ─── ConvertAnnexBToAvcc ────────────────────────────────────────────
    //
    // ConvertAnnexBToAvcc processes data incrementally. It scans for AnnexB
    // start codes and writes AVCC (4-byte length-prefixed) NALUs into the
    // same buffer. A NALU is only written when there is data BETWEEN two
    // start codes — the first start code opens it, the next closes it.
    // The last "orphaned" NALU body (after the final start code) is NOT
    // written; instead `consumed` tells the caller where to preserve
    // orphaned data for the next call.

    [Fact]
    public void ConvertAnnexBToAvcc_SingleStartCode_NoNaluWritten()
    {
        // One start code, one NALU body, but no following start code → orphaned
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67, 0x68 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result); // no NALU between two start codes
        Assert.Equal(3, consumed); // orphaned body starts after the SC
    }

    [Fact]
    public void ConvertAnnexBToAvcc_MultipleNalus_FirstWritten()
    {
        // Two NALUs: first delimited by start codes on both sides → written
        // Second: no following start code → orphaned
        var buf = new byte[]
        {
            0x00, 0x00, 0x01, 0x67, 0xAA, // SC + SPS body (2B)
            0x00, 0x00, 0x01, 0x68, 0xBB  // SC + PPS body (2B, orphaned)
        };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // AVCC: [len=2][0x67, 0xAA] = 6 bytes
        Assert.Equal(6, result);
        Assert.Equal(8, consumed); // bytes 0-7 consumed, orphaned tail at 8

        // Verify length prefix
        Assert.Equal(0x00, buf[0]);
        Assert.Equal(0x00, buf[1]);
        Assert.Equal(0x00, buf[2]);
        Assert.Equal(0x02, buf[3]);
        Assert.Equal(0x67, buf[4]);
        Assert.Equal(0xAA, buf[5]);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_EmptyBuffer_ReturnsZero()
    {
        var result = FfmpegEncoder.ConvertAnnexBToAvcc([], 0, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(0, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OnlyStartCode_NoNaluBody_ReturnsZero()
    {
        var buf = new byte[] { 0x00, 0x00, 0x01 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(3, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedTail_Processed()
    {
        // Orphaned tail before start code IS processed (foundFirstSc=true when
        // first SC is not at position 0). Data DE AD before SC is a continuation
        // from a previous call's last NALU.
        var buf = new byte[] { 0xDE, 0xAD, 0x00, 0x00, 0x01, 0x67 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(6, result); // AVCC: [len=2][DE,AD] = 6 bytes
        Assert.Equal(5, consumed); // orphaned 0x67 at position 5
    }

    [Fact]
    public void ConvertAnnexBToAvcc_IncompleteTail_Orphaned()
    {
        // Start code + body, but body extends to end without following SC
        var buf = new byte[] { 0x00, 0x00, 0x01, 0x67, 0xDE };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result); // no NALU delimited by two SCs
        Assert.Equal(3, consumed);
    }

    [Fact]
    public void ConvertAnnexBToAvcc_FourByteStartCode_Orphaned()
    {
        var buf = new byte[] { 0x00, 0x00, 0x00, 0x01, 0x67, 0x68 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(4, consumed); // 4-byte SC consumed
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OnlyGarbage_NoStartCode_ReturnsZero()
    {
        var buf = new byte[] { 0x67, 0x68, 0x69 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(0, result);
        Assert.Equal(0, consumed); // no start code found
    }

    [Fact]
    public void ConvertAnnexBToAvcc_KeyframeSequence_FirstTwoWritten()
    {
        // SPS + PPS are delimited by following start codes → written
        // IDR slice is orphaned (no following SC)
        var buf = new byte[]
        {
            0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x1E, // SC + SPS (4B body)
            0x00, 0x00, 0x01, 0x68, 0xEB,             // SC + PPS (2B body)
            0x00, 0x00, 0x01, 0x65, 0x88, 0x84        // SC + IDR (3B body, orphaned)
        };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // SPS: [len=4][4B] = 8, PPS: [len=2][2B] = 6, total = 14
        Assert.Equal(14, result);
        Assert.Equal(15, consumed); // orphaned IDR body (0x65,0x88,0x84) starts at position 15
    }

    [Fact]
    public void ConvertAnnexBToAvcc_ThreeDelimited_SuccessiveNalus()
    {
        // Three NALUs each followed by a start code for the NEXT one.
        // First two are written, third is orphaned.
        var buf = new byte[]
        {
            0x00, 0x00, 0x01, 0x41,
            0x00, 0x00, 0x01, 0x42,
            0x00, 0x00, 0x01, 0x43
        };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // First NALU: [len=1][0x41] = 5
        // Second NALU: [len=1][0x42] = 5
        // Total: 10
        Assert.Equal(10, result);
        Assert.Equal(11, consumed); // orphaned 0x43 at position 11
    }

    [Fact]
    public void ConvertAnnexBToAvcc_LargeNaluWrittenThenSmallNalu()
    {
        // First NALU has 100 bytes body; second NALU 1 byte body (orphaned)
        var buf = new byte[106];
        buf[0] = 0x00; buf[1] = 0x00; buf[2] = 0x01; // SC for first NALU
        for (int i = 3; i < 103; i++) buf[i] = (byte)(i - 3); // 100-byte NALU body
        buf[103] = 0x00; buf[104] = 0x00; buf[105] = 0x01; // SC for second NALU

        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        // First NALU: [len=100][100B] = 104 bytes
        Assert.Equal(104, result);
        Assert.Equal(106, consumed); // second SC at 103 + 3 = 106
        Assert.Equal(0x64, buf[3]); // length = 100 = 0x64
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedTail_DataBeforeFirstScProcessed()
    {
        // Data before first start code is orphaned from a previous pipe read —
        // now processed correctly as continuation NALU.
        var buf = new byte[] { 0xDE, 0xAD, 0x00, 0x00, 0x01, 0x67 };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(buf, buf.Length, out var consumed);
        Assert.Equal(6, result); // AVCC: [len=2][DE,AD] = 6 bytes
        Assert.Equal(5, consumed); // orphaned 0x67 at position 5
    }

    [Fact]
    public void ConvertAnnexBToAvcc_OrphanedThenCompleteNalu_OrphanProcessed()
    {
        // Orphan tail from call1 (0x67, 0xAA) IS processed now.
        // The second NALU after the SC is orphaned (no following SC).
        var combined = new byte[] { 0x67, 0xAA, 0x00, 0x00, 0x01, 0x68, 0xBB };
        var result = FfmpegEncoder.ConvertAnnexBToAvcc(combined, combined.Length, out var consumed);
        // Orphan (0x67, 0xAA) written as AVCC: [len=2][0x67,0xAA] = 6 bytes.
        // NALU (0x68, 0xBB) is orphaned — no following SC.
        Assert.Equal(6, result);
        Assert.Equal(5, consumed);
    }

    // ─── ComputeScaleTarget ─────────────────────────────────────────────

    [Fact]
    public void ComputeScaleTarget_NoUserOutput_NoFallback_ReturnsNull()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 0, 0, 1);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_UserOutputDownscalesCapture()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 1280, 720, 1);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_UserOutputEqualInput_ReturnsNull()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1280, 720, 1280, 720, 1);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_OddOutputRoundedDownToEven()
    {
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 855, 481, 1);
        Assert.NotNull(result);
        Assert.Equal((854, 480), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_UserOutputLargerThanInput_NoUpscale()
    {
        // Jogo rodando em 720p com preset 1080p — nunca faz upscale.
        var result = FfmpegEncoder.ComputeScaleTarget(1280, 720, 1920, 1080, 1);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackDivisor_DoesNotReduceBelowUserOutput()
    {
        // Cascading fallback 1/2 + user 720p num capture 1920×1080 → mantém 1280×720.
        // O alvo explícito é sagrado: o divisor é inerte e o 720p do usuário fica.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 1280, 720, 2);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    // ── Resolução da UI é SAGRADA: o divisor só vale para "native" ─────────
    // A resolução escolhida na UI chega como alvo explícito (> 0) e é sagrada: nenhum
    // divisor de fallback/capacity guard pode reduzi-la. O divisor (HW 1/2 → HW 1/4 →
    // CPU 1/2) só age quando NÃO há alvo explícito (native), onde não existe escolha do
    // usuário a violar. Foi o contrário disto que a sessão FiveM de 2026-10-03 expôs: o
    // capacity guard baixou 1080p→720p a meio da gravação e dessincronizou o A/V.

    [Theory]
    [InlineData(2)]
    [InlineData(4)]
    public void ComputeScaleTarget_UserOutput_IsNeverReducedByFallbackDivisor(int divisor)
    {
        // Usuário em 1080p + divisor → mantém 1080p (sem scale). O divisor é inerte.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 1920, 1080, divisor);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackDivisor_UsesUserOutputWhenBelowFloor()
    {
        // Usuário em 960×540 + 1/2 → o alvo do usuário vence; o divisor é inerte com
        // alvo explícito, mesmo abaixo do piso.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 960, 540, 2);
        Assert.NotNull(result);
        Assert.Equal((960, 540), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_SubFloorCapture_IsNotReducedBelowItsOwnSize()
    {
        // Captura 960×540 (abaixo do piso): o piso não pode virar upscale, então o piso
        // efetivo é o próprio tamanho da captura e o divisor 1/2 não tem para onde ir.
        var result = FfmpegEncoder.ComputeScaleTarget(960, 540, 0, 0, 2);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_1440pUser_IsPreserved()
    {
        // Usuário em 1440p + 1/2 → mantém 1440p: o divisor não toca num alvo explícito.
        var result = FfmpegEncoder.ComputeScaleTarget(2560, 1440, 2560, 1440, 2);
        Assert.Null(result);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackDivisor_AppliesWhenNative()
    {
        // Sem resolução explícita do usuário (nativo, outputW<=0) + fallback 1/2.
        // Com o piso absoluto o 1/2 (960×540) sobe ao piso 1280×720.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 0, 0, 2);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackOnly_StillHonorsFloor()
    {
        // Nativo + 1/4 (480×270) → o piso absoluto segura em 1280×720. O degrau 1/4 é
        // absorvido pelo piso: ele existe para re-tentar, mas não produz 480×270.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 0, 0, 4);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_FallbackDivisorMakesInputOdd_EvenResult()
    {
        // Input 1280×721 (impar) sem output do usuário → arredonda altura para par (1280×720).
        var result = FfmpegEncoder.ComputeScaleTarget(1280, 721, 0, 0, 1);
        Assert.NotNull(result);
        Assert.Equal((1280, 720), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_PreservesAspect_16by10Source()
    {
        // Captura 2560×1600 (16:10) + preset 1920×1080 (16:9) → 1728×1080 (16:10), sem esticar.
        var result = FfmpegEncoder.ComputeScaleTarget(2560, 1600, 1920, 1080, 1);
        Assert.NotNull(result);
        Assert.Equal((1728, 1080), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_PreservesAspect_21by9Source()
    {
        // Captura 3440×1440 (21:9) + preset 1920×1080 (16:9) → 1920×804 (21:9), sem esticar.
        var result = FfmpegEncoder.ComputeScaleTarget(3440, 1440, 1920, 1080, 1);
        Assert.NotNull(result);
        Assert.Equal((1920, 804), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_PreservesAspect_WithFallbackDivisor()
    {
        // Captura 2560×1600 (16:10) + preset 1280×720 (16:9) → ajustado para 1152×720 (16:10),
        // encaixado no box 1280×720 sem esticar. O divisor é inerte (alvo explícito).
        var result = FfmpegEncoder.ComputeScaleTarget(2560, 1600, 1280, 720, 2);
        Assert.NotNull(result);
        Assert.Equal((1152, 720), result!.Value);
    }

    // ─── ComputeScaleTarget: o aspect da captura é SEMPRE preservado ──
    //
    // Até 2026-09-29 a opção "Remover bordas pretas" pulava esta preservação e *esticava*
    // (21:9 preenchia 1920×1080, imagem ~1,35× achatada). Ela passou a recortar antes, no
    // crop (ComputeLetterboxCrop), então não existe mais caminho que distorça. Os 4 testes
    // que fixavam o stretch foram reescritos: codificavam a distorção.

    [Theory]
    [InlineData(3440, 1440, 1920, 804)]   // 21:9 → limita pela largura
    [InlineData(2560, 1600, 1728, 1080)] // 16:10 → limita pela altura
    [InlineData(3840, 1600, 1920, 800)]   // 12:5 → limita pela largura
    public void ComputeScaleTarget_SemprePreservaAspectDaCaptura(int srcW, int srcH, int expW, int expH)
    {
        var result = FfmpegEncoder.ComputeScaleTarget(srcW, srcH, 1920, 1080, 1);
        Assert.Equal((expW, expH), result!.Value);
    }

    [Fact]
    public void ComputeScaleTarget_Native_ReturnsNull()
    {
        Assert.Null(FfmpegEncoder.ComputeScaleTarget(2560, 1600, 0, 0, 1));
    }

    [Fact]
    public void ComputeScaleTarget_EscalaQuandoAspectoCoincide()
    {
        // 16:9 → 16:9: não há barra para cortar, o scale puro faz o serviço.
        var result = FfmpegEncoder.ComputeScaleTarget(1920, 1080, 1280, 720, 1);
        Assert.Equal((1280, 720), result!.Value);
    }

    // ─── ComputeLetterboxCrop ("Remover bordas pretas" = RECORTA, não estica) ──
    //
    // A opção se chama "remover bordas pretas" mas até 2026-09-29 ela pulava a preservação
    // de aspect (esticava/distorcia) e o caminho de crop era código morto — SetCropRect não
    // tinha call site. Estas aritméticas fixam o comportamento que o NOME promete: cortar as
    // barras da Captura, preservando a proporção. Geométrico (só dims, sem ler pixel), então
    // custo zero no caminho de captura: o crop vira filtro ffmpeg depois da NV12.

    [Fact]
    public void ComputeLetterboxCrop_FonteEMesmoAspecto_DoNaoCorta()
    {
        // 16:9 → 16:9: não há barra para remover. Este é o caso real do usuário
        // (captura 1920×1080, todos os presets 16:9) — a opção precisa ser no-op.
        var crop = FfmpegEncoder.ComputeLetterboxCrop(1920, 1080, 1920, 1080);
        Assert.Null(crop);
    }

    [Fact]
    public void ComputeLetterboxCrop_16por10Para16por9_CortaTopoEBase()
    {
        // Janela 16:10 rodando jogo 16:9 = letterbox. Mantém a largura inteira
        // (1920×1200 → 1920×1080) e centraliza: y = (1200−1080)/2 = 60.
        var crop = FfmpegEncoder.ComputeLetterboxCrop(1920, 1200, 1920, 1080);
        Assert.NotNull(crop);
        Assert.Equal((0, 60, 1920, 1080), crop!.Value);
    }

    [Fact]
    public void ComputeLetterboxCrop_21por9Para16por9_CortaLaterais()
    {
        // 3440×1440 (21:9) → 16:9 = pillarbox. Mantém a altura inteira e aperta a largura
        // para 1440×16/9 = 2560, centralizando: x = (3440−2560)/2 = 440.
        var crop = FfmpegEncoder.ComputeLetterboxCrop(3440, 1440, 1920, 1080);
        Assert.NotNull(crop);
        Assert.Equal((440, 0, 2560, 1440), crop!.Value);
    }

    [Fact]
    public void ComputeLetterboxCrop_PreservaProporcaoDoAlvo_EmVezDeEsticar()
    {
        // A trava do que a opção NÃO faz mais: o retângulo tem exatamente a proporção do alvo.
        // Com o stretch antigo, 2560×1600 preenchia 1920×1080 (imagem 1,5× achatada).
        var crop = FfmpegEncoder.ComputeLetterboxCrop(2560, 1600, 1920, 1080);
        Assert.NotNull(crop);
        var (_, _, w, h) = crop!.Value;
        Assert.Equal(1920.0 / 1080.0, (double)w / h, 3);
    }

    [Fact]
    public void ComputeLetterboxCrop_AlvoNativo_NaoCorta()
    {
        // Sem preset (0×0) o alvo É a própria entrada → nada a cortar.
        Assert.Null(FfmpegEncoder.ComputeLetterboxCrop(2560, 1600, 0, 0));
    }

    [Theory]
    [InlineData(1921, 1200)] // largura ímpar, barra vertical real
    [InlineData(4000, 1443)] // altura ímpar: round(1443×16/9)=2565 cai em ímpar
    [InlineData(1367, 1201)]
    public void ComputeLetterboxCrop_DimsPares_Sempre(int srcW, int srcH)
    {
        // NV12 exige dims pares; ímpar deixaria o ffmpeg recusar o rawvideo.
        // (Um 1921×1081 daria null de propósito — diferença de 0,0009 fica no epsilon,
        //  e cortar 1px de uma imagem sem barra seria pior que não cortar.)
        var crop = FfmpegEncoder.ComputeLetterboxCrop(srcW, srcH, 1920, 1080);
        Assert.NotNull(crop);
        var c = crop!.Value;
        Assert.Equal(0, c.W % 2);
        Assert.Equal(0, c.H % 2);
        Assert.Equal(0, c.X % 2);
        Assert.Equal(0, c.Y % 2);
    }

    [Fact]
    public void ComputeLetterboxCrop_RetanguloNuncaSomeDoFrame()
    {
        // o crop precisa caber dentro da captura (x+w ≤ srcW, y+h ≤ srcH) — um arredondamento
        // para cima aqui daria filtro crop inválido e o encoder morreria no primeiro frame.
        foreach (var (srcW, srcH, tgtW, tgtH) in new[]
                 {
                     (3440, 1440, 1920, 1080), (1920, 1200, 1920, 1080),
                     (2560, 1600, 1920, 1080), (2560, 1080, 1920, 1080),
                     (1366, 768, 1920, 1080), (3840, 1600, 1920, 1080),
                 })
        {
            var crop = FfmpegEncoder.ComputeLetterboxCrop(srcW, srcH, tgtW, tgtH);
            if (crop is not { } c) continue;
            Assert.True(c.X >= 0 && c.Y >= 0, $"origem negativa em {srcW}x{srcH}");
            Assert.True(c.W <= srcW && c.H <= srcH, $"retângulo maior que a fonte em {srcW}x{srcH}");
            Assert.True(c.X + c.W <= srcW && c.Y + c.H <= srcH, $"retângulo estoura a fonte em {srcW}x{srcH}");
        }
    }

    [Fact]
    public void ComputeLetterboxCrop_DiferencaMinima_IgnoraParaNaoCortarPorRuido()
    {
        // 1920×1080 vs alvo 1919×1079: diferença de 1px não é barra, é arredondamento.
        // Cortar aqui tiraria 1px de imagem por nada (e o alvo preservaria o aspecto de novo).
        Assert.Null(FfmpegEncoder.ComputeLetterboxCrop(1920, 1080, 1919, 1079));
    }

    // ─── ResolveEffectiveCrop + BuildCropScaleFilters: o filtro existe DE VERDADE ──

    [Fact]
    public void ResolveEffectiveCrop_Desligado_NaoCorta()
    {
        Assert.Null(FfmpegEncoder.ResolveEffectiveCrop(false, 0, 0, 0, 0, 1920, 1200, 1920, 1080));
    }

    [Fact]
    public void ResolveEffectiveCrop_LigadoComBarra_CortaGeometricamente()
    {
        var crop = FfmpegEncoder.ResolveEffectiveCrop(true, 0, 0, 0, 0, 1920, 1200, 1920, 1080);
        Assert.Equal((0, 60, 1920, 1080), crop!.Value);
    }

    [Fact]
    public void ResolveEffectiveCrop_Regressao_Captura16por9NaoGeraCrop()
    {
        // O caso real do usuário: 1920×1080 num preset 16:9. Com a opção LIGADA não pode
        // aparecer crop — senão o "remover bordas pretas" comeria 1px de imagem à toa.
        Assert.Null(FfmpegEncoder.ResolveEffectiveCrop(true, 0, 0, 0, 0, 1920, 1080, 1920, 1080));
    }

    [Fact]
    public void ResolveEffectiveCrop_CropExplicito_TemPrecedencia()
    {
        // SetCropRect manual é o seam público e sempre vale: o geométrico não pode sobrescrever.
        var crop = FfmpegEncoder.ResolveEffectiveCrop(true, 10, 20, 800, 450, 1920, 1200, 1920, 1080);
        Assert.Equal((10, 20, 800, 450), crop!.Value);
    }

    [Fact]
    public void BuildCropScaleFilters_ComBarra_EmiteCropNoVf()
    {
        // A trava que faltava na versão anterior: a aritmética existir não basta — o filtro
        // `crop=` precisa aparecer na cadeia, senão a opção é no-op de novo.
        var crop = FfmpegEncoder.ComputeLetterboxCrop(1920, 1200, 1920, 1080);
        var filters = FfmpegEncoder.BuildCropScaleFilters(1920, 1200, crop, 1920, 1080, 1, out _);
        Assert.Equal("crop=1920:1080:0:60", filters[0]);
    }

    [Fact]
    public void BuildCropScaleFilters_SemBarra_NaoEmiteCrop()
    {
        var filters = FfmpegEncoder.BuildCropScaleFilters(1920, 1080, null, 1280, 720, 1, out _);
        Assert.DoesNotContain(filters, f => f.StartsWith("crop=", StringComparison.Ordinal));
        // Sem crop o scale vai na conversão (NV12 já sai no alvo) — logo não há scale no vf.
        Assert.DoesNotContain(filters, f => f.StartsWith("scale=", StringComparison.Ordinal));
    }

    [Fact]
    public void BuildCropScaleFilters_CropComScale_NaoUpscale()
    {
        // Com crop o base do scale é o frame cortado: 3440×1440 → crop 2560×1440, preset
        // 1920×1080 ⇒ scale 1920×1080. O divisor de capacidade entra sobre o recorte.
        var crop = FfmpegEncoder.ComputeLetterboxCrop(3440, 1440, 1920, 1080);
        var filters = FfmpegEncoder.BuildCropScaleFilters(3440, 1440, crop, 1920, 1080, 1, out var r);
        Assert.Equal("crop=2560:1440:440:0", filters[0]);
        Assert.Equal("scale=1920:1080", filters[1]);
        // Com crop a NV12 continua no tamanho CHEIO da captura (o recorte é filtro do ffmpeg,
        // então a conversão não muda) e o que o encoder recebe é o pós-crop escalado.
        Assert.Equal(3440, r.Nv12W);
        Assert.Equal(1440, r.Nv12H);
        Assert.Equal(1920, r.EncodedW);
        Assert.Equal(1080, r.EncodedH);
    }

    // ─── ResolveOutput (O1 — onde o downscale acontece: conversão vs vf) ─

    [Fact]
    public void ResolveOutput_NoCrop_User720p_MovesScaleToNv12_NoScaleInVf()
    {
        // O1: captura 1920×1080 + user 720p, sem crop → a NV12 JÁ sai em 1280×720
        // (downscale na conversão) e o ffmpeg recebe rawvideo nessa resolução (-s),
        // SEM filtro scale no vf (ScaleW/H = null).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 1280, 720, 1);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1280, 720), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
        Assert.Null(r.ScaleH);
    }

    [Fact]
    public void ResolveOutput_NoCrop_Native_NoScaleAnywhere()
    {
        // Sem crop e sem resolução do usuário (nativo) → nada muda: encoded == capture,
        // NV12 == capture, sem scale.
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 0, 0, 1);
        Assert.Equal((1920, 1080), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_NoCrop_FallbackDivisor_DownscaleInNv12()
    {
        // Nativo + fallback 1/2 → o piso absoluto segura em 1280×720 na NV12 (conversão),
        // sem scale no vf. Sem o piso seria 960×540.
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 0, 0, 2);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1280, 720), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_NoCrop_User1080p_FallbackKeepsUserResolution()
    {
        // Resolução da UI é sagrada: user 1080p + divisor 2 continua 1920×1080 na NV12,
        // sem scale. (Antes o "Item 1" degradava para 720p — foi o que quebrou o A/V na
        // sessão FiveM de 2026-10-03.)
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 1920, 1080, 2);
        Assert.Equal((1920, 1080), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_NoCrop_User720p_FallbackKeepsUserFloor()
    {
        // User 720p com fallback 1/2 → mantém 1280×720: a resolução da UI é sagrada e
        // o divisor só age em native (sem alvo explícito).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 0, 0, 1280, 720, 2);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1280, 720), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_CropActive_KeepsNv12AtCapture_ScaleInVf()
    {
        // Crop (código morto hoje) → NV12 sai nas dims da captura (ffmpeg faz crop+scale no vf).
        // Crop 1600×900 na captura 1920×1080 + user 720p → scale 1280×720 vai no vf.
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 1600, 900, 1280, 720, 1);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
        Assert.Equal(1280, r.ScaleW);
        Assert.Equal(720, r.ScaleH);
    }

    [Fact]
    public void ResolveOutput_CropActive_NoUserOutput_ScaleInVfNull()
    {
        // Crop sem resolução do usuário → scale não é necessário (crop define a saída).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 1280, 720, 0, 0, 1);
        Assert.Equal((1280, 720), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
        Assert.Null(r.ScaleW);
    }

    [Fact]
    public void ResolveOutput_CropClampedTo320x240()
    {
        // Crop menor que 320×240 é elevado ao mínimo (mesma regra do StartFfmpeg).
        var r = FfmpegEncoder.ResolveOutput(1920, 1080, 100, 100, 0, 0, 1);
        Assert.Equal((320, 240), (r.EncodedW, r.EncodedH));
        Assert.Equal((1920, 1080), (r.Nv12W, r.Nv12H));
    }

    // ─── BuildWeightedPredArg ─────────────────────────────────────────────

    [Fact]
    public void BuildWeightedPredArg_BframesZero_ReturnsWeightedPred()
    {
        // Preset Boa (bf 0): weighted_pred é válido e aplicado.
        Assert.Equal(" -weighted_pred 1", FfmpegEncoder.BuildWeightedPredArg(true));
    }

    [Fact]
    public void BuildWeightedPredArg_BframesNonZero_ReturnsEmpty()
    {
        // ffmpeg 9.0 rejeita weighted_pred com B-frames ("invalid param (8)") — omitido.
        Assert.Equal("", FfmpegEncoder.BuildWeightedPredArg(false));
    }

    // ─── Multipass (NVENC only) ──────────────────────────────────────────

    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("hevc_nvenc")]
    [InlineData("av1_nvenc")]
    public void BuildEncoderTuneArgs_NvencMultipassTrue_EmitsFullRes(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 16, "p5", "speed", multipass: true);
        Assert.Contains("-multipass fullres", args);
        Assert.DoesNotContain("-multipass disabled", args);
    }

    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("hevc_nvenc")]
    [InlineData("av1_nvenc")]
    public void BuildEncoderTuneArgs_NvencMultipassFalse_EmitsDisabled(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 16, "p5", "speed", multipass: false);
        Assert.Contains("-multipass disabled", args);
    }

    // ─── BuildEncoderTuneArgs ───────────────────────────────────────────

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UseAmfArgs(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-quality speed", args);
        Assert.Contains("-rc vbr_peak", args);
        Assert.DoesNotContain("-crf", args);
        Assert.DoesNotContain("-preset veryfast", args);
        Assert.DoesNotContain("-profile:v high", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Av1Amf_DoesNotUseCpuFallbackArgs()
    {
        // Bug: av1_amf caía no default libx264 → -crf/-bf 0/-profile:v high inválidos p/ AMF.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("av1_amf", 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("-crf", args);
        Assert.DoesNotContain("-preset veryfast", args);
        Assert.DoesNotContain("-profile:v high", args);
        Assert.Contains("-quality speed", args);
    }

    [Theory]
    [InlineData("libx264")]
    [InlineData("libx265")]
    public void BuildEncoderTuneArgs_CpuFallback_UsesFastPreset(string codec)
    {
        // Alavanca 6: preset de CPU sobe de veryfast para fast (melhora retenção de
        // detalhe em movimento; realtime ainda folgado em máquinas modernas).
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-preset fast ", args);
        Assert.DoesNotContain("veryfast", args);
        Assert.Contains("-bf 0", args);
        Assert.Contains("-crf", args);
        Assert.DoesNotContain("zerolatency", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_UnknownCodec_DefaultBranchUsesFastPreset()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs("mpeg2video", 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-preset fast ", args);
        Assert.DoesNotContain("veryfast", args);
        Assert.Contains("-bf 0", args);
        Assert.Contains("-profile:v high", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Av1Amf_NoMeQuarterPel()
    {
        // av1_amf não expõe -me_quarter_pel (só h264/hevc_amf) — passá-lo causa erro de opção.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("av1_amf", 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("me_quarter_pel", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_H264Amf_KeepsMeQuarterPel()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs("h264_amf", 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("me_quarter_pel true", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UsesFillerData_NotFiller(string codec)
    {
        // Bug (2026-08-11): -filler 0 não existe no ffmpeg 9 — o encoder AMF abortava com
        // "Unrecognized option 'filler'" a cada restart (exit code, restart loop). Opção real: -filler_data.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-filler_data 0", args);
        Assert.DoesNotContain(" -filler ", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AmfCodecs_AllOptionsExistInFfmpeg9()
    {
        // Se qualquer opção AMF aqui não existir no ffmpeg 9, o encoder aborta com "Unrecognized option".
        foreach (var codec in new[] { "av1_amf", "h264_amf", "hevc_amf" })
        {
            var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
            Assert.Contains("-quality speed", args);
            Assert.Contains("-rc vbr_peak", args);
            Assert.Contains("-b:v 14400K", args);
            Assert.Contains("-maxrate 40000K", args);
            Assert.Contains("-bufsize 80000K", args);
            Assert.DoesNotContain("-qp_i ", args);
            Assert.DoesNotContain("-qp_p ", args);
            Assert.Contains("-bf 0", args);
            // GOP 60 desde o Item 4 (era 120 = 2 s de rollback no corte; agora 1 s).
            Assert.Contains("-g 60", args);
            Assert.DoesNotContain("-g 120", args);
            Assert.Contains("-filler_data 0", args);
            Assert.Contains("-enforce_hrd 0", args);
        }
    }

    // ── Item 4: GOP 60 (rollback do corte 2s → 1s) ────────────────────────────
    //
    // Sem B-frames (item 7), um corte só pode começar num I-frame. Com -g 120 a 60fps o
    // GOP é de 2 s, então o corte recua até 2 s do pedido — o usuário vê "o clip começa
    // antes do que devia". Com -g 60 o rollback cai pela metade e o custo é irrelevante:
    // dobrar a frequência de I-frame só acrescenta 1 bit de flag por frame mais o
    // predictor intra de 1 frame a cada 60, e o --probe-vbv mediu ~48,5 Mbps de folga
    // contra o teto de -maxrate, então sobra orçamento.
    //
    // Este teste cobre TODOS os codecs: NVENC, QSV, AMF, D3D12VA e os 2 de CPU. Alguns
    // já vinham em 60 (QSV usava -g 60; libx265 usava keyint=60 no x265-params) — o
    // teste existe para travar essa uniformidade e pegar qualquer codec novo que volte
    // a 120 (ou que nem declare GOP, como o libx264 fazia: x264 default é keyint=250,
    // pior que 120).
    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("hevc_nvenc")]
    [InlineData("av1_nvenc")]
    [InlineData("h264_qsv")]
    [InlineData("hevc_qsv")]
    [InlineData("av1_qsv")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    [InlineData("h264_d3d12va")]
    [InlineData("hevc_d3d12va")]
    [InlineData("av1_d3d12va")]
    [InlineData("libx264")]
    [InlineData("libx265")]
    public void BuildEncoderTuneArgs_AllCodecs_UseGop60(string codec)
        {
            var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");

            // Nenhum codec pode declarar GOP de 2 s (nem o x265, que esconde o keyint em -x265-params).
            Assert.DoesNotContain("-g 120", args);
            Assert.DoesNotContain("-g 250", args);
            Assert.DoesNotContain("keyint=120", args);
            Assert.DoesNotContain("keyint_min=120", args);

            // Todos declaram GOP de 1 s, e o valor é conferido EXATO — a versão anterior
            // aceitava `args.Contains("-g 60") || args.Contains("keyint=60")`, que passaria
            // igual se só metade das chains usasse {Gop} e as outras continuassem no literal
            // 60. Agora cada ocorrência é contada e o valor comparado (mesma lição do
            // `-profile:v main` do Item 9: Contains de prefixo é trava decorativa).
            var declarados = DeclaredGopValues(args);
            Assert.True(declarados.Length > 0, $"chain de {codec} não declara GOP nenhum: {args}");
            Assert.All(declarados, v => Assert.Equal(FfmpegEncoder.Gop.ToString(), v));
        }

    /// <summary>Todos os valores de GOP declarados na chain: <c>-g N</c>, <c>keyint=N</c> e
    /// <c>min-keyint=N</c>. Extrair por regex (e não por <c>Contains</c>) é o que impede a
    /// trava decorativa: <c>Contains("-g 60")</c> também casa com <c>-g 600</c>, e
    /// <c>Contains("main")</c> com <c>main10</c>.</summary>
    private static string[] DeclaredGopValues(string args) =>
        System.Text.RegularExpressions.Regex.Matches(args, @"(?<!min-)-g (\d+)")
            .Select(m => m.Groups[1].Value)
            .Concat(System.Text.RegularExpressions.Regex.Matches(args, @"(?<!min-)keyint=(\d+)")
                .Select(m => m.Groups[1].Value))
            .Concat(System.Text.RegularExpressions.Regex.Matches(args, @"min-keyint=(\d+)")
                .Select(m => m.Groups[1].Value))
            .ToArray();

    // O GOP é o que limita o rollback do corte, então ele não pode depender do preset/cq:
    // 60 frames @60fps = 1 s sempre, com qualquer preset e qualquer CQ.
    [Fact]
    public void BuildEncoderTuneArgs_Gop60_IsIndependentOfPresetAndCq()
    {
        foreach (var codec in new[] { "h264_nvenc", "av1_amf", "libx264" })
        {
            foreach (var preset in new[] { "p1", "p5", "p7", "speed", "quality" })
            {
                foreach (var cq in new[] { 16.0, 20.0, 22.0 })
                {
                    var args = FfmpegEncoder.BuildEncoderTuneArgs(
                        codec, cq, 40000, 80000, 2, 32, preset);
                    // Valor EXATO, pela mesma razão do teste acima: a forma anterior
                    // (`Contains("-g 60") || Contains("keyint=60")`) passaria com metade das
                    // chains no literal e a outra metade em {Gop}, e ainda passaria com
                    // "-g 600".
                    var declarados = DeclaredGopValues(args);
                    Assert.True(declarados.Length > 0, $"{codec} não declara GOP: {args}");
                    Assert.All(declarados, v => Assert.Equal(FfmpegEncoder.Gop.ToString(), v));
                }
            }
        }
    }

    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_H264HevcAmf_UsesVbaq(string codec)
    {
        // h264/hevc_amf: VBAQ é o AQ clássico da família AVC/HEVC da AMF.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-vbaq true", args);
        Assert.DoesNotContain("-aq_mode ", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Av1Amf_UsesAqModeCaq_NotVbaq()
    {
        // Bug (2026-09-14): -vbaq é opção regia do av1_amf — verificada no ffmpeg 9.0.1 real
        // ("has not been used for any stream"). O AQ do código AV1 da AMF é -aq_mode caq
        // (context adaptive quantization), valor 1 no help do ffmpeg — sem ele, AV1 AMD fica
        // sem adaptive quantization nenhum (qualidade assimétrica em cenas complexas).
        var args = FfmpegEncoder.BuildEncoderTuneArgs("av1_amf", 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-aq_mode caq", args);
        Assert.DoesNotContain("-vbaq ", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_PreanalysisAdded_WhenProbeSustains(string codec)
    {
        // DGPU forte (probe sustenta quality/high_quality): liga preanalysis + TAQ para
        // máxima qualidade perceptiva (padrão AMD). O PA NUNCA entra sem o probe ter passado
        // por SelectAmfPreanalysis — iGPU/VCN 1.0 degrada p/ balanced/speed e fica OFF.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4", "quality", amfPreanalysis: true);
        Assert.Contains("-preanalysis true", args);
        Assert.Contains("-pa_taq_mode 2", args);
        Assert.DoesNotContain("-pa_adaptive_mini_gop", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_PreanalysisAbsent_WhenNotSustained(string codec)
    {
        // Padrão (iGPU/fraca): sem PA — cadeia preanalysis ausente nos 3 codecs AMF.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("preanalysis", args);
        Assert.DoesNotContain("pa_", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_SavEnabled_WhenSupported(string codec)
    {
        // SAV só entra quando SupportsSmartAccessVideo confirmou (≥2 adapters AMD + probe ok).
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4", amfSav: true);
        Assert.Contains("-smart_access_video 1", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_SavAbsent_ByDefault(string codec)
    {
        // Padrão sem SAV — dGPU-only/iGPU-only (1 adapter) nunca recebe -smart_access_video.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("smart_access_video", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_VbrPeak_NeverMixesQuantizer(string codec)
    {
        // Bug obs-ffmpeg #12994: QP + RC de bitrate = QP sobrepõe o alvo. Em vbr_peak o alvo
        // (b:v) é quem manda — QP nunca deve ser passado junto (senão o teto de bitrate some).
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-rc vbr_peak", args);
        Assert.Contains("-b:v 14400K", args);
        Assert.DoesNotContain("-qp_i ", args);
        Assert.DoesNotContain("-qp_p ", args);
    }

    [Theory]
    [InlineData(40000, 14400)]
    [InlineData(55000, 19800)]
    [InlineData(12000, 6000)]
    [InlineData(200000, 50000)]
    public void BuildEncoderTuneArgs_AmfCodecs_BitrateTarget_ScalesWithMaxrate(int maxrateKbps, int expectedTargetKbps)
    {
        // Alvo = 36% do maxrate do front (Medal: 1080p ≈ 15-20 Mbps; "alta" 55000 → 19800).
        // Clamp [6000, 50000]: presets fracos não caem abaixo do mínimo p/ 720p, 4K não estoura.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("h264_amf", 22, maxrateKbps, maxrateKbps * 2, 2, 32, "p4");
        Assert.Contains($"-b:v {expectedTargetKbps}K", args);
        Assert.Contains($"-maxrate {maxrateKbps}K", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UseGop60(string codec)
    {
        // Este teste fixava "-g 120" como se fosse um BENEFÍCIO ("~10% mais compressão com
        // seek em intervalos de 2s"). O Item 4 trocou a premissa: sem B-frames, GOP 120
        // significava que TODO corte recuava até 2 s para o I-frame anterior — sintoma que o
        // usuário percebia. A economia de bitrate era de ~<1% (o --probe-vbv mediu 48,5 Mbps
        // de folga contra o teto de -maxrate), então trocar 2 s de erro visível por <1% de
        // arquivo é ganho líquido. O nome foi trocado junto: "UsesGop2Seconds" agora mentiria.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-g 60", args);
        Assert.DoesNotContain("-g 120", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_IncludesVbvBitrateTarget(string codec)
    {
        // vbr_peak: -b:v é o alvo médio e -maxrate/-bufsize o teto VBV — o CQP puro (sem alvo)
        // estourou ~180 Mbps na RX 5700 XT (cq 18) → VCN + spill 10x, clip de 94s ≈ 930 MB.
        // 6.11 Item 2: mediu-se que o -bufsize não tem efeito nessas chains (ver
        // BuildEncoderTuneArgs_KeepsConfiguredBufsizeForEveryCodec) — o front manda, e é o que vai.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-b:v 14400K", args);
        Assert.Contains("-maxrate 40000K", args);
        Assert.Contains("-bufsize 80000K", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AmfCodecs_DoesNotIncludePreanalysisChain()
    {
        // Preset quality (default antigo) + preanalysis + lookahead 40 era pesado demais pra RDNA1
        // (VCN 1.0): encoder AMF rodava a ~0.55x speed → drift A/V crescente ~1.6-1.9s e clips com
        // activeFps=36 em vez de 60. Agora usa -quality speed (preset rápido) sem a cadeia preanalysis.
        foreach (var codec in new[] { "av1_amf", "h264_amf", "hevc_amf" })
        {
            var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
            Assert.DoesNotContain("preanalysis", args);
            Assert.DoesNotContain("pa_taq_mode", args);
            Assert.DoesNotContain("pa_lookahead_buffer_depth", args);
            Assert.DoesNotContain("pa_paq_mode", args);
            Assert.DoesNotContain("pa_adaptive_mini_gop", args);
            Assert.DoesNotContain("pa_scene_change_detection", args);
            Assert.DoesNotContain("high_motion_quality_boost", args);
        }
    }

    // ─── AMF adaptive preset (param amfPreset no seam) ──────────────────

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_UseCustomAmfPreset(string codec)
    {
        // Preset adaptativo (SelectAmfPreset) escolhido por machine: GPU forte fica quality,
        // GPU fraca degrada para balanced/speed. O seam deve injetar o preset escolhido.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4", "balanced");
        Assert.Contains("-quality balanced", args);
    }

    [Theory]
    [InlineData("av1_amf")]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_DefaultPresetIsSpeed(string codec)
    {
        // Chamadas sem o param amfPreset (testes pré-existentes / fallback de produção)
        // mantêm -quality speed — preset leve nunca causa restart loop nem lentidão.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-quality speed", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AmfCodecs_NormalizesInvalidPresetToSpeed()
    {
        // Preset inválido nunca chega ao ffmpeg — o seam normaliza para speed.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("h264_amf", 22, 40000, 80000, 2, 32, "p4", "ultra");
        Assert.Contains("-quality speed", args);
        Assert.DoesNotContain("-quality ultra", args);
    }

    [Theory]
    [InlineData("quality", "quality")]
    [InlineData("balanced", "balanced")]
    [InlineData("speed", "speed")]
    [InlineData("high_quality", "high_quality")]
    [InlineData("High_Quality", "high_quality")]
    [InlineData(" HIGH_QUALITY ", "high_quality")]
    [InlineData("QUALITY", "quality")]
    [InlineData(" Balanced ", "balanced")]
    [InlineData("ultra", "speed")]
    [InlineData("", "speed")]
    [InlineData(null, "speed")]
    public void NormalizeAmfPreset_ReturnsNormalizedOrSpeed(string? input, string expected)
    {
        Assert.Equal(expected, FfmpegEncoder.NormalizeAmfPreset(input));
    }

    // ─── QSV (Intel) ────────────────────────────────────────────────────

    [Theory]
    [InlineData("h264_qsv")]
    [InlineData("hevc_qsv")]
    [InlineData("av1_qsv")]
    public void BuildEncoderTuneArgs_QsvCodecs_UseQsvArgs(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-preset veryslow", args);
        Assert.Contains("-global_quality", args);
        Assert.Contains("-extbrc 1", args);
        Assert.Contains("-maxrate 40000K", args);
        Assert.DoesNotContain("-crf", args);
        Assert.DoesNotContain("-profile:v high", args);
    }

    [Theory]
    [InlineData("h264_qsv")]
    [InlineData("hevc_qsv")]
    public void BuildEncoderTuneArgs_H264HevcQsv_UseRdoMbbrc(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 22, 40000, 80000, 2, 32, "p4");
        Assert.Contains("-rdo 1", args);
        Assert.Contains("-mbbrc 1", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Qsv_DoesNotIncludeExtraHwFrames()
    {
        // ffmpeg 9 rejeita -extra_hw_frames como opção de encoder ("not a encoding option").
        var args = FfmpegEncoder.BuildEncoderTuneArgs("h264_qsv", 22, 40000, 80000, 2, 32, "p4");
        Assert.DoesNotContain("extra_hw_frames", args);
    }

    // ─── GetRawFormatForCodec ───────────────────────────────────────────

    [Theory]
    [InlineData("av1_amf", "av1")]
    [InlineData("av1_nvenc", "av1")]
    [InlineData("libsvtav1", "av1")]
    [InlineData("av1_d3d12va", "av1")]
    [InlineData("av1_qsv", "av1")]
    [InlineData("hevc_amf", "hevc")]
    [InlineData("h264_amf", "h264")]
    [InlineData("h264_qsv", "h264")]
    [InlineData("hevc_qsv", "hevc")]
    [InlineData("libx264", "h264")]
    public void GetRawFormatForCodec_ReturnsExpected(string codec, string expected)
    {
        Assert.Equal(expected, FfmpegEncoder.GetRawFormatForCodec(codec));
    }

    // ─── IsAv1Keyframe ──────────────────────────────────────────────────

    [Fact]
    public void IsAv1Keyframe_FrameHeaderObu_KeyFrame_ReturnsTrue()
    {
        // OBU FRAME_HEADER (type 3) com frame_type == 0 (KEY_FRAME).
        // Primeiro byte do payload (AV1 §5.9.1, MSB→LSB):
        //   frame_marker(2)=01 | version(1)=0 | show_existing_frame(1)=0 |
        //   frame_type(2)=00 | show_frame(1) | error_resilient_mode(1) → 0x40
        var payload = new byte[] { 0x40 };
        var data = BuildAv1Obu(3, payload);
        Assert.True(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_FrameObu_KeyFrame_ReturnsTrue()
    {
        // OBU FRAME (type 6) com frame_type == 0 (KEY_FRAME) → 0x40.
        var payload = new byte[] { 0x40 };
        var data = BuildAv1Obu(6, payload);
        Assert.True(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_FrameHeaderObu_InterFrame_ReturnsFalse()
    {
        // frame_type == 1 (INTER_FRAME) → bits [3..2] = 01 → 0x44.
        var payload = new byte[] { 0x44 };
        var data = BuildAv1Obu(3, payload);
        Assert.False(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_FrameObu_InterFrame_ReturnsFalse()
    {
        var payload = new byte[] { 0x44 };
        var data = BuildAv1Obu(6, payload);
        Assert.False(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_WithTemporalDelimiterAndSequenceHeader_DetectsKeyFrame()
    {
        // Payload realista: TEMPORAL_DELIMITER (2) → SEQUENCE_HEADER (1) → FRAME (6).
        var delimiter = BuildAv1Obu(2, Array.Empty<byte>());
        var seqHeader = BuildAv1Obu(1, new byte[] { 0x80, 0x00 });
        var frame = BuildAv1Obu(6, new byte[] { 0x40 });
        var data = Concat(delimiter, seqHeader, frame);
        Assert.True(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_OnlyDelimiter_ReturnsFalse()
    {
        var data = BuildAv1Obu(2, Array.Empty<byte>());
        Assert.False(FfmpegEncoder.IsAv1Keyframe(data, data.Length));
    }

    [Fact]
    public void IsAv1Keyframe_Empty_ReturnsFalse()
    {
        Assert.False(FfmpegEncoder.IsAv1Keyframe(Array.Empty<byte>(), 0));
    }

    [Fact]
    public void IsAv1Keyframe_TruncatedObu_ReturnsFalse()
    {
        var payload = new byte[] { 0x00 };
        var data = BuildAv1Obu(6, payload);
        var truncated = new byte[data.Length - 1];
        Array.Copy(data, truncated, truncated.Length);
        Assert.False(FfmpegEncoder.IsAv1Keyframe(truncated, truncated.Length));
    }

    private static byte[] BuildAv1Obu(int obuType, byte[] payload)
    {
        // AV1 OBU header byte: forbidden(1) | obu_type(4) | extension(1) | has_size(1) | reserved(1).
        byte header = (byte)((obuType << 3) | 0x02); // has_size_field = 1
        var size = Leb128(payload.Length);
        var result = new byte[1 + size.Length + payload.Length];
        result[0] = header;
        Array.Copy(size, 0, result, 1, size.Length);
        Array.Copy(payload, 0, result, 1 + size.Length, payload.Length);
        return result;
    }

    private static byte[] Leb128(int value)
    {
        var bytes = new System.Collections.Generic.List<byte>();
        do
        {
            byte b = (byte)(value & 0x7F);
            value >>= 7;
            if (value > 0) b |= 0x80;
            bytes.Add(b);
        } while (value > 0);
        return bytes.ToArray();
    }

    private static byte[] Concat(params byte[][] arrays)
    {
        int total = 0;
        foreach (var a in arrays) total += a.Length;
        var result = new byte[total];
        int offset = 0;
        foreach (var a in arrays)
        {
            Array.Copy(a, 0, result, offset, a.Length);
            offset += a.Length;
        }
        return result;
    }

    // ─── TryWriteStdin / ComputeStdinWriteTimeout ──────────────────────

    [Fact]
    public void TryWriteStdin_ResponsiveStream_ReturnsOk()
    {
        using var ms = new MemoryStream();
        var result = FfmpegEncoder.TryWriteStdin(ms, new byte[] { 1, 2, 3 }, 200, out var fault);
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Ok, result);
        Assert.Null(fault);
        Assert.Equal(new byte[] { 1, 2, 3 }, ms.ToArray());
    }

    [Fact]
    public void TryWriteStdin_SlowStream_TimesOutWithoutHanging()
    {
        var stream = new NeverCompletingStream();
        var sw = Stopwatch.StartNew();
        var result = FfmpegEncoder.TryWriteStdin(stream, new byte[] { 1 }, 100, out var fault);
        sw.Stop();
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Timeout, result);
        Assert.Null(fault);
        Assert.True(sw.ElapsedMilliseconds < 2000, $"Wait deve respeitar o timeout; levou {sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public void TryWriteStdin_FaultingStream_ReturnsFaultedWithException()
    {
        var stream = new FaultingStream();
        var result = FfmpegEncoder.TryWriteStdin(stream, new byte[] { 1 }, 2000, out var fault);
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Faulted, result);
        Assert.IsType<IOException>(fault);
    }

    [Fact]
    public void TryWriteStdin_EmptyData_StillWritesOk()
    {
        using var ms = new MemoryStream();
        var result = FfmpegEncoder.TryWriteStdin(ms, Array.Empty<byte>(), 200, out var fault);
        Assert.Equal(FfmpegEncoder.StdinWriteResult.Ok, result);
        Assert.Null(fault);
    }

    [Fact]
    public void ComputeStdinWriteTimeout_WarmupNoOutput_ReturnsGenerousTimeout()
    {
        Assert.Equal(FfmpegEncoder.StdinWriteWarmupTimeoutMs, FfmpegEncoder.ComputeStdinWriteTimeout(0));
        Assert.True(FfmpegEncoder.StdinWriteWarmupTimeoutMs > FfmpegEncoder.StdinWriteTimeoutMs);
    }

    [Fact]
    public void ComputeStdinWriteTimeout_ProducingOutput_ReturnsStrictTimeout()
    {
        Assert.Equal(FfmpegEncoder.StdinWriteTimeoutMs, FfmpegEncoder.ComputeStdinWriteTimeout(1));
        Assert.Equal(FfmpegEncoder.StdinWriteTimeoutMs, FfmpegEncoder.ComputeStdinWriteTimeout(9001));
    }

    // ─── CanUseDirectInput (O2 — evita a cópia redundante p/ texturas SR) ──

    [Theory]
    [InlineData(BindFlags.ShaderResource, true)]
    [InlineData(BindFlags.ShaderResource | BindFlags.RenderTarget, true)]
    [InlineData(BindFlags.None, false)]
    [InlineData(BindFlags.RenderTarget, false)]
    public void CanUseDirectInput_ChecksShaderResourceFlag(BindFlags flags, bool expected)
    {
        var desc = new Texture2DDescription
        {
            Width = 1920, Height = 1080, MipLevels = 1, ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = flags,
            CPUAccessFlags = CpuAccessFlags.None
        };
        Assert.Equal(expected, FfmpegEncoder.CanUseDirectInput(desc));
    }

    // ─── DownscaleBgra (O1 — fallback CPU em escala de saída) ────────────

    private static byte[] Bgra(byte r, byte g, byte b, byte a = 255) => new[] { b, g, r, a };

    [Fact]
    public void DownscaleBgra_IdentityDimensions_ReturnsCopyUnchanged()
    {
        // 2x2 vermelho → 2x2 (dst == src): mesmos bytes, mesmas dims.
        var src = new byte[] { 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255 };
        var dst = FfmpegEncoder.DownscaleBgra(src, 2, 2, 8, 2, 2);
        Assert.Equal(16, dst.Length);
        Assert.Equal(src, dst);
    }

    [Fact]
    public void DownscaleBgra_SolidColor_AveragesToSameColor()
    {
        // 4x4 cinza (128,128,128) → 2x2: todos os pixels seguem iguais.
        var src = new byte[4 * 4 * 4];
        for (int i = 0; i < src.Length; i += 4)
        {
            src[i] = 128; src[i + 1] = 128; src[i + 2] = 128; src[i + 3] = 255;
        }
        var dst = FfmpegEncoder.DownscaleBgra(src, 4, 4, 16, 2, 2);
        Assert.Equal(16, dst.Length);
        for (int i = 0; i < dst.Length; i += 4)
        {
            Assert.Equal(128, dst[i]); Assert.Equal(128, dst[i + 1]);
            Assert.Equal(128, dst[i + 2]); Assert.Equal(255, dst[i + 3]);
        }
    }

    [Fact]
    public void DownscaleBgra_Bilinear_QuadrantsAverageCenter()
    {
        // 2x2 quadrantes assimétricos → 1x1 média bilinear: TL=vermelho(255,0,0),
        // TR=preto(0,0,0), BL=preto(0,0,0), BR=branco(255,255,255).
        // Centro = (0.5,0.5): R=(255+0+0+255)/4=127.5→128, G=(0+0+0+255)/4=63.75→64,
        // B=(0+0+0+255)/4=63.75→64.
        var src = new byte[]
        {
            0, 0, 255, 255,  0, 0, 0, 255,
            0, 0, 0, 255,  255, 255, 255, 255,
        };
        var dst = FfmpegEncoder.DownscaleBgra(src, 2, 2, 8, 1, 1);
        Assert.Equal(4, dst.Length);
        Assert.Equal(64, dst[0]);   // B
        Assert.Equal(64, dst[1]);   // G
        Assert.Equal(128, dst[2]);  // R
        Assert.Equal(255, dst[3]);  // A
    }

    [Fact]
    public void DownscaleBgra_OddSource_DownscalesToEvenTarget()
    {
        // 3x3 sólido → 2x2: dims corretas e cor preservada.
        var src = new byte[3 * 3 * 4];
        for (int i = 0; i < src.Length; i += 4)
        {
            src[i] = 10; src[i + 1] = 200; src[i + 2] = 40; src[i + 3] = 255;
        }
        var dst = FfmpegEncoder.DownscaleBgra(src, 3, 3, 12, 2, 2);
        Assert.Equal(16, dst.Length);
        for (int i = 0; i < dst.Length; i += 4)
        {
            Assert.Equal(10, dst[i]); Assert.Equal(200, dst[i + 1]);
            Assert.Equal(40, dst[i + 2]); Assert.Equal(255, dst[i + 3]);
        }
    }

    [Fact]
    public void DownscaleBgra_InvalidDims_ReturnsEmpty()
    {
        var src = new byte[16];
        Assert.Empty(FfmpegEncoder.DownscaleBgra(src, 2, 2, 8, 0, 0));
        Assert.Empty(FfmpegEncoder.DownscaleBgra(src, 0, 0, 0, 2, 2));
    }

    // ─── BgraToNv12 (O1 — conversão BGRA→NV12 em escala de saída) ───────

    [Fact]
    public void BgraToNv12_Gray2x2_LimitedRanges()
    {
        // Cinza (128,128,128): Y=126 (BT.601 limited), U=V=128.
        var src = new byte[2 * 2 * 4];
        for (int i = 0; i < src.Length; i += 4)
        {
            src[i] = 128; src[i + 1] = 128; src[i + 2] = 128; src[i + 3] = 255;
        }
        var nv12 = new byte[2 * 2 + (2 / 2) * 2];
        FfmpegEncoder.BgraToNv12(src, 8, 2, 2, nv12);
        Assert.Equal(6, nv12.Length);
        Assert.Equal(new byte[] { 126, 126, 126, 126, 128, 128 }, nv12);
    }

    [Fact]
    public void BgraToNv12_Red2x2_UvInterleavedAtCorrectOffset()
    {
        // Vermelho puro (255,0,0): Y=82, U=90, V=240 (clamp BT.601 limited).
        var src = new byte[]
        {
            0, 0, 255, 255,  0, 0, 255, 255,
            0, 0, 255, 255,  0, 0, 255, 255,
        };
        var nv12 = new byte[2 * 2 + (2 / 2) * 2];
        FfmpegEncoder.BgraToNv12(src, 8, 2, 2, nv12);
        // Y plane (4): 82 82 82 82 — UV plane (2): U=90, V=240
        Assert.Equal(new byte[] { 82, 82, 82, 82, 90, 240 }, nv12);
    }

    // Streams de teste para TryWriteStdin — sem depender de um processo ffmpeg real.

    private sealed class NeverCompletingStream : Stream
    {
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) { }
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously).Task;
    }

    private sealed class FaultingStream : Stream
    {
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => Task.FromException<byte[]>(new IOException("pipe closed"));
    }

    // ─── Item B: Map DoNotWait + GPU busy (DXGI_ERROR_WAS_STILL_DRAWING) ─

    [Fact]
    public void StagingMapFlags_IsDoNotWait()
    {
        Assert.Equal(Vortice.Direct3D11.MapFlags.DoNotWait, FfmpegEncoder.StagingMapFlags);
    }

    [Fact]
    public void IsGpuBusyMapError_WasStillDrawing_ReturnsTrue()
    {
        var ex = new InvalidOperationException("map busy");
        ex.HResult = unchecked((int)0x887A000A); // DXGI_ERROR_WAS_STILL_DRAWING (valor real)
        Assert.True(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_NonCompositedUi_ReturnsFalse()
    {
        var ex = new InvalidOperationException("non-composited ui");
        ex.HResult = unchecked((int)0x887A0021); // DXGI_ERROR_NON_COMPOSITED_UI — NÃO é busy
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_DeviceRemoved_ReturnsFalse()
    {
        var ex = new InvalidOperationException("device removed");
        ex.HResult = unchecked((int)0x887A0005); // DXGI_ERROR_DEVICE_REMOVED
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_EFail_ReturnsFalse()
    {
        var ex = new InvalidOperationException("efail");
        ex.HResult = unchecked((int)0x80004005); // E_FAIL
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(ex));
    }

    [Fact]
    public void IsGpuBusyMapError_DefaultHResult_ReturnsFalse()
    {
        Assert.False(FfmpegEncoder.IsGpuBusyMapError(new InvalidOperationException("no hresult")));
    }

    [Fact]
    public void BuildEncodeDropReason_Busy_ReturnsGpuBusyMessage()
    {
        Assert.Equal("GPU busy (0x887A000A) — frame dropped, retry next frame.", FfmpegEncoder.BuildEncodeDropReason(true));
    }

    [Fact]
    public void BuildEncodeDropReason_NotBusy_ReturnsEncodeError()
    {
        Assert.Equal("Encoder não produziu frame (encode error).", FfmpegEncoder.BuildEncodeDropReason(false));
    }

    [Fact]
    public void GpuBusyDrops_ReadsThroughVolatileField()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_gpuBusyDrops", 3);
        Assert.Equal(3, enc.GpuBusyDrops);
    }

    [Fact]
    public void LastFrameBusyDrop_ReflectsField()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_lastFrameBusyDrop", true);
        Assert.True(enc.LastFrameBusyDrop);
    }

    [Fact]
    public void ResetState_ClearsGpuBusyState()
    {
        using var enc = new FfmpegEncoder();
        SetField(enc, "_lastFrameBusyDrop", true);
        SetField(enc, "_gpuBusyDrops", 5);

        var reset = typeof(FfmpegEncoder).GetMethod("ResetState", BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(reset);
        reset!.Invoke(enc, null);

        Assert.False(enc.LastFrameBusyDrop);
        Assert.Equal(0, enc.GpuBusyDrops);
    }

    // ─── Item B-fix: retry bloqueante no MESMO frame quando GPU busy ─

    private static InvalidOperationException BusyMapException()
    {
        var ex = new InvalidOperationException("map busy");
        ex.HResult = unchecked((int)0x887A000A); // DXGI_ERROR_WAS_STILL_DRAWING
        return ex;
    }

    [Fact]
    public void MapWithBusyRetry_FastPathSucceeds_ReturnsTrue_NoBlockingCall()
    {
        var blockingCalled = false;
        var result = FfmpegEncoder.TryMapWithBusyRetry(
            () => new MappedSubresource(new IntPtr(0x100), 1920, 1920),
            () => { blockingCalled = true; return new MappedSubresource(new IntPtr(0x200), 1920, 1920); },
            out var map);

        Assert.True(result);
        Assert.Equal(new IntPtr(0x100), map.DataPointer);
        Assert.False(blockingCalled);
    }

    [Fact]
    public void MapWithBusyRetry_FastBusy_BlockingRecovers_ReturnsBlockingResult()
    {
        var blockingCalled = false;
        var result = FfmpegEncoder.TryMapWithBusyRetry(
            () => throw BusyMapException(),
            () => { blockingCalled = true; return new MappedSubresource(new IntPtr(0x200), 1920, 1920); },
            out var map);

        Assert.True(result);
        Assert.True(blockingCalled);
        Assert.Equal(new IntPtr(0x200), map.DataPointer);
    }

    [Fact]
    public void MapWithBusyRetry_FastBusy_BlockingAlsoBusy_ReturnsFalse()
    {
        var result = FfmpegEncoder.TryMapWithBusyRetry(
            () => throw BusyMapException(),
            () => throw BusyMapException(),
            out _);

        Assert.False(result);
    }

    [Fact]
    public void MapWithBusyRetry_NonBusyError_Propagates()
    {
        Assert.Throws<InvalidOperationException>(() =>
            FfmpegEncoder.TryMapWithBusyRetry(
                () => throw new InvalidOperationException("non-busy"),
                () => throw new InvalidOperationException("blocking should not be called"),
                out _));
    }

    [Fact]
    public void MapWithBusyRetry_BlockingThrowsNonBusy_Propagates()
    {
        Assert.Throws<InvalidOperationException>(() =>
            FfmpegEncoder.TryMapWithBusyRetry(
                () => throw BusyMapException(),
                () => throw new InvalidOperationException("device removed"),
                out _));
    }

    // ── 6.11 Item 2: VBV (bufsize) — medido, e a medição disse NÃO MEXER ───────
    // Hipótese original do plano: bufsize = 2 x maxrate (130 Mbit no preset muito-alta) dá
    // ~5,5s de folga, o encoder nunca paga por pico de quadro, e daí viriam os arquivos
    // inchados / ~79 Mbps médios.
    //
    // MEDIÇÃO (--probe-vbv, RTX 5050, driver 32.0.16.1714, ffmpeg 9.0.1 Gyan full,
    // 2026-09-25, cq 16 / 1920x1080@60 / maxrate 65000): a hipótese é FALSA p/ as chains
    // atuais. h264_nvenc devolveu 3019 KiB byte-idêntico com bufsize 130000, 64000, 48000 e
    // 32000 K — bitrate efetivo 16,5 Mbps contra teto de 65 Mbps (48,5 Mbps de folga), então
    // o VBV nunca aperta. hevc_nvenc e av1_nvenc idem. Com -rc vbr -b:v 0 o NVENC só consulta
    // o VBV ao atingir o -maxrate, e a chain nunca chega lá. A referência de "~180 Mbps" que
    // motivou a hipótese vinha do CQP PURO, que a chain não usa mais (hoje é vbr_peak + -b:v).
    //
    // Consequência: o bufsize configurado é preservado em todos os codecs. Os testes abaixo
    // travam esse comportamento para ninguém "otimizar" o VBV sem medir de novo.

    [Theory]
    [InlineData("h264_nvenc", 65000, 130000)]
    [InlineData("hevc_nvenc", 65000, 130000)]
    [InlineData("av1_nvenc", 65000, 130000)]
    [InlineData("h264_amf", 65000, 130000)]
    [InlineData("hevc_amf", 55000, 110000)]
    [InlineData("av1_amf", 40000, 80000)]
    [InlineData("h264_qsv", 40000, 80000)]
    [InlineData("hevc_qsv", 40000, 80000)]
    [InlineData("av1_qsv", 40000, 80000)]
    [InlineData("libx264", 30000, 60000)]
    [InlineData("libx265", 30000, 60000)]
    public void BuildEncoderTuneArgs_KeepsConfiguredBufsizeForEveryCodec(
        string codec, int maxrateKbps, int bufsizeKbps)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 18, maxrateKbps, bufsizeKbps, 2, 16, "p5");

        Assert.Contains($"-bufsize {bufsizeKbps}K", args);
    }

    // Seam de probe: só o --probe-vbv força candidatos, nunca a produção.
    [Theory]
    [InlineData(32000)]
    [InlineData(48000)]
    public void BuildEncoderTuneArgs_HonorsVbvOverrideForProbeOnly(int vbvOverride)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            "h264_nvenc", 18, 65000, 130000, 2, 16, "p5", vbvOverrideKbps: vbvOverride);

        Assert.Contains($"-bufsize {vbvOverride}K", args);
        Assert.DoesNotContain("-bufsize 130000K", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_VbvOverrideMatchingConfiguredIsNoop()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            "h264_nvenc", 18, 65000, 130000, 2, 16, "p5", vbvOverrideKbps: 130000);

        Assert.Contains("-bufsize 130000K", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AllCodecsEmitAtMostOneBufsize()
    {
        string[] codecs = [
            "libx264", "libx265",
            "h264_nvenc", "hevc_nvenc", "av1_nvenc",
            "h264_amf", "hevc_amf", "av1_amf",
            "h264_qsv", "hevc_qsv", "av1_qsv",
            "h264_d3d12va", "hevc_d3d12va", "av1_d3d12va",
        ];

        foreach (var codec in codecs)
        {
            var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 20, 40000, 80000, 2, 16, "p5");
            var count = System.Text.RegularExpressions.Regex.Matches(args, @"-bufsize ").Count;
            Assert.True(count <= 1, $"{codec} emitiu {count} x -bufsize");
        }
    }

    // ── Item 9: main10 em hevc_nvenc × entrada NV12 8-bit ──────────────────
    //
    //hevc_nvenc pede -profile:v main10 (FfmpegEncoder.cs:315) e a entrada do
    // pipeline é -f rawvideo -pix_fmt nv12 (FfmpegEncoder.cs:627) = 8 bits. Bitstream de
    // 10 bits gerado de um sinal de 8 bits não ganha qualidade de lugar nenhum, só custa o
    // upconvert. Estes testes fixam o FATO (main10 está em produção, incondicional) e o seam
    // que o --probe-hevc-profile precisa para A/B sem tocar na produção.

    [Fact]
    public void BuildEncoderTuneArgs_HevcNvenc_EmitsMain_NotMain10()
    {
        // MEDIDO (--probe-hevc-profile, RTX 5050, ffmpeg 9.0.1, 2026-09-26, cq 18 /
        // 1920x1080@60 / maxrate 55000): a chain de produção com `-profile:v main10` produz
        // um arquivo que difere do `-profile:v main` em EXATAMENTE 4 BYTES — o general_profile_idc
        // no VPS NAL (0x21 Main vs 0x22 Main10). Os outros 4.134.825 bytes são bit-idênticos.
        // Ou seja: o NVENC NÃO converte 8→10 bit; a flag só reescreve a tag do header, e o
        // stream sai ROTULADO como Main 10 contendo amostras de 8 bits. Byte 0% (critério era
        // ≥5%), fps -1,2% (ruído). Removido.
        //
        // Este teste ANTIGO fixava `main10` — ele caracterizava o estado que a medição refutou.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("hevc_nvenc", 18, 55000, 110000, 0, 16, "p5");

        Assert.Contains("-profile:v main", args);
        Assert.DoesNotContain("main10", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_HevcNvenc_Main10_StillAvailableThroughProbeSeam()
    {
        // O override continua existindo de propósito: se algum dia a captura virar P010 de
        // verdade, main10 volta a ter o que ganhar e o A/B precisa existir para provar isso.
        // Remover a flag sem remover o seam apagaria a forma de checar a hipótese.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            "hevc_nvenc", 18, 55000, 110000, 0, 16, "p5", profileOverride: "main10");

        Assert.Contains("-profile:v main10", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_HevcNvenc_ProfileOverride_ReplacesMain_ForProbeOnly()
    {
        // O probe precisa medir `main` contra main10 na MESMA chain, e para isso a produção
        // precisa de um override. Sem ele o A/B seria impossível sem editar a produção entre
        // uma medição e outra.
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            "hevc_nvenc", 18, 55000, 110000, 0, 16, "p5", profileOverride: "main10");

        Assert.Contains("-profile:v main10", args);
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(args, @"-profile:v \S+"));
    }

    [Fact]
    public void BuildEncoderTuneArgs_HevcNvenc_ProfileOverrideMain_IsNoop()
    {
        // main explícito tem que ser byte-idêntico ao default — senão o "controle" do A/B
        // difere do tratamento e o delta medido é de outra chain.
        var withOverride = FfmpegEncoder.BuildEncoderTuneArgs(
            "hevc_nvenc", 18, 55000, 110000, 0, 16, "p5", profileOverride: "main");
        var semOverride = FfmpegEncoder.BuildEncoderTuneArgs(
            "hevc_nvenc", 18, 55000, 110000, 0, 16, "p5");

        Assert.Equal(semOverride, withOverride);
    }

    [Fact]
    public void BuildEncoderTuneArgs_ProfileOverride_DoesNotTouchOtherCodecs()
    {
        // O override é do probe do HEVC. Se vazasse para h264_nvenc, o A/B do profile mediria
        // duas variáveis ao mesmo tempo (profile E codec) e o número não diria nada.
        foreach (var codec in new[] { "h264_nvenc", "av1_nvenc", "libx264", "hevc_amf" })
        {
            var semOverride = FfmpegEncoder.BuildEncoderTuneArgs(codec, 18, 55000, 110000, 0, 16, "p5");
            var comOverride = FfmpegEncoder.BuildEncoderTuneArgs(
                codec, 18, 55000, 110000, 0, 16, "p5", profileOverride: "main10");

            Assert.Equal(semOverride, comOverride);
        }
    }

    [Fact]
    public void BuildEncoderTuneArgs_ProfileOverride_NeverEmitsTwoProfiles()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            "hevc_nvenc", 18, 55000, 110000, 0, 16, "p5", profileOverride: "main");

        // main10 é prefixo textual de "main": contar por substring daria 2 e esconderia o bug.
        var matches = System.Text.RegularExpressions.Regex.Matches(args, @"-profile:v \S+");
        Assert.Single(matches);
        Assert.Equal("-profile:v main", matches[0].Value);
    }

    [Fact]
    public void ComputeAmfTargetKbps_MatchesDocumentedCurve()
    {
        Assert.Equal(23400, FfmpegEncoder.ComputeAmfTargetKbps(65000));
        Assert.Equal(19800, FfmpegEncoder.ComputeAmfTargetKbps(55000));
        Assert.Equal(6000, FfmpegEncoder.ComputeAmfTargetKbps(100));   // piso
        Assert.Equal(50000, FfmpegEncoder.ComputeAmfTargetKbps(999999)); // teto
    }

    // ── 6.11 Item 3: -usage da AMF ──────────────────────────────────────────
    // Sem -usage o ffmpeg usa AMF_VIDEO_USAGE_TRANSCODING, cujo LOWLATENCY_MODE=false
    // significa "precisa de >=3 frames antes de qualquer output" e cujo VBV default é
    // 20 Mbit. Captura de jogo é o caso de baixa latência: a doc da AMD lista
    // VIDEO_GAME_STREAMING como o usage de "video game streaming". Ver NormalizeAmfUsage.

    [Theory]
    [InlineData("transcoding")]
    [InlineData("ultralowlatency")]
    [InlineData("lowlatency")]
    [InlineData("webcam")]
    [InlineData("high_quality")]
    [InlineData("lowlatency_high_quality")]
    [InlineData("WEBCAM")]          // case-insensitive
    [InlineData("  lowlatency  ")]  // trim
    public void NormalizeAmfUsage_AcceptsFfmpeg9UsageNames(string usage)
    {
        Assert.Equal(usage.Trim().ToLowerInvariant(), FfmpegEncoder.NormalizeAmfUsage(usage));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("game_streaming")]  // não existe no ffmpeg 9
    [InlineData("low_latency")]     // grafia do header C, não do switch do ffmpeg
    [InlineData("lulz")]
    public void NormalizeAmfUsage_UnknownOrUnset_Means_DoNotEmit(string? usage)
    {
        // Vazio = "não configurado" = a chain NÃO emite -usage. A versão anterior devolvia
        // "transcoding" aqui, com a justificativa de que era o default do ffmpeg; o binário
        // embarcado reporta (default -1), ou seja, o ffmpeg não emitia nada. Chutar um
        // valor aqui é mudar RC/lookahead da captura AMD às cegas, sem hardware para medir.
        Assert.Equal("", FfmpegEncoder.NormalizeAmfUsage(usage));
    }

    /// <summary>
    /// O contrato de não-mudança: sem usage configurado, os args da chain AMF têm de ser
    /// <b>idênticos</b> aos de antes do Item 3 — sem <c>-usage</c> e com o <c>-rc vbr_peak</c>
    /// que a chain já emitia. É este teste, e não o default do config, que garante que o
    /// Item 3 não mexe no comportamento AMD.
    /// </summary>
    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    public void BuildEncoderTuneArgs_AmfUnsetUsage_OmitsUsage_AndKeepsThePreItem3Rc(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            codec, 18, 55000, 110000, 0, 16, "p5", amfUsage: "");

        Assert.DoesNotContain("-usage", args);
        Assert.Contains("-rc vbr_peak", args);
    }

    [Fact]
    public void NormalizeAmfRc_UnsetUsage_StaysVbrPeak()
    {
        Assert.Equal("vbr_peak", FfmpegEncoder.NormalizeAmfRc(""));
    }

    /// <summary>
    /// O default da API precisa ser "não configurado", não <c>transcoding</c> — este é o
    /// teste que o <c>AmfUnsetUsage_OmitsUsage</c> acima NÃO cobre. Todos os testes do Item 3
    /// passam <c>amfUsage:</c> por argumento explícito, então nenhum deles tocava o valor
    /// padrão do parâmetro nem o inicializador do campo: a suíte ficava verde com
    /// <c>transcoding</c> hardcoded nos dois, e qualquer call site novo que omitisse o
    /// argumento receberia <c>-usage transcoding</c> em silêncio. Mesma classe de erro do
    /// <c>main10</c> (Item 9) e do <c>-rc vbr_peak</c> (Item 8): opção que não falha e faz o
    /// usuário acreditar que escolheu. O binário real responde <c>-usage (default -1)</c>,
    /// ou seja "não definido pelo app" — não <c>transcoding</c>.
    /// </summary>
    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    public void BuildEncoderTuneArgs_AmfUsageOmitted_OmitsUsage_NotTranscoding(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 18, 55000, 110000, 0, 16, "p5");

        Assert.DoesNotContain("-usage", args);
        Assert.Contains("-rc vbr_peak", args);
    }

    /// <summary>
    /// O mesmo contrato no caminho de produção: um encoder recém-construído, antes de
    /// qualquer <c>SetQualityParams</c>, não pode já sair com <c>transcoding</c> no
    /// <c>-usage</c>. É o inicializador de <c>_amfUsage</c> que segura esse default.
    /// <para><b>Precisa do construtor real:</b> <c>RuntimeHelpers.GetUninitializedObject</c>
    /// <b>não roda inicializadores de campo</b>, então deixaria <c>_amfUsage</c> em <c>null</c>
    /// e o teste passaria com o bug presente — falso verde. O ctor sem hardware só aloca o
    /// channel, não toca D3D nem ffmpeg.</para>
    /// </summary>
    [Fact]
    public void FreshEncoder_AmfUsageIsUnset_BeforeAnySetQualityParams()
    {
        using var encoder = new FfmpegEncoder(useHardware: false);

        var args = encoder.BuildTuneArgsForTest("h264_amf");

        Assert.DoesNotContain("-usage", args);
    }

    /// <summary>
    /// E <c>SetQualityParams</c> sem <c>amfUsage</c> (<c>null</c> = "não informado") não pode
    ///introduzir o <c>transcoding</c> que acabamos de remover do default: o valor continua o
    /// que já era, e o que já era é "não configurado".
    /// </summary>
    [Fact]
    public void SetQualityParams_WithoutAmfUsage_DoesNotIntroduceTranscoding()
    {
        using var encoder = new FfmpegEncoder(useHardware: false);
        encoder.SetQualityParams(18, 55000, 110000, 0, 4, "p5", codec: "h264_amf", amfUsage: null);

        var args = encoder.BuildTuneArgsForTest("h264_amf");

        Assert.DoesNotContain("-usage", args);
    }

    // O par usage/rc canônico da AMF: LCVBR é o default de ultralowlatency/lowlatency,
    // PCVBR (vbr_peak) o dos demais.
    [Theory]
    [InlineData("transcoding", "vbr_peak")]
    [InlineData("webcam", "vbr_peak")]
    [InlineData("high_quality", "vbr_peak")]
    [InlineData("lowlatency_high_quality", "vbr_peak")]
    [InlineData("ultralowlatency", "vbr_latency")]
    [InlineData("lowlatency", "vbr_latency")]
    public void NormalizeAmfRc_DerivesRateControlFromUsage(string usage, string expectedRc)
    {
        Assert.Equal(expectedRc, FfmpegEncoder.NormalizeAmfRc(usage));
    }

    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_amf")]
    [InlineData("av1_amf")]
    public void BuildEncoderTuneArgs_AmfCodecs_EmitUsageAndRc(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            codec, 18, 55000, 110000, 0, 16, "p5", amfUsage: "webcam");

        Assert.Contains("-usage webcam", args);
        Assert.Contains("-rc vbr_peak", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_AmfUsageUltralowlatencySwitchesToVbrLatency()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            "h264_amf", 18, 55000, 110000, 0, 16, "p5", amfUsage: "ultralowlatency");

        Assert.Contains("-usage ultralowlatency", args);
        Assert.Contains("-rc vbr_latency", args);
        Assert.DoesNotContain("-rc vbr_peak", args);
    }

    [Fact]
    public void BuildEncoderTuneArgs_InvalidAmfUsage_DoesNotGuessAValue()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            "h264_amf", 18, 55000, 110000, 0, 16, "p5", amfUsage: "game_streaming");

        Assert.DoesNotContain("-usage", args);
        Assert.Contains("-rc vbr_peak", args);
    }

    // -usage é exclusivo da AMF: nenhum outro codec pode receber a opção.
    [Theory]
    [InlineData("h264_nvenc")]
    [InlineData("hevc_nvenc")]
    [InlineData("av1_nvenc")]
    [InlineData("h264_qsv")]
    [InlineData("libx264")]
    [InlineData("h264_d3d12va")]
    public void BuildEncoderTuneArgs_NonAmfCodecsNeverGetUsage(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(
            codec, 18, 55000, 110000, 0, 16, "p5", amfUsage: "webcam");

        Assert.DoesNotContain("-usage", args);
    }

    // ── libsvtav1: preset só numérico, e sem -profile:v high ──────────────────────────
    //
    // O `_ =>` de BuildEncoderTuneArgs (fallback de CPU) emite os args do x264 para qualquer
    // codec não listado, e `libsvtav1` não era listado. Como o engine cai nele de verdade
    // (EncoderManager.cs:282-283, "av1" => ?? "libsvtav1" para GPU sem AV1 hw), a captura
    // passava dois args que o SVT-AV1 recusa. Medido no binário embarcado (ffmpeg 9.0.2):
    //   -preset fast        → "Undefined constant or missing '(' in 'fast'" → exit -22
    //   -profile:v high     → "Profile 1 requires 4:4:4 color format"        → exit -22
    //   -preset 8, sem profile → exit 0
    // É a mesma classe do `-rc vbr_peak` (Item 8) e do `main10` (Item 9): nome de uma família
    // usado em outra, e a falha é no primeiro uso real, não no CI.
    [Theory]
    [InlineData("libsvtav1")] // SVT-AV1: `-preset <int> (from -2 to 13)`, sem constantes nomeadas
    public void BuildEncoderTuneArgs_EncodersWithNumericOnlyPreset_EmitNumericPreset(string codec)
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs(codec, 18, 40000, 80000, 0, 4, "p5");

        var match = Regex.Match(args, @"-preset\s+(\S+)");
        Assert.True(match.Success, $"nenhum -preset nos args de {codec}: {args}");
        Assert.Matches(@"^-?\d+$", match.Groups[1].Value);
    }

    [Fact]
    public void BuildEncoderTuneArgs_Libsvtav1_DoesNotEmitTheH264Profile()
    {
        // No AV1 o ffmpeg traduz "high" para o profile 1, que exige 4:4:4 — e a entrada da
        // captura é NV12 4:2:0, então o encoder não abre. O x264 é que usa "high" de verdade.
        var args = FfmpegEncoder.BuildEncoderTuneArgs("libsvtav1", 18, 40000, 80000, 0, 4, "p5");

        Assert.DoesNotContain("-profile:v high", args);
    }

    /// <summary>
    /// O GOP tem de ser o mesmo nas chains de software, senão o trim por keyframe (Item 4)
    /// volta a ter rollback de 2 s justamente no codec de CPU.
    /// </summary>
    [Fact]
    public void BuildEncoderTuneArgs_Libsvtav1_UsesTheProjectGop()
    {
        var args = FfmpegEncoder.BuildEncoderTuneArgs("libsvtav1", 18, 40000, 80000, 0, 4, "p5");

        Assert.Contains($"-g {FfmpegEncoder.Gop}", args);
        Assert.Contains($"-keyint_min {FfmpegEncoder.Gop}", args);
    }
}
