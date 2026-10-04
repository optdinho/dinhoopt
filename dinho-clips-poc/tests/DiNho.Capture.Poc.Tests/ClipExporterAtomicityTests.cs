using System.Diagnostics;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// T1 — o export só pode publicar um MP4 verificado.
///
/// Incidente 2026-10-01: <c>MuxWithFfmpegStreaming</c> escrevia direto em
/// <c>outputPath</c>. Se o ffmpeg fosse morto no meio do mux (timeout de 5 min com
/// <c>proc.Kill()</c>, ou o app fechando durante o export) o arquivo ficava em disco
/// <b>sem o átomo <c>moov</c></b> — ou seja, sem índice, impossível de abrir. Foi
/// exatamente o <c>DiNho Optimizer 2026-10-01_09-51-12.mp4</c>.
///
/// E o pior: <c>ExportToMp4</c> chamava o probe/thumbnail dentro de um
/// <c>try/catch</c> que só logava warning, então <c>SaveClipAsync</c> imprimia
/// <c>SAVE OK</c> sobre um arquivo quebrado. 3 de 4 clips da sessão foram anunciados
/// como salvos com vídeo incompleto.
/// </summary>
[Collection("FfmpegPathOverride")]
public sealed class ClipExporterAtomicityTests
{
    private static string TempMp4() =>
        Path.Combine(Path.GetTempPath(), $"atomic_{Guid.NewGuid():N}.mp4");

    // ── ResolveTempOutputPath: parcial no MESMO diretório ────────────

    [Fact]
    public void ResolveTempOutputPath_IsInSameDirectoryAsFinal()
    {
        var final = Path.Combine("C:\\clips", "DiNho Optimizer 2026-10-01_09-51-12.mp4");

        var partial = ClipExporter.ResolveTempOutputPath(final);

        // File.Move só é atômico dentro do mesmo volume. Um parcial em %TEMP%
        // (outro volume, em geral) cairia numa cópia non-atômica.
        Assert.Equal(
            Path.GetDirectoryName(Path.GetFullPath(final))!.TrimEnd('\\'),
            Path.GetDirectoryName(Path.GetFullPath(partial))!.TrimEnd('\\'));
    }

