using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using DiNho.Capture.Poc.Encoders;
using Xunit;

namespace DiNho.Capture.Poc.Tests;

[Collection("VideoPacketPool")]
public class FfmpegEncoderFrameWriterTests
{
    public FfmpegEncoderFrameWriterTests() => VideoPacketPool.ResetForTest();

    private static byte[] Data(int i) => new byte[] { (byte)i, (byte)(i * 2), (byte)(i * 3) };

    private static TimeSpan Pts(int i) => TimeSpan.FromMilliseconds(i * 16);

    // Stream que aceita a escrita imediatamente (como um pipe não-travado).
    private sealed class SinkStream : Stream
    {
        private readonly MemoryStream _inner;
        public SinkStream(MemoryStream inner) => _inner = inner;
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => _inner.Write(buffer, offset, count);
        public override Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => _inner.WriteAsync(buffer, offset, count, cancellationToken);
    }

    // Stream lenta que segura SÓ A PRIMEIRA escrita até ser liberada; as demais
    // fluem direto (simula um encoder lento apenas no write inicial — suficiente
    // para garantir que o writer está "em voo" com o frame 1 quando os demais chegam).
    private sealed class GatedStream : Stream
    {
        private readonly object _gateSync = new();
        private readonly ManualResetEventSlim _entered = new(false);
        private bool _holdNext = true;
        private TaskCompletionSource<bool> _release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _writeCount;
        public MemoryStream Sink { get; } = new();
        public int WriteCount => Volatile.Read(ref _writeCount);
        public void WaitWriteStarted() => Assert.True(_entered.Wait(2000), "writer thread should start the first write");
        public void ReleaseNext()
        {
            TaskCompletionSource<bool> current;
            lock (_gateSync) current = _release;
            current.TrySetResult(true);
        }
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
        {
            _entered.Set();
            Task? gated;
            lock (_gateSync)
            {
                if (_holdNext)
                {
                    _holdNext = false;
                    gated = _release.Task.ContinueWith(
                        _ => { Sink.Write(buffer, offset, count); Interlocked.Increment(ref _writeCount); },
                        CancellationToken.None, TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
                }
                else
                {
                    Sink.Write(buffer, offset, count);
                    Interlocked.Increment(ref _writeCount);
                    return Task.CompletedTask;
                }
            }
            return gated;
        }
    }

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

    // O3-writer: preserva a disciplina FIFO — frames escritos na ordem exata em que
    // foram enfileirados, e os PTS enfileirados na mesma ordem (sync A/V intocado).
    [Fact]
    public void FrameWriter_WritesFramesInOrder_AndEnqueuesPtsInOrder()
    {
        var written = new MemoryStream();
        var ptsList = new List<TimeSpan>();
        using var w = new FfmpegEncoder.FrameWriter(
            () => new SinkStream(written), () => 2000, pts => ptsList.Add(pts), (_, _) => { });

        for (int i = 1; i <= 5; i++)
            Assert.True(w.TryEnqueue(Data(i), Pts(i)));

        w.Stop(abort: false, joinMs: 2000);

        Assert.Equal(new[] { 1, 2, 3, 4, 5 }, ptsList.Select(p => (int)p.TotalMilliseconds / 16).ToArray());
        Assert.Equal(Data(1).Concat(Data(2)).Concat(Data(3)).Concat(Data(4)).Concat(Data(5)), written.ToArray());
    }

    // O3-writer: o produtor (thread de captura) NÃO bloqueia quando o encoder é
    // mais lento que a captura — o bloqueio fica confinado à thread do writer.
    [Fact]
    public void FrameWriter_SlowPipe_DoesNotBlockProducer_WhileQueueHasSpace()
    {
        var sink = new MemoryStream();
        using var w = new FfmpegEncoder.FrameWriter(
            () => new SlowWritableStream(sink), () => 2000, _ => { }, (_, _) => { }, maxQueued: 8);

        var sw = Stopwatch.StartNew();
        for (int i = 1; i <= 3; i++)
            Assert.True(w.TryEnqueue(Data(i), Pts(i)));
        sw.Stop();

        Assert.True(sw.ElapsedMilliseconds < 50, $"producer blocked for {sw.ElapsedMilliseconds}ms on slow pipe");
        w.Stop(abort: false, joinMs: 5000);
        Assert.Equal(3 * 3, sink.ToArray().Length);
    }

