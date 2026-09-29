/**
 * Args de re-encode para o editor de clipes (trim/merge).
 *
 * O editor vinha com `libx264` hardcoded: quem tem GPU-capable gastava CPU para editar um
 * clipe que já tinha saído de um encoder de hardware. Este módulo monta os args a partir do
 * codec efetivo que o engine reportou.
 *
 * A diferença entre as famílias não é cosmética — mandar `-crf` para nvenc/qsv/amf não
 * falha, é *ignorado com warning*, que significa CQ sem efeito nenhum e a ilusão de que a
 * qualidade está sendo controlada. Por isso o rate control é escolhido por família.
 */

const SW_ENCODERS = new Set(['libx264', 'libx265', 'libsvtav1'])
const NVENC_ENCODERS = new Set(['h264_nvenc', 'hevc_nvenc', 'av1_nvenc'])
const QSV_ENCODERS = new Set(['h264_qsv', 'hevc_qsv', 'av1_qsv'])
const AMF_ENCODERS = new Set(['h264_amf', 'hevc_amf', 'av1_amf'])
const D3D12VA_ENCODERS = new Set(['h264_d3d12va', 'hevc_d3d12va', 'av1_d3d12va'])

/**
 * Como pedir "rápido" em cada encoder de software. A flag **não é a mesma**, e isso foi
 * medido no binário embarcado (ffmpeg 9.0.2), não de memória:
 *
 * | encoder   | flag da velocidade                 | `-preset veryfast`                    |
 * |-----------|------------------------------------|---------------------------------------|
 * | libx264   | `-preset <string>` (tem nome)      | vale (comportamento antigo, travado em teste) |
 * | libx265   | `-preset <string>` (tem nome)      | vale                                  |
 * | libsvtav1 | `-preset <int>` 0..13, **sem nome** | **rejeita**: "Undefined constant or missing '(' in 'veryfast'" → exit -22 |
 *
 * O SVT é a mesma classe do `-rc vbr_peak` (Item 8): nome que pertence a outra família,
 * com falha no primeiro uso real (GPU sem AV1 por hardware cai em `libsvtav1` — ver
 * `EncoderManager.cs:282-283`), longe do CI.
 */

/** 8 = banda "rápido" do SVT (7..9), o equivalente do `-preset fast` do x264. Testado no binário. */
const SVT_FAST_PRESET = '8'

/** Emite a flag de velocidade do encoder de software. Não emite nada que ele não tenha. */
function pushSoftwareSpeedArgs(args: string[], codec: string): void {
  if (codec === 'libsvtav1') {
    args.push('-preset', SVT_FAST_PRESET)
    return
  }
  // x264/x265: `veryfast` é o padrão de CPU do repo — aqui o preset é sobre responsiveness
  // do editor, não sobre bitrate final.
  args.push('-preset', 'veryfast')
}

const KNOWN_ENCODERS = new Set([
  ...SW_ENCODERS,
  ...NVENC_ENCODERS,
  ...QSV_ENCODERS,
  ...AMF_ENCODERS,
  ...D3D12VA_ENCODERS,
])

/**
 * Codec aceito sem questionar. Qualquer outra coisa é lixo e cai no software.
 *
 * Saiam daqui, por medição e não por gosto (ver AGENTS.md, follow-up do Item 10):
 * `libaom-av1`, `h264_v4l2m2m` e `hevc_v4l2m2m`. Os três **não têm produtor no engine C#**
 * (o mapeamento real é EncoderManager.cs:282-283, que cai em `libsvtav1`) **e não estão no
 * manifest do ffmpeg** (`scripts/ffmpeg-requirements.json`), ou seja nem sequer são
 * garantidos no binário embarcado. Prometer um encoder que o build talvez não traga é a
 * mesma armadilha do Item 10.
 *
 * O que medi antes de remover, para não chutar:
 * - `libaom-av1` **não tem `-preset`** (a opção é `-cpu-used` 0..8): o `-preset veryfast`
 *   era aceito e **descartado em silêncio** — aceita até lixo com exit 0, ou seja um no-op
 *   que fingia valer. E ele **recusa VBV em modo CRF** ("Rate control parameters set
 *   without a bitrate" → exit -22), ao contrário do SVT, que aceita ("capped CRF").
 *   Corrigir isso exigiria duas exceções para um encoder inalcançável.
 * - `*_v4l2m2m` estava em `AMF_ENCODERS`, ou seja receberia `-quality`/`-rc cqp`/`-qp_i` de
 *   AMF — que um encoder V4L2 M2M não entende. Além disso `v4l2m2m` nem existe em build
 *   Windows.
 *
 * Se algum dia o engine passar a produzir um deles, o lugar certo é este allowlist **e** o
 * manifest, e a chain do editor precisa ser medida no binário antes (a lição do `-preset`).
 */
function isKnownEncoder(codec: string): boolean {
  return KNOWN_ENCODERS.has(codec)
}

/**
 * Decide o encoder do editor a partir do codec que o engine usou.
 *
 * O status do engine é uma *string*: ela vem do processo, de um arquivo de status em disco e
 * de um cache. Passar qualquer valor dela direto para o ffmpeg transformaria um valor
 * corrompido em argumento de linha de comando, então a validação é allowlist — e o
 * fallback (libx264) é exatamente o comportamento de antes, que é seguro.
 */
