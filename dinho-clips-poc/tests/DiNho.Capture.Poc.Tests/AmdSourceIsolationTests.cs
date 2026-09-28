using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Estes testes existem porque a coluna de fps do <c>--probe-amf-cqp</c> <b>não media o
/// encoder</b> - e nenhuma asserção de código teria pego isso.
///
/// <para><b>O defeito, medido.</b> No RX 5700 XT real, a ponta de produção
/// (22.074 kbps) e o braço CQP qp16 (67.681 kbps) deram <b>42,8 e 42,6 fps</b>. A taxa triplicou
/// e o fps não mudou. Um número que não se move quando o trabalho do encoder muda não está
/// medindo o encoder. A causa: <see cref="AmdAudit"/> alimenta o ffmpeg com
/// <c>-f lavfi -i mandelbrot=...</c> e cronometra o <b>processo inteiro</b>.</para>
///
/// <para><b>Por que "subtrair o custo da fonte" seria errado.</b> A leitura Ingênua seria medir
/// a geração da fonte uma vez e descontar. Isso não funciona porque o ffmpeg é um pipeline: a
/// geração e o encode <b>se sobrepõem</b>, logo o tempo total é <c>max(fonte, encode)</c> e não a
/// soma. Medido: ~23 ms/frame para o mandelbrot contra 3-5 ms/frame do h264_amf. O encoder está
/// <b>totalmente escondido</b> atrás da fonte, e a subtração daria um número sem significado
/// (e negativo, se a fonte ficasse 1 ms acima do encode). A correção correta é <b>remover a
/// fonte do caminho cronometrado</b>, não corrigir por ela.</para>
///
/// <para><b>A correção.</b> A fonte é materializada <b>uma vez</b> em y4m e cada braço lê o
/// arquivo. O y4m é YUV cru, então a demux é praticamente um memcpy (GB/s) - some ~0,3 ms/frame
/// contra os ~23 ms do mandelbrot. O VMAF continua comparável com o audit porque a referência
/// passa a ser o <b>mesmo arquivo de pixels</b> que o encoder recebeu, e não uma segunda
/// geração independente da lavfi.</para>
///
/// <para><b>O que estes testes NÃO cobrem, e é a parte honesta.</b> Eles travam o
/// <i>argv</i> e a forma do contrato, não a execução. A prova de que a correção funciona é
/// <b>empírica</b> e feita com o binário real: dois encodes idênticos com fontes de
/// complexidade muito diferente têm de mostrar fps <b>igual</b> com materialização e
/// <b>divergente</b> sem ela. Um teste com mock passaria com o bug inteiro presente.</para>
/// </summary>
public class AmdSourceIsolationTests
{
    // ---------- SourceInputArgs: o argv que decide de onde vem o frame ----------

    [Fact]
    public void SourceInputArgs_Lavfi_DeclaraOFiltro()
    {
        // O modo antigo, e ele é legítimo para quem não mede throughput (o audit, a
        // validação de device). O que ele NÃO pode é ser o default de um probe que
        // publica fps.
        var args = AmdAudit.SourceInputArgs("mandelbrot=size=1920x1080:rate=60", AmdSourceMode.LavfiRealtime);

        Assert.Equal(new[] { "-f", "lavfi", "-i", "mandelbrot=size=1920x1080:rate=60" }, args);
    }

    [Fact]
    public void SourceInputArgs_PreMaterialized_NaoDeclaraLavfi()
    {
        // Este é o teste que trava a correção. `-f lavfi` num caminho de arquivo faz o ffmpeg
        // tentar interpretar os bytes do y4m como um grafo de filtro e morrer - mas o modo
        // errado aqui é o silencioso: se alguém reintroduzir `-f lavfi` junto com o arquivo,
        // o probe volta a cronometrar a fonte e a coluna de fps volta a mentir sem erro
        // nenhum. Por isso a asserção é sobre a AUSÊNCIA do filtro, não sobre a presença
        // de `-i`.
        var args = AmdAudit.SourceInputArgs(@"C:\Users\WENDEL\AppData\Local\Temp\src.y4m", AmdSourceMode.PreMaterialized);

        Assert.Equal(new[] { "-i", @"""C:\Users\WENDEL\AppData\Local\Temp\src.y4m""" }, args);
        Assert.DoesNotContain("lavfi", args);
    }

    [Fact]
    public void SourceInputArgs_PreMaterialized_ProtegeEspacosNoCaminho()
    {
        // O materializado nasce em `%TEMP%`, que no Windows é
        // `C:\Users\<NOME DO USUÁRIO>\AppData\Local\Temp` - e "Windows"/"WENDEL" não tem
        // espaço, mas nomes de usuário têm. Sem o quoting, o caminho parte em duas entradas
        // e o ffmpeg abre o arquivo errado (ou nenhum) - erro visível, mas de depuração
        // ruim. O teste fixa o quoting do mesmo jeito que os outros argv do projeto.
        var args = AmdAudit.SourceInputArgs(@"C:\Users\Joao da Silva\AppData\Local\Temp\src.y4m", AmdSourceMode.PreMaterialized);

        Assert.Contains(@"""C:\Users\Joao da Silva\AppData\Local\Temp\src.y4m""", args);
    }

