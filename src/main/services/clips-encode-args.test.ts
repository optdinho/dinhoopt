import { describe, expect, it } from 'vitest'
import { buildReEncodeArgs, resolveTrimCodec } from './clips-encode-args'

describe('resolveTrimCodec', () => {
  it('usa o codec efetivo do engine quando ele é conhecido', () => {
    expect(resolveTrimCodec('h264_nvenc')).toBe('h264_nvenc')
    expect(resolveTrimCodec('hevc_amf')).toBe('hevc_amf')
    expect(resolveTrimCodec('av1_nvenc')).toBe('av1_nvenc')
  })

  it('cai para libx264 quando o engine não reporta codec (engine parado ou status velho)', () => {
    expect(resolveTrimCodec(undefined)).toBe('libx264')
    expect(resolveTrimCodec(null)).toBe('libx264')
    expect(resolveTrimCodec('')).toBe('libx264')
    expect(resolveTrimCodec('   ')).toBe('libx264')
  })

  it('rejeita lixo como nome de encoder em vez de passar para o ffmpeg', () => {
    expect(resolveTrimCodec('Ffmpeg')).toBe('libx264')
    expect(resolveTrimCodec('c:v')).toBe('libx264')
    expect(resolveTrimCodec('../../evil')).toBe('libx264')
    expect(resolveTrimCodec('libx264; rm -rf /')).toBe('libx264')
  })

  it('aceita a família de software que o engine pode reportar', () => {
    expect(resolveTrimCodec('libx264')).toBe('libx264')
    expect(resolveTrimCodec('libx265')).toBe('libx265')
    // libsvtav1 NÃO é hipotético: EncoderManager.cs:282-283 mapeia "av1" => ?? "libsvtav1" (GPU sem AV1 hw).
    expect(resolveTrimCodec('libsvtav1')).toBe('libsvtav1')
  })

  it('normaliza caixa e espaço sem mudar afamilia', () => {
    expect(resolveTrimCodec(' H264_NVENC ')).toBe('h264_nvenc')
  })
})

