using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// T2 — o app empacotado não pode executar o ffmpeg de desenvolvimento.
///
/// Incidente 2026-10-01 (E6): <c>FfmpegPathResolver.GetFfmpegPath</c> testava os
/// candidatos na ordem da lista e o staging de DEV
/// (<c>resources/clips-engine-staging/ffmpeg.exe</c>) vinha ANTES do layout
/// empacotado (<c>resources/clips-engine/ffmpeg.exe</c>). Numa máquina de
/// desenvolvimento os dois existem e respondem <c>-version</c>: o app INSTALADO
/// passou a usar o binário de dev para TODAS as operações — inclusive o mux, cujo
/// log de 2026-10-01 mostra o thumbnail rodando
/// <c>C:\Users\Windows\Desktop\001\resources\clips-engine-staging\ffmpeg.exe</c>.
///
/// Não era cosmético: o binário de dev não é o validado pelo gate
/// <c>node scripts/verify-ffmpeg.js</c>, e o sucesso era logado em Debug — sumindo
/// do log da sessão instalada.
/// </summary>
public sealed class FfmpegPathResolverTests
{
    private static string[] Paths(string baseDir) =>
        [.. FfmpegPathResolver.BuildCandidates(baseDir).Select(c => c.Path)];

    private static string[] Reasons(string baseDir) =>
        [.. FfmpegPathResolver.BuildCandidates(baseDir).Select(c => c.Reason)];

    /// <summary>Cria baseDir com o layout empacotado (clips-engine/ ao lado do pai).</summary>
    private static string PackagedBaseDir()
    {
        var root = Path.Combine(Path.GetTempPath(), $"pkg_{Guid.NewGuid():N}", "resources", "clips-engine");
        Directory.CreateDirectory(root);
        return root;
    }

    private static string DevBaseDir()
    {
        var root = Path.Combine(Path.GetTempPath(), $"dev_{Guid.NewGuid():N}", "bin", "Release", "net10.0-windows10.0.26100.0");
        Directory.CreateDirectory(root);
        return root;
    }

