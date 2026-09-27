import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { checkRequirements, formatReport, main, parseArgs, parseComponentList } = require('./verify-ffmpeg.js')
const MANIFEST = require('./ffmpeg-requirements.json')

const ENCODERS_GYAN_9_0_1 = [
  'Encoders:',
  ' V..... = Video',
  ' A..... = Audio',
  ' S..... = Subtitle',
  ' .F.... = Frame-level multithreading',
  ' ...X.. = Codec is experimental',
  ' ------',
  ' V..... libsvtav1            SVT-AV1(Scalable Video Technology for AV1) encoder (codec av1)',
  ' V....D av1_d3d12va          D3D12VA av1 encoder (codec av1)',
  ' V....D av1_nvenc            NVIDIA NVENC av1 encoder (codec av1)',
  ' V..... av1_qsv              AV1 (Intel Quick Sync Video acceleration) (codec av1)',
  ' V....D av1_amf              AMD AMF AV1 encoder (codec av1)',
  ' V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC (codec h264)',
  ' V....D h264_amf             AMD AMF H.264 Encoder (codec h264)',
  ' V....D h264_d3d12va         D3D12VA h264 encoder (codec h264)',
  ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)',
  ' V..... h264_qsv             H.264 / AVC (Intel Quick Sync Video acceleration) (codec h264)',
  ' V....D libx265              libx265 H.265 / HEVC (codec hevc)',
  ' V....D hevc_amf             AMD AMF HEVC encoder (codec hevc)',
  ' V....D hevc_d3d12va         D3D12VA hevc encoder (codec hevc)',
  ' V....D hevc_nvenc           NVIDIA NVENC HEVC encoder (codec hevc)',
  ' V..... hevc_qsv             HEVC (Intel Quick Sync Video acceleration) (codec hevc)',
  'VFS..D mjpeg                MJPEG (Motion JPEG)',
  ' A....D aac                  AAC (Advanced Audio Coding)',
].join('\n')

const DECODERS_GYAN_9_0_1 = [
  'Decoders:',
  ' V..... = Video',
  ' A..... = Audio',
  ' ------',
  ' VFS..D h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10',
  ' VFS..D hevc                 HEVC (High Efficiency Video Coding)',
  ' V....D av1                  Alliance for Open Media AV1',
  ' V..... rawvideo             raw video',
  ' A....D aac                  AAC (Advanced Audio Coding)',
  ' A....D pcm_f32le            PCM 32-bit floating point little-endian',
].join('\n')

const MUXERS_GYAN_9_0_1 = [
  'Formats:',
  ' D.. = Demuxing supported',
  ' .E. = Muxing supported',
  ' ..d = Is a device',
  ' ---',
  '  E  adts            ADTS AAC (Advanced Audio Coding)',
  '  E  f32le           PCM 32-bit floating-point little-endian',
  '  E  h264            raw H.264 video',
  '  E  hevc            raw HEVC video',
  '  E  image2          image2 sequence',
  '  E  ivf             On2 IVF',
  '  E  matroska        Matroska',
  '  E  mp4             MP4 (MPEG-4 Part 14)',
].join('\n')

const DEMUXERS_GYAN_9_0_1 = [
  'Formats:',
  ' D.. = Demuxing supported',
  ' .E. = Muxing supported',
  ' ---',
  ' D   aac             raw ADTS AAC (Advanced Audio Coding)',
  ' D   concat          Virtual concatenation script',
  ' D   f32le           PCM 32-bit floating-point little-endian',
  ' D   image2          image2 sequence',
  ' D   rawvideo        raw video',
  ' D   matroska,webm   Matroska / WebM',
  ' D   mov,mp4,m4a,3gp,3g2,mj2 QuickTime / MOV',
].join('\n')

const FILTERS_GYAN_9_0_1 = [
  'Filters:',
  '  T.. = Timeline support',
  '  .S. = Slice threading',
  '  A = Audio input/output',
  '  V = Video input/output',
  '  | = Source or sink filter',
  '  ------',
  ' TS afftdn            A->A       Denoise audio samples using FFT.',
  ' TS anlmdn            A->A       Reduce broadband noise from stream using Non-Local Means.',
  ' TS arnndn            A->A       Reduce noise from speech using Recurrent Neural Networks.',
  ' TS cas               V->V       Contrast Adaptive Sharpen.',
  ' .. crop              V->V       Crop the input video.',
  ' .. format            V->V       Convert the input video to one of the specified pixel formats.',
  ' .. hwupload          V->V       Upload a normal frame to a hardware frame',
  ' .. scale             V->V       Scale the input video size and/or convert the image format.',
  ' .. sr_amf            V->V       AMF HQ video upscaling',
  ' .. frc_amf           V->V       AMF video Frame Rate Converter',
].join('\n')

