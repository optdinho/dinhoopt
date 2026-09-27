import { describe, expect, it } from 'vitest'
import { presetSubLabel, QUALITY_PRESETS, type QualityPresetKey, RESOLUTION_HEIGHT } from './clips-quality-presets'

const KEYS = Object.keys(QUALITY_PRESETS) as QualityPresetKey[]

/** Limites de `ConfigManager.cs:307` (o validador de width/height do engine). */
const CS_MIN_W = 640
const CS_MAX_W = 1920
const CS_MIN_H = 480
const CS_MAX_H = 1080

/** Os CQs que o usuário escolheu. O plano proíbe inventar um novo. */
const ALLOWED_CQ = [16, 18, 20, 22]

describe('QUALITY_PRESETS', () => {
  it('tem um degrau leve-60 em 900p60', () => {
    const leve = QUALITY_PRESETS['leve-60']
    expect(leve).toBeDefined()
    expect(leve.width).toBe(1600)
    expect(leve.height).toBe(900)
    expect(leve.fps).toBe(60)
  })

  it('leve-60 reusa CQ 20 (invariante: nenhum preset cria CQ novo)', () => {
    expect(QUALITY_PRESETS['leve-60'].cq).toBe(20)
    for (const key of KEYS) {
      expect(ALLOWED_CQ).toContain(QUALITY_PRESETS[key].cq)
    }
  })

  it('leve-60 é distinguível de boa (o realce da grade não pode acender dois)', () => {
    const boa = QUALITY_PRESETS.boa
    const leve = QUALITY_PRESETS['leve-60']
    // A grade compara cq E maxrate para decidir qual botão está ativo.
    const mesmaChave = boa.cq === leve.cq && boa.maxrateKbps === leve.maxrateKbps
    expect(mesmaChave).toBe(false)
  })

  it('leve-60 deriva o maxrate da curva de boa escalando por pixels (mesmo CQ => mesmo bpp)', () => {
    const boa = QUALITY_PRESETS.boa
    const leve = QUALITY_PRESETS['leve-60']
    const px = (w?: number, h?: number) => (w ?? 0) * (h ?? 0)
    const esperado = Math.round((boa.maxrateKbps as number) * (px(leve.width, leve.height) / px(boa.width, boa.height)))
    expect(leve.maxrateKbps).toBe(esperado)
    expect(leve.maxrateKbps).toBe(62500)
  })

  it('bufsize é sempre 2x o maxrate em todos os presets', () => {
    for (const key of KEYS) {
      const p = QUALITY_PRESETS[key]
      expect(p.bufsizeKbps).toBe((p.maxrateKbps as number) * 2)
    }
  })

  it('leve-60 zera bframes (coerente com o item 7 desligado)', () => {
    expect(QUALITY_PRESETS['leve-60'].bframes).toBe(0)
  })

  it('todo preset fica dentro da validação do engine (ConfigManager.cs:307)', () => {
    for (const key of KEYS) {
      const p = QUALITY_PRESETS[key]
      expect(p.width).toBeGreaterThanOrEqual(CS_MIN_W)
      expect(p.width).toBeLessThanOrEqual(CS_MAX_W)
      expect(p.height).toBeGreaterThanOrEqual(CS_MIN_H)
      expect(p.height).toBeLessThanOrEqual(CS_MAX_H)
    }
  })

  it('todo preset tem dimensões divisíveis por 2 (o encoder faz & ~1, mas não queremos waste)', () => {
    for (const key of KEYS) {
      const p = QUALITY_PRESETS[key]
      expect((p.width as number) % 2).toBe(0)
      expect((p.height as number) % 2).toBe(0)
    }
  })

  it('todo preset manda p5, o sentinel de "não especificado" que liga a escada adaptativa', () => {
    for (const key of KEYS) {
      expect(QUALITY_PRESETS[key].encoderPreset).toBe('p5')
    }
  })
})

describe('RESOLUTION_HEIGHT', () => {
  it('cobre toda a largura usada por algum preset', () => {
    for (const key of KEYS) {
      const w = QUALITY_PRESETS[key].width as number
      expect(RESOLUTION_HEIGHT[w]).toBe(QUALITY_PRESETS[key].height)
    }
  })

  it('todo par é ~16:9 (o encoder não faz letterbox, então qualquer outra coisa estica)', () => {
    // Expresso em pixels, que é o que importa: a largura ideal para a altura é h × 16/9.
    // 1280×720, 1600×900 e 1920×1080 são 16:9 exatos. O 854×480 fica 0,67 px do ideal
    // porque 854 é a maior largura par que cabe em 480p (o 480p convencional), e a
    // diferença é invisível — o que importaria é um desvio grande, tipo 4:3.
    for (const [w, h] of Object.entries(RESOLUTION_HEIGHT)) {
      const ideal = (Number(h) * 16) / 9
      expect(Math.abs(Number(w) - ideal)).toBeLessThan(1)
    }
  })

  it('não tem entrada para largura que o seletor não oferece (fallback silencioso)', () => {
    expect(
      Object.keys(RESOLUTION_HEIGHT)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual([854, 1280, 1600, 1920])
  })
})

describe('presetSubLabel', () => {
  // Trava de regressão: os quatro rótulos que já estavam na grade estão corretos.
  // Se este teste falhar, alguém mudou os dados e esqueceu de reavaliar a verdade da grade.
  it.each([
    ['muito-alta', 'CQ 16 · 1080p'],
    ['alta', 'CQ 18 · 1080p'],
    ['boa', 'CQ 20 · 720p'],
    ['performance', 'CQ 22 · 720p30'],
  ])('reproduz o rótulo honesto de %s', (key, esperado) => {
    expect(presetSubLabel(QUALITY_PRESETS[key as QualityPresetKey])).toBe(esperado)
  })

  it('descreve leve-60 truthfully', () => {
    expect(presetSubLabel(QUALITY_PRESETS['leve-60'])).toBe('CQ 20 · 900p')
  })

  it('acrescenta o fps só quando ele não é 60 (o sufixo carrega informação)', () => {
    expect(presetSubLabel({ cq: 20, height: 720, fps: 30 })).toBe('CQ 20 · 720p30')
    expect(presetSubLabel({ cq: 20, height: 720, fps: 60 })).toBe('CQ 20 · 720p')
  })

  it('não quebra com config parcial', () => {
    expect(presetSubLabel({})).toBe('—')
    expect(presetSubLabel({ cq: 20 })).toBe('CQ 20')
  })
})
