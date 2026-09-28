using System.Globalization;

namespace DiNho.Capture.Poc.Encoders;

/// <summary>Uma célula da grade <c>usage x QP</c>: um par medido de verdade, ou um par que o
/// encoder recusou.</summary>
/// <param name="Measured"><c>false</c> quando o encode não rodou. Existe como estado de
/// primeira classe porque <b>0 bytes é o menor número possível</b> e uma célula recusada
/// venceria qualquer pick de "menor custo" se fosse tratada como medida.</param>
/// <param name="Samples">Voltas que entraram na mediana. 1 = triagem só, e um número de
/// timing com uma volta não vira escolha de desempenho.</param>
internal readonly record struct AmdSweepCell(
    string Usage, int Qp, bool Measured, long Bytes, double Vmaf, double Fps, int Samples)
{
    /// <summary>Rótulo estável da célula, para relatório e para casar com as duas pontas do
    /// relatório. Não usar o índice da lista: a ordem da triagem tem timing próprio e muda.</summary>
    /// <summary>Como a célula aparece na tabela.
    ///
    /// <para>A reference é a célula de <b>usage vazio</b> (produção não emite <c>-usage</c>), e
    /// interpolar isso dava <c>/qp16</c> — uma linha sem sujeito, em que o 1º segmento some e
    /// a coluna parece deslocada. O rótulo tem de dizer que a célula é a de <i>sem usage</i>.</para></summary>
    public string Label => $"{(Usage.Length == 0 ? "default" : Usage)}/qp{Qp}";
}

/// <summary>Decisão do sweep, toda em funções puras — a única parte testável sem GPU.</summary>
internal static class AmdSweepVerdict
{
    /// <summary>Percentual de fps em que dois braços deixam de ser distinguíveis na prática.
    /// Mesmo número do corte de promote do <c>--probe-amf-usage</c> (10%)? Não: aqui o corte
    /// é de <b>empate</b>, não de promoção, e 10% seria permissivo demais para "o mais
    /// rápido". 5% é o valor que o <c>JudgeAmfCqp</c> já usa como perda aceitável de fps.</summary>
    internal const double FpsTolerancePct = 5.0;

    /// <summary>Tolerância do portão de qualidade. 0,05 ponto numa escala de 0-100 é
    /// invisível, e existe só para o VMAF lido duas vezes não dar 77,3999999 vs 77,4.
    /// <b>Não é margem de qualidade</b> — é guarda de ponto flutuante.</summary>
    internal const double QualityEpsilon = 0.05;

    /// <summary>Reproduz a imagem estática: bytes/qualidade/velocidade. Uma célula medida sem
    /// repetição não é escolha de <b>desempenho</b> — mesmo piso do
    /// <c>AmfUsageRepeat.MinRoundsForPromote</c> (= 3), e pelo mesmo motivo: nos dados reais do
    /// RX 5700 XT o delta de fps entre voltas foi de 0% a 15% para o MESMO par, então uma
    /// volta é ruído com forma de número. Bytes e VMAF são determinísticos e continuam
    /// valendo com uma volta, por isso o pick de custo não tem este piso.</summary>
    internal const int MinSamplesForThroughputPick = 3;

    /// <summary>Portão "sem perda de qualidade". <paramref name="anchor"/> é o VMAF da
    /// produção; 0 significa produção não medida, e aí o portão não pode reprovar ninguém —
    /// devolver "nenhuma célula passou" seria indistinguível de "todas as células são ruins".</summary>
    internal static bool PassesQuality(double vmaf, double anchor) =>
        anchor <= 0 || vmaf >= anchor - QualityEpsilon;

    /// <summary>Célula <paramref name="b"/> domina a <paramref name="a"/>? Melhor (ou igual)
    /// nos três eixos e estritamente melhor em pelo menos um. Igualdade conta como dominação
    /// de propósito: duas células idênticas nos três eixos são a mesma escolha, e manter as
    /// duas faria o relatório listarifinalistas repetidos.</summary>
    private static bool Dominates(in AmdSweepCell a, in AmdSweepCell b) =>
        a.Bytes <= b.Bytes && a.Vmaf >= b.Vmaf && a.Fps >= b.Fps &&
        (a.Bytes < b.Bytes || a.Vmaf > b.Vmaf || a.Fps > b.Fps);