    private sealed class SlowWritableStream : Stream
    {
        private readonly MemoryStream _inner;
        public SlowWritableStream(MemoryStream inner) => _inner = inner;
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
        public override async Task WriteAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
        {
            await Task.Delay(30, cancellationToken);
            await _inner.WriteAsync(buffer, offset, count, cancellationToken);
        }
    }

    // O3-writer drop-oldest: fila cheia = o frame MAIS ANTIGO enfileirado é sacrificado
    // (nunca o frame em escrita) e os PTS/NV12 não vazam. "agora" vence.
    [Fact]
    public void FrameWriter_DropOldest_DropsOldestQueuedFrame_NotInFlight()
    {
        var gate = new GatedStream();
        var writtenPts = new List<TimeSpan>();
        using var w = new FfmpegEncoder.FrameWriter(
            () => gate, () => 2000, pts => writtenPts.Add(pts), (_, _) => { }, maxQueued: 2);

        Assert.True(w.TryEnqueue(Data(1), Pts(1)));
        Assert.True(w.TryEnqueue(Data(2), Pts(2)));
        gate.WaitWriteStarted(); // writer enfileirou o frame 1 e está bloqueado no pipe

        Assert.True(w.TryEnqueue(Data(3), Pts(3)));
        Assert.True(w.TryEnqueue(Data(4), Pts(4)));
        Assert.True(w.TryEnqueue(Data(5), Pts(5)));

        Assert.Equal(2, w.DroppedOverflow); // frames 2 e 3 eram os mais antigos enfileirados
        Assert.Equal(2, w.QueuedCount);     // fila agora [4, 5]

        gate.ReleaseNext(); // libera o write do frame 1 (em voo — nunca é dropado)
        w.Stop(abort: false, joinMs: 3000);

        Assert.Equal(new[] { 1, 4, 5 }, writtenPts.Select(p => (int)p.TotalMilliseconds / 16).ToArray());
        Assert.Equal(Data(1).Concat(Data(4)).Concat(Data(5)), gate.Sink.ToArray());
    }

    // O3-writer: timeout do pipe (encoder travado) → mesmo cause do caminho síncrono,
    // agora reportado pela thread do writer sem travar a captura.
    [Fact]
    public void FrameWriter_StalledPipe_ReportsTimeoutCause()
    {
        using var never = new NeverCompletingStream();
        string? cause = null;
        var failed = new ManualResetEventSlim();
        using var w = new FfmpegEncoder.FrameWriter(
            () => never, () => 50, _ => { }, (c, _) => { cause = c; failed.Set(); });

        Assert.True(w.TryEnqueue(Data(1), Pts(1)));
        Assert.True(failed.Wait(2000), "writer should report the timeout");

        Assert.Equal("encoder:stdin_timeout", cause);
        w.Stop(abort: true, joinMs: 1000);
    }

    [Fact]
    public void FrameWriter_FaultingPipe_ReportsIoErrorCauseAndFault()
    {
        using var fault = new FaultingStream();
        string? cause = null;
        Exception? faultEx = null;
        var failed = new ManualResetEventSlim();
        using var w = new FfmpegEncoder.FrameWriter(
            () => fault, () => 2000, _ => { }, (c, f) => { cause = c; faultEx = f; failed.Set(); });

        Assert.True(w.TryEnqueue(Data(1), Pts(1)));
        Assert.True(failed.Wait(2000), "writer should report the io error");

        Assert.Equal("encoder:stdin_io_error", cause);
        Assert.Equal("pipe closed", faultEx?.Message);
        w.Stop(abort: true, joinMs: 1000);
    }

