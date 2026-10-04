using DiNho.Capture.Poc.Pipeline;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Simulacao do <c>PipelineLoop</c> (ordenacao real: resync no topo, PTS do slot,
/// <c>CaptureWaitMs</c>, <c>TryPad</c> no miss, <c>Advance</c> uma vez por tick, e
/// espera ate <c>DeadlineTicksFor(slot)</c>) com uma fonte sintetica de cadencia
/// arbitraria.
///
/// Porque existe: <see cref="FrameGrid"/> (22 testes) e <see cref="FramePadder"/> (12 testes)
/// estao testados isoladamente, mas a LOGICA DE PACING - a que produziu os 542 dPTS do clip
/// de 2026-10-03 - nao tinha teste nenhum. Estes testes compoem as duas classes e verificam a
/// invariante que importa: <b>quaisquer que sejam a cadencia da fonte e o custo de
/// processamento, o PTS de cada packet tem de cair exactamente na grelha.</b>
///
/// Nao substituem um soak real (a fonte sintetica nao tem DWM, nem GPU, nem encoder), mas
/// trocam "144 fps num monitor de 144 Hz" por uma simulacao determinista e instantanea.
/// </summary>
public sealed class CfrPacerSimulationTests
{
    private const long Freq = 1_000_000;          // ticks = microssegundos
    private const int GridFps = 60;
    private const int CapMs = 22;                 // mesmo tecto de ComputeCaptureTimeoutMs
    private const int PadBudget = 2;              // TexturePool(3) - 1
    private const long Interval = 16_667;         // round(1_000_000 / 60)

    private const int Real = 1;
    private const int Dup = 2;
    private const int Skip = 0;

    private sealed class SimResult
    {
        public List<long> Pts { get; } = new();
        public List<int> Kind { get; } = new();
        public long Skipped { get; set; }
        public int Resyncs { get; set; }
        public int Dups => Kind.Count(k => k == Dup);
        public int Skips => Kind.Count(k => k == Skip);
        public int Reals => Kind.Count(k => k == Real);
        public int LongestDupRun { get; set; }
    }

    /// <summary>
    /// Corre um pipeline simulado. <paramref name="procMsAt"/> devolve o custo de processamento
    /// do slot (copia + convert + encode) e e onde se injectam overruns.
    /// <paramref name="stallAtSlot"/>/<paramref name="stallSlots"/> simulam uma paragem brusca
    /// (alt-tab, stall de GPU) em que o "agora" salta varias Periodos de uma vez.
    /// </summary>
    private static SimResult Sim(
        int srcFps,
        int slots,
        Func<int, int>? procMsAt = null,
        long stallAtSlot = -1,
        long stallSlots = 0,
        int procMs = 4,
        int diagMs = 1)
    {
        var grid = new FrameGrid(0, GridFps, Freq);
        var padder = new FramePadder<object>(PadBudget);
        var r = new SimResult();
        var texture = new object();

        long now = 0;
        var srcInterval = (long)Math.Round(Freq / (double)Math.Max(1, srcFps));
        long nextSrc = 0;
        var dupRun = 0;

        for (var k = 0; k < slots; k++)
        {
            if (k == stallAtSlot) now += stallSlots * grid.IntervalTicks;

            // Topo do tick: resync antes de calcular o PTS do slot.
            if (grid.ShouldResync(now))
            {
                var before = grid.Skipped;
                grid.Resync(now);
                var lost = grid.Skipped - before;
                if (lost > 0)
                {
                    r.Skipped += lost;
                    r.Resyncs++;
                    padder.Invalidate();      // o loop tambem invalida o orcamento de dups
                    dupRun = 0;
                }
            }

            var pts = grid.PtsTicksFor(grid.Slot);
            var waitMs = grid.CaptureWaitMs(now, CapMs);
            var waitUntil = now + waitMs * Freq / 1000;
            var proc = (procMsAt?.Invoke(k) ?? procMs) * Freq / 1000;

            if (nextSrc <= waitUntil)
            {
                // Frame real: a fonte tinha uma frame pronta dentro da janela de captura.
                now = Math.Max(now, nextSrc);
                nextSrc += srcInterval;
                padder.Observe(texture, 1920, 1080);
                now += proc;
                grid.Advance();
                r.Pts.Add(pts); r.Kind.Add(Real);
                dupRun = 0;
            }
            else
            {
                // Timeout: a fonte nao entregou nada dentro da janela.
                now = waitUntil;
                if (padder.TryPad(out _, 0, 0))
                {
                    now += proc;
                    grid.Advance();
                    r.Pts.Add(pts); r.Kind.Add(Dup);
                    r.LongestDupRun = Math.Max(r.LongestDupRun, ++dupRun);
                }
                else
                {
                    grid.Advance();            // miss a serio: o slot nao e emitido
                    r.Kind.Add(Skip);
                    dupRun = 0;
                }
            }

            now += diagMs * Freq / 1000;

            // Espera orientada a grelha: o alvo eDeadlineTicksFor(slot).
            var target = grid.DeadlineTicksFor(grid.Slot);
            if (now < target) now = target;
        }

        return r;
    }

    /// <summary>
    /// INVARIANTE CENTRAL. Todo o delta entre packets emitidos tem de ser um multiplo
    /// exacto de <see cref="Interval"/>.
    ///
    /// A primeira versao deste teste exigia delta == 1 intervalo e FALHOU, o que estava
    /// certo: um delta de 2 intervalos e um SKIP (o slot nao e emitido, o pacote
    /// seguinte vem dois slots depois) e um delta de N intervalos e um RESYNC. Nenhum dos
    /// dois e um buraco. O que seria um buraco - e o bug dos 542 dPTS - e um delta que
    /// nao e multiplo do periodo, porque isso significa que o PTS saiu da grelha.
    /// </summary>
    private static void AssertPtsOnGrid(SimResult r)
    {
        Assert.True(r.Pts.Count >= 2, $"simulacao produziu so {r.Pts.Count} packets");
        for (var i = 1; i < r.Pts.Count; i++)
        {
            var d = r.Pts[i] - r.Pts[i - 1];
            Assert.True(d > 0, $"PTS nao monotónico no indice {i}: {r.Pts[i - 1]} -> {r.Pts[i]}");
            Assert.Equal(0, d % Interval);
        }
    }

    /// <summary>Conta os deltas que nao sao exactamente 1 periodo (skips e resyncs).</summary>
    private static int CountGapsBeyondOneSlot(SimResult r)
    {
        var n = 0;
        for (var i = 1; i < r.Pts.Count; i++)
            if (r.Pts[i] - r.Pts[i - 1] != Interval) n++;
        return n;
    }

    /// <summary>Delta de exactamente 1 periodo em todas as transicoes - grelha sem falhas.</summary>
    private static void AssertGridExact(SimResult r)
    {
        AssertPtsOnGrid(r);
        Assert.Equal(0, CountGapsBeyondOneSlot(r));
    }

    // ── Fonte ACIMA de 60 fps (o "caso 144 fps", sem monitor de 144 Hz) ────────────────

    [Fact]
    public void Fonte180Fps_NuncaDuplica_NuncaSalta()
    {
        var r = Sim(srcFps: 180, slots: 18_000);

        AssertGridExact(r);
        Assert.Equal(18_000, r.Reals);
        Assert.Equal(0, r.Dups);      // nunca falta imagem: o padding nao tem trabalho
        Assert.Equal(0, r.Skips);
        Assert.Equal(0, r.Resyncs);
    }

    // 240 fps = 4 frames por slot. Confirma que a excesso de frames NAO faz o loop
    // emitir mais do que 60 por segundo (seria duplicar a grelha, nao usar a grelha).
    [Fact]
    public void Fonte240Fps_NaoEmiteMaisQueOSlotsDaGrelha()
    {
        var r = Sim(srcFps: 240, slots: 3_600);

        AssertGridExact(r);
        Assert.Equal(3_600, r.Pts.Count);
        Assert.Equal(0, r.Dups);
        Assert.Equal(0, r.Skips);
    }

    // ── Fonte ABAIXO de 60 fps: e o caso que exercita o PADDING ────────────────────────

    [Fact]
    public void Fonte30Fps_PreencheOsSlotsVaziosSemFurarATimeline()
    {
        var r = Sim(srcFps: 30, slots: 9_000);

        AssertGridExact(r);
        Assert.True(r.Dups > 0, "a 30 fps metade dos slots tem de ser preenchida por duplicata");
        Assert.Equal(0, r.Skips);     // o orcamento de 2 nunca esgota a cadencia de 30 fps
    }

    // ORCAMENTO DE DUPLICATAS — a fronteira e exactamente 20 fps.
    //
    // 20 fps = 50 ms por frame = 3 slots de 16,667 ms. Logo 1 frame real + 2 duplicatas,
    // que e exactamente o orcamento (TexturePool(3) - 1 = 2). Medido: 2001 reais + 3999 dups
    // e ZERO skips em 6000 slots. Abaixo de 20 fps ha 4 ou mais slots por frame, o orcamento
    // deixa de chegar e o slot e SALTADO — o clip fica mais curto, nunca com buracos.
    [Fact]
    public void Fonte20Fps_OrcamentoExatamenteChegado_NuncaSalta()
    {
        var r = Sim(srcFps: 20, slots: 6_000);

        AssertGridExact(r);
        Assert.Equal(0, r.Skips);
        Assert.Equal(2, r.LongestDupRun);
        // 3 slots por frame => 2/3 dos slots sao duplicatas.
        Assert.Equal(6_000 - r.Reals, r.Dups);
    }

    // 15 fps = 66,7 ms por frame = 4 slots. O orcamento de 2 nao chega: o terceiro miss
    // e um SKIP. E o que o `skip=` da telemetria mede - e, como o soak mostrou, encurta o
    // clip sem abrir um unico buraco na timeline.
    [Fact]
    public void Fonte15Fps_ExcedendoOrcamento_ViraSkipNaoBuraco()
    {
        var r = Sim(srcFps: 15, slots: 6_000);

        AssertPtsOnGrid(r);
        Assert.True(r.Skips > 0, "a 15 fps o orcamento de 2 dups tem de esgotar");
        Assert.True(r.LongestDupRun <= PadBudget, $"corrida de {r.LongestDupRun} dups > orcamento {PadBudget}");
        // Cada skip traduz-se em (um) delta acima de 1 periodo, e nada mais.
        Assert.Equal(r.Skips, CountGapsBeyondOneSlot(r));
    }

    // O orcamento de duplicatas nunca e excedido, seja qual for a cadencia da fonte.
    [Theory]
    [InlineData(10)]
    [InlineData(15)]
    [InlineData(20)]
    [InlineData(24)]
    [InlineData(30)]
    [InlineData(45)]
    [InlineData(59)]
    [InlineData(61)]
    [InlineData(90)]
    [InlineData(144)]
    [InlineData(240)]
    public void OrcamentoDeDuplicatasRespeitado_EmQualquerCadencia(int srcFps)
    {
        var r = Sim(srcFps: srcFps, slots: 6_000);

        AssertPtsOnGrid(r);
        Assert.True(r.LongestDupRun <= PadBudget,
            $"fonte a {srcFps} fps produziu {r.LongestDupRun} duplicatas consecutivas (orcamento {PadBudget})");
    }

    // ── O REGRESSAO TEST: overruns de processamento nao podem furar a timeline ──────────
    // Este e o teste do bug dos 542 dPTS. O pacer antigo calculava o alvo como
    // `beforeCapture + intervalo`, portanto um overrun de N ms deslocava a grelha de PTS
    // N ms PARA SEMPRE. Aqui um slot estica o processamento para 25 ms (muito acima do
    // periodo de 16,667 ms) e mesmo assim o PTS tem de ficar exacto.

    [Fact]
    public void OverrunDeProcessamento_NaoDeslocaAGrelhaDePts()
    {
        // 1 em cada 7 slots custa 25 ms - 1,5x o periodo. O overruns e' deliberado.
        var r = Sim(srcFps: 60, slots: 18_000, procMsAt: k => k % 7 == 0 ? 25 : 4);

        AssertGridExact(r);
        Assert.Equal(0, r.Skips);
    }

    // Overruns periodicos: estes nao podem produzir duplicatas em cadeia: quando o loop
    // se atrasa, a proxima iteracao ve a janela de captura ja aberta e devolve 1 ms.
    [Fact]
    public void OverrunPeriodico_NaoProvocaCorridaDeDuplicatas()
    {
        var r = Sim(srcFps: 60, slots: 18_000, procMsAt: k => k % 7 == 0 ? 25 : 4);

        AssertGridExact(r);
        Assert.True(r.Dups < r.Pts.Count * 0.10,
            $"dup = {r.Dups}/{r.Pts.Count} ({100.0 * r.Dups / r.Pts.Count:N1}%) - acima de 10% significa que o padding esta a esconder perda de captura real");
    }

    // 144 fps COM overruns: o "caso 144 fps" completo. A grelha tem de continuar exacta
    // mesmo com a fonte a 2,4x a cadencia e com picos de processamento.
    [Fact]
    public void Fonte144Fps_ComOverruns_GrelhaContinuaExacta()
    {
        var r = Sim(srcFps: 144, slots: 18_000, procMsAt: k => k % 5 == 0 ? 22 : 3);

        AssertGridExact(r);
        Assert.Equal(0, r.Skips);
        Assert.Equal(0, r.Dups);
    }

    // ── Paragem brusca: o resync conta os slots perdidos e a grelha volta a ser exacta ──

    // NOTA sobre o offset de 1 intervalo: no loop real o Advance() acontece ANTES do
    // pacing, e o alvo e DeadlineTicksFor(slot) = ancora + (slot+1) x intervalo. Logo o
    // PTS emitido fica permanentemente 1 intervalo ATRAS do relogio de parede. E por isso
    // que uma paragem de N periodos contada a partir do topo do tick aparece como N+1
    // slots perdidos. Este e o comportamento observado, nao um erro da simulacao - se
    // mudar, este teste falha e o sinal e que a ordem Advance/pacing mudou no loop.
    [Fact]
    public void ParagemBrusca_ResyncContaSlotsPerdidos()
    {
        var r = Sim(srcFps: 60, slots: 3_600, stallAtSlot: 1_800, stallSlots: 12);

        Assert.Equal(1, r.Resyncs);
        Assert.Equal(13, r.Skipped);   // 12 da paragem + 1 do offset PTS-atras-do-relogio
    }

    // Aps o resync a timeline tem de voltar a ser exacta. Este e o ponto do resync:
    // reancora sem partir o que vem a seguir. O salto e um multiplo do periodo (o PTS
    // salta `lost` intervalos de uma vez), logo o PTS nao sai da grelha - so ha UM delta
    // acima de 1 periodo em todo o clip, e e o do proprio resync.
    [Fact]
    public void AposResync_ATimelineVoltaAoExacto()
    {
        var r = Sim(srcFps: 60, slots: 3_600, stallAtSlot: 1_800, stallSlots: 12);

        AssertPtsOnGrid(r);
        Assert.Equal(1, CountGapsBeyondOneSlot(r));   // so o salto do resync
    }

    // O salto do resync tem de ser multiplo do periodo. Vale `lost + 1` intervalos e nao
    // `lost`: o resync reancora o slot CORRENTE em `now`, e o pacote anterior foi emitido no
    // slot anterior. Medido: Skipped=13 e salto de 233 338 ticks = 14 x 16 667.
    [Fact]
    public void SaltoDoResync_ValeraoSlotsContados()
    {
        var r = Sim(srcFps: 60, slots: 3_600, stallAtSlot: 1_800, stallSlots: 12);

        Assert.Equal(13, r.Skipped);
        for (var i = 1; i < r.Pts.Count; i++)
        {
            var d = r.Pts[i] - r.Pts[i - 1];
            if (d == Interval) continue;
            Assert.Equal((r.Skipped + 1) * Interval, d);
            return;
        }
        Assert.Fail("nenhum salto de resync encontrado na timeline");
    }

    // Resync invalida o orcamento de duplicatas, portanto logo a seguir pode haver uma
    // corrida de dups ate ao limite - mas nunca acima.
    [Fact]
    public void Resync_InvalidaOrcamentoSemExceder()
    {
        var r = Sim(srcFps: 60, slots: 3_600, stallAtSlot: 1_800, stallSlots: 12);

        Assert.True(r.LongestDupRun <= PadBudget);
        Assert.Equal(0, r.Skips);
    }

    // ── Sanidade do modelo: a simulacao tem de produzir os regimes que a medicao reais espera ──

    [Fact]
    public void Simulacao_ReproduzOsRegimesEsperados()
    {
        // Acima de 60 fps: nunca falta imagem, logo zero duplicatas.
        Assert.Equal(0, Sim(srcFps: 144, slots: 6_000).Dups);
        Assert.Equal(0, Sim(srcFps: 240, slots: 6_000).Dups);
        // 60 fps exactos: uma frame por slot, zero dups.
        Assert.Equal(0, Sim(srcFps: 60, slots: 6_000).Dups);
        // Abaixo de 60 fps: o padding e o que preenche, e ele trabalha.
        Assert.True(Sim(srcFps: 30, slots: 6_000).Dups > 1_000);
        // 20 fps: o orcamento de 2 chega exactamente (3 slots por frame).
        Assert.Equal(0, Sim(srcFps: 20, slots: 6_000).Skips);
        // Abaixo de 20 fps: o orcamento esgota e o slot e saltado (clip mais curto, sem buraco).
        Assert.True(Sim(srcFps: 15, slots: 6_000).Skips > 0);
    }

    // Uma fonte a 60 fps NUNCA produz skips: se um slot e perdido, o pipeline falhou,
    // porque havia sempre uma frame disponivel. Este teste fixa esse piso.
    [Fact]
    public void Fonte60Fps_NuncaSalta_Slots()
    {
        var r = Sim(srcFps: 60, slots: 18_000);

        AssertGridExact(r);
        Assert.Equal(0, r.Skips);
        Assert.Equal(0, r.Dups);
    }
}