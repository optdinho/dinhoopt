using DiNho.Capture.Poc.Watchdog;

namespace DiNho.Capture.Poc.Tests;

public sealed class FeedTelemetryTests
{
    private const long Freq = 1_000_000; // ticks = µs

    private static FeedTelemetry Create(double windowSeconds) => new(windowSeconds, Freq);

    // Janela não expirada → summary null, estado preservado.
    [Fact]
    public void TryTakeSummary_DentroDaJanela_RetornaNull()
    {
        var t = Create(5.0);
        t.AddGoodFrame(1_000, 500, 4_000, 20_000);
        Assert.False(t.TryTakeSummary(3_000_000, out var _));
        Assert.False(t.TryTakeSummary(4_999_999, out var _));
    }

    // Janela expirada → resume a janela e zera os acumuladores.
    [Fact]
    public void TryTakeSummary_JanelaExpirada_ResumeEZaera()
    {
        var t = Create(5.0);
        t.AddGoodFrame(2_000, 500, 4_000, 21_500);
        t.AddGoodFrame(2_000, 500, 3_000, 20_500);
        var s = t.TryTakeSummary(5_000_000, out var summary);
        Assert.True(s);
        Assert.Equal(2, summary.GoodFrames);
        Assert.Equal(2.0, summary.WaitMs, 3);
        Assert.Equal(0.5, summary.CopyMs, 3);
        Assert.Equal(3.5, summary.ConvertMs, 3);
        Assert.Equal(21.0, summary.TotalMs, 3);
        // 2 frames / 5s → 0.4fps neste tick de teste
        Assert.Equal(0.4, summary.FeedFps, 3);

        // Após o reset, janela nova começa vazia (mais 6s de relógio → expira de novo).
        var s2 = t.TryTakeSummary(11_000_000, out var summary2);
        Assert.True(s2);
        Assert.Equal(0, summary2.GoodFrames);
    }

    // FeedFps é frames bons / janela real de relógio, não / intervalo decorrido.
    [Fact]
    public void FeedFps_UsaJanelaCompleta()
    {
        var t = Create(2.0);
        for (int i = 0; i < 12; i++)
            t.AddGoodFrame(1_000, 200, 2_000, 16_000);
        var success = t.TryTakeSummary(4_000_000, out var s);
        Assert.True(success);
        Assert.Equal(12, s.GoodFrames);
        Assert.Equal(6.0, s.FeedFps, 3); // 12 / 2s
    }

    // Encodes nulos (EncodeFrame retornou null) e falhas de captura são contados separadamente.
    [Fact]
    public void Counts_EncodeNull_e_FailFrames_Separados()
    {
        var t = Create(5.0);
        t.AddGoodFrame(1_000, 200, 3_000, 16_000);
        t.AddEncodeNull();
        t.AddEncodeNull();
        t.AddFailFrame();
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(1, s.GoodFrames);
        Assert.Equal(2, s.EncodeNulls);
        Assert.Equal(1, s.FailFrames);
        Assert.Equal(0.2, s.FeedFps, 3);
    }

    // Filas: média e pico de depth amostrados durante a janela.
    [Fact]
    public void QueueDepth_MediaEPico()
    {
        var t = Create(5.0);
        t.AddQueueDepth(0);
        t.AddQueueDepth(2);
        t.AddQueueDepth(4);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(2.0, s.QueueDepthAvg, 3);
        Assert.Equal(4, s.QueueDepthMax);
    }

    // Sem nenhuma amostra, o summary ainda sai com zeros (janela vazia não gera stall de log).
    [Fact]
    public void SummaryVazio_ZerosSemExcecao()
    {
        var t = Create(5.0);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(0, s.GoodFrames);
        Assert.Equal(0.0, s.WaitMs, 3);
        Assert.Equal(0.0, s.FeedFps, 3);
    }

    // Order de ticks anômalos (wait negativo por jitter de QPC) NÃO entra na média
    // — outlier > 100ms é excluído do cálculo, preservando a média dos frames saudáveis.
    [Fact]
    public void TicksAnomalos_SaoExcluidosDaMedia()
    {
        var t = Create(5.0);
        t.AddGoodFrame(-1_000, 500, 4_000, 20_000);
        var s = t.TryTakeSummary(5_000_000, out var summary);
        Assert.True(s);
        // 1 frame outlier → excluded, GoodFrames still 1 but mean = 0 (no good frames used)
        Assert.Equal(0.0, summary.WaitMs, 3);
        Assert.Equal(1, summary.GoodFrames);
    }