    // Abort (StopFfmpeg/dispose): frames enfileirados são descartados SEM write —
    // nenhum PTS órfão, nenhum byte no pipe morto.
    [Fact]
    public void FrameWriter_AbortStop_DiscardsQueuedFrames_WithoutWriting()
    {
        var gate = new GatedStream();
        int wrote = 0;
        using var w = new FfmpegEncoder.FrameWriter(
            () => gate, () => 2000, _ => Interlocked.Increment(ref wrote), (_, _) => { });

        Assert.True(w.TryEnqueue(Data(1), Pts(1)));
        Assert.True(w.TryEnqueue(Data(2), Pts(2)));
        Assert.True(w.TryEnqueue(Data(3), Pts(3)));

        w.Stop(abort: true, joinMs: 2000);

        Assert.Equal(0, wrote);
        Assert.Equal(0, gate.WriteCount);
        Assert.Equal(0, w.QueuedCount);
    }

    // Depois do stop a fila não aceita mais frames — o produtor devolve o buffer ao pool.
    [Fact]
    public void FrameWriter_EnqueueAfterStop_ReturnsFalse()
    {
        using var w = new FfmpegEncoder.FrameWriter(
            () => new SinkStream(new MemoryStream()), () => 2000, _ => { }, (_, _) => { });
        w.Stop(abort: true, joinMs: 1000);
        Assert.False(w.TryEnqueue(Data(1), Pts(1)));
    }

    // REGRESSÃO: Stop com join curto NÃO garante que a thread morreu. Ela fica presa no
    // write em voo (o warm-up do 1º frame tem timeout de 10s — StdinWriteWarmupTimeoutMs —
    // muito maior que o join de 1s do FfmpegEncoder.Dispose) e, quando o write finalmente
    // falha, executa ReturnFrame DEPOIS do Stop ter retornado.
    //
    // O VideoPacketPool é um estático GLOBAL: esse Return tardio entra no pool
    // depois do teardown e corrompe qualquer coisa que leia o pool no meio (a suíte
    // VideoPacketPoolTests roda em paralelo e falhava ~1 run em 4 com exatamente este
    // sintoma: Assert.NotSame() values are the same instance).
    //
    // Não dá para "consertar" bloqueando o Dispose por 10s. O contrato certo é: quando o
    // join estoura, o frame em voo vira órfão e é deixado para o GC — nunca devolvido ao
    // pool, porque o owner já saiu e ninguém mais rastreia aquele buffer.
    [Fact]
    public void FrameWriter_StopJoinTimesOut_OrphanedInFlightFrame_IsNotReturnedToPool()
    {
        VideoPacketPool.MaxIdleBytes = 256L * 1024 * 1024;
        VideoPacketPool.ResetForTest();
        try
        {
            // Tamanho ÚNICO: nenhum buffer de captura real (NV12 1080p = 3.110.400 bytes)
            // tem esse comprimento, então qualquer array 4093 que sair do pool É o órfão.
            // Isso torna o teste hermético mesmo com outra writer devolvendo buffer no pool
            // global durante a janela — não dependemos de IdleBytes == 0.
            const int orphanLen = 4093;
            var orphan = new byte[orphanLen];
            var gate = new GatedStream();
            var w = new FfmpegEncoder.FrameWriter(
                () => gate,
                // Timeout de write folgado: o GatedStream segura a 1ª escrita, então o join
                // curto de 50ms estoura com a thread VIVA — é o caso do warm-up de 10s em produção.
                () => 60_000,
                _ => { },
                (_, _) => { });

            Assert.True(w.TryEnqueue(orphan, Pts(1)));
            gate.WaitWriteStarted();
            Assert.True(w.IsAliveForTest, "writer thread should be in the in-flight write");

            // Join curto estoura: o owner (FfmpegEncoder.Dispose) segue e acha que a writer morreu.
            w.Stop(abort: true, joinMs: 50);
            Assert.True(w.IsAliveForTest, "join should have timed out with the thread still in the write");

            // O write enfim completa (o ffmpeg abriu o encoder / o pipe destravou). A thread
            // acorda e tentaria devolver o frame ao pool — mas o Stop já retornou, então o
            // buffer é órfão e vai para o GC. Sem a supressão, o órfão reapareceria no pool
            // DEPOIS do teardown: exatamente o vazamento que corrompia VideoPacketPoolTests.
            gate.ReleaseNext();
            Assert.True(WaitForThreadExit(w, 5000), "writer thread should exit after the write completes");

            Assert.DoesNotContain(DrainPoolAll(), a => a.Length == orphanLen && ReferenceEquals(a, orphan));
        }
        finally
        {
            VideoPacketPool.ResetForTest();
        }
    }