const BSFS_GYAN_9_0_1 = ['Bitstream filters:', 'aac_adtstoasc', 'h264_mp4toannexb', 'hevc_mp4toannexb'].join('\n')

const PROTOCOLS_GYAN_9_0_1 = [
  'Supported file protocols:',
  'Input:',
  '  concat',
  '  file',
  '  pipe',
  'Output:',
  '  file',
  '  pipe',
].join('\n')

function availableAll() {
  return {
    encoders: parseComponentList(ENCODERS_GYAN_9_0_1, 'flags'),
    decoders: parseComponentList(DECODERS_GYAN_9_0_1, 'flags'),
    muxers: parseComponentList(MUXERS_GYAN_9_0_1, 'flags'),
    demuxers: parseComponentList(DEMUXERS_GYAN_9_0_1, 'flags'),
    filters: parseComponentList(FILTERS_GYAN_9_0_1, 'arrow'),
    bsfs: parseComponentList(BSFS_GYAN_9_0_1, 'bare'),
    protocols: parseComponentList(PROTOCOLS_GYAN_9_0_1, 'bare'),
  }
}

describe('parseComponentList', () => {
  it('extrai encoders/decoders da coluna de flags e ignora a legenda', () => {
    const found = parseComponentList(ENCODERS_GYAN_9_0_1, 'flags')

    expect(found.has('h264_nvenc')).toBe(true)
    expect(found.has('libsvtav1')).toBe(true)
    expect(found.has('aac')).toBe(true)
    expect(found.has('mjpeg')).toBe(true)
    expect(found.has('V')).toBe(false)
    expect(found.has('Encoders')).toBe(false)
    expect(found.has('=')).toBe(false)
    expect(found.has('------')).toBe(false)
  })

  it('extrai muxers/demuxers do formato de 2 flags', () => {
    const muxers = parseComponentList(MUXERS_GYAN_9_0_1, 'flags')
    const demuxers = parseComponentList(DEMUXERS_GYAN_9_0_1, 'flags')

    expect(muxers.has('ivf')).toBe(true)
    expect(muxers.has('f32le')).toBe(true)
    expect(muxers.has('Demuxing')).toBe(false)
    expect(demuxers.has('rawvideo')).toBe(true)
    expect(demuxers.has('Demuxing')).toBe(false)
  })

  it('desdobra familia de nomes separada por virgula', () => {
    const demuxers = parseComponentList(DEMUXERS_GYAN_9_0_1, 'flags')

    expect(demuxers.has('mov')).toBe(true)
    expect(demuxers.has('mp4')).toBe(true)
    expect(demuxers.has('mj2')).toBe(true)
    expect(demuxers.has('matroska')).toBe(true)
    expect(demuxers.has('webm')).toBe(true)
    expect(demuxers.has('mov,mp4,m4a,3gp,3g2,mj2')).toBe(false)
  })

  it('extrai filtros pela coluna in->out e ignora a legenda', () => {
    const found = parseComponentList(FILTERS_GYAN_9_0_1, 'arrow')

    expect(found.has('crop')).toBe(true)
    expect(found.has('hwupload')).toBe(true)
    expect(found.has('frc_amf')).toBe(true)
    expect(found.has('Timeline')).toBe(false)
    expect(found.has('|')).toBe(false)
  })

  it('extrai listas de nome unico (bsfs/protocols) e ignora cabecalhos', () => {
    const bsfs = parseComponentList(BSFS_GYAN_9_0_1, 'bare')
    const protocols = parseComponentList(PROTOCOLS_GYAN_9_0_1, 'bare')

    expect([...bsfs].sort()).toEqual(['aac_adtstoasc', 'h264_mp4toannexb', 'hevc_mp4toannexb'])
    expect(protocols.has('file')).toBe(true)
    expect(protocols.has('pipe')).toBe(true)
    expect(protocols.has('Bitstream')).toBe(false)
    expect(protocols.has('Input')).toBe(false)
  })

  it('tolera CRLF do ffmpeg.exe no Windows', () => {
    const found = parseComponentList(ENCODERS_GYAN_9_0_1.replace(/\n/g, '\r\n'), 'flags')

    expect(found.has('h264_nvenc')).toBe(true)
    expect(found.has('h264_nvenc\r')).toBe(false)
  })

  it('devolve conjunto vazio sem lancar em saida truncada ou vazia', () => {
    expect(parseComponentList('', 'flags').size).toBe(0)
    expect(parseComponentList('Encoders:\n V.....', 'flags').size).toBe(0)
    expect(parseComponentList(undefined, 'arrow').size).toBe(0)
  })

  it('nao duplica nomes repetidos', () => {
    const found = parseComponentList(PROTOCOLS_GYAN_9_0_1, 'bare')

    expect([...found].filter((name) => name === 'file')).toHaveLength(1)
  })
})