    // Spike de 500ms no wait não distorce a média dos demais frames.
    [Fact]
    public void SingleSpike_DoesNotSkewMean()
    {
        var t = Create(5.0);
        // 4 normais: wait=2ms (2000 ticks @1MHz)
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);
        // 1 spike: wait=500ms (500_000 ticks) → excluded
        t.AddGoodFrame(500_000, 500, 4_000, 521_000);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(5, s.GoodFrames);
        Assert.Equal(2.0, s.WaitMs, 3);  // spike excluded → mean = 2.0
    }

    // Frames todos normais → média inalterada.
    [Fact]
    public void AllNormal_NoExclusion()
    {
        var t = Create(5.0);
        t.AddGoodFrame(1_000, 500, 4_000, 20_000);
        t.AddGoodFrame(3_000, 500, 4_000, 20_000);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(2.0, s.WaitMs, 3); // mean of 1ms and 3ms
        Assert.Equal(2, s.GoodFrames);
    }

    // O summary precisa expor AS DUAS populações. O FeedFps usa GoodFrames (todos os
    // frames) e o TotalMs usa só os limpos — logo `TotalMs × GoodFrames` NÃO recupera o
    // trabalho real da janela sempre que há outlier, e o log deixa de fechar a conta.
    // Foi exatamente o que deixou os ~11,7ms/frame sem destino no log de 2026-09-29.
    [Fact]
    public void Summary_ExpoeAsDuasPopulacoes_ParaFecharAConta()
    {
        var t = Create(5.0);
        // 4 frames limpos de 20ms
        for (int i = 0; i < 4; i++)
            t.AddGoodFrame(1_000, 500, 4_000, 20_000);
        // 1 outlier de 521ms (excluído da média por wait > 100ms)
        t.AddGoodFrame(500_000, 500, 4_000, 521_000);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(5, s.GoodFrames);      // fps conta todos
        Assert.Equal(4, s.CleanFrames);     // média usa só os limpos
        Assert.Equal(20.0, s.TotalMs, 3);   // média limpa
        // (4×20 + 521) / 5 = 120.2 → a média de TODOS os frames
        Assert.Equal(120.2, s.TotalMsAll, 1);
        // A conta fecha: 5 frames × 120.2ms = 601ms de trabalho real na janela.
        // Com a média limpa daria 100ms — 501ms evaporados, invisíveis no log.
        Assert.Equal(601.0, s.GoodFrames * s.TotalMsAll, 1);
        Assert.Equal(1.0, s.FeedFps, 3);
    }

    // Sem outliers, as duas populações coincidem (caracterização: o campo novo não inventa
    // número quando a janela inteira é saudável).
    [Fact]
    public void AllNormal_TotalMsAllCoincideComTotalMs()
    {
        var t = Create(5.0);
        t.AddGoodFrame(1_000, 500, 4_000, 20_000);
        t.AddGoodFrame(3_000, 500, 3_000, 30_000);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(2, s.CleanFrames);
        Assert.Equal(25.0, s.TotalMs, 3);
        Assert.Equal(25.0, s.TotalMsAll, 3);
    }

    // O bloco de pacing (Task.Delay + spin) é o único trecho do loop que NÃO está dentro
    // de `total`. Sem medir os dois lados separadamente, a conta não fecha e não se sabe
    // se o tempo perdido é o delay estourando ou o spin passando do alvo.
    [Fact]
    public void Summary_ExpoeDelayESpinDoPacing_ParaFecharAContaDoPeriodo()
    {
        var t = Create(5.0);
        // 2 frames: 12ms de trabalho + 4ms de delay + 0.7ms de spin = 16.7ms (60fps)
        t.AddGoodFrame(9_000, 100, 2_900, 12_000);
        t.AddPacing(4_000, 700);
        t.AddGoodFrame(9_000, 100, 2_900, 12_000);
        t.AddPacing(4_000, 700);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(4.0, s.PacingDelayMs, 2);
        Assert.Equal(0.7, s.PacingSpinMs, 2);
        // A conta do período fecha: work + delay + spin = 16.7ms = 1/60fps
        Assert.Equal(16.7, s.TotalMsAll + s.PacingDelayMs + s.PacingSpinMs, 2);
    }

    // Janela sem nenhum sample de pacing (ex.: loop ainda na fase de warmup) não quebra.
    [Fact]
    public void Summary_SemPacing_Zera()
    {
        var t = Create(5.0);
        t.AddGoodFrame(9_000, 100, 2_900, 12_000);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(0.0, s.PacingDelayMs, 3);
        Assert.Equal(0.0, s.PacingSpinMs, 3);
    }

    // O bloco de diagnóstico (foreground/alvo/status/drift) roda por iteração FORA do
    // `total` medido (que fecha no AddVideo). Sem expô-lo, `total + pace` não fecha o
    // período e o tempo roubado do loop fica invisível no log.
    [Fact]
    public void Summary_ExpoeDiagnostico_ParaFecharAContaDoPeriodo()
    {
        var t = Create(5.0);
        t.AddGoodFrame(9_000, 100, 2_900, 12_000);
        t.AddDiagnostics(4_000); // 4ms — Freq=1MHz, ticks=µs
        t.AddPacing(4_000, 700);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(4.0, s.DiagnosticsMs, 2);
        // work + diag + delay + spin = 12 + 4 + 4 + 0.7 = 20.7ms
        Assert.Equal(20.7, s.TotalMsAll + s.DiagnosticsMs + s.PacingDelayMs + s.PacingSpinMs, 2);
    }

    // O diagnóstico é amostrado por iteração (como o pacing): a média cobre todas as
    // iterações da janela, inclusive as que não viraram frame bom.
    [Fact]
    public void AddDiagnostics_MediaDeVariasIteracoes()
    {
        var t = Create(5.0);
        t.AddDiagnostics(2_000);
        t.AddDiagnostics(4_000);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(3.0, s.DiagnosticsMs, 2);
    }

    // Janela sem nenhum sample de diagnóstico não quebra (warmup / reinit).
    [Fact]
    public void Summary_SemDiagnostico_Zera()
    {
        var t = Create(5.0);
        t.AddGoodFrame(9_000, 100, 2_900, 12_000);
        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(0.0, s.DiagnosticsMs, 3);
    }

    // O log não fecha sem saber quantas ITERAÇÕES o loop deu. O pacing é amostrado por
    // iteração e o trabalho por frame bom; se as populações diferem, existe iteração
    // queimada (frame não-bom: timeout diferido do WGC, textura nula) que o `good` não
    // conta e que consome um ciclo de pacing inteiro.
    [Fact]
    public void Summary_ExpoeIteracoes_QueNaoViraramFrameBom()
    {
        var t = Create(5.0);
        // 2 frames bons e 3 iterações perdidas (timeout diferido / textura nula).
        // As 3 iterações pesadas pagam pacing mas não entram em AddGoodFrame.
        for (int i = 0; i < 3; i++) t.AddPacing(4_000, 700);
        t.AddGoodFrame(9_000, 100, 2_900, 12_000);
        t.AddPacing(4_000, 700);
        t.AddGoodFrame(9_000, 100, 2_900, 12_000);
        t.AddPacing(4_000, 700);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(5, s.PacingCount);
        Assert.Equal(2, s.GoodFrames);
        Assert.Equal(3, s.PacingCount - s.GoodFrames);
    }

    // Múltiplos outliers: só frames limpos contam na média.
    [Fact]
    public void MultipleOutliers_ExcludeAll()
    {
        var t = Create(5.0);
        // 1 outlier wait
        t.AddGoodFrame(500_000, 500, 4_000, 521_000);
        // 1 outlier convert
        t.AddGoodFrame(2_000, 500, 500_000, 521_000);
        // 1 normal
        t.AddGoodFrame(2_000, 500, 4_000, 21_000);

        Assert.True(t.TryTakeSummary(5_000_000, out var s));
        Assert.Equal(3, s.GoodFrames);
        // Only the 1 normal frame used for mean
        Assert.Equal(2.0, s.WaitMs, 3);
        Assert.Equal(4.0, s.ConvertMs, 3);
    }
}