using System.Reflection;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Trava de regressão do Item 7 (B-frames): por que <c>bframes = 0</c> é forçado em
/// <c>RamManager.BuildSettings</c> e por que o plano não pode ser implementado como
/// "espelhar o FIFO de EmitPacket".
///
/// <para><b>Medido</b> (RTX 5050, ffmpeg 9.0.1, <c>h264_nvenc -preset p7 -cq 20 -g 60
/// -bf 2</c>, 1080p60), a ordem de bitstream real das AUs é:</para>
/// <code>
/// AU:   0   1   2   3   4   5   6   7   8   9  10
/// POC:  0   4   2   8   6  12  10  16  14  20  18
/// tipo: I   P   B   P   B   P   B   P   B   P   B
/// </code>
/// Pirâmide hierárquica (um B entre cada par de P) e POC <b>não monotônico</b>. A ordem
/// de apresentação é POC/2, não a posição no bitstream.
///
/// <para><b>Consequência 1</b> — <c>_inputPtsQueue</c> entrega o PTS de captura por
/// <i>posição no bitstream</i> (1:1 com a AU). Logo todo P recebe PTS 1 frame
/// <b>cedo</b> e todo B 1 frame <b>atrasado</b>: judder alternado de ±1 frame
/// (±16,7ms a 60fps). Ver <see cref="FifoAssignsCapturePtsByBitstreamPosition_NotByPresentationOrder"/>
/// e <see cref="MeasuredNvencBf2Order_FifoMisTimesEveryFrameByOneFrame"/>.</para>
///
/// <para><b>Consequência 2</b> — o PTS não-monotônico não é reordenado, é
/// <i>reescrito</i> para monotônico (ver <c>ProcessIvfFrames_CorrectsNonMonotonicRealPts</c>),
/// o que destrói a informação de apresentação em vez de preservá-la.</para>
///
/// <para><b>Consequência 3 (raio de explosão além do parser)</b> — todo o consumidor
/// depois do encoder assume PTS monotônico na ordem da lista. O exporter calcula o gap
/// de vídeo como <c>pkt.Pts - (prev.Pts + prev.Duration)</c>: com PTS reordenado esse
/// delta fica <b>negativo</b>, o <c>end</c> do intervalo regride e
/// <c>FilterAudioByIntervals</c> descarta áudio que <i>está</i> dentro da janela do
/// frame. Ver <see cref="GetVideoIntervals_ReorderedPts_ProducesDegenerateInterval_DroppingAudioInFrame"/>.</para>
///
/// <para><b>O que NAO é o bloqueio</b>: <c>EncodedPacket</c> não tem <c>Dts</c>, mas
/// isso não impede B-frames — o SimpleBlock do Matroska carregar um timestamp só (PTS) e
/// a ordem dos blocos já é a linha do tempo de decode. O que impede é o PTS ser
/// atribuído pela posição do bitstream em vez da ordem de apresentação. A correção
/// exigida é um reorder buffer por POC (o <c>pic_order_cnt_lsb</c> está no bitstream,
/// como o <c>trace_headers</c> mostra), não um FIFO.</para>
/// </summary>
[Collection("VideoPacketPool")]
public sealed class BframeReorderConstraintTests
{
    private const double FrameMs = 1000.0 / 60.0;

    /// <summary>
    /// Ordem de bitstream REAL medida com <c>-bf 2</c> (ver doc da classe).
    /// POC em unidades de 2 frames; apresentação = POC/2.
    /// </summary>
    private static readonly int[] MeasuredBf2Poc = [0, 4, 2, 8, 6, 12, 10, 16, 14, 20, 18];

    private static FfmpegEncoder CreateEncoder()
    {
        var enc = (FfmpegEncoder)System.Runtime.CompilerServices.RuntimeHelpers
            .GetUninitializedObject(typeof(FfmpegEncoder));
        var bf = BindingFlags.NonPublic | BindingFlags.Instance;
        typeof(FfmpegEncoder).GetField("_outputChannel", bf)!.SetValue(enc,
            System.Threading.Channels.Channel.CreateBounded<EncodedPacket>(
                new System.Threading.Channels.BoundedChannelOptions(256)
                { FullMode = System.Threading.Channels.BoundedChannelFullMode.DropOldest }));
        typeof(FfmpegEncoder).GetField("_inputPtsQueue", bf)!.SetValue(enc,
            new System.Collections.Concurrent.ConcurrentQueue<TimeSpan>());
        typeof(FfmpegEncoder).GetField("_frameRate", bf)!.SetValue(enc, 60);
        return enc;
    }