describe('checkRequirements', () => {
  it('aprova quando o binario tem tudo que o manifest exige', () => {
    const result = checkRequirements(MANIFEST, availableAll())

    expect(result.ok).toBe(true)
    expect(result.missing).toEqual([])
    expect(result.checked).toBeGreaterThan(0)
  })

  it('reporta o que falta por categoria e reprova', () => {
    const available = availableAll()
    available.encoders.delete('h264_amf')
    available.filters.delete('hwupload')
    available.protocols.delete('file')

    const result = checkRequirements(MANIFEST, available)

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([
      { category: 'encoders', names: ['h264_amf'] },
      { category: 'filters', names: ['hwupload'] },
      { category: 'protocols', names: ['file'] },
    ])
  })

  it('aceita familia de nomes: exigir mov e mp4 e satisfeito por mov,mp4,m4a', () => {
    const result = checkRequirements(
      { demuxers: ['mov', 'mp4', 'm4a'] },
      { demuxers: parseComponentList(DEMUXERS_GYAN_9_0_1, 'flags') },
    )

    expect(result.ok).toBe(true)
    expect(result.checked).toBe(3)
  })

  it('trata lista vazia de componentes disponiveis como tudo faltando', () => {
    const result = checkRequirements(MANIFEST, {})

    expect(result.ok).toBe(false)
    expect(result.missing.map((entry) => entry.category)).toEqual([
      'encoders',
      'decoders',
      'muxers',
      'demuxers',
      'filters',
      'bsfs',
      'protocols',
    ])
    expect(result.missing.every((entry) => entry.names.length > 0)).toBe(true)
  })

  it('ignora categoria que o manifest nao exige', () => {
    const result = checkRequirements({ encoders: ['libx264'] }, { encoders: new Set(['libx264']) })

    expect(result.ok).toBe(true)
    expect(result.checked).toBe(1)
  })
})

describe('parseArgs', () => {
  it('rejeita --ffmpeg sem valor em vez de sondar o ffmpeg do PATH', () => {
    // Este é o gate que decide se o build/entrega é aceito, e o valor de `--ffmpeg` é
    // *qual binário* está sendo julgado. Com `argv[index + 1] ?? options.ffmpeg`, um
    // `--ffmpeg` sem valor (flag esquecida, ou colada de outra linha) caía silenciosamente
    // no default `ffmpeg.exe`, que o `probeAvailable` resolve pelo PATH: o gate rodava
    // inteiro, dizia "51/51 OK", e o veredito era sobre **outro** build — exatamente o
    // ffmpeg custom que o `copy-engine.js` prioriza, que é o que costuma faltar componente.
    expect(() => parseArgs(['--ffmpeg'])).toThrow(/--ffmpeg/)
  })

  it('rejeita --ffmpeg seguido de outra flag (valor faltando, nao um caminho)', () => {
    expect(() => parseArgs(['--ffmpeg', '--manifest', 'x.json'])).toThrow(/--ffmpeg/)
  })

  it('aceita a forma --ffmpeg=path, que antes era ignorada em silencio', () => {
    expect(parseArgs(['--ffmpeg=C:\\tools\\ffmpeg.exe']).ffmpeg).toBe('C:\\tools\\ffmpeg.exe')
  })

  it('mantem o default e aceita a forma com espaco', () => {
    expect(parseArgs([]).ffmpeg).toBe('ffmpeg.exe')
    expect(parseArgs(['--ffmpeg', 'x.exe']).ffmpeg).toBe('x.exe')
  })

  it('rejeita --manifest sem valor pelo mesmo motivo', () => {
    expect(() => parseArgs(['--manifest'])).toThrow(/--manifest/)
  })
})

describe('main', () => {
  it('falha com codigo 2 e sem sondar nada quando o binario nao foi informado', () => {
    // Um throw de `parseArgs` que escapa de `main` viraria stack trace e exit 1, o que
    // parece falha do ffmpeg em vez de erro de uso do gate.
    const stderr: string[] = []
    const origWrite = process.stderr.write
    process.stderr.write = ((chunk: string) => {
      stderr.push(String(chunk))
      return true
    }) as typeof process.stderr.write
    let code: number | undefined
    try {
      code = main(['--ffmpeg'])
    } finally {
      process.stderr.write = origWrite
    }
    expect(code).toBe(2)
    expect(stderr.join('')).toMatch(/--ffmpeg/)
  })
})

