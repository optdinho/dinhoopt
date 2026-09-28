using System.Buffers;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Threading.Channels;
using DiNho.Capture.Poc.Logging;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

internal sealed partial class FfmpegEncoder : IEncoder
{
    private Process? _process;
    private Stream? _stdin;
    private Stream? _stdout;
    private readonly Channel<EncodedPacket> _outputChannel;

    private int _width, _height, _frameRate;
    private int _cropX, _cropY, _cropW, _cropH;
    private bool _initialized;
    private volatile bool _disposed;
    private Thread? _readerThread;
    private CancellationTokenSource? _readerCts;
    private Thread? _stderrThread;
    private CancellationTokenSource? _stderrCts;
    private FrameWriter? _frameWriter;
    private string? _processFailedCause;
    private string? _codec;
    private readonly bool _useHardware;
    private int _bitrateKbps = 2000;

    // Cascading fallback chain — built once at first probe, consumed by TryFallbackCodec()
    private List<EncoderManager.FallbackEntry>? _fallbackChain;
    private int _currentFallbackIndex;
    private int _scaleDivisor = 1; // 1 = full res, 2 = half, 4 = quarter

    // Resolução de saída configurável pelo usuário (0 = mantém resolução de entrada).
    // O input rawvideo fica sempre na resolução da captura (_width/_height); o scale
    // acontece dentro do ffmpeg via -vf "scale=..." antes do encoder.
    private int _outputWidth;
    private int _outputHeight;
    private bool _stretchToFit;

    private GpuVideoConverter? _gpuConverter;
    private ID3D11Texture2D? _nv12Staging;
    private ID3D11Texture2D? _inputCopy;
    private int _inputCopyW, _inputCopyH, _stagingW, _stagingH;
    private Format _inputCopyFormat;

    // Dimensões da NV12 emitida (encoded dims). Sem crop, o scale acontece no GPU/CPU
    // (VideoProcessorBlt / DownscaleBgra) — a NV12 já sai na resolução final e o ffmpeg
    // recebe rawvideo direto nela, sem filtro scale. Com crop (código morto) mantém-se
    // _width/_height e o scale no vf. Setadas no StartFfmpeg; 0 = fallback para captura.
    private int _nv12W;
    private int _nv12H;

    private readonly Queue<EncodedPacket> _pendingOutputs = new();
    private bool _processFailed;
    private int _frameCount;
    private int _restartAttempts;
    private long _lastRestartTicks;
    private int _gpuConvertFails;
    private int _droppedPackets;
    private volatile bool _lastFrameBusyDrop;
    private int _gpuBusyDrops;

    // Absolute restart limiter: max 10 restarts in any 30-second window to prevent CLR crash from GC pressure
    private int _restartsInWindow;
    private long _restartWindowStartTicks;

    // CRF+VBV quality params (NVENC/AV1)
    private int _cq = 24;
    private int _maxrateKbps = 80000;
    private int _bufsizeKbps = 100000;
    private int _bframes = 0;
    private int _lookahead = 0;
    private string _nvencPreset = "p2";
    private string _amfPreset = "speed";
    private string _amfUsage = "";
    private bool _amfPreanalysis = false;
    private bool _amfSav = false;
    private bool _multipass = false;

    // Buffers NV12 são pooled por frame (VideoPacketPool.Rent) — o writer thread ainda
    // pode estar escrevendo o frame anterior, então scratch único não é mais seguro.

    // Real PTS tracking — ConcurrentQueue because Enqueue (pipeline thread) and Dequeue (reader thread) are different threads
    private readonly ConcurrentQueue<TimeSpan> _inputPtsQueue = new();
    private long _lastRealPtsTicks = -1; // Last known real PTS for extrapolation when queue is drained

    // H.264 parser state
    private byte[]? _pendingBuf;   // AVCC frame assembly buffer (ParseAvcc → EmitPacket)
    private int _pendingLen;
    private bool _hadSlice;
    private bool _pendingTooLarge; // Set by ParseAvcc when pending exceeds 200KB — prevents false EmitPacket
    private long _outputFrameIndex;

    // Stdin write timeout: strict 200ms only in steady state (encoder proven working).
    // During warm-up (no packet emitted yet) use a generous timeout — ffmpeg opening the
    // HW encoder does not read stdin yet, and a strict timeout kills it before cold-start,
    // causing a kill-restart loop that cascades to CPU libx264 (observed on RTX 5050:
    // av1_nvenc cold-start can exceed 200ms, especially when the previous NVENC session
    // is still being released).
    internal const int StdinWriteTimeoutMs = 200;
    internal const int StdinWriteWarmupTimeoutMs = 10_000;

    // GOP = keyframe a cada 60 frames = 1 s @60fps. Valor nomeado (não repetir o número
    // mágico em 11+ chains) e travado por teste em BuildEncoderTuneArgs_AllCodecs_UseGop60.
    //
    // Era 120 (2 s) nas chains NVENC/AMF/D3D12VA. Sem B-frames (item 7) um corte só pode
    // começar num I-frame, então o ClipExporter recua até o último keyframe antes do ponto
    // pedido — com GOP 2 s o usuário percebia "o clip começa até 2 s antes do que pedi".
    // Metade do GOP corta isso pela metade, e o custo é irrelevante: mais I-frame só
    // acrescenta 1 bit de flag por frame + o predictor intra de 1 frame a cada 60. Medido em
    // 600 frames com a chain real: GOP60 vs GOP120 = h264 +0,29%, hevc +0,84%, av1 -0,52%.
    // QSV já usava 60 e o libx265 já usava keyint=60 no -x265-params: agora é uniforme.
    internal const int Gop = 60;

    /// <summary>Preset do SVT-AV1 (fallback de AV1 em CPU). A escala é <b>numérica</b>, de 0 a
    /// 13 - o ffmpeg 9.0.1 recusa nome com "Undefined constant or missing '(' in 'fast'"
    /// (exit -22). Medido no binário embarcado, testesrc2, 300 frames, args reais de
    /// produção (CQ 20, GOP 60, bf 0), Xeon E5-2690 v3 12c/24t:
    /// <list type="bullet">
    /// <item>1080p60: p4 = 30 fps · p6 = 57 · p7 = 69 · <b>p8 = 104</b> · p9 = 131 · p10 = 153</item>
    /// <item>720p60: p4 = 57 · p6 = 104 · p7 = 125 · <b>p8 = 157</b> · p9 = 220 · p10 = 265</item>
    /// </list>
    /// Ou seja, a escala é <b>crescente = mais rápido</b> (medido, não de memória) e a banda
    /// "rápido" (7..9) é mesmo a única que sustenta 60fps em 1080p: <b>p6 fica em 57 fps, ou
    /// seja já não sustenta</b>. O 8 dá 1,74× de folga sobre 60fps nesse CPU de servidor de
    /// 2014 (p7 daria só 1,15×, fino demais para um pipeline que também captura e converte).
    /// Bytes mudam ~2% entre p7 e p10, então subir o preset aqui é ganho de vazão quase de
    /// graça — a escolha de ficar em 8 é por folga de throughput, não por tamanho. Para
    /// comparação no mesmo CQ 20: libx264 <c>-preset fast</c> faz 152 fps em 1080p (69% do
    /// que o SVT 8 faz) e 301 em 720p; e o SVT entrega ~2,3× os bytes do x264 no mesmo CQ,
    /// a mesma discrepância de escala de CRF por codec já medida no NVENC (item 8) — não é
    /// defeito, e o CQ do usuário é invariante.
    /// </summary>
    internal const string SvtPreset = "8";

    // Raw AnnexB/AVCC accumulation buffer — handles pipe splits that land mid-NALU
    private byte[]? _rawBuf;
    private int _rawLen;
    private bool _hadRawSlice; // tracked in AnnexB path before conversion
    private bool _loggedParseAvcc; // first-call guard for ParseAvcc log
    private string? _userCodec; // original user codec preference, for fallback chain building
    private byte[]? _incompleteNalBuf;   // Incomplete NALU tail from ParseAvcc (Bug 1 fix)
    private int _incompleteNalLen;        // Length of incomplete NALU tail

    // Format latch — ffmpeg -f h264 with -bsf:v should output AnnexB, but sometimes
    // frames slip through in AVCC format. We detect once and latch.
    private enum PipeFormat { Unknown, AnnexB, Avcc, Ivf }
    private PipeFormat _pipeFormat;

    // Cached avcC (AVCDecoderConfigurationRecord) extracted from the first SPS/PPS encountered.
    // Needed by clip exporter when the rolling replay buffer has evicted the initial packet.
    private byte[]? _cachedVps;
    private byte[]? _cachedSps;
    private byte[]? _cachedPps;
    private byte[]? _cachedAvcc;
    private byte[]? _cachedHvcc;
    private bool _ivfHeaderParsed;
    private uint _ivfTimebaseDen;
    private uint _ivfTimebaseNum;

