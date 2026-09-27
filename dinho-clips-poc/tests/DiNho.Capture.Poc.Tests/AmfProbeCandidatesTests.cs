namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Item 3: o <c>--probe-amf-usage</c> media cada <c>-usage</c> contra a refer�ncia
/// <c>transcoding</c> e imprimia que ela "� o que a produ��o usa hoje". Isso deixou de ser
/// verdade no pr�prio Item 3, que restaurou o default de produ��o para <b>n��o passar
/// <c>-usage</c> nenhum</b> (o <c>AMF_VIDEO_USAGE</c> respondia <c>(default -1)</c> no bin�rio
/// embarcado, ent��o escolher <c>transcoding</c> por conta pr�pria seria inventar um default).
///
/// O crit�rio de promote/decide do Item 3 foi escrito e travado contra "o default em uso" -
/// que s��o o vazio. Se o probe medir contra <c>transcoding</c>, o n�mero que sai da m��quina
/// AMD responde uma pergunta diferente da que foi fixada, e ainda pode promover um
/// <c>-usage</c> que ganha contra <c>transcoding</c> e perde contra o vazio. � a mesma classe
/// de erro do Item 5 (medir a refer�ncia errada e concluir em cima dela).
///
/// Estes testes travam a refer�ncia e, mais importante, a armadilha de <c>NormalizeAmfUsage</c>:
/// ela devolve <c>""</c> tanto para "vazio" quanto para "texto inv�lido", ent��o normalizar os
/// tokens ingenuamente transformaria lixo em refer�ncia silenciosamente.
/// </summary>
public class AmfProbeCandidatesTests
{
    /// <summary>A refer�ncia tem de ser o default real de produ��o: a string vazia (sem
    /// <c>-usage</c>). Se a primeira linha da tabela deixar de ser a vazia, todo delta do
    /// relat�rio passa a ser relativo a <c>transcoding</c> e o crit�rio do Item 3 fica sem
    /// lastro.</summary>
    [Fact]
    public void ReferenciaDaTabelaEhODefaultDeProducao_NAOTranscoding()
    {
        var cands = ProgramBenchmark.ResolveAmfProbeCandidates(null);

        Assert.Equal("", cands[0]);
        Assert.DoesNotContain("transcoding", new[] { cands[0] });
    }

    [Fact]
    public void SemArgumento_ProvaTodosOsUsagesComOVazioNaPrimeiraLinha()
    {
        var cands = ProgramBenchmark.ResolveAmfProbeCandidates(null);

        Assert.Equal(
            new[] { "", "transcoding", "ultralowlatency", "lowlatency", "webcam", "high_quality", "lowlatency_high_quality" },
            cands);
    }

    /// <summary>O token <c>default</c> é como o usu�rio pede "a refer�ncia" na linha de comando,
    /// porque digitar uma string vazia num .bat é frágil e seria indistinguível de "nada
    /// passou".</summary>
    [Fact]
    public void TokenDefault_MapeiaParaAStringVazia()
    {
        var cands = ProgramBenchmark.ResolveAmfProbeCandidates("default");

        Assert.Equal(new[] { "" }, cands);
    }

    [Fact]
    public void TokenDefaultListadoPorUltimo_AindaEntraPrimeiro()
    {
        var cands = ProgramBenchmark.ResolveAmfProbeCandidates("transcoding,webcam,default");

        Assert.Equal(new[] { "", "transcoding", "webcam" }, cands);
    }

    [Fact]
    public void ReferenciaNaoApareceDuplicada_QuandoOTokenDefaultVemComEleMesmo()
    {
        var cands = ProgramBenchmark.ResolveAmfProbeCandidates("default,default,transcoding,transcoding");

        Assert.Equal(new[] { "", "transcoding" }, cands);
    }

    /// <summary>A armadilha: <c>NormalizeAmfUsage</c> devolve <c>""</c> para entrada inv�lida
    /// tanto quanto para a vazia. Sem o filtro, digitar <c>--probe-amf-usage ... lixo</c>
    /// mediria "sem -usage" e sairia com o nome <c>transcoding</c> na linha - o n�mero pareceria
    /// bom e a pergunta estaria errada, que s��o as duas coisas ruins ao mesmo tempo.</summary>
    [Fact]
    public void TokenInvalido_NAOViraReferenciaSilenciosamente()
    {
        var cands = ProgramBenchmark.ResolveAmfProbeCandidates("lixo_que_nao_existe");

        Assert.NotEqual(new[] { "" }, cands);
        Assert.Equal("", cands[0]);
        Assert.Contains("transcoding", cands);
    }

    /// <summary>Um v�lido junto de um inv�lido: o v�lido vai, o lixo n�o vira refer�ncia.</summary>
    [Fact]
    public void TokenInvalidoComValidoNaoContamina()
    {
        var cands = ProgramBenchmark.ResolveAmfProbeCandidates("transcoding,lixo_que_nao_existe");

        Assert.Equal(new[] { "", "transcoding" }, cands);
    }

    /// <summary>A linha da tabela precisa dizer, em palavras, que a refer�ncia � a ausencia de
    /// <c>-usage</c>. Imprimir vazio ali seria um bug de leitura: o usu�rio veria uma coluna sem
    /// nome e n��o saberia o que a linha 1 significa.</summary>
    [Fact]
    public void RotuloDaReferencia_DizQueNaoPassaUsage()
    {
        var rotulo = ProgramBenchmark.AmfUsageLabel("");

        Assert.Contains("default", rotulo, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("-usage", rotulo, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void RotuloDeUsoConhecido_FicaIgualAoNome()
    {
        Assert.Equal("transcoding", ProgramBenchmark.AmfUsageLabel("transcoding"));
    }

    /// <summary>Trava o token no texto do CLI, para o .bat da m��quina AMD e o c�digo n��o
    /// divergirem: se o token mudar, o roteiro de teste parado na m��quina do usu�rio passa a
    /// medir a tabela inteira sem ele avisar.</summary>
    [Fact]
    public void TokenDefaultEhOCodigoQueORoteiroUsa()
    {
        Assert.Equal("default", ProgramBenchmark.AmfDefaultUsageToken);
    }
}
