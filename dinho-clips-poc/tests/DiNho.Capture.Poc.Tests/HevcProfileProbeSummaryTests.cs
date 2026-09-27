namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Item 9: <c>hevc_nvenc</c> pede <c>-profile:v main10</c> (FfmpegEncoder.cs:315) enquanto a
/// entrada do pipeline é <c>-f rawvideo -pix_fmt nv12</c> — 8 bits. Bitstream de 10 bits gerado
/// de um sinal de 8 bits não tem de onde ganhar qualidade; no máximo evita o banding de 8 bits,
/// ao custo de um upconvert.
///
/// <para><b>A premissa do plano estava errada e o item virou o contrário do que ele dizia.</b>
/// O plano pedia "adotar main10 atrás de uma flag". A flag já existia — inverted: main10 está
/// em produção <b>incondicional</b>, desde pelo menos 2026-08-03. Então a pergunta não é
/// "adota?", e sim <b>"o que já está lá se paga?"</b>, e a resposta possível é remover.
///
/// <para>Estes testes travam o critério ANTES da medição (regra de ouro do plano: "medir antes
/// de fixar número; se a medição refutar a hipótese, o item termina sem mudança de comportamento"
/// — aqui a mudança de comportamento possível é <i>remover</i> algo já em produção, que é
/// justamente o caso em que não se pode decidir depois de ver o número que se quer).</para>
///
/// <para>Critério fixado: main10 só continua se entregar <b>≥5% menos bytes</b> no mesmo CQ
/// <b>E</b> perder <b>&lt;5% de fps</b>. Falhou qualquer um dos dois ⇒ remove.(main10).</para>
/// </summary>
public class HevcProfileProbeSummaryTests
{
    private const double MinByteGainPct = 5.0;
    private const double MaxFpsLossPct = 5.0;

    [Fact]
    public void Criterion_Main10_SavesBytesWithoutFpsCost_KeepsIt()
    {
        // main10 entrega 12% menos bytes e custa 1% de fps: passa nos dois lados do critério.
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: (297.0, 17600));