    [Fact]
    public void SourceInputArgs_Lavfi_NaoCitaComoArquivo()
    {
        // Simetria: no modo lavfi o spec é um grafo de filtro, não um caminho. Se alguém
        // aplicar o Quote() indiscriminadamente, o spec vira um caminho entre aspas e a
        // lavfi para de funcionar - e de novo sem erro claro, só fps estranho.
        var args = AmdAudit.SourceInputArgs("mandelbrot=size=854x480:rate=60", AmdSourceMode.LavfiRealtime);

        Assert.DoesNotContain(@"""", string.Join(' ', args));
    }

    // ---------- SourceCost: o custo da fonte é reportado, não escondido ----------

    [Fact]
    public void SourceCost_EhCalculadoContraODuracaoNominal()
    {
        // O probe passa a mostrar quanto a materialização custou, para que um futuro
        // mantenedor veja que a fonte é cara e não "desconfie" do número. O denominador
        // é a duração do relógio de parede; a unidade é fps de conteúdo, a mesma da
        // coluna de fps do encode, porque é essa igualdade de unidade que torna o
        // diagnóstico uma subtração em vez de uma conversão.
        var custo = AmdAudit.SourceCost(120, 60, 2.5);

        // 120 frames em 2,5 s = 48 fps de conteúdo. Contra um alvo de 60 fps, uma fonte
        // que só entrega 48 É o gargalo - e é exatamente o quehappened com o mandelbrot
        // a 1080p medido no RX 5700 XT, com o encoder escondido atrás.
        Assert.Equal(48, custo, 6);
        Assert.True(AmdAudit.SourceCost(120, 60, 2.5) < 60, "fonte de 48 fps não sustenta o alvo de 60");
    }

    [Fact]
    public void SourceCost_FpsZeroNaoViraInfinity()
    {
        // `Nominal` já devolve 0 quando fps <= 0. Dividir por 0 aqui daria Infinity, e o
        // relatório imprimiria "custo da fonte: Infinity fps" - que é o tipo de lixo que
        // sobrevive porque ninguém lê a coluna num caso que "nunca acontece".
        var custo = AmdAudit.SourceCost(120, 0, 2.5);

        Assert.Equal(0, custo);
    }

    [Fact]
    public void SourceCost_ElapsedZeroNaoViraInfinity()
    {
        // Mesma classe do anterior pelo outro divisor: relogio de parede parado (o que
        // acontece em máquina sob carga, e é justamente a máquina que a gente quer medir).
        var custo = AmdAudit.SourceCost(120, 60, 0);

        Assert.Equal(0, custo);
    }

    // ---------------- o audit herda o mesmo defeito ----------------

    /// <summary>Os 16 call sites do audit passavam a fonte direto para a lavfi, entao o S4
    /// reportava 42,4-43,0 fps e reprovava o alvo de 60 enquanto o CQP, com a mesma config,
    /// reportava 230,0. A correcao nao foi "consertar 16 linhas": foi <b>tirar o default</b>
    /// das assinaturas de <c>Encode</c>/<c>BuildVmafArgs</c>/<c>MeasureVmaf</c>. Sem isso, o
    /// proximo call site novo nasce contaminado e o build nem reclama.</summary>
    [Fact]
    public void PrepareSource_QuandoNaoMaterializa_DegradaParaLavfiComAEspecificacao()
    {
        var dir = Path.Combine(Path.GetTempPath(), "dinho-amd-src-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        try
        {
            // Especificacao invalida de proposito. MaterializeSource devolve false tanto
            // porque o ffmpeg rejeita o spec quanto porque nao ha ffmpeg nenhum - o contrato de
            // degradacao e o mesmo nos dois casos, entao este teste nao depende de GPU, nem de
            // ffmpeg instalado, nem de disco.
            var src = AmdAudit.PrepareSource(dir, "mandelbrot=size=INVALID", 30, 30, "taxa");

            Assert.False(src.Materialized);
            Assert.Equal(AmdSourceMode.LavfiRealtime, src.Mode);

            // O ponto critico desta assercao: o Path tem de ser a ESPECIFICACAO, nao o
            // caminho do .y4m. Um .y4m inexistente seria lido pelo ffmpeg como arquivo vazio, e
            // o encode sairia com 0 bytes - reportado como "recusou" quando nao houve recusa
            // nenhuma. E a mesma classe do encoder ausente virar OK.
            Assert.Equal("mandelbrot=size=INVALID", src.Path);
            Assert.DoesNotContain(".y4m", src.Path);
        }
        finally
        {
            try { Directory.Delete(dir, true); } catch { }
        }
    }

    /// <summary>S1/S2 medem TAXA e S3/S4/S6 medem QUALIDADE: sao conteudos diferentes
    /// (<c>life</c> e <c>mandelbrot</c>), logo dois arquivos. Tratar "a fonte" como uma so
    /// trocaria a curva de taxa pela de qualidade sem ninguem ver - e a curva de taxa e a que
    /// descobre o teto do VBV.</summary>
    [Fact]
    public void AsDuasFontesDoAuditSaoConteudosDiferentes_UmArquivoNaoServeParaOsDois()
    {
        var taxa = AmdAudit.RateSource(1920, 1080, 60);
        var qualidade = AmdAudit.QualitySource(1920, 1080, 60);

        Assert.NotEqual(taxa, qualidade);
        Assert.Contains("life", taxa);
        Assert.Contains("mandelbrot", qualidade);
    }
}