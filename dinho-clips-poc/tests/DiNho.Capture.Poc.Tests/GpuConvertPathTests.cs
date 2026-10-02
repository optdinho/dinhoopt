namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// T3 (lado encoder) — um resize de 1px do jogo derrubava a conversão para CPU.
///
/// Incidente 2026-10-01 (E4): a janela foi de 1932x1052 para 1933x1052.
/// <c>ConvertGpuNv12</c> guardava <c>texDesc.Width != _width</c> e caía para
/// <c>ConvertCpuNv12</c> — 70-75 ms por frame contra ~2,2 ms na GPU. O encoder
/// virava o gargalo e o save saía pela metade (152,82 s de 305,01 s).
///
/// A saída NV12 é 1932x1052 de qualquer jeito (é o que o ffmpeg recebe), então o
/// pixel de diferença pode e deve ser absorvido pelo VideoProcessor — um blit
/// escalado na GPU, não uma conversão de software.
/// </summary>
public sealed class GpuConvertPathTests
{
    private const int Nv12W = 1932;
    private const int Nv12H = 1052;

    private static Encoders.ConvertPath Resolve(
        int texW, int texH, int wantW, int wantH,
        int nv12W = Nv12W, int nv12H = Nv12H, bool cooldown = false) =>
        Encoders.ConvertPathResolver.ResolveConvertPath(
            texW, texH, wantW, wantH, nv12W, nv12H, cooldown);

    [Fact]
    public void ExactMatch_UsesGpuExact()
    {
        Assert.Equal(Encoders.ConvertPath.GpuExact, Resolve(1932, 1052, 1932, 1052));
    }

    [Fact]
    public void WidthOffByOne_UsesGpuScaled_NotCpu()
    {
        // O caso do log de 2026-10-01.
        Assert.Equal(Encoders.ConvertPath.GpuScaled, Resolve(1933, 1052, 1932, 1052));
    }

    [Fact]
    public void HeightOffByOne_UsesGpuScaled()
    {
        Assert.Equal(Encoders.ConvertPath.GpuScaled, Resolve(1932, 1053, 1932, 1052));
    }

    [Fact]
    public void BigResize_UsesGpuScaled()
    {
        // Trocar de janela (1280x720 → 1920x1080) continua sendo blit escalado:
        // a GPU escala em microssegundos, a CPU leva ~70ms.
        Assert.Equal(Encoders.ConvertPath.GpuScaled, Resolve(1280, 720, 1920, 1080));
    }

    [Fact]
    public void OddTextureHeight_UsesGpuScaled()
    {
        // Odd no INPUT é ok: é o OUTPUT NV12 que precisa ser par.
        Assert.Equal(Encoders.ConvertPath.GpuScaled, Resolve(1932, 1053, 1932, 1052));
    }