    [Fact]
    public void ResolveTempOutputPath_KeepsMp4Extension()
    {
        // A extensão precisa ser .mp4: o ffmpeg escolhe o muxer pelo sufixo e sem
        // ele escreveria raw H.264 num arquivo chamado .partial.
        var final = Path.Combine(Path.GetTempPath(), "clip.mp4");

        Assert.EndsWith(".mp4", ClipExporter.ResolveTempOutputPath(final), StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolveTempOutputPath_IsDistinctFromFinal()
    {
        var final = TempMp4();
        Assert.NotEqual(Path.GetFullPath(final), Path.GetFullPath(ClipExporter.ResolveTempOutputPath(final)));
    }

    [Fact]
    public void ResolveTempOutputPath_IsDeterministic()
    {
        // Determinismo importa: o `finally` precisa reencontrar o parcial que o
        // `writePartial` criou, e o log de falha precisa citar o mesmo caminho.
        var final = TempMp4();
        Assert.Equal(
            ClipExporter.ResolveTempOutputPath(final),
            ClipExporter.ResolveTempOutputPath(final));
    }

    // ── VerifyExportOutput: decisão pura do veredito ─────────────────

    [Fact]
    public void Verify_MissingFile_IsRejected()
    {
        var v = ClipExporter.VerifyExportOutput(bytes: -1, ffmpegStderr: "", expectedAudio: false);
        Assert.Equal(ClipExporter.ExportVerdict.MissingFile, v.Verdict);
        Assert.False(v.IsOk);
    }

    [Fact]
    public void Verify_EmptyFile_IsRejected()
    {
        // Arquivo de 0 byte é o modo de falha mais comum do mux interrompido.
        var v = ClipExporter.VerifyExportOutput(bytes: 0, ffmpegStderr: "Video: h264", expectedAudio: false);
        Assert.Equal(ClipExporter.ExportVerdict.EmptyFile, v.Verdict);
    }

    [Fact]
    public void Verify_NoVideoStream_IsRejected()
    {
        // stderr sem "Video:" = o ffmpeg criou o container mas não gravou vídeo.
        var v = ClipExporter.VerifyExportOutput(bytes: 1024, ffmpegStderr: "Stream #0:0: Audio: aac", expectedAudio: false);
        Assert.Equal(ClipExporter.ExportVerdict.NoVideoStream, v.Verdict);
        Assert.False(v.HasVideo);
    }

    [Fact]
    public void Verify_ExpectedAudioMissing_IsRejected()
    {
        // Clip mudo: o usuário recebe vídeo sem som e não tem como saber por quê.
        // Antes era só um Log.W engolido pelo catch do caller.
        var v = ClipExporter.VerifyExportOutput(bytes: 1024, ffmpegStderr: "Stream #0:0: Video: h264", expectedAudio: true);
        Assert.Equal(ClipExporter.ExportVerdict.ExpectedAudioMissing, v.Verdict);
        Assert.True(v.HasVideo);
        Assert.False(v.HasAudio);
    }

    [Fact]
    public void Verify_VideoOnlyNoAudioExpected_IsOk()
    {
        var v = ClipExporter.VerifyExportOutput(bytes: 1024, ffmpegStderr: "Stream #0:0: Video: h264", expectedAudio: false);
        Assert.True(v.IsOk);
        Assert.Equal(1, v.Streams);
    }

    [Fact]
    public void Verify_VideoAndAudio_IsOk()
    {
        var stderr = "  Stream #0:0: Video: h264\n  Stream #0:1: Audio: aac";
        var v = ClipExporter.VerifyExportOutput(bytes: 2048, ffmpegStderr: stderr, expectedAudio: true);
        Assert.True(v.IsOk);
        Assert.Equal(2, v.Streams);
        Assert.True(v.HasVideo);
        Assert.True(v.HasAudio);
    }

    [Fact]
    public void Verify_VerdictReason_IsNonEmptyForEveryFailure()
    {
        // O motivo vai para o log e para o renderer: uma exception sem texto não
        // ajuda ninguém a decidir se re-tenta o save.
        foreach (var bytes in new[] { -1L, 0L, 8L })
        {
            var v = ClipExporter.VerifyExportOutput(bytes, "Video: h264", expectedAudio: true);
            if (!v.IsOk)
                Assert.False(string.IsNullOrWhiteSpace(v.Reason));
        }
    }

    // ── MuxAndPublish: publica SOMENTE depois de verificar ───────────

    [Fact]
    public void Publish_MuxThrows_LeavesNoFileAtFinalPath()
    {
        var final = TempMp4();
        try
        {
            Assert.Throws<InvalidOperationException>(() =>
                ClipExporter.MuxAndPublish(
                    final,
                    _ => throw new InvalidOperationException("ffmpeg exit code 1: muxer error"),
                    _ => throw new InvalidOperationException("verify não deve ser chamado")));

            Assert.False(File.Exists(final), "MP4 publicado apesar do mux ter falhado");
        }
        finally { TryDelete(final); }
    }

    [Fact]
    public void Publish_MuxThrows_CleansUpPartialFile()
    {
        var final = TempMp4();
        var partial = ClipExporter.ResolveTempOutputPath(final);
        try
        {
            Assert.Throws<InvalidOperationException>(() =>
                ClipExporter.MuxAndPublish(final, p =>
                {
                    File.WriteAllBytes(p, new byte[4096]);
                    throw new InvalidOperationException("ffmpeg morto no meio");
                }, _ => throw new InvalidOperationException()));

            Assert.False(File.Exists(partial), "parcial órfão deixado no diretório de saída");
            Assert.False(File.Exists(final));
        }
        finally { TryDelete(final); TryDelete(partial); }
    }

    [Fact]
    public void Publish_VerifyRejects_LeavesNoFileAtFinalPath()
    {
        var final = TempMp4();
        var partial = ClipExporter.ResolveTempOutputPath(final);
        try
        {
            var ex = Assert.Throws<InvalidOperationException>(() =>
                ClipExporter.MuxAndPublish(
                    final,
                    p => File.WriteAllBytes(p, new byte[4096]),
                    p => ClipExporter.VerifyExportOutput(
                        new FileInfo(p).Length, "Stream #0:0: Audio: aac", expectedAudio: false)));

            Assert.Contains("NoVideoStream", ex.Message, StringComparison.Ordinal);
            Assert.False(File.Exists(final), "MP4 com vídeo ausente foi publicado mesmo assim");
            Assert.False(File.Exists(partial));
        }
        finally { TryDelete(final); TryDelete(partial); }
    }

    [Fact]
    public void Publish_VerifyRejects_ExceptionCarriesTheVerdict()
    {
        // O `SAVE FAILED` do log precisa dizer QUAL foi o veredito — "ffmpeg falhou"
        // não distingue clip sem vídeo de clip sem áudio de arquivo vazio.
        var final = TempMp4();
        var partial = ClipExporter.ResolveTempOutputPath(final);
        try
        {
            var ex = Assert.Throws<InvalidOperationException>(() =>
                ClipExporter.MuxAndPublish(
                    final,
                    p => File.WriteAllBytes(p, new byte[4096]),
                    p => ClipExporter.VerifyExportOutput(
                        new FileInfo(p).Length, "Stream #0:0: Video: h264", expectedAudio: true)));

            Assert.Contains("ExpectedAudioMissing", ex.Message, StringComparison.Ordinal);
        }
        finally { TryDelete(final); TryDelete(partial); }
    }

    [Fact]
    public void Publish_Verified_MovesPartialToFinalPath()
    {
        var final = TempMp4();
        var partial = ClipExporter.ResolveTempOutputPath(final);
        try
        {
            var payload = new byte[8192];
            Random.Shared.NextBytes(payload);

            var seenPartial = string.Empty;
            ClipExporter.MuxAndPublish(final, p =>
            {
                seenPartial = p;
                File.WriteAllBytes(p, payload);
            }, p => ClipExporter.VerifyExportOutput(
                new FileInfo(p).Length, "Stream #0:0: Video: h264", expectedAudio: false));

            Assert.Equal(partial, seenPartial);
            Assert.True(File.Exists(final));
            Assert.Equal(payload, File.ReadAllBytes(final));
            Assert.False(File.Exists(partial), "parcial sobreviveu ao publish");
        }
        finally { TryDelete(final); TryDelete(partial); }
    }

    [Fact]
    public void Publish_Verified_VerifiesBeforeMoving()
    {
        // Ordem é o ponto: se o verify roda depois do move, um MP4 quebrado já foi
        // publicado (e visível para o renderer) quando a falha é detectada.
        var final = TempMp4();
        var partial = ClipExporter.ResolveTempOutputPath(final);
        var order = new List<string>();
        try
        {
            ClipExporter.MuxAndPublish(final, p =>
            {
                order.Add("mux");
                File.WriteAllBytes(p, new byte[4096]);
            }, p =>
            {
                order.Add("verify");
                Assert.False(File.Exists(final), "arquivo final já existia durante o verify");
                return ClipExporter.VerifyExportOutput(4096, "Stream #0:0: Video: h264", false);
            });

            order.Add("published");
            Assert.Equal(["mux", "verify", "published"], order);
        }
        finally { TryDelete(final); TryDelete(partial); }
    }

    [Fact]
    public void Publish_Verified_OverwritesStaleFileAtFinalPath()
    {
        // Mesmo nome de clip em dois saves no mesmo segundo: o segundo precisa
        // substituir, não falhar com IOException.
        var final = TempMp4();
        try
        {
            File.WriteAllBytes(final, new byte[16]);
            ClipExporter.MuxAndPublish(final, p => File.WriteAllBytes(p, new byte[4096]),
                p => ClipExporter.VerifyExportOutput(4096, "Stream #0:0: Video: h264", false));
            Assert.Equal(4096, new FileInfo(final).Length);
        }
        finally { TryDelete(final); TryDelete(ClipExporter.ResolveTempOutputPath(final)); }
    }

    [Fact]
    public void Publish_Failed_LeavesExistingFinalUntouched()
    {
        // Dois saves com o MESMO nome (mesmo segundo): se o segundo export
        // falhar, o MP4 do primeiro tem que continuar íntegro. Sem isto o
        // usuário perde um clip bom por causa de um save posterior que deu
        // errado — e o log ainda diria "EXPORT FAILED" como se nada existisse.
        var final = TempMp4();
        try
        {
            var original = new byte[8192];
            Random.Shared.NextBytes(original);
            File.WriteAllBytes(final, original);

            Assert.Throws<InvalidOperationException>(() =>
                ClipExporter.MuxAndPublish(final, p => File.WriteAllBytes(p, new byte[4096]),
                    p => ClipExporter.VerifyExportOutput(4096, "moov atom not found", expectedAudio: false)));

            Assert.True(File.Exists(final), "falha do segundo save apagou o MP4 do primeiro");
            Assert.Equal(original, File.ReadAllBytes(final));
        }
        finally { TryDelete(final); TryDelete(ClipExporter.ResolveTempOutputPath(final)); }
    }

    [Fact]
    public void Publish_Failed_DoesNotLeaveThumbnailOfFailedClip()
    {
        // O thumbnail é gerado no caminho FINAL durante o verify — antes do move.
        // Se o verify reprovar, ele fica órfão ao lado de um MP4 que é de outro
        // clip (ou não existe). Pior: o renderer mostra a imagem do clip que
        // FALHOU junto com o MP4 do clip que deu certo.
        var final = TempMp4();
        var thumb = ClipExporter.ResolveThumbnailPath(final);
        try
        {
            // Simula o thumbnail que o ffmpeg deixou no STAGING antes de o probe reprovar.
            var staging = ClipExporter.ResolveStagingThumbnailPath(final);
            File.WriteAllBytes(staging, new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 });

            Assert.Throws<InvalidOperationException>(() =>
                ClipExporter.MuxAndPublish(final, p => File.WriteAllBytes(p, new byte[4096]),
                    p => ClipExporter.VerifyExportOutput(4096, "moov atom not found", expectedAudio: false),
                    staging));

            Assert.False(File.Exists(staging), "thumbnail do clip que falhou ficou órfão");
            Assert.False(File.Exists(thumb),
                "MP4 reprovado não pode publicar thumbnail no caminho final");
        }
        finally
        {
            TryDelete(final);
            TryDelete(ClipExporter.ResolveTempOutputPath(final));
            TryDelete(ClipExporter.ResolveStagingThumbnailPath(final));
            TryDelete(thumb);
        }
    }

    [Fact]
    public void Publish_Verified_MovesStagingThumbnailToFinalPath()
    {
        // Sucesso: o staging tem que virar o thumbnail final, senão o renderer
        // nunca encontra a imagem e o clip aparece sem preview.
        var final = TempMp4();
        var thumb = ClipExporter.ResolveThumbnailPath(final);
        var staging = ClipExporter.ResolveStagingThumbnailPath(final);
        try
        {
            File.WriteAllBytes(staging, new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 });

            ClipExporter.MuxAndPublish(final, p => File.WriteAllBytes(p, new byte[4096]),
                p => ClipExporter.VerifyExportOutput(4096, "Stream #0:0: Video: h264", expectedAudio: false),
                staging);

            Assert.True(File.Exists(thumb), "thumbnail não foi publicado no caminho final");
            Assert.False(File.Exists(staging), "staging do thumbnail ficou para trás");
        }
        finally
        {
            TryDelete(final);
            TryDelete(ClipExporter.ResolveTempOutputPath(final));
            TryDelete(staging);
            TryDelete(thumb);
        }
    }

