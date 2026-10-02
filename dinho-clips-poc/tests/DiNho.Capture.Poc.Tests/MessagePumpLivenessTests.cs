using System.Diagnostics;
using DiNho.Capture.Poc.Capture;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// T5 — o pump da WGC não tinha como dizer "estou vivo".
///
/// Incidente 2026-10-01: o log mostrou <c>WGC-Pump ... msgs=0</c> por 2m35s
/// seguidos e <c>lastIssue=NoFrame</c>. O código só logava quando um
/// <c>Invoke</c> estourava o timeout de 10 s — e como ninguém chamava Invoke
/// durante a gravação, a linha "msgs=0" parecia um pump morto quando na
/// verdade era um pump SAUDÁVEL que não recebeu nenhum frame do DWM (o
/// problema era outro, e o log não ajudava a separar as duas coisas).
///
/// Sem <c>IsAlive</c>, o coordinator tratava "sem frames" e "pump morto" do
/// mesmo jeito: reinicializava tudo. E o watchdog via a MESMA condição
/// indistinguível, escalando de reinit para restart sem evidência de qual era
/// o caso.
///
/// A correção não é "consertar o WGC" — é tornar o estado observável: o pump
/// publica Alive/LoopCount/MessageCount, e quem decide olha esses números.
/// </summary>
public sealed class MessagePumpLivenessTests
{
    [Fact]
    public void NewPump_IsAlive()
    {
        using var pump = new WindowsMessagePump();
        Assert.True(pump.IsAlive);
    }

    [Fact]
    public void Pump_AdvancesLoopCount()
    {
        using var pump = new WindowsMessagePump();
        var before = pump.LoopCount;

        // O loop roda a cada <=4ms; 200ms da folga larga mesmo numa maquina carregada.
        Thread.Sleep(200);

        Assert.True(pump.LoopCount > before,
            $"loop nao avancou ({before} -> {pump.LoopCount}) - o pump esta travado");
    }

    [Fact]
    public void Pump_RunsWithoutThrowing()
    {
        // O catch do Run() engolia qualquer excecao e SAIA do loop, deixando um
        // pump morto que ainda responderia IsAlive==true se ninguem observasse.
        using var pump = new WindowsMessagePump();
        Thread.Sleep(150);
        Assert.Null(pump.CrashReason);
    }

    [Fact]
    public void Pump_ExecutesInvokedActions()
    {
        using var pump = new WindowsMessagePump();
        var ran = false;
        pump.Invoke(() => ran = true);
        Assert.True(ran);
    }

    [Fact]
    public void InvokeAfterCrash_ThrowsInsteadOfTimingOut()
    {
        using var pump = new WindowsMessagePump();
        pump.Invoke(() => { }); // funcional, pump OK

        // Um pump que crashou tem que se recusar a aceitar trabalho em vez de
        // aceitar e segurar o caller por 10s ate o timeout.
        pump.MarkCrashedForTest("simulated");
        var threw = false;
        try { pump.Invoke(() => { }); }
        catch (InvalidOperationException) { threw = true; }

        Assert.True(threw, "Invoke num pump crashado tem que lancar, nao esperar 10s");
    }

    [Fact]
    public void Dispose_StopsThePump()
    {
        var pump = new WindowsMessagePump();
        pump.Dispose();

        Thread.Sleep(120);
        Assert.False(pump.IsAlive, "o loop tem que parar quando o pump e descartado");
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        var pump = new WindowsMessagePump();
        pump.Dispose();
        pump.Dispose(); // nao pode lancar
    }

    [Fact]
    public void InvokeAfterDispose_Throws()
    {
        var pump = new WindowsMessagePump();
        pump.Dispose();
        Assert.Throws<ObjectDisposedException>(() => pump.Invoke(() => { }));
    }

    // ── O gate: pump morto vs feed parado ──────────────────────────────

    [Fact]
    public void HealthyPump_IsNotStalled()
    {
        using var pump = new WindowsMessagePump();
        Thread.Sleep(150);
        var now = Stopwatch.GetTimestamp();
        Assert.False(CaptureStallDetector.IsPumpStalled(pump.IsAlive, pump.LastLoopTicks,
            lastFrameTicks: now, nowTicks: now));
    }

    [Fact]
    public void DeadPump_IsStalledImmediately()
    {
        // Pump morto nao precisa esperar o timeout de frames para ser notado.
        Assert.True(CaptureStallDetector.IsPumpStalled(
            pumpAlive: false, lastLoopTicks: Stopwatch.GetTimestamp(), lastFrameTicks: Stopwatch.GetTimestamp(),
            nowTicks: Stopwatch.GetTimestamp()));
    }

