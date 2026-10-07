using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using DiNho.Capture.Poc.Ipc;
using Xunit;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Reproduz o defeito encontrado em 2026-10-03: com <c>maxNumberOfServerInstances: 1</c>,
/// o primeiro cliente (persistente, como o Electron) impedia QUALQUER segundo cliente de
/// ligar-se — o accept loop lançava "pipe busy" num loop silencioso de 1 s.
/// </summary>
public sealed class NamedPipeServerIntegrationTests
{
    private static string NewPipeName() => $"dinho-test-{Guid.NewGuid():N}";

    private static NamedPipeClientStream ConnectClient(string pipeName, int timeoutMs = 5000)
    {
        var client = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut);
        client.Connect(timeoutMs);
        return client;
    }

    private static void Send(NamedPipeClientStream c, string cmd, string? reqId = null)
    {
        var json = JsonSerializer.Serialize(new { v = 1, cmd, reqId, payload = new { } });
        var bytes = Encoding.UTF8.GetBytes(json + "\n");
        c.Write(bytes, 0, bytes.Length);
        c.Flush();
    }

    /// <summary>Lê uma linha com timeout. Devolve null se nada chegar a tempo.</summary>
    private static string? ReadLine(NamedPipeClientStream c, int timeoutMs)
    {
        var buffer = new byte[8192];
        using var cts = new CancellationTokenSource(timeoutMs);
        var acc = new MemoryStream();
        try
        {
            while (true)
            {
                int n = c.Read(buffer, 0, buffer.Length);
                if (n == 0) return null;
                acc.Write(buffer, 0, n);
                var text = Encoding.UTF8.GetString(acc.ToArray());
                var idx = text.IndexOf('\n');
                if (idx >= 0) return text[..idx];
                if (cts.IsCancellationRequested) return null;
            }
        }
        catch (IOException) { return null; }
        catch (OperationCanceledException) { return null; }
    }

    [Fact]
    public void SecondClient_Connects_WhileFirstClientHoldsThePipe()
    {
        var pipeName = NewPipeName();
        using var server = new NamedPipeServer(pipeName);
        server.GetStatus = () => new EngineStatusMessage
        {
            Value = new EngineStatusValue { Recording = true, Game = "teste" }
        };
        server.OnMessage = _ => Task.FromResult<IpcMessage?>(null);
        server.Start();

        try
        {
            // Cliente A: persistente e SILENCIOSO — é exactamente o papel do Electron.
            using var clientA = ConnectClient(pipeName);

            // Cliente B tem de conseguir ligar-se apesar de A segurar o pipe.
            using var clientB = ConnectClient(pipeName, timeoutMs: 5000);

            Send(clientB, "getStatus");
            var reply = ReadLine(clientB, 5000);

            Assert.NotNull(reply);
            Assert.Contains("\"v\":1", reply!);
        }
        finally { server.Stop(); }
    }

    [Fact]
    public void RawBroadcast_ReachesEveryConnectedClient()
    {
        var pipeName = NewPipeName();
        using var server = new NamedPipeServer(pipeName);
        server.GetStatus = () => new EngineStatusMessage();
        server.OnMessage = _ => Task.FromResult<IpcMessage?>(null);
        server.Start();

        try
        {
            using var clientA = ConnectClient(pipeName);
            using var clientB = ConnectClient(pipeName);

            // O pipe estar ligado no SO não basta: o servidor regista o cliente
            // dentro de HandleClientAsync, e um broadcast nesse intervalo seria
            // perdido. Esperamos o registo antes de fazer o fan-out.
            var deadline = DateTime.UtcNow.AddSeconds(5);
            while (server.ConnectedClientCount < 2 && DateTime.UtcNow < deadline)
                Thread.Sleep(10);
            Assert.Equal(2, server.ConnectedClientCount);

            server.BroadcastRaw("{\"v\":1,\"cmd\":\"_event\",\"payload\":{\"type\":\"ping\"}}");

            // O timer de status (~2s) também escreve nestas filas, por isso não
            // podemos assumir que o ping é a PRIMEIRA linha: no run completo da suite
            // o status chega primeiro e o teste falhava por ordem de chegada.
            var a = ReadUntil(clientA, "ping", 5000);
            var b = ReadUntil(clientB, "ping", 5000);

            Assert.NotNull(a);
            Assert.NotNull(b);
        }
        finally { server.Stop(); }
    }

    /// <summary>Lê todas as linhas que chegarem dentro da janela. B pode (e deve) receber
    /// status broadcasts — o que não pode receber é o commandResult de outro cliente.</summary>
    private static List<string> Drain(NamedPipeClientStream c, int windowMs)
    {
        var lines = new List<string>();
        var buffer = new byte[8192];
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < windowMs)
        {
            int n;
            try { n = c.Read(buffer, 0, buffer.Length); }
            catch (IOException) { break; }
            if (n == 0) break;
            var text = Encoding.UTF8.GetString(buffer, 0, n);
            foreach (var part in text.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                lines.Add(part);
            c.Flush();
            // Só testa o resto da janela se não havia nada imediato para ler.
            if (lines.Count == 0) continue;
            break;
        }
        return lines;
    }

    /// <summary>Lê até encontrar uma linha contendo <paramref name="needle"/>, ignorando
    /// as anteriores (status broadcasts). Devolve null se a janela expirar.</summary>
    private static string? ReadUntil(NamedPipeClientStream c, string needle, int windowMs)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < windowMs)
        {
            var line = ReadLine(c, Math.Max(200, windowMs - (int)sw.ElapsedMilliseconds));
            if (line is null) return null;
            if (line.Contains(needle, StringComparison.Ordinal)) return line;
        }
        return null;
    }

    [Fact]
    public void LongRunningResult_GoesOnlyToTheRequestingClient()
    {
        var pipeName = NewPipeName();
        using var server = new NamedPipeServer(pipeName);
        server.GetStatus = () => new EngineStatusMessage();

        var gate = new TaskCompletionSource();
        server.OnMessage = async _ => { await gate.Task; return null; };
        server.Start();

        try
        {
            using var clientA = ConnectClient(pipeName);
            using var clientB = ConnectClient(pipeName);

            // Só A pede, com reqId próprio.
            Send(clientA, "saveClip", reqId: "req-A");
            var accepted = ReadLine(clientA, 4000);
            Assert.NotNull(accepted);
            Assert.Contains("accepted", accepted!);

            gate.SetResult();

            // A recebe o resultado; B recebe status (legítimo) mas NUNCA o commandResult.
            var a = ReadLine(clientA, 6000);
            Assert.NotNull(a);
            Assert.Contains("commandResult", a!);
            Assert.Contains("req-A", a!);

            var seenByB = Drain(clientB, 1500);
            Assert.DoesNotContain(seenByB, line => line.Contains("commandResult"));

            // Confirma que B estava mesmo ligado e a receber: tem de haver pelo menos
            // um engineStatus. Sem isto, o teste passaria mesmo se B estivesse morto.
            Assert.Contains(seenByB, line => line.Contains("engineStatus"));
        }
        finally { server.Stop(); }
    }
}