export function resolveTrimCodec(engineCodec: string | null | undefined): string {
  const normalized = typeof engineCodec === 'string' ? engineCodec.trim().toLowerCase() : ''
  return isKnownEncoder(normalized) ? normalized : 'libx264'
}

export interface ReEncodeParams {
  codec: string
  cq: number
  maxrateKbps: number
  bufsizeKbps: number
  vfChain?: string | null
}

export function buildReEncodeArgs(p: ReEncodeParams): string[] {
  const { maxrateKbps, bufsizeKbps, vfChain } = p
  // A mesma allowlist (e a mesma normalização) do resolveTrimCodec, pelo mesmo motivo: em
  // produção o valor já vem validado daqui, mas esta função é exportada e um codec de lixo
  // não pode virar argumento de linha de comando — nem receber os args de outra família.
  // Fallback = libx264, que é o comportamento antigo e é seguro. Sem isto, o NVENC era o
  // `else` e qualquer string desconhecida recebia `-rc vbr -b:v 0 -cq` em silêncio.
  const normalized = typeof p.codec === 'string' ? p.codec.trim().toLowerCase() : ''
  const codec = isKnownEncoder(normalized) ? normalized : 'libx264'
  const cq = p.cq
  const args = ['-c:v', codec]

  if (SW_ENCODERS.has(codec)) {
    // x264/x265: CRF é a taxa constante e o VBV limita os picos. veryfast é o padrão de CPU
    // do repo — o preset aqui é sobre responsiveness do editor, não sobre bitrate final.
    pushSoftwareSpeedArgs(args, codec)
    args.push('-crf', String(cq))
  } else if (QSV_ENCODERS.has(codec)) {
    // O global_quality do QSV vive numa escala própria, não na do CRF: por isso a captura
    // converte com cq - 4 (FfmpegEncoder.cs:284) e o editor repete o deslocamento. Sem ele,
    // um clipe gravado em CQ 20 voltaria do trim com global_quality 20 = outra qualidade.
    args.push('-preset', 'veryfast', '-global_quality', String(qsvQuality(cq)))
  } else if (AMF_ENCODERS.has(codec)) {
    // O AMF não tem CRF nem global_quality: o caminho é QP, e o QP só é lido em `-rc cqp`.
    // O default do wrapper AMF é vbr_peak, onde qp_i/qp_p é descartado em silêncio — o
    // ffmpeg não avisa e o CQ do usuário deixa de valer. `-rc cqp` é o que amarra os dois.
    // A captura usa vbr_peak + b:v porque lá o alvo é taxa; aqui o alvo é o CQ escolhido,
    // então este é um desvio deliberado da chain, não um esquecimento.
    args.push('-quality', 'balanced', '-rc', 'cqp', '-qp_i', String(cq), '-qp_p', String(cq))
  } else if (D3D12VA_ENCODERS.has(codec)) {
    // d3d12va não é nvenc com outro nome: o QP vai em `-qp` e o modo em `-rc` (índice, como a
    // captura em FfmpegEncoder.cs:335-337). `-cq` não existe nesse encoder, e `-b:v 0` não faria
    // sentido sem o par de dois-pass. NÃO VERIFICADO se o índice 1 é CQP: o d3d12va não expõe o
    // nome das constantes e não há hardware para sondar; índice numérico não é validado pelo
    // ffmpeg, então o modo errado só apareceria como CQ sem efeito. Ver AGENTS.md.
    args.push('-rc', '1', '-qp', String(d3d12Qp(cq)))
  } else if (NVENC_ENCODERS.has(codec)) {
    // NVENC: o CQ é pré-passe de taxa constante. `-b:v 0` + `-rc vbr` é o caminho medido na
    // captura (`-rc vbr -b:v 0 -cq {cq}`): sem o -b:v 0 o NVENC entra em dois-pass e o b:v
    // passa a ser o alvo, não o teto.
    //
    // O valor do -rc tem de ser o NOME aceito por aquele encoder, nunca o índice nem o nome de
    // outra família: o -rc do nvenc só tem constqp|vbr|cbr (ffmpeg 9.0.2, binário embarcado) e
    // recusou `vbr_peak` com "Unable to parse rc option value vbr_peak" — `vbr_peak` é
    // constante de AMF/D3D12VA. Pior: índice numérico não é validado (o nvenc aceitou
    // `-rc 999` em silêncio), então errar o número só apareceria como CQ sem efeito.
    args.push('-rc', 'vbr', '-b:v', '0', '-cq', String(cq))
  }
  // Nenhuma família casa aqui: só se o codec for normalizado para algo conhecido acima, já
  // que o fallback de codec desconhecido é libx264 (primeiro ramo).

  // O VBV é comum a todas as famílias, e é o que segura o pico de bitrate do editor.
  args.push('-maxrate', `${maxrateKbps}K`, '-bufsize', `${bufsizeKbps}K`)
  if (vfChain) args.push('-vf', vfChain)
  args.push('-c:a', 'copy')
  return args
}

/** Mesma conversão e mesmo clamp da captura: `FfmpegEncoder.cs:284`. */
function qsvQuality(cq: number): number {
  return Math.min(Math.max(Math.trunc(cq) - 4, 0), 51)
}

/** Mesma conversão e mesmo clamp da captura: `FfmpegEncoder.cs:335` (`Math.Clamp(cq, 0, 52)`). */
function d3d12Qp(cq: number): number {
  return Math.min(Math.max(Math.trunc(cq), 0), 52)
}