    [Fact]
    public void StagingThumbnail_SharesDirectoryWithTheMp4()
    {
        // O move final precisa ser ATÔMICO: em outro volume vira cópia, e uma
        // cópia interrompida deixa thumbnail pela metade.
        var final = Path.Combine(Path.GetTempPath(), $"clip_{Guid.NewGuid():N}.mp4");

        var staging = ClipExporter.ResolveStagingThumbnailPath(final);
        var thumb = ClipExporter.ResolveThumbnailPath(final);

        Assert.Equal(Path.GetDirectoryName(final), Path.GetDirectoryName(staging));
        Assert.Equal(Path.GetDirectoryName(final), Path.GetDirectoryName(thumb));
        // GetExtension devolve ".jpg" (a última) — o que distingue o staging do
        // final é o stem ".partial", não a extensão.
        Assert.Equal(".jpg", Path.GetExtension(staging));
        Assert.EndsWith(".partial.thumb.jpg", staging, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain(".partial", thumb, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolveThumbnailPath_IsFinalPath_NotPartial()
    {
        // O thumbnail é gerado durante o verify (mesma chamada ffmpeg do probe), mas
        // precisa aterrissar no nome FINAL — um ".partial.thumb.jpg" seria lixo
        // que o renderer nunca encontra.
        var final = TempMp4();

        var thumb = ClipExporter.ResolveThumbnailPath(final);

        Assert.Equal(Path.ChangeExtension(final, ".thumb.jpg"), thumb);
        Assert.DoesNotContain(".partial", thumb, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ResolveThumbnailPath_IsDeterministic()
    {
        var final = TempMp4();
        Assert.Equal(ClipExporter.ResolveThumbnailPath(final), ClipExporter.ResolveThumbnailPath(final));
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    // ── End-to-end com ffmpeg real ──────────────────────────────────────
    //
    // Sem estes testes a atomicidade do T1 é só testada contra um fake: o
    // `MuxWithFmmpegStreaming` de produção (que chama o ffmpeg real e faz o probe)
    // nunca era exercitado — `ToolAvailable("ffmpeg")` era false nesta máquina e
    // os testes de integração retornavam cedo. O caminho que gerou o
    // `moov atom not found` ficava sem cobertura.

    private static string? TryResolveRepoFfmpeg()
    {
        var candidates = new List<string?>
        {
            @"C:\Users\Windows\Desktop\001\resources\ffmpeg-custom\ffmpeg.exe",
            @"C:\Users\WENDEL\Desktop\001\resources\ffmpeg-custom\ffmpeg.exe",
            // O próprio resolver (staging de dev / publish / PATH), para os testes
            // não dependerem de um caminho fixo da minha máquina.
            SafeResolveDefault(),
        };
        foreach (var c in candidates)
            if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
        return null;
    }

    private static string? SafeResolveDefault()
    {
        try { return FfmpegPathResolver.GetFfmpegPath(); }
        catch { return null; }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void EndToEnd_ValidExport_PublishesFinalAndLeavesNoPartial()
    {
        var ffmpeg = TryResolveRepoFfmpeg();
        if (ffmpeg is null) return;
        FfmpegPathResolver.OverridePathForTest(ffmpeg);

        var dir = Path.Combine(Path.GetTempPath(), $"e2e_{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var final = Path.Combine(dir, "clip.mp4");
        var partial = ClipExporter.ResolveTempOutputPath(final);
        var thumb = ClipExporter.ResolveThumbnailPath(final);
        try
        {
            var video = FfmpegFixture.GenerateH264Packets(60, 320, 180);
            var audio = FfmpegFixture.GenerateAdtsAacFrames(2.0, 48000, 2);

            using var exporter = new ClipExporter();
            var result = exporter.ExportToMp4(final, video, audio, 320, 180, 60, "h264");

            Assert.Equal(final, result);
            Assert.True(File.Exists(final));
            Assert.True(new FileInfo(final).Length > 0);
            Assert.False(File.Exists(partial), "parcial sobrou após export bem-sucedido");
            Assert.True(File.Exists(thumb), "thumbnail não foi gerado");

            // Stream de vídeo realmente presente: o arquivo existe não basta,
            // foi exatamente um "existe mas sem vídeo" que enganou o SAVE OK.
            var probe = FfmpegFixture.Probe(result);
            Assert.Contains("Video:", probe, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("Audio:", probe, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            FfmpegPathResolver.OverridePathForTest(null);
            TryDelete(final); TryDelete(partial); TryDelete(thumb);
            try { Directory.Delete(dir, recursive: true); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void EndToEnd_MuxFails_PublishesNothingAndCleansPartial()
    {
        var ffmpeg = TryResolveRepoFfmpeg();
        if (ffmpeg is null) return;
        FfmpegPathResolver.OverridePathForTest(ffmpeg);

        var dir = Path.Combine(Path.GetTempPath(), $"e2e_{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var final = Path.Combine(dir, "clip.mp4");
        var partial = ClipExporter.ResolveTempOutputPath(final);
        try
        {
            // Payload H.264 rotulado como AV1 no MKV: o demuxer do ffmpeg não acha
            // sequence header e aborta — o mesmo modo de falha do log real
            // ("No sequence header available") que terminate com `moov atom not found`.
            var video = FfmpegFixture.GenerateH264Packets(30, 320, 180);

            using var exporter = new ClipExporter();
            Assert.ThrowsAny<Exception>(() =>
                exporter.ExportToMp4(final, video, [], 320, 180, 60, rawFormat: "av1"));

            Assert.False(File.Exists(final), "MP4 publicado apesar do mux ter falhado");
            Assert.False(File.Exists(partial), "parcial órfão deixado no diretório do usuário");
        }
        finally
        {
            FfmpegPathResolver.OverridePathForTest(null);
            TryDelete(final); TryDelete(partial);
            try { Directory.Delete(dir, recursive: true); } catch { }
        }
    }

    [Fact]
    [Trait("Category", "Integration")]
    public void EndToEnd_ExpectedAudioMissing_IsRejectedNotPublished()
    {
        var ffmpeg = TryResolveRepoFfmpeg();
        if (ffmpeg is null) return;
        FfmpegPathResolver.OverridePathForTest(ffmpeg);

        var dir = Path.Combine(Path.GetTempPath(), $"e2e_{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var final = Path.Combine(dir, "clip.mp4");
        var partial = ClipExporter.ResolveTempOutputPath(final);
        var thumb = ClipExporter.ResolveThumbnailPath(final);
        try
        {
            // Vídeo válido, áudio com header não-ADTS: TrimNonAdtsPrefix descarta
            // tudo, hasAudioTracks fica false mas o MKV contém 0 packets de áudio.
            var video = FfmpegFixture.GenerateH264Packets(30, 320, 180);
            var audio = new List<EncodedPacket>
            {
                new(new byte[64], MediaType.Audio, TimeSpan.Zero,
                    TimeSpan.FromMilliseconds(21), false)
            };

            using var exporter = new ClipExporter();
            exporter.ExportToMp4(final, video, audio, 320, 180, 60, "h264");

            // Sem áudio não há ExpectedAudioMissing (o caller não esperava áudio),
            // mas o arquivo precisa existir e ter vídeo.
            Assert.True(File.Exists(final));
            Assert.False(File.Exists(partial));
            var probe = FfmpegFixture.Probe(final);
            Assert.Contains("Video:", probe, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            FfmpegPathResolver.OverridePathForTest(null);
            TryDelete(final); TryDelete(partial); TryDelete(thumb);
            try { Directory.Delete(dir, recursive: true); } catch { }
        }
    }
}

/// <summary>Geração/probe de fixtures com o ffmpeg real, compartilhados pelos testes T1.</summary>
internal static class FfmpegFixture
{
    /// <summary>
    /// Pacotes H.264 AVCC de <paramref name="count"/> frames, gerados pelo ffmpeg
    /// (o payload precisa ser H.264 de verdade: o mux faz <c>-c:v copy</c>, então um
    /// NAL sintético faria o ffmpeg abortar).
    /// </summary>
    internal static List<EncodedPacket> GenerateH264Packets(int count, int width, int height)
    {
        var raw = Path.Combine(Path.GetTempPath(), $"fixture_{Guid.NewGuid():N}.h264");
        try
        {
            double durationSec = count / 30.0;
            // InvariantCulture é obrigatório: em pt-BR o `{durationSec:F4}` vira
            // "1,0000" e o ffmpeg lê a vírgula como separador de filtro
            // ("No such filter: '0000'").
            var d = durationSec.ToString("F4", System.Globalization.CultureInfo.InvariantCulture);
            var args = $"-y -loglevel error -f lavfi -i color=c=black:s={width}x{height}:d={d} " +
                       $"-c:v libx264 -preset ultrafast -crf 51 -profile baseline -level 30 " +
                       $"-f h264 \"{raw}\"";
            using var proc = new Process
            {
                StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args, redirectError: true)
            };
            proc.Start();
            var err = proc.StandardError.ReadToEndAsync();
            proc.WaitForExit(30_000);
            if (proc.ExitCode != 0 || !File.Exists(raw))
                throw new InvalidOperationException($"fixture ffmpeg falhou: {err.Result}");

            return SplitAnnexB(File.ReadAllBytes(raw), count, width, height);
        }
        finally { TryDelete(raw); }
    }

    /// <summary>Dump de input do ffmpeg — é o probe de streams usado pelo export.</summary>
    internal static string Probe(string path)
    {
        using var proc = new Process
        {
            StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(
                args: $"-i \"{path}\" -vframes 1 -s 32x18 -f image2 NUL", redirectError: true)
        };
        proc.Start();
        var err = proc.StandardError.ReadToEndAsync();
        proc.WaitForExit(30_000);
        return err.Result;
    }

    private const long TicksPerFrameAt30 = TimeSpan.TicksPerSecond / 30;

    private static List<EncodedPacket> SplitAnnexB(byte[] raw, int maxFrames, int width, int height)
    {
        var packets = new List<EncodedPacket>();
        int frameStart = -1, frameCount = 0, i = 0;

        while (i < raw.Length - 3 && frameCount < maxFrames)
        {
            if (!(raw[i] == 0 && raw[i + 1] == 0)) { i++; continue; }
            int scLen = (raw[i + 2] == 1) ? 3 : (raw[i + 2] == 0 && i + 3 < raw.Length && raw[i + 3] == 1) ? 4 : 0;
            if (scLen == 0) { i++; continue; }

            int nalStart = i + scLen;
            if (nalStart >= raw.Length) break;
            int nalType = raw[nalStart] & 0x1F;

            int nextSC = -1;
            for (int j = nalStart + 1; j < raw.Length - 2; j++)
            {
                if (raw[j] == 0 && raw[j + 1] == 0
                    && (raw[j + 2] == 1 || (raw[j + 2] == 0 && j + 3 < raw.Length && raw[j + 3] == 1)))
                { nextSC = j; break; }
            }

            int nalEnd = nextSC > 0 ? nextSC : raw.Length;
            bool isSlice = nalType == 1 || nalType == 5;
            if (frameStart < 0) frameStart = i;

            if (isSlice)
            {
                var frameLen = nalEnd - frameStart;
                var temp = new byte[frameLen];
                System.Buffer.BlockCopy(raw, frameStart, temp, 0, frameLen);
                var avcc = ToAvcc(temp);
                if (avcc is { Length: > 0 })
                {
                    packets.Add(new EncodedPacket(
                        avcc, MediaType.Video,
                        TimeSpan.FromTicks(TicksPerFrameAt30 * frameCount),
                        TimeSpan.FromTicks(TicksPerFrameAt30),
                        nalType == 5, width, height));
                    frameCount++;
                }
                frameStart = -1;
            }

            i = nextSC > 0 ? nextSC : raw.Length;
        }

        return packets;
    }

    /// <summary>
    /// Pacotes AAC-ADTS de verdade, gerados pelo ffmpeg.
    ///
    /// Não dá para usar payload AAC sintético: sem o header ADTS o ffmpeg não
    /// descobre sample rate ("Could not find codec parameters for stream 0
    /// (Audio: aac (LC), stereo, fltp)") e o mux aborta com "sample rate not set".
    /// A fixture precisa ser um ADTS real, igual ao que a NAudio produz em produção.
    /// </summary>
    internal static List<EncodedPacket> GenerateAdtsAacFrames(double durationSec, int sampleRate, int channels)
    {
        var raw = Path.Combine(Path.GetTempPath(), $"fixture_aac_{Guid.NewGuid():N}.aac");
        try
        {
            var d = durationSec.ToString("F4", System.Globalization.CultureInfo.InvariantCulture);
            var args = $"-y -loglevel error -f lavfi -i anullsrc=r={sampleRate}:cl=stereo " +
                       $"-c:a aac -b:a 128k -t {d} -f adts \"{raw}\"";
            using var proc = new Process
            {
                StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(args, redirectError: true)
            };
            proc.Start();
            var err = proc.StandardError.ReadToEndAsync();
            proc.WaitForExit(30_000);
            if (proc.ExitCode != 0 || !File.Exists(raw))
                throw new InvalidOperationException($"fixture aac falhou: {err.Result}");

            return SplitAdts(File.ReadAllBytes(raw));
        }
        finally { TryDelete(raw); }
    }

    /// <summary>
    /// Divide um fluxo ADTS em frames. O tamanho do frame está nos bits 30-42 do
    /// header de 7 bytes: ((b3 & 0x03) << 11) | (b4 << 3) | (b5 >> 5).
    /// </summary>
    private static List<EncodedPacket> SplitAdts(byte[] raw)
    {
        var packets = new List<EncodedPacket>();
        var ticksPerSec = (double)TimeSpan.TicksPerSecond;
        int pos = 0;
        int index = 0;

        while (pos + 7 <= raw.Length)
        {
            if (raw[pos] != 0xFF || (raw[pos + 1] & 0xF0) != 0xF0) { pos++; continue; }

            int len = ((raw[pos + 3] & 0x03) << 11) | (raw[pos + 4] << 3) | (raw[pos + 5] >> 5);
            if (len < 7 || pos + len > raw.Length) { pos++; continue; }

            var frame = new byte[len];
            System.Buffer.BlockCopy(raw, pos, frame, 0, len);
            packets.Add(new EncodedPacket(
                frame, MediaType.Audio,
                TimeSpan.FromTicks((long)(index * ticksPerSec / 1024)),
                TimeSpan.FromTicks((long)(ticksPerSec / 1024)),
                false));
            index++;
            pos += len;
        }

        return packets;
    }

    private static byte[]? ToAvcc(byte[] annexB)
    {
        var outBytes = new List<byte>();
        int pos = 0;
        while (pos + 3 < annexB.Length)
        {
            if (annexB[pos] != 0 || annexB[pos + 1] != 0) { pos++; continue; }
            int scLen = annexB[pos + 2] == 1 ? 3
                      : annexB[pos + 2] == 0 && annexB[pos + 3] == 1 ? 4 : 0;
            if (scLen == 0) { pos++; continue; }

            int nalStart = pos + scLen;
            int next = -1;
            for (int j = nalStart; j < annexB.Length - 2; j++)
            {
                if (annexB[j] == 0 && annexB[j + 1] == 0
                    && (annexB[j + 2] == 1 || (annexB[j + 2] == 0 && annexB[j + 3] == 1)))
                { next = j; break; }
            }
            int len = next > 0 ? next - nalStart : annexB.Length - nalStart;
            outBytes.Add((byte)(len >> 24));
            outBytes.Add((byte)(len >> 16));
            outBytes.Add((byte)(len >> 8));
            outBytes.Add((byte)len);
            for (int k = 0; k < len; k++) outBytes.Add(annexB[nalStart + k]);
            pos = next > 0 ? next : annexB.Length;
        }
        return outBytes.Count > 0 ? outBytes.ToArray() : null;
    }

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }
}
