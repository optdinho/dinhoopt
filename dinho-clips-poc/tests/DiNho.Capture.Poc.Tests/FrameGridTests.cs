using DiNho.Capture.Poc.Pipeline;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Grelha CFR absoluta: o deadline de cada tick e a ancora + (slot+1) x intervalo, NUNCA
/// relativo ao inicio da iteracao corrente. Um overrun absorve-se no slot seguinte em vez de
/// furar a timeline de PTS - que era a causa dos 542 dPTS anomalos do clip de 2026-10-03.
/// </summary>
public sealed class FrameGridTests
{
    private const long Freq = 1_000_000; // ticks = microssegundos
    private const int Fps = 60;
    private const long Interval = 16_667; // round(1_000_000 / 60) = 16667 ticks = 16,667 ms

    /// <summary>Timeout maximo de espera pela frame - mesmo teto de ComputeCaptureTimeoutMs (ceil(1000/60)+5).</summary>
    private const int CapMs = 22;

    private static FrameGrid Create(long nowTicks = 0, int fps = Fps)
        => new(nowTicks, fps, Freq);

    // Intervalo em ticks QPC, arredondado: 1_000_000L / 60 trunca para 16666 e faz o loop
    // correr a 60,0024 fps (+2,4 us/s, ~0,7 ms em 300 s de timeline).
    [Fact]
    public void IntervalTicks_Redondeado_NaoTruncado()
    {
        var g = Create();
        Assert.Equal(Interval, g.IntervalTicks);
        Assert.NotEqual(16_666, g.IntervalTicks);
    }

    // A slot 0 vale o instante de ancora - o PTS do primeiro tick e zero por definicao.
    [Fact]
    public void PtsFor_PrimeiroSlot_Zero()
    {
        var g = Create(nowTicks: 123_456_789);
        Assert.Equal(123_456_789, g.PtsTicksFor(0));
        Assert.Equal(0, g.Slot);
    }

    // O passo entre slots e exactamente um periodo: e isto que torna a timeline CFR.
    [Fact]
    public void PtsFor_IncrementaExatamenteUmIntervalo()
    {
        var g = Create();
        for (long slot = 0; slot < 120; slot++)
            Assert.Equal(Interval * slot, g.PtsTicksFor(slot));
    }

    // O deadline de um slot e o inicio do seguinte - e a ancora mais N periodos.
    [Fact]
    public void DeadlineFor_EhAncoraMaisNPeriodos()
    {
        var g = Create();
        Assert.Equal(Interval, g.DeadlineTicksFor(0));
        Assert.Equal(2 * Interval, g.DeadlineTicksFor(1));
        Assert.Equal(101 * Interval, g.DeadlineTicksFor(100));
    }

    // PTS estritamente monotonico ao longo de uma sessao longa (2 min a 60 fps).
    [Fact]
    public void PtsFor_EraMonotonico_EntreSlots()
    {
        var g = Create();
        long prev = g.PtsTicksFor(0);
        for (long slot = 1; slot <= 7_200; slot++)
        {
            var pts = g.PtsTicksFor(slot);
            Assert.True(pts > prev, $"slot {slot}: {pts} nao e maior que {prev}");
            prev = pts;
        }
    }

    // Loop em dia: sem overruns, nunca ressincroniza.
    [Fact]
    public void ShouldResync_False_EmJanelaNormal()
    {
        var g = Create();
        for (long slot = 0; slot < 100; slot++)
        {
            Assert.False(g.ShouldResync(g.DeadlineTicksFor(g.Slot)));
            g.Advance();
        }
        Assert.Equal(0, g.Skipped);
    }

    // O overrun de uma iteracao NAO desloca a grelha: o proximo slot continua com o
    // PTS exacto que teria se o overrun nao existisse. Este e o teste que mata os
    // ~360 dPTS de 18-21 ms do clip real.
    [Fact]
    public void Advance_DepoisDeOverrun_NaoDeslocaAGrelha()
    {
        var g = Create();
        var esperado = g.PtsTicksFor(1);

        // Iteracao 0 overrun em 5 ms - o loop arrancou 5 ms tarde.
        g.Advance();

        Assert.Equal(esperado, g.PtsTicksFor(g.Slot));
        Assert.Equal(Interval, g.PtsTicksFor(1) - g.PtsTicksFor(0));
    }

    // Overrun grande (loop bloqueado) -> ressincroniza.
    [Fact]
    public void ShouldResync_Verdadeiro_ComOverrunGrande()
    {
        var g = Create();
        var muitoTarde = g.DeadlineTicksFor(g.Slot) + (FrameGrid.MaxSlipSlots + 1) * Interval;
        Assert.True(g.ShouldResync(muitoTarde));
    }

// Resync reancora o slot corrente no "agora" e mantem a FASE: o indice nao salta, o
    // PTS avanca exactamente um intervalo de slot para slot. Repara-se no buraco que isto
    // cria no ficheiro (83,335 ms abaixo) — e ele e' o objectivo, nao um efeito colateral.
    [Fact]
    public void Resync_ReancoraNoAgora_PreservandoAGrelha()
    {
        var g = Create();
        g.Advance();
        g.Advance();
        var slot = g.Slot;

        var now = g.PtsTicksFor(slot) + 50 * Interval; // 50 slots de atraso
        g.Resync(now);

        Assert.Equal(now, g.PtsTicksFor(g.Slot));
        Assert.Equal(Interval, g.PtsTicksFor(g.Slot + 1) - g.PtsTicksFor(g.Slot));
        Assert.False(g.ShouldResync(now));
    }