    public FfmpegEncoder(bool useHardware = true)
    {
        _useHardware = useHardware;

        // DropOldest mantém a dinâmica de gravação: quando o canal enche, o
        // pacote mais antigo é descartado e os frames mais recentes (o "agora",
        // que é o ponto de save do replay buffer) são preservados.
        //
        // O callback itemDropped é obrigatório: o descarte via DropOldest NÃO
        // chama Release() sozinho — sem este callback o byte[] do VideoPacketPool
        // vazaria (M1).
        _outputChannel = Channel.CreateBounded<EncodedPacket>(new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.DropOldest
        }, itemDropped: pkt =>
        {
            pkt.Release();
            // M2: contabiliza drops para o operador. Loga no 1º drop e depois a cada
            // 100 — um ffmpeg lento (encoder < 1.0x) pode descartar centenas por
            // segundo, e logar todo drop inundaria o log. 100 = ~1.6s a 60fps.
            int drops = Interlocked.Increment(ref _droppedPackets);
            if (drops == 1 || drops % 100 == 0)
                Log.W("FfmpegEncoder", $"output channel overflow — {drops} packets dropped total (encoder output slower than capture)");
        });
    }
    public byte[]? AvccCache => _cachedAvcc;
    public byte[]? HvccCache => _cachedHvcc;
    public string? Codec => _codec;
    private bool IsHevc => _codec is "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "libx265";
    private bool IsAv1 => _codec is "av1_nvenc" or "libsvtav1" or "av1_amf" or "av1_qsv";
    public string RawFormat => IsHevc ? "hevc" : IsAv1 ? "av1" : "h264";
    public void SetD3DManager(IMFDXGIDeviceManager? manager) { }

    public void SetCropRect(int x, int y, int w, int h)
    {
        _cropX = x; _cropY = y; _cropW = w; _cropH = h;
    }

    /// <summary>
    /// Define a resolução de saída desejada (ex.: 854×480, 1280×720, 1920×1080).
    /// O frame é redimensionado inteiro via filtro scale do ffmpeg — sem recorte.
    /// Valores ≤ 0 mantêm a resolução de entrada. Dimensões ímpares são arredondadas
    /// para baixo (par), exigência do NV12.
    /// </summary>
    public void SetOutputResolution(int width, int height)
    {
        _outputWidth = width > 0 ? width & ~1 : 0;
        _outputHeight = height > 0 ? height & ~1 : 0;
    }

    /// <summary>
    /// "Remover bordas pretas": quando true, o scale preenche o box alvo inteiro
    /// (deixa de preservar o aspect da captura — leve distorção). Sempre desliga
    /// o box-fit, mas o "nunca upscale" continua valendo.
    /// </summary>
    public void SetStretchToFit(bool stretchToFit)
    {
        _stretchToFit = stretchToFit;
    }

    /// <summary>Gate do NVENC weighted_pred: ffmpeg 9.0 (SDK 11.1+) rejeita weighted_pred quando
    /// bframes &gt; 0 ("invalid param (8): Weighted Prediction not supported with B-frames") —
    /// aplica apenas com bframes = 0 (preset Boa) para preservar o recurso sem restart loop.</summary>
    internal static string BuildWeightedPredArg(bool bframesZero) =>
        bframesZero ? " -weighted_pred 1" : "";

    /// <summary>Alvo médio de bitrate (-b:v) das chains AMF, derivado do maxrate do front:
    /// 36% do teto, com piso 6 Mbps (presets fracos) e teto 50 Mbps (4K). Extraído de
    /// BuildEncoderTuneArgs p/ os testes e o probe --probe-vbv usarem a MESMA curva — a
    /// fonte da verdade do bitrate efetivo da AMF não pode viver em dois lugares.</summary>
    internal static int ComputeAmfTargetKbps(int maxrateKbps) =>
        Math.Clamp((int)Math.Round(maxrateKbps * 0.36), 6000, 50000);

    /// <summary>Normaliza o <c>-usage</c> da AMF para um dos seis valores aceitos pelo ffmpeg 9
    /// (transcoding/ultralowlatency/lowlatency/webcam/high_quality/lowlatency_high_quality).
    /// Case-insensitive com trim; <b>inválido, vazio ou null → string vazia</b>, que significa
    /// <b>não emitir <c>-usage</c></b> e deixar o ffmpeg no default dele.
    ///
    /// <para><b>Por que vazio e não "transcoding" (correção de 2026-09-26):b> esta função
    /// fixava <c>transcoding</c> como fallback, e a justificativa — registrada no Item 3 —
    /// era que <c>transcoding</c> era "o default histórico do ffmpeg", ou seja, um no-op.
    /// <b>O binário embarcado diz o contrário:</b>
    /// <c>ffmpeg -h encoder=h264_amf</c> → <c>-usage &lt;int&gt; (from -1 to 5) (default -1)</c>.
    /// <c>-1</c> é "não definido pelo app", não <c>transcoding</c>. Emitir <c>transcoding</c>
    /// onde antes nada era emitido é uma <b>mudança real</b> de RC, lookahead e
    /// <c>ENFORCE_HRD</c> na captura AMD — feita sem hardware para medir, que é exatamente
    /// o que o Item 3 dizia não promote. Vazio deixa os args da chain <b>idênticos</b> aos de
    /// antes do Item 3, e a opção continua exposta para a decisão medida. Mesmo modo de falha
    /// do <c>main10</c> (Item 9) e do <c>-rc vbr_peak</c> (Item 8): opção que não falha e
    /// parece não mudar nada.</para>
    ///
    /// <para><b>Por que o usage importa:</b> a AMF deriva o conjunto completo de parâmetros do
    /// usage escolhido, não só um preset. Comparando a doc da AMD (AMF_Video_Encode_API.md):
    /// <c>transcoding</c> usa PCVBR, VBV de 20 Mbit e <c>LOWLATENCY_MODE=false</c> — que
    /// significa "precisa de ao menos 3 frames antes de qualquer output". <c>webcam</c> usa
    /// PCVBR com VBV de 2 Mbit. <c>ultralowlatency</c> é o usage documentado para
    /// <i>video game streaming</i>: LCVBR, VBV de 735 kbit, <c>LOWLATENCY_MODE=true</c>
    /// (output no 1º frame) e <c>ENFORCE_HRD=true</c>. Meça com <c>--probe-amf-usage</c>
    /// antes de configurar qualquer um deles.</para></summary>
    internal static string NormalizeAmfUsage(string? usage)
    {
        if (string.IsNullOrWhiteSpace(usage)) return "";
        var u = usage.Trim().ToLowerInvariant();
        return u is "transcoding" or "ultralowlatency" or "lowlatency" or "webcam"
            or "high_quality" or "lowlatency_high_quality" ? u : "";
    }

    /// <summary>Rate control canônico do <c>-usage</c> escolhido. A AMF usa LCVBR como default
    /// de ultralowlatency/lowlatency e PCVBR nos demais; no ffmpeg 9 isso é
    /// <c>-rc vbr_latency</c> e <c>-rc vbr_peak</c>. Passa o usage por NormalizeAmfUsage antes
    /// (o chamador já recebe o valor normalizado).</summary>
    internal static string NormalizeAmfRc(string? usage)
    {
        var u = NormalizeAmfUsage(usage);
        return u is "ultralowlatency" or "lowlatency" ? "vbr_latency" : "vbr_peak";
    }

    /// <summary>Args do encoder no StartFfmpeg, por codec. Extraído como seam puro (sem estado)
    /// para permitir teste unitário da cadeia de tune de cada codec. AMF: CQP (QP = cq do front)
    /// + preset (degradado por máquina) + vbaq + me_quarter_pel (só h264/hevc_amf — av1_amf não
    /// expõe me_quarter_pel e usa -aq_mode caq como AQ, seu equivalente do vbaq). O preset antigo
    /// `quality` + preanalysis + lookahead 40 era pesado demais pra RDNA1 (VCN 1.0): encoder a
    /// ~0.55x speed → drift A/V crescente e clips com ~36fps em vez de 60. A partir do ffmpeg 9,
    /// o AMF expõe high_quality + a cadeia preanalysis/TAQ — ambos agora entram SÓ quando o probe
    /// real sustenta (SelectAmfPreanalysis), mantendo iGPU/VCN 1.0 segura. `-filler` não existe no
    /// ffmpeg 9 — a opção é `-filler_data` (boolean), válida nos 3 codecs AMF.</summary>
    internal static string BuildEncoderTuneArgs(string codec, double cq, int maxrateKbps, int bufsizeKbps,
        int bframes, int lookahead, string nvencPreset, string amfPreset = "speed",
        bool multipass = false, bool amfPreanalysis = false, bool amfSav = false,
        int? vbvOverrideKbps = null, string amfUsage = "",
        string? profileOverride = null)
    {
        // Cadeia preanalysis/TAQ da AMF — entra só quando a GPU sustentou quality/high_quality
        // no probe (RDNA2+/VCN 2.0+ de alto desempenho); iGPU nunca recebe esses switchs pesados.
        var amfPaChain = amfPreanalysis
            ? " -preanalysis true -pa_lookahead_buffer_depth 40 -pa_taq_mode 2"
            : "";
        // Smart Access Video (APU+dGPU AMD, 2 VCNs) — só quando SupportsSmartAccessVideo == true.
        var amfSavArg = amfSav ? " -smart_access_video 1" : "";
        // Fallback de CPU (libx264/libx265): CRF+VBV com preset fast. Sem -tune zerolatency
        // (bframes=0 garante ordem de saída = ordem de entrada p/ o PTS do pipeline) e sem
        // -threads 1 (usa todos os cores). CABAC/High profile recupera ~15% de eficiência.
        // GOP explícito: o default do x264 é keyint=250 (4,2 s a 60fps) — sem -g o corte
        // recuava MAIS que os 120 que este item remove. keyint_min = g trava a posição do
        // I-frame (sem isso o x264 pode adiar o keyframe, alongando o GOP efetivo).
        var cpuCq = Math.Clamp(cq, 1, 51);
        var qsvQp = Math.Clamp(cq - 4, 0, 51);
        var amfPresetNorm = NormalizeAmfPreset(amfPreset);
        var amfUsageNorm = NormalizeAmfUsage(amfUsage);
        var amfRcNorm = NormalizeAmfRc(amfUsageNorm);
        // -usage vai ANTES de -quality/-rc: a AMF deriva o resto do conjunto de parâmetros do
        // usage, e as opções explícitas abaixo sobrescrevem só o que mandamos. Conflito zero
        // com -b:v/-maxrate/-bufsize, que continuam mandando em bitrate.
        // Vazio = não configurado = não emitir (o default -1 do ffmpeg). Ver NormalizeAmfUsage.
        var amfUsageArg = string.IsNullOrEmpty(amfUsageNorm) ? "" : $" -usage {amfUsageNorm}";
        // AMF: vbr_peak com alvo médio derivado do maxrate do front (36% — altar 55000→19800
        // ≈ Medal 1080p h264 de 15-20 Mbps) + teto VBV (maxrate/bufsize). Sem QP junto: o QP
        // sobrepõe o alvo (issue obs-ffmpeg #12994); e o CQP puro (sem alvo) estourou ~180 Mbps
        // com cq 18 na RX 5700 XT → VCN + spill ~10x e clip de 94s ≈ 930 MB. Clamp mantém
        // presets fracos ≥6 Mbps e 4K sem estourar.
        var amfTarget = ComputeAmfTargetKbps(maxrateKbps);
        // VBV = bufsize configurado pelo front. MEDIDO (--probe-vbv, RTX 5050, 2026-09-25,
        // cq 16 / 1920x1080@60 / maxrate 65000): o -bufsize NÃO tem efeito nas chains atuais.
        // h264_nvenc devolveu 3019 KiB byte-idêntico em 130000K, 64000K, 48000K e 32000K —
        // bitrate efetivo 16,5 Mbps contra teto de 65 Mbps. Mesma conclusão em hevc_nvenc e
        // av1_nvenc. A referência antiga de "~180 Mbps" / "79 Mbps médios" veio do CQP PURO,
        // que a chain não usa mais: hoje é vbr_peak com -b:v {amfTarget}.
        // Consequência: NÃO apertar o bufsize aqui — seria uma mudança sem efeito medível.
        // vbvOverrideKbps existe SÓ para o probe forçar candidatos; null em produção.
        //
        // ⚠️ A frase "o VBV nunca chega a apertar" que estava aqui era GENERALIZADA A PARTIR
        // DE UM PROBE DE CONTEÚDO QUASE ESTÁTICO e está REFUTADA por remedição com os args de
        // produção (2026-09-26, 1280x720@60, bframes 0, -rc-lookahead 4, -g 60, p7, 300
        // frames, 5 fontes). O que o -maxrate realmente faz:
        //  •Ele LIMITA quando a demanda do conteúdo é MENOR que o teto. mandelbrot cq16:
        //    max20 => 21.099 kbps, max40 => 33.168 kbps, max100 => 33.253 (+57%/+0,3%) — o
        //    teto corta 36% do arquivo em max20, então lá ele manda mesmo.
        //  •Ele NÃO IMPÕE teto quando a demanda é MAIOR. life (caos, frame inteiro muda)
        //    cq16: max20 => 71.252 kbps = 356% do teto; max40 => 71.488 (+0,3%).
        //  •O bufsize é irrelevante mesmo: life cq16 max20 buf400 (10x) => 71.102 kbps (−0,2%).
        // E o CQ também perde autoridade no mesmo regime: em life, cq16 => 71.252 vs cq28 =>
        // 72.269 kbps (1,7% de diferença). Modelo que explica tudo: o VBV drena um buffer
        // com teto de rajada, mas a taxa média é imposta pela ENTROPIA do conteúdo, com um
        // piso que nem CQ 28 baixa. Ou seja: o teto é teto de rajada, não de tamanho de arquivo.
        // Consequência para o Item 0 (perfil LowMemory preserva o CQ do usuário): a proteção
        // de RAM NÃO vinha do piso de CQ 26 que foi removido (ele não controlaria o tamanho
        // nesse regime) e sim do cap de 720p do Item 1. Em troca, LowMemory com CQ 16 sobre
        // cena caótica pode chegar a ~71 Mbps em 720p (~32 GB/h) — risco de disco/IO real,
        // registrado no plano para decisão do usuário, não "corrigido" aqui por CQ ou VBV,
        // porque as duas levers measurei não controlam esse regime.
        var vbv = vbvOverrideKbps ?? bufsizeKbps;
        // Item 9 (medido): a chain pediu -profile:v main10 desde 2026-08-03, mas a entrada do
        // pipeline é rawvideo NV12 8-bit (FfmpegEncoder.cs:627). O A/B medido em RTX 5050 /
        // ffmpeg 9.0.1 (cq 18, 1920x1080@60, maxrate 55000) deu arquivo com 4 bytes de
        // diferença — o general_profile_idc no VPS NAL, 0x21 Main vs 0x22 Main10 — e os outros
        // 4.134.825 bit-idênticos. O NVENC NÃO converte 8→10: a flag só mentava no header, e
        // o stream saía ROTULADO como Main 10 cheio de amostras de 8 bits. Zero bytes
        // economizados, fps dentro do ruído, e um stream mal rotulado.
        //
        // main10 só passa a valer se a captura virar P010 de verdade (aí o sinal tem 10 bits
        // e o upconvert deixa de ser perda). profileOverride existe SÓ para o
        // --probe-hevc-profile refazer esse A/B quando isso acontecer; null = produção.
        var hevcProfile = profileOverride ?? "main";
        return codec switch
        {
            "libx264" => $"-preset fast -crf {cpuCq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -profile:v high -g {Gop} -keyint_min {Gop}",
            "libx265" => $"-preset fast -crf {cpuCq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -x265-params no-open-gop=1:keyint={Gop}:min-keyint={Gop}",
            // SVT-AV1 (fallback de AV1 em CPU — EncoderManager.cs:282-283). Dois args do ramo
            // do x264 NÃO podem ser herdados aqui, medido no binário embarcado (ffmpeg 9.0.1):
            //   -preset <nome>  → o SVT só aceita int: "Undefined constant or missing '(' in
            //                      'fast'" → exit -22. A escala é 0..13 (7..9 = rápido);
            //                      8 é o equivalente do "fast" do x264 e foi testado.
            //   -profile:v high → no AV1 o ffmpeg traduz "high" para o profile 1, que exige
            //                      4:4:4, e a entrada é NV12 4:2:0: "Profile 1 requires 4:4:4
            //                      color format" → exit -22.
            // Sem este braço, o `_ =>` entregava os dois e a captura não abria em nenhuma
            // máquina com GPU sem AV1 por hardware. Mesma classe do `-rc vbr_peak` (Item 8).
            "libsvtav1" => $"-preset {SvtPreset} -crf {cpuCq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -g {Gop} -keyint_min {Gop}",
            "h264_nvenc" => $"-preset {nvencPreset} -tune hq -rc vbr -b:v 0 -cq {cq} -maxrate {maxrateKbps}K -bufsize {vbv}K -profile:v high -bf {bframes} -rc-lookahead {lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass {(multipass ? "fullres" : "disabled")}{BuildWeightedPredArg(bframes == 0)} -nonref_p 1 -g {Gop} -keyint_min {Gop}",
            "hevc_nvenc" => $"-preset {nvencPreset} -tune hq -rc vbr -b:v 0 -cq {cq} -maxrate {maxrateKbps}K -bufsize {vbv}K -profile:v {hevcProfile} -bf {bframes} -b_ref_mode middle -rc-lookahead {lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass {(multipass ? "fullres" : "disabled")}{BuildWeightedPredArg(bframes == 0)} -nonref_p 1 -g {Gop} -keyint_min {Gop}",
            "av1_nvenc" => $"-preset {nvencPreset} -tune hq -rc vbr -b:v 0 -cq {cq} -maxrate {maxrateKbps}K -bufsize {vbv}K -bf {bframes} -rc-lookahead {lookahead} -spatial-aq 1 -aq-strength 8 -temporal-aq 1 -multipass {(multipass ? "fullres" : "disabled")} -nonref_p 1 -g {Gop} -keyint_min {Gop}",
            // AMF: vbr_peak (alvo médio em -b:v, teto em -maxrate) + VBV. rc h264/hevc: VBAQ +
            // me_quarter_pel (AQ clássico AVC/HEVC). av1_amf usa -aq_mode caq (o AQ do AV1; vbaq
            // não existe p/ av1_amf no ffmpeg 9). Sem QP junto ao RC de bitrate (issue obs-ffmpeg
            // #12994: QP sobrepõe o alvo). GOP = {Gop} (1 s a 60fps): o padrão GPUOpen/OBS era 120,
            // mas sem B-frames todo corte recua até o I-frame anterior — 2 s de rollback
            // visível. Medido: o custo em bytes do GOP 60 foi ~0% (h264 +0,29%, hevc +0,84%,
            // av1 -0,52%). PA/preanalysis fora por padrão (RDNA1 VCN 1.0 overload).
            "h264_amf" => $"{amfUsageArg} -quality {amfPresetNorm} -rc {amfRcNorm} -b:v {amfTarget}K -maxrate {maxrateKbps}K -bufsize {vbv}K -bf 0 -g {Gop} -filler_data 0 -enforce_hrd 0 -vbaq true -me_quarter_pel true{amfPaChain}{amfSavArg}",
            "hevc_amf" => $"{amfUsageArg} -quality {amfPresetNorm} -rc {amfRcNorm} -b:v {amfTarget}K -maxrate {maxrateKbps}K -bufsize {vbv}K -bf 0 -g {Gop} -filler_data 0 -enforce_hrd 0 -vbaq true -me_quarter_pel true{amfPaChain}{amfSavArg}",
            "av1_amf" => $"{amfUsageArg} -quality {amfPresetNorm} -rc {amfRcNorm} -b:v {amfTarget}K -maxrate {maxrateKbps}K -bufsize {vbv}K -bf 0 -g {Gop} -filler_data 0 -enforce_hrd 0 -aq_mode caq{amfPaChain}{amfSavArg}",
            // QSV: veryslow + global_quality + extbrc/rdo/adaptive/mbbrc. Sem -extra_hw_frames:
            // ffmpeg 9 rejeita extra_hw_frames como opção de encoder ("not a encoding option") —
            // é opção frame-level (valida p/ vf hwupload=...). QSV precisa de -init_hw_device qsv
            // (adicionado no StartFfmpeg/probe) para criar a sessão MFX; sem ele o ffmpeg 9 falha
            // com "Error creating a MFX session: -9" mesmo em máquina Intel.
        "h264_qsv" or "hevc_qsv" => $"-preset veryslow -global_quality {qsvQp} -bf 0 -g {Gop} -maxrate {maxrateKbps}K -bufsize {vbv}K -extbrc 1 -look_ahead_depth 40 -rdo 1 -low_power 0 -adaptive_i 1 -adaptive_b 1 -b_strategy 1 -mbbrc 1 -async_depth 1",
        "av1_qsv" => $"-preset veryslow -global_quality {qsvQp} -bf 0 -g {Gop} -maxrate {maxrateKbps}K -bufsize {vbv}K -extbrc 1 -look_ahead_depth 40 -adaptive_i 1 -adaptive_b 1 -b_strategy 1 -async_depth 1",
            // D3D12VA: só aceita frames no pixel format d3d12 (via hwupload no vf chain).
            // RC modes: 1=CQP, 2=CBR, 3=VBR, 4=QVBR. -bf 0 garante ordem de saída = entrada
            // (requisito do PTS pipeline). GOP = {Gop}, igual às demais chains.
            // ⚠️ O "1=CQP" vem do enum C (D3D12VA_RCMode) e NÃO é verificável aqui: o
            // d3d12va não expõe os nomes das constantes na seção dele do -h full e não há
            // hardware na máquina de teste. Índice numérico NÃO é validado pelo ffmpeg (o
            // nvenc aceitou -rc 999 em silêncio), então se 1 ≠ CQP o -qp é descartado sem
            // erro e o CQ deixa de valer. Trocar por -rc cqp (nome) faria o ffmpeg validar
            // e falhar alto — não foi aplicado por ser mudança em família sem hardware para
            // medir, o mesmo motivo do -usage da AMF.
            "h264_d3d12va" => $"-rc 1 -qp {Math.Clamp(cq, 0, 52)} -bf 0 -g {Gop}",
            "hevc_d3d12va" => $"-rc 1 -qp {Math.Clamp(cq, 0, 52)} -bf 0 -g {Gop}",
            "av1_d3d12va" => $"-rc 1 -qp {Math.Clamp(cq, 0, 52)} -bf 0 -g {Gop}",
            // Fallback de software: args do x264. É o ÚNICO braço que ainda aceita qualquer
            // codec, e por isso é a armadilha do item: `-preset` e `-profile:v` NÃO são
            // universais. Já mordeu uma vez — `libsvtav1` caía aqui e o encoder não abria
            // (`-preset fast` rejeitado, e `-profile:v high` = profile 1 exige 4:4:4 no AV1).
            // Antes de adicionar um codec a este switch, confira no binário embarcado
            // (`ffmpeg -h encoder=<codec>`) se -preset aceita NOME e se -profile:v existe.
            _ => $"-preset fast -crf {cpuCq} -maxrate {maxrateKbps}K -bufsize {bufsizeKbps}K -bf 0 -profile:v high -g {Gop}"
        };
    }

    /// <summary>Normaliza o preset AMF para um dos quatro valores válidos do ffmpeg 9
    /// (high_quality/quality/balanced/speed). Case-insensitive com trim; inválido, vazio ou null →
    /// "speed" (preset default mais seguro — RDNA1 sustenta ~1.0x mesmo em resolução alta).
    ///
    /// <para><b>Por que NOME e nunca o índice (medido no binário embarcado, ffmpeg 9.0.1,
    /// <c>-h encoder=&lt;codec&gt;</c>).</b> Os três AMF aceitam os mesmos <b>nomes</b>, mas os
    /// <b>índices divergem em cada encoder</b>:
    /// <code>
    /// -quality  h264_amf: balanced=0 speed=1    quality=2 high_quality=3
    ///           hevc_amf: quality=0  balanced=5  speed=10 high_quality=15
    ///           av1_amf:  high_quality=0 quality=30 balanced=70 speed=100
    /// </code>
    /// Nenhum preset tem o mesmo índice nos três. Como índice numérico <b>não é validado</b>
    /// (o nvenc aceitou <c>-rc 999</c> em silêncio), um atalho compartilhado trocaria o preset
    /// de toda a família AMF sem erro nenhum — e o S2b do <c>--audit-amd</c> mediu que o preset
    /// <b>não muda os bytes</b>, só a <b>velocidade</b> (1,8× entre high_quality e speed): o
    /// arquivo sairia normal e só a GPU ficaria mais lenta. O mesmo vale para <c>-rc</c>, onde
    /// <c>vbr_latency</c> é 3 no h264 e 1 no hevc/av1 — o índice do <c>cbr</c> no h264. Nomes
    /// são validados pelo ffmpeg (sumiu da tabela = <c>Unrecognized option</c>, alto e visível).
    /// Trava em <c>AmfNumericIndexDivergenceTests</c>.</para></summary>
    internal static string NormalizeAmfPreset(string? preset)
    {
        if (string.IsNullOrWhiteSpace(preset)) return "speed";
        var p = preset.Trim().ToLowerInvariant();
        return p is "high_quality" or "quality" or "balanced" or "speed" ? p : "speed";
    }

    /// <summary>Formato raw dos dados de vídeo na saída do ffmpeg, por codec — necessário para o
    /// mux (IVF p/ AV1 vs raw p/ H264/HEVC) e para o detector de formato no ReaderLoop.</summary>
    internal static string GetRawFormatForCodec(string codec) => codec switch
    {
        "hevc_nvenc" or "hevc_amf" or "hevc_qsv" or "hevc_d3d12va" or "libx265" => "hevc",
        "av1_nvenc" or "libsvtav1" or "av1_d3d12va" or "av1_amf" or "av1_qsv" => "av1",
        _ => "h264"
    };

    /// <summary>Resolução efetiva dos pacotes emitidos, determinada no StartFfmpeg a partir do
    /// scale aplicado (usuário + divisor) e do crop. Cobre tanto o scale do usuário quanto o
    /// cascading fallback — evita que o header do MKV (EncodedPacket.Width/Height) divirja do
    /// bitstream real.</summary>
    private int _encodedW;
    private int _encodedH;
    private int EncodedWidth => _encodedW > 0 ? _encodedW : _width;
    private int EncodedHeight => _encodedH > 0 ? _encodedH : _height;

    /// <summary>Piso ABSOLUTO de resolução do guard de capacidade (Item 1, opção A). O
    /// divisor da cascata de fallback pode degradar o alvo do usuário, mas nunca abaixo
    /// disto. 1280×720 é o mesmo teto que o perfil RAM <c>LowMemory</c> já usa como cap,
    /// então o piso não introduz um conceito novo — só dá um nome a ele.</summary>
    internal const int MinOutputWidth = 1280;
    internal const int MinOutputHeight = 720;

    /// <summary>
    /// Calcula a resolução alvo do filtro scale combinando a resolução de saída do
    /// usuário com o scale do cascading fallback (1/N da entrada). Preserva o aspect
    /// ratio da entrada quando a resolução do usuário tem proporção diferente (ex.:
    /// captura 16:10/21:9 + preset 16:9) — ajusta dentro do box alvo sem esticar.
    /// Retorna null quando nenhum scale é necessário (saída == entrada).
    ///
    /// <para><b>Item 1 — o divisor antes era um no-op em produção.</b> A condição era
    /// <c>scaleDivisor &gt; 1 &amp;&amp; outputW &lt;= 0</c>, mas o coordinator SEMPRE manda
    /// resolução explícita &gt; 0 (<c>EngineCoordinator.Capture.cs:278-279</c>), então os
    /// degraus "HW 1/2", "HW 1/4" e "CPU 1/2" da cascata existiam só como rótulo no log:
    /// o ffmpeg continuava codificando na resolução cheia enquanto o log dizia 1/2. O
    /// commit que introduziu a cascata (7474fce) não protegia nada.</para>
    ///
    /// <para><b>Contrato atual (opção A, piso absoluto):</b> o divisor APLICA sempre que
    /// <c>scaleDivisor &gt; 1</c>, e o resultado é limitado por <b>piso absoluto 1280×720</b>,
    /// não pela escolha do usuário. A escolha do usuário continua sendo o TETO (e nunca
    /// gera upscale), mas deixa de ser o piso — um alvo de 1080p cai para 720p quando o
    /// encoder não sustenta a resolução cheia, que é justamente o propósito da cascata.
    /// Um alvo já abaixo do piso (ex.: 960×540) é preservado, porque degradá-lo mais ainda
    /// só pioraria o resultado sem comprar fps.</para>
    ///
    /// <para>O piso nunca vira upscale: numa captura menor que o piso, o piso efetivo é o
    /// próprio tamanho da entrada.</para>
    ///
    /// <para><b>Limitação conhecida fora de 16:9 (medido):</b> o piso é aplicado por eixo e
    /// <i>depois</i> a razão de aspecto é preservada, que pode puxar a altura para baixo do
    /// piso. Em ultrawide 2560x1080 o divisor 2 dá 1280x720 pelo piso, mas como
    /// <c>inAr &gt; outAr</c> o ajuste final limita pela <b>largura</b> e o resultado é
    /// <b>1280x540</b> — a altura fica abaixo dos 720 do piso. O comportamento é o correto
    /// (preservar proporção sem esticar), mas o "piso 1280x720" só é garantido em 16:9.
    /// Forçar 720 de altura daria 1706x720, mudando a saída de quem captura ultrawide — por
    /// isso a limitação fica documentada em vez de "corrigida".</para>
    /// </summary>
    /// <summary>
    /// O degrau de escala realmente muda a resolução que o ffmpeg recebe?
    ///
    /// <para><b>Por que isso precisa existir:</b> com o piso absoluto 1280x720 (Item 1) os
    /// divisores <b>convergem</b>. Em 1080p, <c>1/2</c> e <c>1/4</c> dão os mesmos 1280x720
    /// (o piso segura), e numa captura já abaixo do piso nenhum divisor tem para onde ir.
    /// <c>NextScaleStepFor</c> não conhece o piso — ele devolve o próximo degrau da cadeia —
    /// então o guard reiniciava o ffmpeg (descartando o backlog de output e o estado de
    /// PTS) sem alterar um único byte dos argumentos, e o log anunciava "1/2 → 1/4" como se
    /// fosse uma mudança. Antes do Item 1 o divisor nem era aplicado, então o guard era
    /// no-op; agora ele precisa saber quando o degrau é real.</para>
    /// </summary>
    internal static bool CapacityStepChangesResolution(
        int inputW, int inputH, int outW, int outH, int oldDivisor, int newDivisor, bool stretchToFit = false)
    {
        var before = ResolveOutput(inputW, inputH, 0, 0, outW, outH, oldDivisor, stretchToFit);
        var after = ResolveOutput(inputW, inputH, 0, 0, outW, outH, newDivisor, stretchToFit);
        return after.EncodedW != before.EncodedW || after.EncodedH != before.EncodedH;
    }

    internal static (int Width, int Height)? ComputeScaleTarget(
        int inputW, int inputH, int outputW, int outputH, int scaleDivisor, bool stretchToFit = false)
    {
        int outW = outputW > 0 ? outputW : inputW;
        int outH = outputH > 0 ? outputH : inputH;
        if (scaleDivisor > 1)
        {
            // Piso efetivo nunca upscale: se a entrada já é menor que o piso, o piso efetivo
            // é a própria entrada (e o divisor não tem para onde reduzir).
            int floorW = Math.Min(MinOutputWidth, inputW);
            int floorH = Math.Min(MinOutputHeight, inputH);
            outW = Math.Min(outW, Math.Max(inputW / scaleDivisor, floorW));
            outH = Math.Min(outH, Math.Max(inputH / scaleDivisor, floorH));
        }
        // Nunca faz upscale — limita à resolução de entrada (mesma regra do EngineCoordinator)
        outW = Math.Min(outW, inputW);
        outH = Math.Min(outH, inputH);
        // "Remover bordas pretas" (stretchToFit): pula a preservação de aspect — o scale
        // preenche o box alvo inteiro (leve distorção). Upscale continua bloqueado acima.
        // Sem stretch, preserva o aspect ratio da captura quando o alvo do usuário tem
        // proporção distinta (ex.: 16:10/21:9 + preset 16:9) — ajusta dentro do box sem esticar.
        if (!stretchToFit && outW > 0 && outH > 0)
        {
            double inAr = (double)inputW / inputH;
            double outAr = (double)outW / outH;
            if (Math.Abs(inAr - outAr) > 0.01)
            {
                if (inAr > outAr) // entrada mais larga: limita por largura
                    outH = (int)Math.Round(outW / inAr);
                else // entrada mais estreita: limita por altura
                    outW = (int)Math.Round(outH * inAr);
            }
        }
        outW &= ~1;
        outH &= ~1;
        if (outW == inputW && outH == inputH)
            return null;
        return (outW, outH);
    }

    /// <summary>Resultado do ResolveOutput — quais dims o ffmpeg recebe (-s), quais a NV12
    /// produzida tem (Nv12W/H) e se o scale vai no filtro vf (ScaleW/H não-nulos = crop ativo).</summary>
    internal readonly record struct EncoderOutputResolve(
        int EncodedW, int EncodedH,
        int Nv12W, int Nv12H,
        int? ScaleW, int? ScaleH);

    /// <summary>
    /// Decisão central de resolução do O1: onde o downscale acontece.
    /// Sem crop (caminho normal): o scale do ComputeScaleTarget é aplicado NA CONVERSÃO
    /// (GPU VideoProcessorBlt / CPU DownscaleBgra) — a NV12 já sai em Nv12W×Nv12H e o ffmpeg
    /// recebe rawvideo direto nela via -s, SEM filtro scale no vf.
    /// Com crop (código morto hoje): a NV12 sai nas dims da captura (Nv12W=EncodedW base = input)
    /// e o scale vai no vf, sobre o frame cortado.
    /// </summary>
    internal static EncoderOutputResolve ResolveOutput(
        int inputW, int inputH, int cropW, int cropH,
        int outputW, int outputH, int scaleDivisor, bool stretchToFit = false)
    {
        bool hasCrop = cropW > 0 && cropH > 0;
        int baseW = hasCrop ? Math.Max(cropW, 320) : inputW;
        int baseH = hasCrop ? Math.Max(cropH, 240) : inputH;
        var scaleTarget = ComputeScaleTarget(baseW, baseH, outputW, outputH, scaleDivisor, stretchToFit);
        int encodedW = scaleTarget?.Width ?? baseW;
        int encodedH = scaleTarget?.Height ?? baseH;
        if (hasCrop)
            return new EncoderOutputResolve(encodedW, encodedH, inputW, inputH, scaleTarget?.Width, scaleTarget?.Height);
        return new EncoderOutputResolve(encodedW, encodedH, encodedW, encodedH, null, null);
    }

    /// <summary>
    /// Define parâmetros de qualidade CRF+VBV para NVENC/AV1.
    /// bitrateKbps ainda é usado como fallback para AMF/QSV/libx264.
    /// </summary>
    public void SetQualityParams(int cq, int maxrateKbps, int bufsizeKbps, int bframes = 2, int lookahead = 4, string preset = "p4", string? codec = null, bool multipass = false, string? amfUsage = null)
    {
        _cq = cq;
        _maxrateKbps = maxrateKbps;
        _bufsizeKbps = bufsizeKbps;
        _bframes = bframes;
        _lookahead = lookahead;
            _nvencPreset = preset;
        _multipass = multipass;
        // null = NÃO INFORMADO, mantém o valor atual — que já nasce "" (não configurado) e,
        // medido no binário (ffmpeg 9.0.1, -h encoder=h264_amf), a seção usage responde
        // "(default -1)", ou seja não existe default implícito. Só muda se o front mandar
        // valor explícito; a normalização garante que nunca sai garbage no -usage.
        // Este parâmetro ficou com default "transcoding" até 2026-09-26 e o campo _amfUsage
        // idem: a suíte ficava verde porque todo teste passava amfUsage: por argumento,
        // então o default da API nunca era exercitado. Ver BuildTuneArgsForTest.
        if (amfUsage != null)
            _amfUsage = NormalizeAmfUsage(amfUsage);
        if (!string.IsNullOrEmpty(codec) && codec != "auto")
        {
            _userCodec = codec;
            var resolved = ResolveCodec(codec);
            // A failed resolve must never leave an empty codec — null lets Initialize pick DetectBestCodec.
            _codec = string.IsNullOrWhiteSpace(resolved) ? null : resolved;
        }
    }

    /// <summary>
    /// Resolve os presets adaptativos (NVENC e AMF) <b>depois</b> que o codec real foi
    /// detectado, nunca antes.
    ///
    /// <para><b>Por que este ponto do código é o único correto:</b> a escada do NVENC
    /// decide por probes, e probe exige saber <i>qual</i> encoder vai rodar. A versão
    /// anterior vivia em <c>EngineCoordinator</c> e recebia <c>_config.Config.Codec</c>,
    /// que é <b>sempre <c>"auto"</c></b> (o front força <c>C.codec = 'auto'</c> em toda
    /// escrita de config e é o default do <c>AppConfig</c>). Como
    /// <c>ResolveEffectiveNvencPreset</c> faz early-return para codec não-NVENC, a escada
    /// <b>nunca rodava</b>: o preset efetivo era o <c>p5</c> legado e o log de "preset
    /// adaptativo" nunca disparava, porque o devolvido era igual ao configurado. Mesma
    /// classe de <c>main10</c> e do <c>-rc vbr_peak</c>: opção que não falha e parece
    /// ter funcionado. Ver <c>FfmpegEncoderNvencPresetTests</c>.</para>
    ///
    /// <para>O AMF já era resolvido aqui, logo depois de <c>DetectBestCodec()</c>. Fica no
    /// mesmo lugar, o que cobre <c>StartCapture</c> e o restart sem duplicar call site.
    /// Mede a resolução de <b>saída</b> (o que o encoder realmente codifica) e, com ela
    /// 0 (captura nativa), o probe é pulado — medir <c>0x0@fps</c> não faria sentido.</para>
    /// </summary>
    internal void ResolveAdaptivePresetsAfterCodecDetection()
    {
        // Codec vazio = deteccao falhou. IsAmfCodec("") e false e a escada faz early-return,
        // entao o preset configurado segue intacto - o mesmo comportamento de antes do
        // DetectBestCodec devolver vazio.
        var codec = _codec ?? "";
        var configuredNvencPreset = _nvencPreset;
        _nvencPreset = EncoderManager.ResolveEffectiveNvencPreset(
            configuredNvencPreset, codec, _outputWidth, _outputHeight, _frameRate);
        if (_nvencPreset != configuredNvencPreset)
            Log.I("FfmpegEncoder", $"NvencPreset adaptativo: '{configuredNvencPreset}' (nao especificado) -> '{_nvencPreset}' medido a {_outputWidth}x{_outputHeight}@{_frameRate}fps");

        _amfPreset = EncoderManager.IsAmfCodec(codec)
            ? EncoderManager.SelectAmfPreset(codec, _width, _height, _frameRate)
            : "speed";
        _amfPreanalysis = EncoderManager.IsAmfCodec(codec)
            ? EncoderManager.SelectAmfPreanalysis(codec, _width, _height, _frameRate, _amfPreset)
            : false;
        _amfSav = EncoderManager.IsAmfCodec(codec)
            ? EncoderManager.SupportsSmartAccessVideo(codec, _width, _height, _frameRate)
            : false;
    }

    public void Initialize(int width, int height, int frameRate, int bitrateKbps = 2000)
    {
        // NV12 requires even dimensions — round down to avoid libx264/NVENC "height not divisible by 2"
        _width = width & ~1;
        _height = height & ~1;
        _frameRate = frameRate;
        _bitrateKbps = bitrateKbps;
        if (string.IsNullOrWhiteSpace(_codec))
        {
            _codec = DetectBestCodec();
        }
        else
        {
            var vendorId = EncoderManager.DetectEncodingVendorId();
            _fallbackChain = EncoderManager.BuildFallbackChain(_userCodec ?? "auto", vendorId);
            _currentFallbackIndex = 0;
        }
        ResolveAdaptivePresetsAfterCodecDetection();
        Log.I("FfmpegEncoder", $"codec={_codec} bitrate={_bitrateKbps}Kbps cq={_cq} maxrate={_maxrateKbps}Kbps bufsize={_bufsizeKbps}Kbps res={width}x{height}@{frameRate}fps preset={_nvencPreset} amfPreset={_amfPreset} amfUsage={_amfUsage} amfPreanalysis={_amfPreanalysis} amfSav={_amfSav} _useHardware={_useHardware}");
        StartFfmpeg();

        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "FfmpegReader"
        };
        _readerThread.Start();
        _initialized = true;

        Log.I("FfmpegEncoder", $"initialized (codec={_codec})");
    }

    /// <summary>Seam de teste: a MESMA chain de tune que a produção monta, mas lida do estado do
    /// encoder. Existe porque o default do <c>-usage</c> da AMF vive em <b>dois lugares que
    /// <see cref="BuildEncoderTuneArgs"/> não expõe</b>: o inicializador do campo
    /// <c>_amfUsage</c> e o valor padrão do parâmetro. Sem este seam os testes só conseguem
    /// passar <c>amfUsage:</c> por argumento explícito — que é exatamente como a suíte
    /// ficou verde com o <c>transcoding</c> (premissa refutada) ainda no código.
    /// Não usar em produção: <paramref name="codec"/> existe para o teste apontar a chain AMF
    /// sem inicializar D3D/ffmpeg.</summary>
    internal string BuildTuneArgsForTest(string codec)
        => BuildEncoderTuneArgs(codec, _cq, _maxrateKbps, _bufsizeKbps, _bframes, _lookahead, _nvencPreset, _amfPreset, _multipass, _amfPreanalysis, _amfSav, amfUsage: _amfUsage);

    // ── ffmpeg process ───────────────────────────────────────────────

    private void StartFfmpeg()
    {
        /* NVENC/AV1: CRF+VBV — -b:v 0 torna o CQ explícito (sem bitrate alvo implícito),
           maxrate/bufsize como segurança VBV.
           AMF/QSV/libx264: fallback com bitrateKbps alvo (esses codecs não têm CRF+VBV bom).
           Melhorias de qualidade sem alterar CQ/res:
             NVENC: spatial-aq 1 + temporal-aq 1 + multipass fullres + weighted_pred + nonref_p
                    (weighted_pred apenas em H264/HEVC e apenas com bframes=0 — ffmpeg 9.0
                     rejeita com "invalid param (8): Weighted Prediction not supported with
                     B-frames"; av1_nvenc rejeita weighted_pred sempre)
             AMF:   preanalysis + pa_taq_mode 2 + vbaq + scene change detection + me_quarter_pel
             QSV:   veryslow + extbrc + rdo 1 + adaptive_i/b + b_strategy + mbbrc
           Cor BT.709: tagging no output → NVENC escreve VUI → atom `colr` no MP4 (players corretos).
           GOP {Gop} (1s a 60fps): o padrão GPUOpen/OBS era 120, mas sem B-frames isso dava
           2s de rollback visível em todo corte. Medido: custo em bytes ~0% (h264 +0,29%,
           hevc +0,84%, av1 -0,52%) — a troca antiga de "~10% menos bits" não se confirmou. */
        var tune = BuildEncoderTuneArgs(_codec!, _cq, _maxrateKbps, _bufsizeKbps, _bframes, _lookahead, _nvencPreset, _amfPreset, _multipass, _amfPreanalysis, _amfSav, amfUsage: _amfUsage);
        int cw = _cropW, ch = _cropH;
        bool hasCrop = cw > 0 && ch > 0;
        if (hasCrop)
        {
            cw = Math.Max(cw, 320);
            ch = Math.Max(ch, 240);
            Log.I("FfmpegEncoder", $"crop={cw}:{ch}:{_cropX}:{_cropY} src={_width}x{_height}");
        }

        // Build -vf filter chain: optional crop + optional scale (user output resolution + cascading fallback)
        // O scale é relativo à resolução PÓS-crop — se um crop estiver ativo, o "nunca upscale"
        // e o divisor do fallback aplicam-se ao frame cortado, não ao frame cheio.
        var vfParts = new List<string>();
        if (hasCrop)
            vfParts.Add($"crop={cw}:{ch}:{_cropX}:{_cropY}");

        // O1: sem crop, o downscale acontece na conversão (GPU VideoProcessorBlt ou CPU
        // DownscaleBgra) — a NV12 já sai em Nv12W×Nv12H e o ffmpeg recebe rawvideo direto
        // na resolução final via -s, sem filtro scale. Com crop (código morto hoje), a NV12
        // sai nas dims da captura e o scale fica no vf sobre o frame cortado.
        var resolve = ResolveOutput(_width, _height, hasCrop ? cw : 0, hasCrop ? ch : 0,
            _outputWidth, _outputHeight, _scaleDivisor, _stretchToFit);
        _encodedW = resolve.EncodedW;
        _encodedH = resolve.EncodedH;
        _nv12W = resolve.Nv12W;
        _nv12H = resolve.Nv12H;
        if (resolve.ScaleW.HasValue && resolve.ScaleH.HasValue)
        {
            vfParts.Add($"scale={resolve.ScaleW}:{resolve.ScaleH}");
            int baseW = hasCrop ? cw : _width;
            int baseH = hasCrop ? ch : _height;
            Log.I("FfmpegEncoder", $"output scale: {baseW}x{baseH} → {resolve.ScaleW}:{resolve.ScaleH} (user={( _outputWidth > 0 ? $"{_outputWidth}x{_outputHeight}" : "native" )}, fallback=1/{_scaleDivisor})");
        }
        // D3D12VA só aceita frames no pixel format d3d12 — hwupload sobe o frame NV12
        // para o device D3D12 antes do encoder (mesmo padrão validado no probe).
        var isD3d12va = _codec?.EndsWith("_d3d12va", StringComparison.Ordinal) == true;
        if (isD3d12va)
            vfParts.Add("hwupload=extra_hw_frames=16,format=d3d12");
        // QSV precisa de -init_hw_device qsv para criar a sessão MFX — sem isso o ffmpeg 9
        // falha com "Error creating a MFX session: -9" mesmo em máquina Intel. O encoder
        // QSV faz o upload internamente (aceita frames NV12 de sistema), não usa hwupload.
        var isQsv = _codec?.EndsWith("_qsv", StringComparison.Ordinal) == true;
        var cropFilter = vfParts.Count > 0
            ? $" -vf \"{string.Join(",", vfParts)}\""
            : "";

        var rawFmt = GetRawFormatForCodec(_codec!);

        // For AV1, use IVF container (explicit frame boundaries with 12-byte headers).
        // Raw AV1 OBU data is not parseable by our AnnexB/AVCC detector.
        // H264/HEVC use raw format with bitstream filter for AnnexB output.
        string outputFmt = rawFmt == "av1" ? "ivf" : rawFmt;

        // Apply bitstream filter to ensure clean AnnexB output (start-code delimited)
        // instead of AVCC (4-byte length prefix). The AnnexB path in ReaderLoop is
        // more robust against pipe splits and arbitrary offsets than the AVCC parser.
        // AV1 IVF format doesn't need a bsf.
        string bsfArg = rawFmt == "av1" ? "" : $" -bsf:v {rawFmt}_mp4toannexb";
        // Note: if the bsf occasionally fails (known ffmpeg quirk with random frames),
        // the AVCC fallback in ReaderLoop handles misdetected data via the 512KB pending
        // guard + format re-detect at NalParsing:335-345.

        _process = new Process
        {
            StartInfo = FfmpegPathResolver.CreateFfmpegStartInfo(
                            args: $"-y -loglevel info " +
                            (isD3d12va ? "-init_hw_device d3d12va=hw=0 " : "") +
                            (isQsv ? "-init_hw_device qsv " : "") +
                            $"-f rawvideo -pix_fmt nv12 -s {_nv12W}x{_nv12H} " +
                            $"-r {_frameRate} -i pipe:0 " +
                            $"-colorspace bt709 -color_primaries bt709 -color_trc bt709 " +
                            $"{cropFilter} -c:v {_codec} {tune} " +
                            $"-f {outputFmt}{bsfArg} pipe:1",
                            redirectInput: true,
                            redirectOutput: true,
                            redirectError: true)
        };
        Log.I("FfmpegEncoder", $"ffmpeg args: {_process.StartInfo.Arguments}");

        _process.Start();

        try { _process.PriorityClass = ProcessPriorityClass.Normal; } catch { }

        _stdin = _process.StandardInput.BaseStream;
        _stdout = new BufferedStream(_process.StandardOutput.BaseStream, 2 * 1024 * 1024);

        var stderrStream = _process.StandardError;
        _stderrCts?.Dispose();
        _stderrCts = new CancellationTokenSource();
        var stCt = _stderrCts.Token;
        _stderrThread = new Thread(() =>
        {
            try
            {
                while (!stCt.IsCancellationRequested)
                {
                    var line = stderrStream.ReadLine();
                    if (line == null) break;
                    if (line.Length > 0)
                    {
                        RecordFfmpegProgress(line);
                        Log.D("ffmpeg", line);
                    }
                }
            }
            catch (OperationCanceledException) { }
            catch (IOException) { }
        })
        {
            IsBackground = true,
            Name = "FfmpegStderr"
        };
        _stderrThread.Start();

        // O3 (fase 1): thread dedicada para o stdin — a captura enfileira frames (nunca
        // bloqueia no pipe), o writer escreve em paralelo e enfileira o PTS só em sucesso.
        _frameWriter = new FrameWriter(
            () => _stdin,
            () => ComputeStdinWriteTimeout(_outputFrameIndex),
            OnFrameWrittenToStdin,
            OnStdinWriteFailed);
    }

    // ── Reader thread: H.264 output (moved to FfmpegEncoder.NalParsing.cs) ──

    // ── Encode frame ─────────────────────────────────────────────────

    internal enum StdinWriteResult { Ok, Timeout, Faulted }

    internal static StdinWriteResult TryWriteStdin(Stream stdin, byte[] data, int timeoutMs, out Exception? fault) =>
        TryWriteStdin(stdin, data, 0, data.Length, timeoutMs, out fault);

    /// <summary>
    /// Escreve dados no stdin do ffmpeg com timeout. Se o pipe encher (processo
    /// travado / CPU zero), retorna Timeout em vez de bloquear a thread de captura.
    /// A task em voo após o timeout é observada (só-faulted) para evitar unobserved
    /// task exception — o processo antigo será morto pelo restart.
    /// </summary>
    internal static StdinWriteResult TryWriteStdin(Stream stdin, byte[] data, int offset, int count, int timeoutMs, out Exception? fault)
    {
        fault = null;
        var writeTask = stdin.WriteAsync(data, offset, count);
        try
        {
            if (writeTask.Wait(TimeSpan.FromMilliseconds(timeoutMs)))
                return StdinWriteResult.Ok;
        }
        catch (AggregateException)
        {
            // Task.Wait(timeout) LANÇA AggregateException quando a task completa
            // com falha em vez de retornar true — trata como Faulted (teste
            // TryWriteStdin_FaultingStream_ReturnsFaultedWithException). Sem este
            // catch, a AggregateException escapava da EncodeFrame (o catch externo
            // só filtra IOException/ObjectDisposedException).
            if (writeTask.IsFaulted)
            {
                fault = writeTask.Exception?.GetBaseException();
                return StdinWriteResult.Faulted;
            }
            throw;
        }
        // A write pode falhar depois do timeout (ex.: restart dispõe o pipe).
        // Observa a task para evitar unobserved task exception; a falha é
        // irrelevante aqui porque o processo antigo será morto.
        _ = writeTask.ContinueWith(t => _ = t.Exception, TaskContinuationOptions.OnlyOnFaulted);
        return StdinWriteResult.Timeout;
    }

    /// <summary>
    /// Escolhe o timeout de escrita no stdin: warm-up (nenhum pacote emitido ainda)
    /// usa timeout generoso para o ffmpeg abrir o encoder HW; estado estável usa o
    /// timeout estrito de proteção contra travas. Um encoder que nunca emitiu pacote
    /// não pode ser considerado "travado" — só um que já provou funcionar.
    /// </summary>
    internal static int ComputeStdinWriteTimeout(long outputFrameIndex) =>
        outputFrameIndex == 0 ? StdinWriteWarmupTimeoutMs : StdinWriteTimeoutMs;

    /// <summary>
    /// Acessores dos drops por GPU busy (0x887A000A). O flag aponta se o ÚLTIMO frame
    /// caiu por busy (conversão NV12 no staging) — o pipeline usa para classificar o
    /// motivo do drop no log/status de forma honesta (busy ≠ encode error).
    /// </summary>
    public bool LastFrameBusyDrop => _lastFrameBusyDrop;

    public int GpuBusyDrops => Volatile.Read(ref _gpuBusyDrops);

    /// <summary>
    /// Reason do drop no pipeline: distingue busy transiente (retry no próximo frame)
    /// de falha real de encode. Chamado pelo EngineCoordinator quando EncodeFrame
    /// retorna null.
    /// </summary>
    internal static string BuildEncodeDropReason(bool isBusy) =>
        isBusy
            ? "GPU busy (0x887A000A) — frame dropped, retry next frame."
            : "Encoder não produziu frame (encode error).";

    public EncodedPacket? EncodeFrame(ID3D11Texture2D texture, TimeSpan pts)
    {
        if (!_initialized) throw new InvalidOperationException("not initialized");
        if (_disposed) return null;

        _lastFrameBusyDrop = false;

        if (_processFailed && !TryRestart())
            return null;

        // O3 (fase 1): NV12 pooled POR FRAME — o scratch único `_nv12Scratch` não serve:
        // o writer thread pode ainda estar escrevendo o frame anterior quando a captura
        // produz este. O buffer é devolvido ao pool pelo writer após a escrita/drop.
        var nv12Buf = VideoPacketPool.Rent(Nv12OutputSize);
        byte[]? nv12;
        try
        {
            nv12 = ConvertGpuNv12(texture, nv12Buf);
        }
        catch
        {
            VideoPacketPool.Return(nv12Buf);
            throw;
        }

        if (nv12 == null)
        {
            VideoPacketPool.Return(nv12Buf);
            return null;
        }

        // Enfileira no writer (nunca bloqueia). Fila cheia → drop-oldest do frame mais
        // antigo enfileirado + buffer devolvido; "agora" vence, como no replay buffer.
        // Timeout/Fault do pipe são reportados via OnStdinWriteFailed (mesmos causes do
        // caminho síncrono) e o restart continua acontecer no próximo EncodeFrame.
        var writer = _frameWriter;
        if (writer == null || !writer.TryEnqueue(nv12Buf, pts))
        {
            VideoPacketPool.Return(nv12Buf);
            return null;
        }

        while (_outputChannel.Reader.TryRead(out var pkt))
        {
            if (_pendingOutputs.Count < 32)
                _pendingOutputs.Enqueue(pkt);
            else
                pkt.Release();
        }

        if (_pendingOutputs.Count > 0)
            return _pendingOutputs.Dequeue();
        if (!_processFailed)
        {
            if (_frameCount % 300 == 1)
            {
                bool exited = _process?.HasExited == true;
                string exitInfo = exited ? $" exited={_process!.ExitCode}" : "";
                int first4 = _pendingBuf != null && _pendingLen >= 4 ? (_pendingBuf[0] << 24) | (_pendingBuf[1] << 16) | (_pendingBuf[2] << 8) | _pendingBuf[3] : 0;
                string noOutputMsg = $"no output packets after {_frameCount} frames written — ffmpeg exited={exited}{exitInfo}, pendingBytes={_pendingLen}, hadSlice={_hadSlice}, frameIndex={_outputFrameIndex}, pendingFirst4=0x{first4:X8}";
                if (_frameCount == 1)
                    Log.D("FfmpegEncoder", noOutputMsg); // cold-start: encoder ainda aquecendo, normal
                else
                    Log.W("FfmpegEncoder", noOutputMsg); // stall real: nenhum pacote após N frames
            }
        }
        return null;
    }

    /// <summary>Tamanho exato do buffer NV12 emitido (Y + UV) — usado para rent no pool.</summary>
    private int Nv12OutputSize => Nv12H * Nv12W + (Nv12H / 2) * Nv12W;

    /// <summary>Frames descartados por overflow da fila de entrada do writer (drop-oldest).</summary>
    public int InputQueueDroppedFrames => _frameWriter?.DroppedOverflow ?? 0;

    /// <summary>Frames atualmente enfileirados no writer (aguardando escrita no stdin).</summary>
    public int QueueDepth => _frameWriter?.QueuedCount ?? 0;

    // ── O3 callbacks do FrameWriter (rodam na thread FfmpegInput) ──────────

    private void OnFrameWrittenToStdin(TimeSpan pts)
    {
        // Só enfileira o PTS depois que o Write foi bem-sucedido — se falhar, o
        // EmitPacket() nunca desenfileiraria e o PTS ficaria órfão (sync corrompido).
        _inputPtsQueue.Enqueue(pts);
        _frameCount++;
        _restartAttempts = 0;
    }

    private void OnStdinWriteFailed(string cause, Exception? fault)
    {
        _processFailed = true;
        _processFailedCause = cause;
        if (fault != null)
            Log.E("FfmpegEncoder", $"stdin: {fault.Message}");
        else if (cause == "encoder:stdin_timeout")
            Log.W("FfmpegEncoder", "stdin write timeout — encoder não consome input, restartando");
        LogProcessExit();
    }

    // ── Codec fallback chain ─────────────────────────────────────────

    private bool TryFallbackCodec()
    {
        if (_fallbackChain == null || _fallbackChain.Count == 0) return false;

        // Move to next entry in the chain
        _currentFallbackIndex++;
        if (_currentFallbackIndex >= _fallbackChain.Count)
        {
            Log.E("FfmpegEncoder", "cascading fallback exhausted — no more entries in chain");
            return false;
        }

        var entry = _fallbackChain[_currentFallbackIndex];
        var oldCodec = _codec;
        _codec = entry.Codec;
        _scaleDivisor = entry.ScaleDivisor;
        _restartAttempts = 0;
        _restartsInWindow = 0;

        Log.W("FfmpegEncoder", $"cascading fallback: {oldCodec} (1/{(_scaleDivisor > 1 ? _scaleDivisor.ToString() : "full")}) → {entry.Label}");
        return true;
    }

    // ── Watchdog: auto-restart on crash ──────────────────────────────

    private bool TryRestart()
    {
        if (_disposed) return false;

        long now = Stopwatch.GetTimestamp();

        // Absolute restart limiter: max 10 restarts in 30-second window
        const int MaxRestartsInWindow = 10;
        const int WindowDurationSec = 30;
        if (_restartsInWindow == 0)
            _restartWindowStartTicks = now;
        double windowElapsedSec = (now - _restartWindowStartTicks) / Stopwatch.Frequency;
        if (windowElapsedSec > WindowDurationSec)
        {
            _restartsInWindow = 0;
            _restartWindowStartTicks = now;
        }
        if (_restartsInWindow >= MaxRestartsInWindow)
        {
            if (!TryFallbackCodec())
            {
                Log.E("FfmpegEncoder", $"max restarts in {WindowDurationSec}s window reached ({MaxRestartsInWindow}), no codec fallback");
                return false;
            }
        }

        long elapsedSec = (now - _lastRestartTicks) / Stopwatch.Frequency;
        int delaySec = 1 << Math.Min(_restartAttempts, 4);

        if (_restartAttempts > 0 && elapsedSec < delaySec)
        {
            // M1: descarte o pacote mais antigo SEM vazar o byte[] do pool
            if (_outputChannel.Reader.TryRead(out var backoffPkt))
                backoffPkt.Release();
            return false;
        }

        if (_restartAttempts >= 5)
        {
            if (!TryFallbackCodec())
            {
                Log.E("FfmpegEncoder", "max restart attempts reached, no codec fallback");
                return false;
            }
        }

        _restartAttempts++;
        _restartsInWindow++;
        Log.W("FfmpegEncoder", $"restarting ffmpeg (attempt {_restartAttempts}, window={_restartsInWindow}/{MaxRestartsInWindow}, cause={_processFailedCause ?? "unknown"}, gpuFails={_gpuConvertFails})");
        return RestartFfmpegProcess();
    }

    private void StopFfmpeg()
    {
        // O3: aborta o writer do stdin (frames enfileirados voltam ao pool sem escrita —
        // o pipe está morrendo; nenhum PTS órfão para o processo antigo).
        _frameWriter?.Stop(abort: true, joinMs: 2000);
        _frameWriter = null;
        _readerCts?.Cancel();
        _stderrCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }
        try { _stdout?.Dispose(); } catch { }

        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }

        _readerThread?.Join(1000);
        _stderrThread?.Join(500);
        _readerCts?.Dispose();
        _stderrCts?.Dispose();
        _process?.Dispose();
        _readerCts = null;
        _stderrCts = null;
        _readerThread = null;
        _stderrThread = null;
        _process = null;
        _stdin = null;
        _stdout = null;
    }

    private void ResetState()
    {
        _processFailed = false;
        _processFailedCause = null;
        _gpuConvertFails = 0;
        _gpuBusyDrops = 0;
        _lastFrameBusyDrop = false;
        _frameCount = 0;
        _outputFrameIndex = 0;
        _lastRealPtsTicks = -1;
        _hadSlice = false;
        _hadRawSlice = false;
        _pendingTooLarge = false;
        _loggedParseAvcc = false;
        _pipeFormat = PipeFormat.Unknown;
        if (_pendingBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = null;
        }
        // Return raw buffer if rented to avoid ArrayPool leaks
        if (_rawBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_rawBuf);
            _rawBuf = null;
            _rawLen = 0;
        }
        _pendingLen = 0;
        while (_pendingOutputs.Count > 0)
            _pendingOutputs.Dequeue().Release();

        while (_inputPtsQueue.TryDequeue(out _)) { }

        while (_outputChannel.Reader.TryRead(out var pkt))
            pkt.Release();

        // Fresh GPU converter after each restart to avoid stale MFT state
        _gpuConverter?.Dispose();
        _gpuConverter = null;
        _gpuConverterFailedUntil = DateTime.MinValue;
        _nv12Staging?.Dispose();
        _nv12Staging = null;
        _inputCopy?.Dispose();
        _inputCopy = null;
        _cpuStaging?.Dispose();
        _cpuStaging = null;
        _cpuStagingW = 0;
        _cpuStagingH = 0;
        _ivfHeaderParsed = false;
        _ivfTimebaseDen = 0;
        _ivfTimebaseNum = 0;
    }

    // ── GPU NV12 conversion (moved to FfmpegEncoder.GpuConvert.cs) ──

    // ── Cleanup ──────────────────────────────────────────────────────

    private void LogProcessExit()
    {
        if (_process == null) return;
        try
        {
            if (_process.HasExited)
                Log.W("FfmpegEncoder", $"ffmpeg exited code={_process.ExitCode}");
        }
        catch { }
    }

    public void Flush()
    {
        // L2: não reiniciar ffmpeg se o encoder já foi encerrado (stop/dispose) ou
        // se o processo nunca chegou a iniciar. Respawning após dispose criaria um
        // processo órfão sem dono. Os pacotes ainda pendentes no channel são drenados
        // para _pendingOutputs (consumido pelo save), independente do estado do processo.
        bool canRestart = !_disposed && _process != null;

        // O3: drena os frames ainda enfileirados no writer ANTES de fechar o stdin —
        // frames pendentes do clip não podem ser perdidos no EOF.
        _frameWriter?.Stop(abort: false, joinMs: 5000);

        // Close stdin to signal EOF to ffmpeg (like the working PowerShell test)
        try { _stdin?.Dispose(); } catch { }

        // Wait for reader thread to finish (ffmpeg will close stdout after EOF on stdin)
        if (_readerThread?.IsAlive == true)
            _readerThread.Join(5000);

        // Emit any remaining packet
        if (_pendingLen > 0 && _hadSlice)
            EmitPacket();

        // Collect remaining packets from the channel
        while (_outputChannel.Reader.TryRead(out var pkt))
            _pendingOutputs.Enqueue(pkt);

        if (!canRestart)
            return;

        // Restart ffmpeg for next capture session
        StopFfmpeg();
        ResetState();
        StartFfmpeg();
        _readerCts = new CancellationTokenSource();
        _readerThread = new Thread(() => ReaderLoop(_readerCts.Token))
        {
            IsBackground = true,
            Name = "FfmpegReader"
        };
        _readerThread.Start();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _frameWriter?.Stop(abort: true, joinMs: 1000);
        _frameWriter = null;
        _readerCts?.Cancel();
        _stderrCts?.Cancel();
        try { _stdin?.Dispose(); } catch { }

        if (_process is { HasExited: false })
        {
            try { _process.Kill(entireProcessTree: true); } catch { }
            _process.WaitForExit(2000);
        }

        _readerThread?.Join(1000);
        _stderrThread?.Join(500);
        _readerCts?.Dispose();
        _stderrCts?.Dispose();
        _process?.Dispose();
        _gpuConverter?.Dispose();
        _nv12Staging?.Dispose();
        _inputCopy?.Dispose();
        _cpuStaging?.Dispose();

        // Release pooled buffers and packets to prevent ArrayPool leaks
        if (_pendingBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_pendingBuf);
            _pendingBuf = null;
        }
        if (_rawBuf != null)
        {
            ArrayPool<byte>.Shared.Return(_rawBuf);
            _rawBuf = null;
        }
        _pendingLen = 0;
        _rawLen = 0;

        while (_pendingOutputs.Count > 0)
            _pendingOutputs.Dequeue().Release();

        while (_inputPtsQueue.TryDequeue(out _)) { }

        while (_outputChannel.Reader.TryRead(out var pkt))
            pkt.Release();
    }
}