        Assert.Equal(HevcProfileVerdict.KeepMain10, s.Verdict);
        Assert.Equal(-12.0, s.ByteDeltaPct!.Value, 1);
        Assert.Equal(-1.0, s.FpsDeltaPct!.Value, 1);
    }

    [Fact]
    public void Criterion_Main10_NoByteGain_RecommendsRemoval()
    {
        // O caso que a hipótese do plano predicts: main10 é byte-idêntico (conversão 8→10 sem
        // fonte de ganho). Não há o que pagar a conversão, então sai.
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: (299.0, 20000));

        Assert.Equal(HevcProfileVerdict.RemoveMain10, s.Verdict);
        Assert.Equal(0.0, s.ByteDeltaPct!.Value, 1);
    }

    [Fact]
    public void Criterion_Main10_CostsFps_RecommendsRemoval_EvenWithByteGain()
    {
        // Byte ganha 20% mas o fps cai 30% (upconvert de 8→10 custa caro). Os dois lados do
        // critério importam: um deles sozinho já reprova. E o caso é REALISTA — converter em
        // software custa CPU que o encoder HW não tem por que pagar.
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: (210.0, 16000));

        Assert.Equal(HevcProfileVerdict.RemoveMain10, s.Verdict);
        Assert.Equal(-20.0, s.ByteDeltaPct!.Value, 1);
        Assert.Equal(-30.0, s.FpsDeltaPct!.Value, 1);
    }

    [Fact]
    public void Criterion_ByteGainRightAtThreshold_Keeps_JustInside5Pct()
    {
        // Borda: exatamente 5% de byte e 0% de fps. O critério diz "≥5%", então mantém.
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: (300.0, 19000));

        Assert.Equal(HevcProfileVerdict.KeepMain10, s.Verdict);
        Assert.Equal(-5.0, s.ByteDeltaPct!.Value, 1);
    }

    [Fact]
    public void Criterion_FpsLossRightAtThreshold_Removes_AtExactly5Pct()
    {
        // Borda do outro lado: perda de exatamente 5% de fps reprova ("<5%" é a condição).
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: (285.0, 19000));

        Assert.Equal(HevcProfileVerdict.RemoveMain10, s.Verdict);
        Assert.Equal(-5.0, s.FpsDeltaPct!.Value, 1);
    }

    [Fact]
    public void Criterion_Main10_MeasuredBigger_ReportsPositiveDeltas()
    {
        // main10 "ganhando" bytes e fps é fisicamente implausível; o relatório precisa mostrar o
        // número como ele é (sinal invertido = erro de cálculo do resumo, não do encoder).
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (200.0, 10000), main10: (260.0, 12000));

        Assert.Equal(+30.0, s.FpsDeltaPct!.Value, 1);
        Assert.Equal(+20.0, s.ByteDeltaPct!.Value, 1);
        Assert.Equal(HevcProfileVerdict.RemoveMain10, s.Verdict);
    }

    [Fact]
    public void Summary_MissingBaseline_ReportsUnmeasuredInsteadOfGuessing()
    {
        // main10 medido e main não (o encoder devolveu null): sem referência não há delta, e
        // "sem referência" não é motivo para dizer que main10 ganha ou perde.
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: null, main10: (297.0, 17600));

        Assert.Equal(HevcProfileVerdict.Unmeasured, s.Verdict);
        Assert.Null(s.ByteDeltaPct);
        Assert.Null(s.FpsDeltaPct);
    }

    [Fact]
    public void Summary_NothingMeasured_ReportsUnmeasured()
    {
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: null, main10: null);

        Assert.Equal(HevcProfileVerdict.Unmeasured, s.Verdict);
    }

    [Fact]
    public void Summary_MainRejectedByEncoder_ReportsUnmeasured()
    {
        // main10 recusado pelo ffmpeg (main10 exige o bitstream 10 bits; se o encoder recusar, é
        // a resposta mais forte possível a favor de remover — mas o relatório é honesto: não
        // mediu, não conclui por número).
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: null);

        Assert.Equal(HevcProfileVerdict.Unmeasured, s.Verdict);
    }

    [Fact]
    public void ToReportLine_NamesBothSidesAndTheVerdict()
    {
        // O relatório precisa dizer o que foi medido E o que fazer, senão ele repete o defeito do
        // Item 5 (anunciar uma pergunta e responder outra).
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: (297.0, 17600));
        var line = s.ToReportLine();

        // Os DOIS lados, com o rótulo exato. A versão anterior usava Assert.Contains("main"),
        // que passa trivialmente porque "main" é substring de "main10" — ou seja, o relatório
        // poderia citar só o main10 e o teste continuava verde, exatamente o defeito que o
        // nome do teste diz medir (mesma lição do `-profile:v main` do Item 9).
        Assert.Contains("main10 vs main", line);
        Assert.Contains("MANTER main10", line);
        Assert.Contains("-12", line);
        Assert.Contains("-1", line);
    }

    [Fact]
    public void ToReportLine_Removal_ShowsHowFarFromThe5PctBar()
    {
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: (300.0, 20000), main10: (299.0, 20000));
        var line = s.ToReportLine();

        Assert.Contains("REMOVER main10", line);
        // A frase inteira, e não um "5" solto: o "5" isolado casaria com qualquer número do
        // relatório (inclusive "-5.0% de fps") e não provaria que a barra foi nomeada.
        Assert.Contains(
            $"não passa dos {ProgramBenchmark.HevcProfileMinByteGainPct:0}% de byte sem perder "
            + $"{ProgramBenchmark.HevcProfileMaxFpsLossPct:0}% de fps",
            line);
    }

    [Fact]
    public void ToReportLine_Unmeasured_SaysSoWithoutAVerdict()
    {
        var s = ProgramBenchmark.SummarizeHevcProfileProbe(main: null, main10: null);

        Assert.Contains("nada medido", s.ToReportLine());
    }

    [Fact]
    public void Criterion_ThresholdsAreTheOnesFixedInThePlan()
    {
        // Trava do critério: 5%/5% foi fixado no plano ANTES de medir. Se alguém afrouxar, o
        // teste quebra — e o número do plano deixa de ser o número do código.
        Assert.Equal(5.0, MinByteGainPct);
        Assert.Equal(5.0, MaxFpsLossPct);
        Assert.Equal(MinByteGainPct, ProgramBenchmark.HevcProfileMinByteGainPct);
        Assert.Equal(MaxFpsLossPct, ProgramBenchmark.HevcProfileMaxFpsLossPct);
    }
}