    /// <summary>Frente de Pareto: as células que <b>ninguém</b> domina. É o conjunto de
    /// finalistas da triagem — as outras não podem ser a resposta para nenhuma pergunta, então
    /// não merecem as voltas extras que as custam.</summary>
    internal static List<AmdSweepCell> Pareto(IReadOnlyList<AmdSweepCell> cells)
    {
        var measured = cells.Where(c => c.Measured).ToList();
        // Distinção por ÍNDICE, não por igualdade de valor. `Equals` num record struct compara
        // os campos, e (default, 26) e (transcoding, 26) com o MESMO QP produzem saída
        // byte-idêntica com frequência — então `Equals` diria que são a mesma célula e as duas
        // entrariam na frente. `ReferenceEquals` num struct taxeia e devolve sempre false, o
        // que é pior: some com a distinção. O índice é a identidade real da grade.
        return measured
            .Where((a, i) => !measured.Where((_, j) => j != i).Any(b => Dominates(b, a)))
            .ToList();
    }

    /// <summary>Como o pick de custo e o de desempenho se relacionam. São <b>três</b> casos, e
    /// o primeiro tem de ser testado antes do segundo porque a mesma célula sempre tem os mesmos
    /// bytes: ordenar ao contrário classifica toda coincidência de célula como "bytes iguais com
    /// rótulos diferentes", que é uma afirmação falsa sobre os dados. Foi o que o sweep de
    /// 27/09 mostrou — custo e velocidade caíram em <c>default/qp30</c> (mesmo rótulo) e o
    /// relatório saiu afirmando que eram rótulos diferentes.</summary>
    internal enum PickRelation
    {
        /// <summary>Os dois picks são a mesma célula. Não há conflito a explicar.</summary>
        SameCell,
        /// <summary>Células distintas que produzem o mesmo arquivo: o que as separou foi algo
        /// que não muda o resultado (o <c>usage</c>).</summary>
        SameBytesDifferentCell,
        /// <summary>Critérios de fato conflitantes: uma é mais barata, a outra mais rápida.</summary>
        Conflict,
    }

    /// <summary>Classifica a relação entre o pick de custo e o de desempenho. A ordem das
    /// comparações é a correção: <see cref="PickRelation.SameCell"/> primeiro, porque
    /// <c>Label</c> igual implica bytes iguais e cairia no caso errado.</summary>
    internal static PickRelation ClassifyPicks(in AmdSweepCell cost, in AmdSweepCell perf) =>
        cost.Label == perf.Label ? PickRelation.SameCell
        : cost.Bytes == perf.Bytes ? PickRelation.SameBytesDifferentCell
        : PickRelation.Conflict;

    /// <summary>Escolha de <b>custo</b>: entre as que passam na qualidade, a de menos bytes.
    /// Empate em bytes vai para a mais rápida — sem isso a decisão seria a ordem da triagem,
    /// que tem timing próprio e pode reordenar entre execuções.</summary>
    internal static AmdSweepCell? PickCost(IReadOnlyList<AmdSweepCell> cells, double anchorVmaf)
    {
        AmdSweepCell? best = null;
        foreach (var c in cells)
        {
            if (!c.Measured || !PassesQuality(c.Vmaf, anchorVmaf)) continue;
            if (best is null || c.Bytes < best.Value.Bytes ||
                (c.Bytes == best.Value.Bytes && c.Fps > best.Value.Fps))
                best = c;
        }
        return best;
    }

    /// <summary>Escolha de <b>desempenho</b>: a mais rápida, e entre as que estão dentro de
    /// <paramref name="tolerancePct"/> dela, a mais barata. O corte existe porque "mais rápido"
    /// só é uma diferença que o usuário sente quando é perceptível; 420 vs 400 fps não é, e o
    /// de 400 entrega o mesmo por menos bytes.</summary>
    internal static AmdSweepCell? PickThroughput(IReadOnlyList<AmdSweepCell> cells, double anchorVmaf, double tolerancePct)
    {
        var pool = cells.Where(c => c.Measured && c.Samples >= MinSamplesForThroughputPick && PassesQuality(c.Vmaf, anchorVmaf)).ToList();
        if (pool.Count == 0) return null;
        var maxFps = pool.Max(c => c.Fps);
        var floor = maxFps * (1 - Math.Max(0, tolerancePct) / 100.0);
        var near = pool.Where(c => c.Fps >= floor).ToList();
        AmdSweepCell best = near[0];
        foreach (var c in near)
            if (c.Bytes < best.Bytes || (c.Bytes == best.Bytes && c.Fps > best.Fps)) best = c;
        return best;
    }