describe('formatReport', () => {
  it('nao afirma sucesso quando falta componente', () => {
    const available = availableAll()
    available.protocols.delete('file')
    const report = formatReport('ffmpeg.exe', checkRequirements(MANIFEST, available))

    expect(report).toContain('file')
    expect(report.toLowerCase()).toContain('missing')
  })

  it('reporta sucesso com o total conferido', () => {
    const report = formatReport('ffmpeg.exe', checkRequirements(MANIFEST, availableAll()))

    expect(report.toLowerCase()).toContain('ok')
    expect(report).not.toContain('missing')
  })
})

describe('ffmpeg-requirements.json', () => {
  const categories = ['encoders', 'decoders', 'muxers', 'demuxers', 'filters', 'bsfs', 'protocols'] as const

  it('exige componentes em todas as categorias', () => {
    for (const category of categories) {
      expect(MANIFEST[category].length).toBeGreaterThan(0)
    }
  })

  it('nao aceita nome com espaco ou virgula (quebraria a flag --enable-*)', () => {
    for (const category of categories) {
      for (const name of MANIFEST[category]) {
        expect(name).toMatch(/^[a-z0-9_]+$/)
      }
    }
  })

  it('cobre as 4 familias de encoder de hardware que o engine detecta', () => {
    for (const family of ['nvenc', 'qsv', 'amf', 'd3d12va']) {
      for (const codec of ['h264', 'hevc', 'av1']) {
        expect(MANIFEST.encoders).toContain(`${codec}_${family}`)
      }
    }
  })

  it('cobre o container e o bsf que o encode de AV1 e de HEVC dependem', () => {
    expect(MANIFEST.muxers).toContain('ivf')
    expect(MANIFEST.bsfs).toContain('hevc_mp4toannexb')
  })

  it('cobre os filtros que as chains de D3D12VA e de audio usam', () => {
    for (const name of ['crop', 'scale', 'format', 'hwupload', 'anlmdn', 'afftdn', 'arnndn', 'cas']) {
      expect(MANIFEST.filters).toContain(name)
    }
  })

  it('cobre todos os encoders que o editor de clipes pode mandar ao ffmpeg', () => {
    // O `clips-encode-args.ts` é a allowlist que decide o que o trim/merge passa como
    // `-c:v`. Um encoder aceito ali e ausente do manifest passaria o gate de
    // `npm run package` e só morreria no primeiro uso real do editor, no usuário, com
    // "Unknown encoder" — o gate existe justamente para pegar isso antes da entrega.
    // (O caminho inverso também importa, mas é menos perigoso: componente no manifest sem
    // produtor só custa uma linha de build a mais.)
    //
    // A extração é por ESTRUTURA (todo literal dentro de um `new Set([...])`), não por
    // lista de nomes: uma versão anterior deste teste hardcodava `libx264|libx265|
    // libsvtav1` e por isso era cega justamente para `libaom-av1` — que tem hífen, não
    // casava com o regex, e reintroduzi-lo na allowlist deixava o teste verde.
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    const source = readFileSync(join(repoRoot, 'src', 'main', 'services', 'clips-encode-args.ts'), 'utf8')
    const encoders = new Set<string>()
    for (const set of source.matchAll(/new Set\(\[(.*?)\]\)/gs)) {
      for (const literal of set[1].matchAll(/'([^']+)'/g)) encoders.add(literal[1])
    }
    // Sanidade do método: os cinco grupos de hardware/software têm de aparecer. Se o
    // formato mudar, a contagem cai e o teste falha em vez de passar em silêncio sobre
    // um conjunto vazio (que satisfaria o `for` sem verificar nada).
    expect(encoders.size).toBeGreaterThanOrEqual(15)
    expect(encoders).toContain('libx264')
    expect(encoders).toContain('av1_d3d12va')
    for (const name of encoders) {
      expect(MANIFEST.encoders, `${name} é aceito pelo editor mas não está no manifest`).toContain(name)
    }
  })

  it('nao exige componentes que o codigo nao produz', () => {
    expect(MANIFEST.encoders).not.toContain('libaom-av1')
    expect(MANIFEST.encoders).not.toContain('h264_v4l2m2m')
    expect(MANIFEST.filters).not.toContain('unsharp')
    expect(MANIFEST.filters).not.toContain('color')
    expect(MANIFEST.demuxers).not.toContain('lavfi')
  })
})