    [Fact]
    public void OddNv12Target_FallsBackToCpu()
    {
        // NV12 exige plano chroma subsampleado: output ímpar não tem como
        // endereçar o plano UV.
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1932, 1052, 1932, 1052, nv12W: 1933));
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1932, 1052, 1932, 1052, nv12H: 1053));
    }

    [Fact]
    public void Cooldown_FallsBackToCpu()
    {
        // Uma converter que já falhou não pode ser reconstruída a cada frame
        // (1 construtor/frame = alocação de recursos GPU em loop).
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1932, 1052, 1932, 1052, cooldown: true));
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1933, 1052, 1932, 1052, cooldown: true));
    }

    [Fact]
    public void DegenerateTexture_FallsBackToCpu()
    {
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(0, 0, 1932, 1052));
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1932, 0, 1932, 1052));
    }

    [Fact]
    public void DegenerateTarget_FallsBackToCpu()
    {
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1932, 1052, 0, 0));
    }

    [Fact]
    public void DegenerateNv12_FallsBackToCpu()
    {
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1932, 1052, 1932, 1052, nv12W: 0));
    }

    [Fact]
    public void NegativeDimensions_FallBackToCpu()
    {
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(-1, 1052, 1932, 1052));
        Assert.Equal(Encoders.ConvertPath.CpuFallback, Resolve(1932, 1052, 1932, -1));
    }

    [Fact]
    public void ScaledPath_IsNeverChosenWhenExact()
    {
        // GpuExact é estritamente "dimensões iguais" — nada de reclassificar.
        for (var w = 1930; w <= 1934; w++)
        {
            var path = Resolve(w, 1052, 1932, 1052);
            Assert.Equal(w == 1932 ? Encoders.ConvertPath.GpuExact : Encoders.ConvertPath.GpuScaled, path);
        }
    }

    [Fact]
    public void ResolveConvertPath_IsPure()
    {
        for (var i = 0; i < 5; i++)
            Assert.Equal(Encoders.ConvertPath.GpuScaled, Resolve(1933, 1052, 1932, 1052));
    }

    // ── Dimensões efetivas do frame propagadas ao pipeline ──────────────

    [Fact]
    public void PipelineSize_TracksObservedFrame()
    {
        // A coordenada do encoder precisa refletir o que o WGC realmente entregou,
        // não o que foi lido do captureItem no start (1932 vs 1933 foi exatamente
        // essa divergência).
        var size = new Capture.PipelineSize(1932, 1052);
        Assert.Equal(1932, size.Width);
        Assert.Equal(1052, size.Height);
        Assert.Equal("1932x1052", size.ToString());

        var grown = size.Observe(1933, 1052);
        Assert.Equal(1933, grown.Width);
        Assert.Equal(1052, grown.Height);
        // Observe devolve um valor novo; a instância original fica intacta.
        Assert.Equal(1932, size.Width);
    }

    [Fact]
    public void PipelineSize_IgnoresDegenerateFrames()
    {
        var size = new Capture.PipelineSize(1932, 1052);

        // Frame meio-degenerado é REJEITADO por inteiro, não aceito pela metade:
        // um 1933x0 não significa "a largura mudou" — é lixo de minimize/alt-tab,
        // e aceitar só a largura daria geometria 1933x1052 que ninguém entregou.
        Assert.Equal(1932, size.Observe(0, 0).Width);
        Assert.Equal(1932, size.Observe(1933, 0).Width);
        Assert.Equal(1052, size.Observe(1933, 0).Height);
        Assert.Equal(1932, size.Observe(0, 1053).Width);
        Assert.Equal(1052, size.Observe(0, 1053).Height);
    }

    [Fact]
    public void PipelineSize_HandlesShrinkAndGrow()
    {
        var size = new Capture.PipelineSize(1920, 1080);
        var shrunk = size.Observe(1280, 720);
        Assert.Equal(1280, shrunk.Width);
        Assert.Equal(720, shrunk.Height);

        var grown = shrunk.Observe(2560, 1440);
        Assert.Equal(2560, grown.Width);
        Assert.Equal(1440, grown.Height);
    }

    [Fact]
    public void PipelineSize_IsAValueType_SoReadsAreSnapshot()
    {
        var a = new Capture.PipelineSize(1920, 1080);
        var b = a.Observe(1280, 720);
        Assert.Equal(1920, a.Width);
        Assert.Equal(1280, b.Width);
    }

    // ── Par de dimensões published atomicamente ───────────────────────
    // WgcCaptureSource publicava _observedW e _observedH em dois campos separados: cada
    // Volatile.Read era tear-free por campo, mas o PAR não era atômico — o consumidor podia
    // ler a largura nova com a altura antiga (1933x1052 com o resize de 1px de 2026-10-01)
    // e reportar uma geometria que ninguém entregou. Packing em um long fecha a janela.

    [Fact]
    public void PipelineSize_PackUnpack_RoundTrips()
    {
        var size = new Capture.PipelineSize(1933, 1052);
        Assert.Equal(size, Capture.PipelineSize.Unpack(Capture.PipelineSize.Pack(size)));
    }

    [Fact]
    public void PipelineSize_Pack_KeepsWidthAndHeightInDistinctHalves()
    {
        // W e H não podem invadir o campo do vizinho: um pack com overlap trocaria
        // 1933x1052 por 1052x1933 silenciosamente.
        var packed = Capture.PipelineSize.Pack(new Capture.PipelineSize(1933, 1052));
        Assert.Equal(1933, Capture.PipelineSize.Unpack(packed).Width);
        Assert.Equal(1052, Capture.PipelineSize.Unpack(packed).Height);
    }

    [Fact]
    public void PipelineSize_Pack_SurvivesDegenerateAndMaxDimensions()
    {
        // 0 (nenhum frame ainda) e int.MaxValue precisam de round-trip correto — o
        // primeiro é o valor inicial do campo, o segundo nunca deve dar overflow negativo.
        Assert.Equal(0, Capture.PipelineSize.Unpack(Capture.PipelineSize.Pack(Capture.PipelineSize.Zero)).Width);
        var huge = new Capture.PipelineSize(int.MaxValue, int.MaxValue);
        Assert.Equal(huge, Capture.PipelineSize.Unpack(Capture.PipelineSize.Pack(huge)));
    }

    [Fact]
    public async Task PipelineSize_ConcurrentPackRead_NeverYieldsAMixedPair()
    {
        // O teste que o design de dois campos não passa: um escritor alterna entre duas
        // geometrias e leitores só podem ver uma delas por completo.
        var writer = new Capture.PipelineSize(1920, 1080);
        var other = new Capture.PipelineSize(1280, 720);
        var current = Capture.PipelineSize.Pack(writer);
        using var cts = new CancellationTokenSource();
        var seen = new System.Collections.Concurrent.ConcurrentBag<Capture.PipelineSize>();

        var writeLoop = Task.Run(() =>
        {
            var next = other;
            while (!cts.IsCancellationRequested)
            {
                Interlocked.Exchange(ref current, Capture.PipelineSize.Pack(next));
                next = next == writer ? other : writer;
            }
        });

        var readLoops = Enumerable.Range(0, 4).Select(_ => Task.Run(() =>
        {
            while (!cts.IsCancellationRequested)
                seen.Add(Capture.PipelineSize.Unpack(Interlocked.Read(ref current)));
        })).ToArray();

        // Janela de observação limitada: o cancelamento precisa acontecer ANTES do
        // WhenAll, senão os loops — que só param com o token — nunca completam.
        var reads = Task.Run(async () =>
        {
            await Task.Delay(TimeSpan.FromMilliseconds(300), cts.Token);
            cts.Cancel();
        });
        await Task.WhenAll(readLoops.Append(writeLoop).Append(reads));

        Assert.NotEmpty(seen);
        // As duas geometrias legítimas precisam ter sido realmente observadas, senão o
        // teste passaria sem exercitar a troca (writer nunca chegou a correr).
        Assert.Contains(writer, seen);
        Assert.Contains(other, seen);
        Assert.All(seen, size => Assert.True(
            size == writer || size == other,
            $"Par misturado observado: {size}"));
    }
}
