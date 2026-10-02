namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Separa "a thread da mensagem morreu" de "o DWM parou de entregar frames" (T5).
///
/// <para>
/// Em 2026-10-01 o log mostrou <c>WGC-Pump ... msgs=0</c> por 2m35s e
/// <c>lastIssue=NoFrame</c>. As duas condições — pump travado e feed parada —
/// eram indistinguíveis, e o watchdog tratava as duas igual: reinit, depois
/// restart, sem evidência de qual era o caso.
/// </para>
/// <para>
/// Aqui a distinção é explícita: o pump publica <c>LoopCount</c> (que avança
/// mesmo sem frames) e o detector compara isso com o tempo do último frame. Loop
/// parado = thread morta. Loop andando sem frames = problema de captura, não
/// da pump.
/// </para>
/// </summary>
internal static class CaptureStallDetector
{
    /// <summary>Sem avanço de loop por este tempo = a thread da mensagem travou.</summary>
    internal const double DefaultPumpTimeoutSec = 5.0;

    /// <summary>Sem frame por este tempo = o feed parou (com o pump vivo).</summary>
    internal const double DefaultFrameTimeoutSec = 10.0;

    /// <summary>
    /// O pipeline está travado?
    /// <para>
    /// <paramref name="pumpAlive"/> = o <c>IsAlive</c> do pump (bool).
    /// <paramref name="loopCount"/> = o contador de voltas do laço — é ele que
    /// pega o pump "vivo" cujo laço parou, que o bool sozinho não vê.
    /// <paramref name="lastFrameTicks"/> = timestamp do último frame capturado;
    /// 0 = ainda não mediu (não é stall).
    /// </para>
    /// </summary>
    internal static bool IsPumpStalled(
        bool pumpAlive,
        long lastLoopTicks,
        long lastFrameTicks,
        long nowTicks,
        double pumpTimeoutSec = DefaultPumpTimeoutSec,
        double frameTimeoutSec = DefaultFrameTimeoutSec,
        bool enabled = true)
    {
        if (!enabled) return false;

        // A thread morreu. Não espera timeout nenhum.
        if (!pumpAlive) return true;

        var since = System.Diagnostics.Stopwatch.Frequency;

        // Loop travado com o bool ainda true: o deadlock silencioso. Um pump
        // que "está vivo" mas não dá uma volta a cada ≤4ms está travado — e o
        // bool IsAlive não pega isso, porque a thread existe.
        if (lastLoopTicks == 0) return true;
        if ((nowTicks - lastLoopTicks) / (double)since >= pumpTimeoutSec) return true;

        // Feed parada com o pump saudável é OUTRO problema (DWM/foreground).
        if (lastFrameTicks == 0) return false;

        var sinceFramesSec = (nowTicks - lastFrameTicks) / (double)since;
        return sinceFramesSec >= frameTimeoutSec;
    }

    /// <summary>
    /// Vale a pena escalar (reinit → restart) por este stall?
    /// <para>
    /// Com o jogo em BACKGROUND o DWM legitimamente para de entregar frames —
    /// alt-tab para o navegador não é falha. Escalar ali é o que fazia a
    /// captura se reiniciar sozinha.
    /// </para>
    /// </summary>
    internal static bool ShouldEscalate(bool stalled, bool gameInForeground) =>
        stalled && gameInForeground;

    /// <summary>Starvation por este tempo escala mesmo sem stall do detector.</summary>
    internal const double DefaultStarvationSec = 8.0;

    /// <summary>
    /// Matriz completa de escalonamento, com o rótulo da causa (T5).
    ///
    /// <para>
    /// <paramref name="watchdogTripped"/> precisa entrar NA conta. O watchdog mede
    /// falhas que o detector não vê — DIM MISMATCH no encode, export travado — e
    /// essas falhas acontecem com frames ainda chegando, ou seja com
    /// <paramref name="stalled"/> falso. Deixar o watchdog de fora do ramo WGC
    /// desligava justamente a recuperação que ele fazia, no caminho de captura que
    /// o jogo usa.
    /// </para>
    /// <para>
    /// A precedência do rótulo importa para o log: "pump/feed stall" é mais
    /// específico que "watchdog" e é o que separa thread morta de feed parada.
    /// </para>
    /// </summary>
    internal static bool ShouldEscalateDecision(
        bool stalled,
        bool watchdogTripped,
        double starvationSec,
        bool gameInForeground,
        out string kind)
    {
        // O watchdog não é gated por foreground: alt-tab não corrompe encoder nem
        // trava export, então um watchdog disparado em background ainda é falha real.
        if (watchdogTripped)
        {
            kind = stalled ? "pump/feed stall" : "watchdog";
            return true;
        }
        if (stalled && ShouldEscalate(stalled, gameInForeground))
        {
            kind = "pump/feed stall";
            return true;
        }
        if (starvationSec > DefaultStarvationSec)
        {
            kind = "starvation";
            return true;
        }

        kind = string.Empty;
        return false;
    }
}