    /// <summary>Quantas vezes o encoder dá conta do alvo. É a resposta interpretável a
    /// "efetividade de hardware" que a coluna de GPU% não dava: 7x significa que sobra
    /// orçamento de encoder para 7x o tempo real.</summary>
    internal static double Headroom(double fps, double targetFps) => targetFps > 0 && fps > 0 ? fps / targetFps : 0;

    // ---------------- quem ganha as voltas extras ----------------

    /// <summary>Tamanho do poço de cada pick: quantas células ele chegou a ver. Os dois picks
    /// <b>não</b> veem o mesmo poço, e esconder isso é o que produziu um relatório com o pick
    /// de "mais rápido" mais lento que o de "mais barato".</summary>
    internal static int CostPoolSize(IReadOnlyList<AmdSweepCell> cells, double anchorVmaf) =>
        cells.Count(c => c.Measured && PassesQuality(c.Vmaf, anchorVmaf));

    /// <summary>Igual ao anterior mais o piso de amostras: é o poço efetivo do pick de
    /// desempenho, e o número que o relatório precisa declarar.</summary>
    internal static int ThroughputPoolSize(IReadOnlyList<AmdSweepCell> cells, double anchorVmaf) =>
        cells.Count(c => c.Measured && c.Samples >= MinSamplesForThroughputPick && PassesQuality(c.Vmaf, anchorVmaf));

    /// <summary>A célula mais rápida entre as que passam na qualidade, <b>sem</b> piso de
    /// amostras. É a triagem do pick de desempenho: o runner a chama para decidir quem recebe
    /// as voltas extras, e nesse ponto <b>ninguém tem 3 voltas ainda</b> — pedir o piso aqui
    /// devolveria sempre null e o orçamento seria sorteado.</summary>
    internal static AmdSweepCell? FastestPassing(IReadOnlyList<AmdSweepCell> cells, double anchorVmaf)
    {
        AmdSweepCell? best = null;
        foreach (var c in cells)
        {
            if (!c.Measured || !PassesQuality(c.Vmaf, anchorVmaf)) continue;
            // Empate de fps vai para a mais barata, pelo mesmo motivo do tiebreak do
            // PickThroughput: 420 vs 420 fps não é diferença, e a de menos bytes é a melhor.
            if (best is null || c.Fps > best.Value.Fps ||
                (c.Fps == best.Value.Fps && c.Bytes < best.Value.Bytes))
                best = c;
        }
        return best;
    }

    /// <summary>Quais células gastam as voltas extras, e o que o relatório precisa saber para
    /// não apresentar um veredito parcial como completo.</summary>
    /// <param name="CheapestPassing">O que <see cref="PickCost"/> devolveria com os dados de
    /// triagem. Repetir esta célula é o que torna o pick de custo confiável.</param>
    /// <param name="FastestPassing">O que <see cref="PickThroughput"/> poderia devolver, sem
    /// piso de amostras. Repetir esta célula é o que torna o pick de desempenho possível.</param>
    /// <param name="FrontPassingDropped">Células da frente que passavam na qualidade e ficaram
    /// sem as voltas. É o número que torna a truncagem <b>visível</b> em vez de sugerir
    /// "aumente FINALISTAS" como se fosse dica.</param>
    internal readonly record struct AmdFinalistSelection(
        IReadOnlyList<AmdSweepCell> Selected,
        AmdSweepCell? CheapestPassing,
        AmdSweepCell? FastestPassing,
        int FrontPassingDropped)
    {
        private bool Has(AmdSweepCell c) => Selected.Any(s => s.Usage == c.Usage && s.Qp == c.Qp);

        /// <summary>O pick de desempenho está <b>provisório</b>: a célula mais rápida da
        /// triagem não recebeu as voltas, logo o pick foi escolhido sobre um poço que
        /// comprovadamente não continha o possível vencedor.</summary>
        internal bool PerfProvisional => FastestPassing is not null && !Has(FastestPassing.Value);
    }

