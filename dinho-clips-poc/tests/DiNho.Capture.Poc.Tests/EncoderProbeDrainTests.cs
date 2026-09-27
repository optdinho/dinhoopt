using System.Text;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Trava de regressão do runner genérico de probes (<c>RunEncodeProbe</c>).
///
/// <para><b>O bug:</b> o drain de stdout/stderr rodava em <c>Task.Run</c> sem
/// <c>try/catch</c>. Quando o probe estoura o timeout, o runner faz
/// <c>Kill(entireProcessTree: true)</c>, o pipe fecha e o <c>Read</c> pendurado lança
/// <see cref="IOException"/>/<see cref="ObjectDisposedException"/> — a task fica
/// <i>faulted</i> e o <c>Task.WaitAll</c> seguinte lança <see cref="AggregateException"/>,
/// que o <c>catch</c> externo engole devolvendo <c>null</c>. O chamador lê
/// <c>null</c> como "o encoder recusou a chain", <b>não</b> como "o probe não terminou":
/// o motivo real do timeout some (o <c>onStderr</c> nunca é chamado) e a medição
/// válida é perdida. Pior: o <c>using var process</c> dispose o processo no
/// <c>return</c> enquanto a task órfã ainda lê <c>StandardOutput</c>.</para>
///
/// <para>Este é o <b>mesmo modo de falha</b> corrigido no <c>FrameWriter</c> (Item flakiness):
/// recurso que sobrevive ao teardown. O irmão <c>RunNvencThroughputProbe</c> já tinha a
/// guarda; o runner genérico consolidado no Item 2 a perdeu na unificação.</para>
/// </summary>
public sealed class EncoderProbeDrainTests
{
    /// <summary>Stream que sempre lança — representa o pipe fechado pelo Kill.</summary>
    private sealed class ThrowingStream(Exception ex) : Stream
    {
        public override int Read(byte[] buffer, int offset, int count) => throw ex;
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => 0; set { } }
        public override void Flush() { }
        public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException();
        public override void SetLength(long v) { }
        public override void Write(byte[] b, int o, int c) { }
    }

    [Fact]
    public void DrainStreamToEnd_PipeClosedByKill_DoesNotPropagate()
    {
        // RED: sem a guarda, a excecao sai do drain e derruba o Task.WaitAll.
        foreach (var ex in new Exception[]
        {
            new IOException("pipe fechado pelo kill"),
            new ObjectDisposedException("StandardOutput"),
        })
        {
            long total = 0;
            EncoderManager.DrainStreamToEnd(new ThrowingStream(ex), n => total += n);
            Assert.Equal(0, total);
        }
    }

    [Fact]
    public void DrainStreamToEnd_StreamsEverything_AndReportsTotalBytes()
    {
        var payload = Encoding.ASCII.GetBytes(new string('x', 300_000));
        long total = 0;
        EncoderManager.DrainStreamToEnd(new MemoryStream(payload), n => total += n);

        Assert.Equal(payload.Length, total);
    }

    [Fact]
    public void DrainStreamToEnd_ThrowsMidStream_KeepsTheBytesAlreadyCounted()
    {
        // O que interessa no timeout: o que o encoder ate entao produziu continua valido
        // (e um limite inferior honesto) em vez de virar 0/"chain rejeitada". O stream le
        // 5.000 bytes e so entao lanca - o drain de 64KB nao muda nada porque ele para no
        // primeiro Read que estoura 'after'.
        long total = 0;
        var stream = new StreamThatThrowsAfter(payload: new byte[100_000], after: 5_000);
        EncoderManager.DrainStreamToEnd(stream, n => total += n);

        Assert.Equal(5_000, total);
    }

    private sealed class StreamThatThrowsAfter(byte[] payload, int after) : Stream
    {
        private int _pos;
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (_pos >= after) throw new IOException("pipe fechado pelo kill");
            var n = Math.Min(Math.Min(count, after - _pos), payload.Length - _pos);
            Array.Copy(payload, _pos, buffer, offset, n);
            _pos += n;
            return n;
        }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => payload.Length;
        public override long Position { get => _pos; set { } }
        public override void Flush() { }
        public override long Seek(long o, SeekOrigin s) => throw new NotSupportedException();
        public override void SetLength(long v) { }
        public override void Write(byte[] b, int o, int c) { }
    }
}