    // Esvazia o pool e devolve tudo o que saiu. Precisa existir porque o VideoPacketPool é um
    // estático global e outras writers podem devolver buffer durante o teste — um assert sobre
    // o contador IdleBytes seria frágil, mas a IDENTIDADE de um array de tamanho único é segura.
    //
    // Rent(1) pega o topo do stack e é o único jeito de drenar TUDO: pedir um comprimento
    // específico faz o Rent descartar os maiores, que aí nunca chegam ao chamador.
    private static List<byte[]> DrainPoolAll()
    {
        var all = new List<byte[]>();
        var guard = 0;
        while (VideoPacketPool.IdleBytes > 0 && guard++ < 5000)
            all.Add(VideoPacketPool.Rent(1));
        return all;
    }

    // Contrapartida do teste acima: quando o join SUCEDE, o drain de Stop continua
    // devolvendo os frames ao pool. Se o flag de "órfão" fosse global, este teste
    // passaria a vazar buffer de verdade em produção — regressão pior que a que corrigimos.
    [Fact]
    public void FrameWriter_StopJoinSucceeds_QueuedFrames_StillReturnedToPool()
    {
        VideoPacketPool.MaxIdleBytes = 256L * 1024 * 1024;
        VideoPacketPool.ResetForTest();
        try
        {
            // 3 tamanhos ÚNICOS e distintos: dá para provar por identidade que os 3 frames
            // voltaram ao pool, sem depender do contador global IdleBytes.
            var frames = new[] { new byte[2051], new byte[2053], new byte[2059] };
            var gate = new GatedStream();
            var w = new FfmpegEncoder.FrameWriter(
                () => gate, () => 2000, _ => { }, (_, _) => { });

            // O 1º fica em voo (GatedStream segura a escrita), os 2 seguintes ficam na fila.
            for (int i = 0; i < frames.Length; i++)
                Assert.True(w.TryEnqueue(frames[i], Pts(i)));

            gate.WaitWriteStarted();
            gate.ReleaseNext();

            w.Stop(abort: true, joinMs: 5000);

            // Join ok ⇒ a thread terminou, os 3 frames voltaram ao pool normalmente.
            Assert.False(w.IsAliveForTest, "writer thread should be dead after a successful join");
            var returned = DrainPoolAll();
            foreach (var f in frames)
                Assert.Contains(f, returned);
        }
        finally
        {
            VideoPacketPool.ResetForTest();
        }
    }

    // Helper: espera a thread do writer sair (ou o timeout estourar). Existe porque o join
    // pode estourar por design — para testar a supressão do órfão, o teste precisa que a
    // thread termine sozinha depois, sem depender de outro Stop.
    private static bool WaitForThreadExit(FfmpegEncoder.FrameWriter w, int timeoutMs)
    {
        var deadline = Environment.TickCount64 + timeoutMs;
        while (w.IsAliveForTest && Environment.TickCount64 < deadline)
            Thread.Sleep(5);
        return !w.IsAliveForTest;
    }

    // Flush (Stop sem abort) deve DRAINAR a fila — frames enfileirados ainda são escritos.
    [Fact]
    public void FrameWriter_StopWithoutAbort_WritesQueuedFramesBeforeExit()
    {
        var written = new MemoryStream();
        var ptsList = new List<TimeSpan>();
        using var w = new FfmpegEncoder.FrameWriter(
            () => new SinkStream(written), () => 2000, pts => ptsList.Add(pts), (_, _) => { });

        for (int i = 1; i <= 3; i++)
            Assert.True(w.TryEnqueue(Data(i), Pts(i)));

        w.Stop(abort: false, joinMs: 2000);

        Assert.Equal(3, ptsList.Count);
        Assert.Equal(Data(1).Concat(Data(2)).Concat(Data(3)), written.ToArray());
    }
}