    [Fact]
    public void FrozenLoopCount_IsStalledEvenIfFlagSaysAlive()
    {
        // IsAlive e um bool que ninguem reinicia; o LoopCount nao mente. Um pump
        // "vivo" com o loop parado e justamente o deadlock silencioso.
        var now = Stopwatch.GetTimestamp();
        Assert.True(CaptureStallDetector.IsPumpStalled(
            pumpAlive: true, lastLoopTicks: now - (long)(2 * Stopwatch.Frequency), lastFrameTicks: now, nowTicks: now,
            pumpTimeoutSec: 1, frameTimeoutSec: 10));
    }

    [Fact]
    public void AliveAndLoopingButNoFrames_IsNotAPumpProblem()
    {
        // Este e o caso de 2026-10-01: pump saudavel, DWM nao entregou nada.
        // O detector precisa distinguir isso de "pump travado" — o reinit e
        // outro (e o WGC/foreground, nao a thread da mensagem).
        var now = Stopwatch.GetTimestamp();
        Assert.False(CaptureStallDetector.IsPumpStalled(
            pumpAlive: true, lastLoopTicks: now - Stopwatch.Frequency, lastFrameTicks: now, nowTicks: now,
            pumpTimeoutSec: 5, frameTimeoutSec: 10));
    }

    [Fact]
    public void NoFramesForLong_IsStalled()
    {
        var now = Stopwatch.GetTimestamp();
        var twoSecondsAgo = now - (2 * Stopwatch.Frequency);
        Assert.True(CaptureStallDetector.IsPumpStalled(
            pumpAlive: true, lastLoopTicks: now - Stopwatch.Frequency, lastFrameTicks: twoSecondsAgo, nowTicks: now,
            pumpTimeoutSec: 5, frameTimeoutSec: 2));
    }

    [Fact]
    public void DisabledDetection_NeverReportsStalled()
    {
        var now = Stopwatch.GetTimestamp();
        Assert.False(CaptureStallDetector.IsPumpStalled(
            pumpAlive: false, lastLoopTicks: 0, lastFrameTicks: 0, nowTicks: now, enabled: false));
    }

    [Fact]
    public void LastFrameNeverSet_MeansNoMeasurementYet()
    {
        // lastFrameTicks == 0 = nenhum frame ainda. Nao e stall de 60 s.
        var now = Stopwatch.GetTimestamp();
        Assert.False(CaptureStallDetector.IsPumpStalled(
            pumpAlive: true, lastLoopTicks: Stopwatch.GetTimestamp(), lastFrameTicks: 0, nowTicks: now, frameTimeoutSec: 2));
    }

    [Fact]
    public void IsPumpStalled_DefaultsMatchTheProductionTimeouts()
    {
        // Os defaults são o que a produção usa: 5 s sem loop = pump travado,
        // 10 s sem frame = feed parada. Um default trocado sem querer muda o
        // comportamento do watchdog em silêncio.
        Assert.Equal(5.0, CaptureStallDetector.DefaultPumpTimeoutSec);
        Assert.Equal(10.0, CaptureStallDetector.DefaultFrameTimeoutSec);
    }

    // ── Escalonamento: foreground vs background ─────────────────────────

    [Fact]
    public void GameInBackground_DoesNotEscalate()
    {
        // Alt-tab para o navegador: o DWM legitimamente para de entregar frames.
        // Escalar para restart aqui era o que reiniciava a captura sozinha.
        Assert.False(CaptureStallDetector.ShouldEscalate(
            stalled: true, gameInForeground: false));
    }

    [Fact]
    public void GameInForeground_Escalates()
    {
        Assert.True(CaptureStallDetector.ShouldEscalate(
            stalled: true, gameInForeground: true));
    }

    [Fact]
    public void NotStalled_NeverEscalates()
    {
        Assert.False(CaptureStallDetector.ShouldEscalate(
            stalled: false, gameInForeground: true));
    }

    [Fact]
    public void Escalation_DoesNotDependOnFramesArrivingRecently()
    {
        // Um pump morto nao gera frames por definicao — se a escalacao exigisse
        // frames recentes, nunca sairia do lugar.
        Assert.True(CaptureStallDetector.ShouldEscalate(
            stalled: true, gameInForeground: true));
    }

    // ── Matriz completa: detector E watchdog ──────────────────────────────
    //
    // O ramo WGC do ShouldEscalateStall NÃO consultava _watchdog.ShouldReinit():
    // com o pump presente, um erro de encode/export (DIM MISMATCH, ExportStall) que
    // o watchdog detectava deixava de escalar — justamente no caminho WGC, que é o do
    // FiveM. Detector e watchdog são complementares: o watchdog vê falha de
    // encode/export com frames ainda chegando; o detector vê feed parada com o pump vivo.