describe('buildReEncodeArgs', () => {
  it('libx264 mantém o comportamento de hoje: crf + veryfast + vbv', () => {
    const args = buildReEncodeArgs({ codec: 'libx264', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    // Trava de caracterização: este é byte-a-byte o array que o trim usava antes do item 8.
    // Se a ordem ou algum par mudar, a edição em software mudou de comportamento.
    expect(args).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-maxrate',
      '40000K',
      '-bufsize',
      '80000K',
      '-c:a',
      'copy',
    ])
  })

  it('nvenc usa o mesmo esquema do engine: vbr + b:v 0 + cq (crf não existe)', () => {
    const args = buildReEncodeArgs({ codec: 'h264_nvenc', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    expect(args).toContain('h264_nvenc')
    // -crf é x264-only; com nvenc ele é ignorado com warning, o que significa CQ sem efeito.
    expect(args).not.toContain('-crf')
    expect(args).toContain('-rc')
    // Medido no binário embarcado (ffmpeg 9.0.1): o -rc do nvenc só aceita constqp|vbr|cbr.
    // `vbr_peak` é constante de AMF/D3D12VA e o nvenc REJEITA com
    // "Unable to parse rc option value vbr_peak" — o trim morria no primeiro uso. Ver também
    // o teste do lado negativo abaixo.
    expect(args[args.indexOf('-rc') + 1]).toBe('vbr')
    expect(args).toContain('20')
  })

  it('nvenc nunca emite vbr_peak: é constante de outra família e o encoder a recusa', () => {
    // Estava aqui como valor do -rc do nvenc e quebrava o trim de HW. O teste de args não
    // pegou porque nenhum teste executa o ffmpeg de verdade — foi a medição de tempo que
    // expôs ("Error setting option rc to value vbr_peak"). A trava é sobre o valor exato:
    // 'vbr' contém 'vbr' como prefixo, então Contains() passaria com 'vbr_peak' presente.
    for (const codec of ['h264_nvenc', 'hevc_nvenc', 'av1_nvenc']) {
      const args = buildReEncodeArgs({ codec, cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
      const rc = args[args.indexOf('-rc') + 1]
      expect(rc).not.toBe('vbr_peak')
      expect(rc).not.toBe('cqp')
      expect(rc).toBe('vbr')
    }
  })

  it('qsv usa global_quality, que é como o QSV expresses o CQ', () => {
    const args = buildReEncodeArgs({ codec: 'hevc_qsv', cq: 18, maxrateKbps: 55000, bufsizeKbps: 110000 })
    expect(args).toContain('hevc_qsv')
    expect(args).toContain('-global_quality')
    expect(args).not.toContain('-crf')
  })

  it('qsv aplica o mesmo deslocamento cq-4 da captura, senão o trim muda a qualidade', () => {
    // A escala do global_quality do QSV não é a do CRF do x264. A captura converte com
    // cq - 4 (FfmpegEncoder.cs:284); sem o mesmo deslocamento, um clipe gravado em CQ 20
    // voltaria do trim em global_quality 20 = qualidade diferente da que o usuário pediu.
    const args = buildReEncodeArgs({ codec: 'hevc_qsv', cq: 20, maxrateKbps: 55000, bufsizeKbps: 110000 })
    const iq = args.indexOf('-global_quality')
    expect(args[iq + 1]).toBe('16')
    expect(args).not.toContain('20')
  })

  it('qsv mantém o clamp 0..51 do deslocamento', () => {
    const baixo = buildReEncodeArgs({ codec: 'h264_qsv', cq: 0, maxrateKbps: 55000, bufsizeKbps: 110000 })
    expect(baixo[baixo.indexOf('-global_quality') + 1]).toBe('0')
    const alto = buildReEncodeArgs({ codec: 'h264_qsv', cq: 51, maxrateKbps: 55000, bufsizeKbps: 110000 })
    expect(alto[alto.indexOf('-global_quality') + 1]).toBe('47')
  })

  it('amf não recebe crf nem global_quality (qp é o caminho do AMF)', () => {
    const args = buildReEncodeArgs({ codec: 'hevc_amf', cq: 20, maxrateKbps: 62500, bufsizeKbps: 125000 })
    expect(args).toContain('hevc_amf')
    expect(args).not.toContain('-crf')
    expect(args).not.toContain('-global_quality')
    expect(args).toContain('62500K')
  })

  it('amf declara -rc cqp, senão o qp é ignorado e o CQ não tem efeito', () => {
    // Este é o modo de falha que o item existe para evitar. O default do wrapper AMF do
    // ffmpeg é vbr_peak: em vbr_peak o -qp_i/-qp_p é DESCARTADO (o encoder só os usa em
    // cqp), o ffmpeg não reclama, e o clipe sai por bitrate em vez do CQ escolhido — a
    // ilusão de qualidade controlada. -rc cqp é o que torna o QP efetivo.
    const args = buildReEncodeArgs({ codec: 'h264_amf', cq: 20, maxrateKbps: 62500, bufsizeKbps: 125000 })
    expect(args[args.indexOf('-rc') + 1]).toBe('cqp')
    expect(args).toContain('-qp_i')
    expect(args).toContain('-qp_p')
    // A captura usa vbr_peak + b:v (FfmpegEncoder.cs:322), mas isso é taxa, não CQ: o
    // editor não pode copiar a chain senão o CQ escolhido deixa de valer aqui.
    expect(args).not.toContain('-b:v')
  })

  it('d3d12va usa rc 1 + qp, que é o caminho do d3d12 — não o do nvenc', () => {
    // d3d12va expõe -rc como índice, e o QP vai em -qp. A captura usa exatamente isso
    // (FfmpegEncoder.cs:335-337), então o editor repete em vez de inventar.
    //
    // NÃO VERIFICADO: se `1` é mesmo CQP. O d3d12va não expõe o nome das constantes na
    // seção dele do `-h full` do binário, e não há hardware nesta máquina para sondar
    // (a tentativa morre em "Error creating MFX session"/inicialização de device antes de
    // qualquer mensagem sobre `-rc`). O risco é concreto e silencioso: índice numérico NÃO
    // é validado pelo ffmpeg (o nvenc aceitou `-rc 999` sem reclamar), então se 1 não for
    // CQP o `-qp` é descartado e o CQ deixa de valer sem erro nenhum. Trocar por `-rc cqp`
    // passaria a ser validado (e falharia alto se o nome não existisse), mas isso muda
    // comportamento de produção numa família que não dá para testar aqui — mesma razão do
    // Item 3 (AMF): não promote sem medir no hardware. Ver AGENTS.md.
    const args = buildReEncodeArgs({ codec: 'h264_d3d12va', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    expect(args).toContain('h264_d3d12va')
    expect(args[args.indexOf('-rc') + 1]).toBe('1')
    expect(args[args.indexOf('-qp') + 1]).toBe('20')
    // -cq é opção do nvenc; no d3d12 não existe, e -b:v 0 forçaria dois-pass à toa.
    expect(args).not.toContain('-cq')
    expect(args).not.toContain('-b:v')
  })

  it('d3d12va mantém o clamp 0..52 do qp', () => {
    const alto = buildReEncodeArgs({ codec: 'hevc_d3d12va', cq: 99, maxrateKbps: 40000, bufsizeKbps: 80000 })
    expect(alto[alto.indexOf('-qp') + 1]).toBe('52')
  })

  it('o codec é o primeiro par de -c:v e o áudio vai copiado', () => {
    const args = buildReEncodeArgs({ codec: 'h264_nvenc', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    expect(args[0]).toBe('-c:v')
    expect(args[1]).toBe('h264_nvenc')
    expect(args.slice(-2)).toEqual(['-c:a', 'copy'])
  })

  // ── libsvtav1: preset numérico, porque nome não existe nesse encoder ──
  //
  // `ffmpeg -h encoder=libsvtav1` → `-preset <int> (from -2 to 13)`: o SVT só aceita preset
  // NUMÉRICO. O editor empurrava `-preset veryfast` para toda a família de software e o
  // ffmpeg morria antes de abrir o output:
  //   [libsvtav1] Undefined constant or missing '(' in 'veryfast'      → exit -22
  // O mesmo comando com `-preset 8` sai 0. É a mesma classe do `-rc vbr_peak` (Item 8): nome
  // que pertence a outra família, com falha no primeiro uso, longe do CI.
  it('libsvtav1 recebe preset NUMÉRICO, porque nome não existe nesse encoder', () => {
    const args = buildReEncodeArgs({ codec: 'libsvtav1', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    const preset = args[args.indexOf('-preset') + 1]
    expect(preset).toMatch(/^-?\d+$/)
    // o CQ do usuário tem de continuar no lugar, sem conversão: o -crf do SVT é 0..63, a
    // mesma faixa do nosso cq (16/18/20/22).
    expect(args[args.indexOf('-crf') + 1]).toBe('20')
  })

  it('libaom-av1 e v4l2m2m NÃO são aceitos: sem produtor no engine e fora do manifest', () => {
    // Medido antes de remover (ver o comentário do allowlist): `libaom-av1` não tem -preset
    // (o -preset era no-op silencioso) e recusa VBV em CRF ("Rate control parameters set
    // without a bitrate"); `*_v4l2m2m` recebia args de AMF, que ele não entende, e nem
    // existe em build Windows. Nenhum dos três tem produtor no C# nem entrada no manifest do
    // ffmpeg, então aceitar seria prometer um encoder que o build talvez não traga.
    for (const codec of ['libaom-av1', 'h264_v4l2m2m', 'hevc_v4l2m2m']) {
      expect(resolveTrimCodec(codec), codec).toBe('libx264')
      const args = buildReEncodeArgs({ codec, cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
      expect(args[1], `${codec} não pode virar -c:v`).toBe('libx264')
    }
  })

  it('veryfast nos encoders de software só vai para quem tem preset NOME', () => {
    // Trava de família: se alguém estender o preset de software para um encoder novo sem
    // conferir a flag, o `veryfast` reaparece e o ffmpeg morre no primeiro uso.
    //
    // O QSV fica de fora DE PROPÓSITO: o `-preset` dele é int 0..7 COM constantes nomeadas
    // (`veryfast` = 7, `veryslow` = 1), então veryfast é legítimo lá — e o editor usa veryfast
    // enquanto a captura usa veryslow, de propósito (responsiveness do editor, não qualidade
    // máxima). Nenhum outro encoder de software tem preset nomeado, hoje.
    const svt = buildReEncodeArgs({ codec: 'libsvtav1', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    const svtPreset = svt[svt.indexOf('-preset') + 1]
    expect(svtPreset).not.toBe('veryfast')
    expect(svtPreset).toMatch(/^-?\d+$/)
  })

  it('codec desconhecido não pode cair no ramo do nvenc em silêncio', () => {
    // `buildReEncodeArgs` é exportada e não validava nada: o ramo do NVENC era o `else`, então
    // qualquer string fora das famílias recebia `-rc vbr -b:v 0 -cq`. Um allowlist que cai em
    // algo perigoso em vez de rejeitar é a mesma armadilha do resolveTrimCodec.
    const args = buildReEncodeArgs({ codec: 'nao_existe', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    expect(args).not.toContain('-b:v')
    expect(args).not.toContain('-rc')
    // e o nome de lixo não pode virar argumento de linha de comando: cai no libx264
    expect(args[1]).toBe('libx264')
  })

  it('codec desconhecido com caixa/espaço também é normalizado antes do fallback', () => {
    const args = buildReEncodeArgs({ codec: '  NAO_EXISTE  ', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    expect(args[1]).toBe('libx264')
    expect(args).not.toContain('-b:v')
  })

  it('inclui o filtro quando há vfChain, e nada quando não há', () => {
    const comVf = buildReEncodeArgs({
      codec: 'h264_nvenc',
      cq: 20,
      maxrateKbps: 40000,
      bufsizeKbps: 80000,
      vfChain: 'unsharp=5:5:1.0',
    })
    expect(comVf.join(' ')).toContain('-vf unsharp=5:5:1.0')
    const semVf = buildReEncodeArgs({ codec: 'h264_nvenc', cq: 20, maxrateKbps: 40000, bufsizeKbps: 80000 })
    expect(semVf).not.toContain('-vf')
  })

  it('o vbv vai com sufixo K e bate com o que foi pedido', () => {
    const args = buildReEncodeArgs({ codec: 'libx264', cq: 16, maxrateKbps: 65000, bufsizeKbps: 130000 })
    expect(args).toContain('65000K')
    expect(args).toContain('130000K')
  })
})