    [Fact]
    public void PackagedLayout_ExcludesDevStaging()
    {
        var paths = Paths(PackagedBaseDir());

        // O ponto do T2: nenhum candidato do app empacotado é o staging de dev.
        Assert.DoesNotContain(
            paths,
            p => p.Contains("clips-engine-staging", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void PackagedLayout_PutsPackagedResourcesFirst()
    {
        var paths = Paths(PackagedBaseDir());

        var packagedIdx = Array.FindIndex(paths,
            p => p.Contains("clips-engine", StringComparison.OrdinalIgnoreCase)
                 && !p.Contains("clips-engine-staging", StringComparison.OrdinalIgnoreCase));
        var stagingIdx = Array.FindIndex(paths,
            p => p.Contains("clips-engine-staging", StringComparison.OrdinalIgnoreCase));

        Assert.True(packagedIdx >= 0, "layout empacotado não TEM candidato empacotado");
        Assert.Equal(-1, stagingIdx);
        Assert.True(packagedIdx < paths.Length);
    }

    [Fact]
    public void DevLayout_StillFindsStaging()
    {
        // npm run dev depende do staging — T2 não pode quebrar o fluxo de dev.
        var paths = Paths(DevBaseDir());

        Assert.Contains(paths, p => p.Contains("clips-engine-staging", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void DevLayout_KeepsStagingBeforePackaged()
    {
        // Em dev puro o staging DEVE ganhar do empacotado: senão o npm run dev passa
        // a usar o binário do install e o dev não vê as próprias mudanças.
        var paths = Paths(DevBaseDir());

        var stagingIdx = Array.FindIndex(paths,
            p => p.Contains("clips-engine-staging", StringComparison.OrdinalIgnoreCase));
        var packagedIdx = Array.FindIndex(paths,
            p => p.Contains("clips-engine", StringComparison.OrdinalIgnoreCase)
                 && !p.Contains("clips-engine-staging", StringComparison.OrdinalIgnoreCase));

        Assert.True(stagingIdx >= 0);
        Assert.True(packagedIdx >= 0);
        Assert.True(stagingIdx < packagedIdx, $"staging(idx={stagingIdx}) deve vir antes de empacotado(idx={packagedIdx})");
    }

    [Fact]
    public void BothLayouts_PathFallbackIsLast()
    {
        foreach (var baseDir in new[] { PackagedBaseDir(), DevBaseDir() })
        {
            var paths = Paths(baseDir);
            Assert.Equal("ffmpeg", paths[^1]);
            Assert.Single(paths, p => p == "ffmpeg");
        }
    }

    [Fact]
    public void BothLayouts_NoDuplicateCandidates()
    {
        foreach (var baseDir in new[] { PackagedBaseDir(), DevBaseDir() })
        {
            var paths = Paths(baseDir);
            Assert.Equal(paths.Length, paths.Distinct(StringComparer.OrdinalIgnoreCase).Count());
        }
    }

    [Fact]
    public void BothLayouts_NoDuplicateCandidates_AfterNormalization()
    {
        // O teste acima compara strings CRUAS e por isso passava mesmo com
        // candidatos duplicados: no layout empacotado, baseDir JÁ É
        // `...\resources\clips-engine`, então
        //   nextToExe        = <base>\ffmpeg.exe
        //   packagedResources = <base>\..\clips-engine\ffmpeg.exe
        // são strings diferentes apontando para o MESMO arquivo.
        //
        // Normalizando, a duplicata aparece. Não é inofensiva: `GetFfmpegPath`
        // faz probe com `ffmpeg -version` por candidato, e uma duplicata gera um
        // spawn de processo inútil (e, se a primeira tentativa falhar por motivo
        // transient, a segunda repete a mesma falha).
        foreach (var baseDir in new[] { PackagedBaseDir(), DevBaseDir() })
        {
            var normalized = Paths(baseDir)
                .Select(p => Path.GetFullPath(p))
                .ToList();

            var dupes = normalized
                .GroupBy(p => p, StringComparer.OrdinalIgnoreCase)
                .Where(g => g.Count() > 1)
                .Select(g => g.Key)
                .ToList();

            Assert.True(dupes.Count == 0,
                $"candidatos duplicados (após normalizar) em {baseDir}: {string.Join(" | ", dupes)}");
        }
    }

    [Fact]
    public void BothLayouts_NeverEmpty()
    {
        Assert.NotEmpty(Paths(PackagedBaseDir()));
        Assert.NotEmpty(Paths(DevBaseDir()));
    }

    [Fact]
    public void EveryCandidate_HasANonEmptyReason()
    {
        // O motivo vai para o log em Info — é o que responde "por que esse binário?"
        // quando alguém investigar um path inesperado numa sessão futura.
        foreach (var baseDir in new[] { PackagedBaseDir(), DevBaseDir() })
        {
            var reasons = Reasons(baseDir);
            Assert.All(reasons, r => Assert.False(string.IsNullOrWhiteSpace(r)));
        }
    }

    [Fact]
    public void PathFallback_ReasonMentionsPath()
    {
        var reasons = Reasons(PackagedBaseDir());
        Assert.Contains(reasons, r => r.Contains("PATH", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void BuildCandidates_IsDeterministic()
    {
        var baseDir = PackagedBaseDir();
        Assert.Equal(Paths(baseDir), Paths(baseDir));
    }

    [Fact]
    public void BuildCandidates_DoesNotDependOnFilesystemForOrdering()
    {
        // A ordem é decidida pela existência do DIRETÓRIO clips-engine, não de
        // qualquer arquivo — assim dois processos concorrentes não divergem.
        var baseDir = PackagedBaseDir();
        var before = Paths(baseDir);
        Directory.CreateDirectory(Path.Combine(baseDir, "..", "clips-engine", "ffmpeg.exe.placeholder"));
        Assert.Equal(before, Paths(baseDir));
    }

    // ── CreateFfmpegStartInfo: WorkingDirectory casa com o binário ────
    //
    // Bug adjacente: o WorkingDirectory vinha de GetFfmpegDir(), que cacheia
    // _cachedDir de forma independente de _cachedPath. Com OverridePathForTest
    // (ou qualquer re-resolução) os dois podiam divergir e o ffmpeg falhava a
    // carregar as DLLs ao lado.

    [Fact]
    public void CreateFfmpegStartInfo_WorkingDirectoryIsBinDir()
    {
        var ffmpeg = Path.Combine(Path.GetTempPath(), $"fakeroot_{Guid.NewGuid():N}", "ffmpeg.exe");
        var prev = FfmpegPathResolver.GetFfmpegPath();
        try
        {
            FfmpegPathResolver.OverridePathForTest(ffmpeg);

            var psi = FfmpegPathResolver.CreateFfmpegStartInfo(args: "-version");

            Assert.Equal(ffmpeg, psi.FileName);
            Assert.Equal(Path.GetDirectoryName(ffmpeg)!, psi.WorkingDirectory);
        }
        finally { FfmpegPathResolver.OverridePathForTest(null); }
    }

    [Fact]
    public void OverridePathForTest_Null_ResetsCache()
    {
        var fake = Path.Combine(Path.GetTempPath(), "nope", "ffmpeg.exe");
        FfmpegPathResolver.OverridePathForTest(fake);
        Assert.Equal(fake, FfmpegPathResolver.GetFfmpegPath());

        FfmpegPathResolver.OverridePathForTest(null);
        var resolved = FfmpegPathResolver.GetFfmpegPath();
        Assert.NotEqual(fake, resolved);

        // O que importa é que a resolução voltou aos candidatos — não qual deles
        // venceu (depende do que existe na máquina).
        var candidates = FfmpegPathResolver.BuildCandidates(AppContext.BaseDirectory)
            .Select(c => Path.GetFullPath(c.Path))
            .ToHashSet(StringComparer.OrdinalIgnoreCase);
        Assert.Contains(Path.GetFullPath(resolved), candidates);
    }
}