    /// <summary>Escolhe quem recebe as voltas extras.
    ///
    /// <para><b>Por que isso não pode ser <c>front.Take(n)</c>.</b> Medido na RX 5700 XT
    /// (40 células, 3 finalistas): a frente tinha 12 células e as 3 primeiras da ordem de
    /// iteração foram <c>default/qp22</c>, <c>default/qp32</c> e <c>default/qp34</c>. Duas
    /// delas <b>já reprovavam o portão de qualidade na triagem</b> (VMAF 76,65 e 73,46 contra
    /// 77,39) — 6 encodes gastos remedindo célula que já tinha perdido. E o pick de
    /// desempenho saiu delas saying que <c>default/qp22</c> era o mais rápido, quando
    /// <c>transcoding/qp30</c> media 260,4 fps contra 237,5 — ou seja <b>o relatório anunciava
    /// um "mais rápido" mais lento que o seu próprio "mais barato"</b>, porque o vencedor
    /// nunca recebeu as 3 voltas que o tornavam elegível.</para>
    ///
    /// <para><b>A regra.</b> Gastar orçamento com quem não pode vencer pick nenhum é desperdício;
    /// e sortear o orçamento sem garantir os dois candidatos ao皇冠 é escolher um poço que pode
    /// não conter a resposta. Então: o orçamento vai primeiro para a mais barata e a mais rápida
    /// que passam (nessa ordem, porque custo é a resposta primária), e o resto da frente que
    /// passa preenche as vagas sobrando.</summary>
    internal static AmdFinalistSelection SelectFinalists(
        IReadOnlyList<AmdSweepCell> cells, IReadOnlyList<AmdSweepCell> front, double anchorVmaf, int max)
    {
        max = Math.Max(1, max);
        var cheapest = PickCost(cells, anchorVmaf);
        var fastest = FastestPassing(cells, anchorVmaf);

        var ordered = new List<AmdSweepCell>();
        void Add(AmdSweepCell? c)
        {
            if (c is null) return;
            if (ordered.Any(s => s.Usage == c.Value.Usage && s.Qp == c.Value.Qp)) return;
            ordered.Add(c.Value);
        }

        // Custo primeiro: com FINALISTAS=1 não dá para ter os dois, e "qual é o mais
        // barato sem perder qualidade" é a pergunta que o relatório responde primeiro.
        foreach (var c in new[] { cheapest, fastest })
        {
            if (ordered.Count >= max) break;
            Add(c);
        }

        foreach (var c in front)
        {
            if (ordered.Count >= max) break;
            if (!PassesQuality(c.Vmaf, anchorVmaf)) continue;   // reprovada não gasta encode
            Add(c);
        }

        // Nenhuma célula passou: a frente inteira ainda é o que há para mostrar, e o
        // relatório vai dizer que nenhum pick existe.
        if (ordered.Count == 0)
            foreach (var c in front)
            {
                if (ordered.Count >= max) break;
                Add(c);
            }

        var selected = ordered.Take(max).ToList();
        var dropped = front.Count(c =>
            PassesQuality(c.Vmaf, anchorVmaf) &&
            !selected.Any(s => s.Usage == c.Usage && s.Qp == c.Qp));

        return new AmdFinalistSelection(selected, cheapest, fastest, dropped);
    }

    /// <summary>Bytes do candidato contra a produção, em %. 0 quando qualquer lado não tem
    /// bytes medidos — dividir por 0 imprimiria "Infinity%", e quem tem de avisar que a
    /// âncora não mediu é o relatório, não a conta.</summary>
    internal static double BytesDeltaPct(long cellBytes, long anchorBytes) =>
        anchorBytes > 0 && cellBytes > 0 ? (cellBytes - anchorBytes) * 100.0 / anchorBytes : 0;

    /// <summary>As três peças de uma célula como argv, já achatadas. Existe para deixar explícito
    /// que <c>usage</c> é um <b>nome</b> que vai para dentro de <c>-usage</c> e não para o argv
    /// da linha de comando: uma lista de usage malformada que escapasse para o ffmpeg viraria
    /// opção do encoder em vez de célula da grade.</summary>
    internal static string[] BuildCellArgs(string codec, string usage, int qp) =>
        [codec, usage, qp.ToString(CultureInfo.InvariantCulture)];
}