    [Fact]
    public void WatchdogTrip_Escalates_EvenWhenFeedIsHealthy()
    {
        Assert.True(CaptureStallDetector.ShouldEscalateDecision(
            stalled: false,
            watchdogTripped: true,
            starvationSec: 0,
            gameInForeground: true,
            out var kind));
        Assert.Equal("watchdog", kind);
    }

    [Fact]
    public void FeedStall_Escalates_AsPumpFeedStall_AndWinsOverWatchdogLabel()
    {
        Assert.True(CaptureStallDetector.ShouldEscalateDecision(
            stalled: true,
            watchdogTripped: true,
            starvationSec: 0,
            gameInForeground: true,
            out var kind));
        // O stall do detector é mais específico que o rótulo do watchdog — é ele que
        // diz pump morto vs feed parada, que era a lacuna do incidente de 01/10.
        Assert.Equal("pump/feed stall", kind);
    }

    [Fact]
    public void Starvation_Escalates_AfterThreshold_WithNoStallAndNoWatchdog()
    {
        Assert.True(CaptureStallDetector.ShouldEscalateDecision(
            stalled: false,
            watchdogTripped: false,
            starvationSec: CaptureStallDetector.DefaultStarvationSec + 0.5,
            gameInForeground: true,
            out var kind));
        Assert.Equal("starvation", kind);
    }

    [Fact]
    public void HealthyPipeline_NeverEscalates()
    {
        Assert.False(CaptureStallDetector.ShouldEscalateDecision(
            stalled: false,
            watchdogTripped: false,
            starvationSec: 1,
            gameInForeground: true,
            out var kind));
        Assert.Equal(string.Empty, kind);
    }

    [Fact]
    public void WatchdogTrip_Escalates_RegardlessOfForeground()
    {
        // O watchdog mede coisa que o alt-tab NÃO causa: encode corrompido, export
        // travado, DIM MISMATCH. Se valesse a mesma regra de foreground, um export
        // preso em background ficaria para sempre.
        Assert.True(CaptureStallDetector.ShouldEscalateDecision(
            stalled: false,
            watchdogTripped: true,
            starvationSec: 0,
            gameInForeground: false,
            out var kind));
        Assert.Equal("watchdog", kind);
    }

    [Fact]
    public void BackgroundedStall_DoesNotEscalate_WhenWatchdogIsSilent()
    {
        Assert.False(CaptureStallDetector.ShouldEscalateDecision(
            stalled: true,
            watchdogTripped: false,
            starvationSec: 0,
            gameInForeground: false,
            out _));
    }

    // ── Lost wakeup: Reset() depois do Wait() perdia trabalho ──────────
    //
    // O laço era `_workAvailable.Wait(4ms); _workAvailable.Reset();`. Um Set()
    // que chegasse entre o retorno do Wait e o Reset era apagado, e o trabalho
    // enfileirado só aparecia no ciclo seguinte — ou pior, se o sinalizado
    // fosse o único, ficava pendurado.
    //
    // O teste mede o efeito observável, não a linha de código: com N threads
    // disparando Invoke em rajada, nenhum trabalho pode ser perdido e o pump
    // precisa continuar vivo. A implementação com Reset-depois passa em folga
    // na maioria das execuções — daí o teste checar TAMBÉM que todo trabalho
    // chegou, e não só que não travou.

    [Fact]
    public void ConcurrentInvokeBurst_LosesNoWorkAndKeepsPumpAlive()
    {
        using var pump = new WindowsMessagePump();

        const int threads = 8;
        const int perThread = 40;
        var executed = 0;
        var gate = new ManualResetEventSlim(false);

        var workers = new Thread[threads];
        for (var t = 0; t < threads; t++)
        {
            workers[t] = new Thread(() =>
            {
                gate.Wait();
                for (var i = 0; i < perThread; i++)
                    pump.Invoke(() => Interlocked.Increment(ref executed));
            }) { IsBackground = true };
            workers[t].Start();
        }

        gate.Set();
        foreach (var w in workers)
            Assert.True(w.Join(TimeSpan.FromSeconds(30)), "thread de trabalho travou");

        Assert.Equal(threads * perThread, executed);
        Assert.True(pump.IsAlive, "o pump nao pode morrer durante uma rajada de Invoke");
        Assert.Null(pump.CrashReason);
    }

    [Fact]
    public void Invoke_RightAfterPreviousInvoke_StillRuns()
    {
        // Sequencial e colado: é o padrão do coordinator (Invoke em sequência,
        // um por captura). Se a janela entre Set() e o drainGrowing se perdesse,
        // o segundo Invoke ficaria pendurado até o próximo ciclo de 4 ms.
        using var pump = new WindowsMessagePump();

        var order = 0;
        for (var i = 1; i <= 50; i++)
        {
            var expected = i;
            pump.Invoke(() => Assert.Equal(expected, Interlocked.Increment(ref order)));
        }

        Assert.Equal(50, order);
    }
}
