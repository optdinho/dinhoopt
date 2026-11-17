using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Regressão "clip acelerado" (2026-11-16): o gravador perdeu frames durante uma janela
/// de contenção de GPU (buracos de 4 a 39 slots, 67–650 ms) e o export tratou cada um
/// como alt-tab — colapsou o tempo e cortou o áudio correspondente. O clip resultante
/// tocava até 1,64× mais rápido.
///
/// O que estes testes fixam: buracos ABAIXO do limiar de colapso sobrevivem ao MP4
/// (o clip mantém a duração real) e interrupções reais (≥ 2 s) continuam a ser colapsadas.
/// </summary>
public sealed class ClipExporterTimelineTests
{
    private const long FrameTicks = 166_667; // 1/60 s em ticks (16,6667 ms)
    private static readonly TimeSpan FrameDur = TimeSpan.FromTicks(FrameTicks);

    private static EncodedPacket V(TimeSpan pts, TimeSpan? dur = null) =>
        new(Array.Empty<byte>(), MediaType.Video, pts, dur ?? FrameDur, false, false, 1920, 1080);

    private static EncodedPacket A(TimeSpan pts, TimeSpan dur) =>
        new(Array.Empty<byte>(), MediaType.Audio, pts, dur, false);

    /// <summary>
    /// Janela de 600 frames a 60 fps com 5 slots perdidos depois do frame 299 — o salto
    /// entre frames consecutivos fica em 6 períodos (100 ms). É o perfil exato das perdas
    /// de 2026-11-16 (484×4, 116×5, 25×6 slots perdidos; máximo 39 = 666 ms).
    /// </summary>
    private static List<EncodedPacket> VideoWithFiveLostSlots()
    {
        var packets = new List<EncodedPacket>(600);
        for (int i = 0; i < 600; i++)
        {
            int slot = i < 300 ? i : i + 5;
            packets.Add(V(TimeSpan.FromTicks(FrameTicks * slot)));
        }
        return packets;
    }

    [Fact]
    public void GetVideoIntervals_HoleBelowCollapseThreshold_StaysOneInterval()
    {
        var intervals = ClipExporter.GetVideoIntervals(
            VideoWithFiveLostSlots(), ClipExporter.GapCollapseThreshold);

        Assert.Single(intervals);
    }

    [Fact]
    public void GetVideoIntervals_RealInterruption_SplitsIntoTwoIntervals()
    {
        // 3 s de interrupção (alt-tab de verdade) ainda colapsa.
        var packets = new List<EncodedPacket>
        {
            V(TimeSpan.Zero),
            V(FrameDur),
            V(FrameDur * 2),
            V(TimeSpan.FromSeconds(3)), // buraco de ~3 s
            V(TimeSpan.FromSeconds(3) + FrameDur),
        };

        var intervals = ClipExporter.GetVideoIntervals(
            packets, ClipExporter.GapCollapseThreshold);

        Assert.Equal(2, intervals.Count);
    }

    [Fact]
    public void ReTimestampToContiguous_SingleInterval_PreservesHoleAndDuration()
    {
        var packets = VideoWithFiveLostSlots();
        var intervals = ClipExporter.GetVideoIntervals(
            packets, ClipExporter.GapCollapseThreshold);

        ClipExporter.ReTimestampToContiguous(packets, [], intervals);

        // O último frame continua no slot 604 (300 + 5 perdidos + 300). Se o buraco fosse
        // colapsado, o PTS final cairia para ~599 slots e o clip ficaria 100 ms mais curto.
        Assert.Equal(TimeSpan.FromTicks(FrameTicks * 604), packets[^1].Pts);

        var maxDelta = TimeSpan.Zero;
        for (int i = 1; i < packets.Count; i++)
        {
            var delta = packets[i].Pts - packets[i - 1].Pts;
            if (delta > maxDelta) maxDelta = delta;
        }

        // 5 slots perdidos = 6 períodos entre frames consecutivos (100 ms).
        Assert.Equal(TimeSpan.FromTicks(FrameTicks * 6), maxDelta);
    }

    [Fact]
    public void FilterAudioByIntervals_SingleInterval_KeepsAudioInsideTheHole()
    {
        // Áudio contínuo atravessando o buraco: com um só intervalo nada é removido.
        // 473 pacotes cobrem exatamente o span do vídeo (604 slots + 1 frame ≈ 10,083 s).
        const int count = 473;
        var audio = new List<EncodedPacket>(count);
        var aDur = TimeSpan.FromTicks(213_333); // 1024 amostras a 48 kHz
        for (int i = 0; i < count; i++)
            audio.Add(A(TimeSpan.FromTicks(213_333 * i), aDur));

        var intervals = ClipExporter.GetVideoIntervals(
            VideoWithFiveLostSlots(), ClipExporter.GapCollapseThreshold);

        var filtered = ClipExporter.FilterAudioByIntervals(audio, intervals);

        Assert.Equal(audio.Count, filtered.Count);
    }

    [Fact]
    public void ReTimestampToContiguous_AudioEndWithinFiveMs_DoesNotRateScale()
    {
        // Vídeo termina a 1,000 s; áudio a 0,998 s. 2 ms de diferença NÃO justificam
        // reamostrar o áudio (o fator era aplicado para qualquer diferença, mesmo 1 tick).
        var video = new List<EncodedPacket>
        {
            V(TimeSpan.Zero, TimeSpan.FromMilliseconds(500)),
            V(TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(500)),
        };
        var audio = new List<EncodedPacket> { A(TimeSpan.Zero, TimeSpan.FromMilliseconds(998)) };
        var intervals = ClipExporter.GetVideoIntervals(video, ClipExporter.GapCollapseThreshold);

        ClipExporter.ReTimestampToContiguous(video, audio, intervals);

        Assert.Equal(TimeSpan.FromMilliseconds(998), audio[0].Duration);
        Assert.Equal(TimeSpan.Zero, audio[0].Pts);
    }

    [Fact]
    public void ReTimestampToContiguous_AudioEndFarFromVideo_StillRateScales()
    {
        // Contraprova: uma diferença material continua a ser corrigida (comportamento antigo).
        var video = new List<EncodedPacket>
        {
            V(TimeSpan.Zero, TimeSpan.FromMilliseconds(500)),
            V(TimeSpan.FromMilliseconds(500), TimeSpan.FromMilliseconds(500)),
        };
        var audio = new List<EncodedPacket> { A(TimeSpan.Zero, TimeSpan.FromMilliseconds(800)) };
        var intervals = ClipExporter.GetVideoIntervals(video, ClipExporter.GapCollapseThreshold);

        ClipExporter.ReTimestampToContiguous(video, audio, intervals);

        Assert.Equal(1000.0, audio[0].Duration.TotalMilliseconds, 1);
    }
}