    // O preco do resync, medido: o PTS do slot reancorado salta `lost x intervalo` em
    // relacao ao ultimo PTS emitido. E um buraco UNICO no ficheiro - o que o diferencia de
    // apanhar o atraso slot a slot, onde cada slot furaria um intervalo.
    [Fact]
    public void Resync_InsereUmUnicoBuraco_DeLostVezesOIntervalo()
    {
        var g = Create();
        var ptsAntes = g.PtsTicksFor(g.Slot);        // ultimo PTS emitido
        var lost = 50;
        g.Resync(ptsAntes + lost * Interval);
        var ptsDepois = g.PtsTicksFor(g.Slot);       // proximo PTS a entrar no ficheiro

        Assert.Equal(lost * Interval, ptsDepois - ptsAntes);
        // ...e a partir dai a grelha volta a ser exactamente CFR.
        Assert.Equal(Interval, g.PtsTicksFor(g.Slot + 1) - ptsDepois);
    }

    // Resync conta os slots perdidos como skipped - nunca emitidos, nunca duplicados.
    [Fact]
    public void Resync_ContaSlotsPerdidos()
    {
        var g = Create();
        var now = g.PtsTicksFor(g.Slot) + 50 * Interval;
        g.Resync(now);
        Assert.Equal(50, g.Skipped);
    }

    // Resync repetido nao volta a contar os mesmos slots.
    [Fact]
    public void Resync_DuasVezes_ContaSoODefice()
    {
        var g = Create();
        g.Resync(g.PtsTicksFor(0) + 50 * Interval);
        var half = g.PtsTicksFor(g.Slot) + 10 * Interval;
        g.Resync(half);
        Assert.Equal(60, g.Skipped);
    }

    // Em dia (loop comecado no deadline): a janela de captura esta toda aberta.
    [Fact]
    public void CaptureWaitMs_EmDia_RetornaOCapMs()
    {
        var g = Create();
        Assert.Equal(CapMs, g.CaptureWaitMs(g.PtsTicksFor(g.Slot), CapMs));
    }

    // REGRA CENTRAL: se a janela do slot JA FECHOU, esperar mais 22 ms e o que produzia
    // os deltas de 38-46 ms (timeout + timeout seguinte). Retorna 1 ms - testa o mailbox
    // uma vez e segue o relogio.
    [Fact]
    public void CaptureWaitMs_JanelaFechada_Retorna1ms()
    {
        var g = Create();
        var agora = g.PtsTicksFor(g.Slot) + CapMs * 1_000; // 22 ms tarde = janela fechada
        Assert.Equal(1, g.CaptureWaitMs(agora, CapMs));
    }

    // Nunca 0: TryCaptureFrame(0) bloquearia o pipeline a espera do proximo FrameArrived
    // em vez de continuar o relogio.
    [Theory]
    [InlineData(-500_000)]  // muito cedo (loop adiantado)
    [InlineData(0)]
    [InlineData(16_666)]
    [InlineData(22_000)]
    [InlineData(40_000)]
    [InlineData(5_000_000)] // muito atrasado
    public void CaptureWaitMs_JamaisZero_NuncaExcedeOCap(long offsetTicks)
    {
        var g = Create();
        var wait = g.CaptureWaitMs(g.PtsTicksFor(g.Slot) + offsetTicks, CapMs);
        Assert.InRange(wait, 1, CapMs);
    }

    // O deadline seguinte continua a andar exactamente um intervalo, mesmo apos
    // varios ticks consecutivos em que o loop se atrasou.
    [Fact]
    public void DeadlineFor_AvancaUmIntervalo_EmCadaTick()
    {
        var g = Create();
        var primeiro = g.DeadlineTicksFor(g.Slot);
        g.Advance();
        Assert.Equal(primeiro + Interval, g.DeadlineTicksFor(g.Slot));
    }

    // fps invalido nao pode dividir por zero - cai para 1 fps.
    [Fact]
    public void Construtor_FpsInvalido_NaoDividePorZero()
    {
        foreach (var fps in new[] { 0, -1 })
        {
            var g = new FrameGrid(0, fps, Freq);
            Assert.True(g.IntervalTicks > 0, $"fps={fps} produziu intervalo {g.IntervalTicks}");
        }
    }

    // Sem frequencia explicita usa-se a do Stopwatch (produz um intervalo plausivel).
    [Fact]
    public void Construtor_SemFreq_UsaStopwatch()
    {
        var g = new FrameGrid(0, Fps, 0);
        Assert.True(g.IntervalTicks > 0);
        Assert.Equal(0, g.Slot);
    }
}