    private static System.Collections.Concurrent.ConcurrentQueue<TimeSpan> QueueOf(FfmpegEncoder enc) =>
        (System.Collections.Concurrent.ConcurrentQueue<TimeSpan>)typeof(FfmpegEncoder)
            .GetField("_inputPtsQueue", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(enc)!;

    private static List<EncodedPacket> DrainAll(FfmpegEncoder enc)
    {
        var channelObj = typeof(FfmpegEncoder)
            .GetField("_outputChannel", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(enc)!;
        var reader = (System.Threading.Channels.ChannelReader<EncodedPacket>)channelObj
            .GetType().GetProperty("Reader")!.GetValue(channelObj)!;

        var list = new List<EncodedPacket>();
        while (reader.TryRead(out var p)) list.Add(p);
        return list;
    }

    /// <summary>Layout IVF: cada frame = [u32 size][u64 pts][payload].</summary>
    private static byte[] BuildIvfBlockWithFrames(int frameCount)
    {
        var payloads = new byte[frameCount][];
        int total = 0;
        for (int i = 0; i < frameCount; i++)
        {
            payloads[i] = [0x12, (byte)i, 0x00];
            total += 12 + payloads[i].Length;
        }
        var block = new byte[total];
        int off = 0;
        for (int i = 0; i < frameCount; i++)
        {
            BitConverter.GetBytes(payloads[i].Length).CopyTo(block, off);
            BitConverter.GetBytes((long)(250 + i * 17)).CopyTo(block, off + 4);
            System.Buffer.BlockCopy(payloads[i], 0, block, off + 12, payloads[i].Length);
            off += 12 + payloads[i].Length;
        }
        return block;
    }

    private static void InvokeIvf(FfmpegEncoder enc, byte[] block)
    {
        var bf = BindingFlags.NonPublic | BindingFlags.Instance;
        typeof(FfmpegEncoder).GetField("_ivfHeaderParsed", bf)!.SetValue(enc, true);
        typeof(FfmpegEncoder).GetField("_ivfTimebaseDen", bf)!.SetValue(enc, 1000u);
        typeof(FfmpegEncoder).GetField("_ivfTimebaseNum", bf)!.SetValue(enc, 1u);
        typeof(FfmpegEncoder).GetField("_rawBuf", bf)!.SetValue(enc, block);
        typeof(FfmpegEncoder).GetField("_rawLen", bf)!.SetValue(enc, block.Length);
        typeof(FfmpegEncoder).GetField("_outputFrameIndex", bf)!.SetValue(enc, 0);
        typeof(FfmpegEncoder).GetField("_codec", bf)!.SetValue(enc, "av1_nvenc");
        typeof(FfmpegEncoder).GetMethod("ProcessIvfFrames", BindingFlags.NonPublic | BindingFlags.Instance)!
            .Invoke(enc, null);
    }

    private static EncodedPacket VideoFrame(double ptsMs, TimeSpan dur) =>
        new([0], MediaType.Video, TimeSpan.FromMilliseconds(ptsMs), dur, false);

    [Fact]
    public void FifoAssignsCapturePtsByBitstreamPosition_NotByPresentationOrder()
    {
        var enc = CreateEncoder();

        // Captura em ordem de APRESENTACAO: pictures 0, 1, 2 (0ms, 16,7ms, 33,3ms).
        var q = QueueOf(enc);
        q.Enqueue(TimeSpan.FromMilliseconds(1000));
        q.Enqueue(TimeSpan.FromMilliseconds(1000 + FrameMs));
        q.Enqueue(TimeSpan.FromMilliseconds(1000 + 2 * FrameMs));

        // O encoder devolve as AUs na ordem de DECODE: picture 0, picture 2, picture 1
        // (o mesmo padrao piramidal medido no bitstream real).
        InvokeIvf(enc, BuildIvfBlockWithFrames(3));
        var packets = DrainAll(enc);

        Assert.Equal(3, packets.Count);
        // O PTS sai na ordem do BITSTREAM (1000, 1016,7, 1033,3) — o FIFO entrega o PTS
        // de captura pela posicao, ignorando que a AU #1 e o picture 2.
        Assert.Equal(1000.0, packets[0].Pts.TotalMilliseconds, 1);
        Assert.Equal(1000 + FrameMs, packets[1].Pts.TotalMilliseconds, 1);
        Assert.Equal(1000 + 2 * FrameMs, packets[2].Pts.TotalMilliseconds, 1);

        // A AU #1 (picture 2 na apresentacao) recebeu o PTS do picture 1: 1 frame errado.
        double presentationOfAu1 = 1000 + 2 * FrameMs;
        Assert.Equal(FrameMs, presentationOfAu1 - packets[1].Pts.TotalMilliseconds, 1);
    }

    /// <summary>
    /// A ordem de bitstream REAL medida com <c>-bf 2</c> atravessada pelo <b>código de
    /// produção</b> (<c>ProcessIvfFrames</c>), e não por aritmética sobre um literal.
    ///
    /// <para>A versão anterior deste teste calculava <c>POC/2 - índice</c> e comparava com um
    /// valor esperado derivado do mesmo índice: ele provava que o array de POC é
    /// autoconstistente, e não que o encoder faz algo. Passavaverde mesmo que o
    /// <c>ProcessIvfFrames</c> fosse reescrito para ordenar por POC — que é exatamente a
    /// correção que o item (7) exige. Aqui a ordem medida entra no parser de verdade.</para>
    /// </summary>
    [Fact]
    public void MeasuredNvencBf2Order_ThroughTheRealParser_MisTimesEveryFrameByOne()
    {
        var enc = CreateEncoder();
        var n = MeasuredBf2Poc.Length;

        // Captura em ordem de APRESENTACAO: picture 0..n-1, um a cada frame.
        var q = QueueOf(enc);
        for (int i = 0; i < n; i++)
            q.Enqueue(TimeSpan.FromMilliseconds(1000 + i * FrameMs));

        // O encoder devolve as AUs na ordem de DECODE medida: 0,4,2,8,6,12,10,16,14,20,18.
        InvokeIvf(enc, BuildIvfBlockWithFrames(n));
        var packets = DrainAll(enc);

        Assert.Equal(n, packets.Count);

        for (int i = 1; i < n; i++)
        {
            // O FIFO entregou o PTS de captura pela POSICAO no bitstream…
            double assigned = packets[i].Pts.TotalMilliseconds;
            Assert.Equal(1000 + i * FrameMs, assigned, 1);

            // …e a apresentação daquela AU é POC/2, então a diferença é a dobra de ±1 frame:
            // P (posição ímpar) 1 frame CEDO, B (posição par) 1 frame ATRASADO.
            double presentationMs = 1000 + MeasuredBf2Poc[i] / 2.0 * FrameMs;
            double driftFrames = (assigned - presentationMs) / FrameMs;
            double expected = i % 2 == 1 ? -1.0 : 1.0;
            Assert.Equal(expected, driftFrames, 0.1);
        }

        // Nenhuma AU fora da primeira recebe o PTS correto — e o máximo é 1 frame, nunca 2 ou
        // 3 (a pirâmide hierárquica do NVENC põe o B sempre entre o par de P adjacente, então
        // a profundidade de reordenação é 1 frame, não o bframes=2 do comando).
        var presentationOf = (int i) => 1000.0 + MeasuredBf2Poc[i] / 2.0 * FrameMs;
        var wrong = Enumerable.Range(1, n - 1)
            .Count(i => Math.Abs(packets[i].Pts.TotalMilliseconds - presentationOf(i)) > 0.5);
        Assert.Equal(n - 1, wrong);
        var maxDrift = Enumerable.Range(1, n - 1)
            .Select(i => Math.Abs((packets[i].Pts.TotalMilliseconds - presentationOf(i)) / FrameMs))
            .Max();
        Assert.Equal(1.0, maxDrift, 0.1);
    }

    [Fact]
    public void GetVideoIntervals_ReorderedPts_ProducesDegenerateInterval_DroppingAudioInFrame()
    {
        // PTS reordenado no formato medido: I(0ms), P(100ms), B(83,3ms).
        var dur = TimeSpan.FromMilliseconds(FrameMs);
        var video = new List<EncodedPacket>
        {
            VideoFrame(0, dur),
            VideoFrame(100, dur),
            VideoFrame(100 - FrameMs, dur),
        };

        var intervals = ClipExporter.GetVideoIntervals(video, TimeSpan.FromMilliseconds(50));

        Assert.Equal(2, intervals.Count);

        // O segundo intervalo DEGRADA: o B tem PTS menor que o end anterior, o merge
        // regride o end e o intervalo fica degenerado (end <= start, duracao zero).
        // Asserção por INVARIANTE, não por tick exato: o que importa é que o intervalo
        // deixou de cobrir a janela do frame P.
        var last = intervals[^1];
        var pFrameEnd = TimeSpan.FromMilliseconds(100) + dur;
        Assert.True(last.end <= last.start,
            $"intervalo degenerado: start={last.start.TotalMilliseconds:F4}ms end={last.end.TotalMilliseconds:F4}ms");
        Assert.True(last.end < pFrameEnd,
            $"intervalo deveria cobrir o frame P [100, 116,7]ms, mas end={last.end.TotalMilliseconds:F4}ms");

        // Audio aos 110ms esta DENTRO da janela real do frame P [100, 116,7] — e mesmo
        // assim e descartado, porque intervals[^1].end regrediu para ~100ms.
        var audio = new List<EncodedPacket>
        {
            new([], MediaType.Audio, TimeSpan.FromMilliseconds(110), dur, false),
        };
        var kept = ClipExporter.FilterAudioByIntervals(audio, intervals);

        Assert.Empty(kept);
    }
}
