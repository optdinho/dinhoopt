import type { ClipsConfig } from '@shared/types'

export type QualityPresetKey = 'muito-alta' | 'alta' | 'boa' | 'leve-60' | 'performance'

/**
 * Fonte única dos presets de qualidade. O componente usa estes valores para
 * aplicar a qualidade e exibir a seleção; nenhum outro local duplica os valores.
 */
export const QUALITY_PRESETS: Record<QualityPresetKey, Partial<ClipsConfig>> = {
  'muito-alta': {
    cq: 16,
    maxrateKbps: 65000,
    bufsizeKbps: 130000,
    encoderPreset: 'p5',
    bframes: 3,
    lookahead: 16,
    bitrateKbps: 65000,
    width: 1920,
    height: 1080,
    fps: 60,
  },
  alta: {
    cq: 18,
    maxrateKbps: 55000,
    bufsizeKbps: 110000,
    encoderPreset: 'p5',
    bframes: 2,
    lookahead: 16,
    bitrateKbps: 55000,
    width: 1920,
    height: 1080,
    fps: 60,
  },
  boa: {
    cq: 20,
    maxrateKbps: 40000,
    bufsizeKbps: 80000,
    encoderPreset: 'p5',
    bframes: 2,
    lookahead: 16,
    bitrateKbps: 40000,
    width: 1280,
    height: 720,
    fps: 60,
  },
  // 900p60 para GPU que não sustenta 1080p60 mas ainda tem folga para mais que 720p.
  // CQ 20 = o mesmo de 'boa' (invariante do plano: nenhum preset cria CQ novo), então o
  // maxrate sai escalando o de 'boa' pelos pixels: 40000 × (1600×900 / 1280×720)
  // = 40000 × 1,5625 = 62500. Mesmo CQ => mesmos bits por pixel, que é a curva que os
  // outros degraus seguem. O VBV é teto, não alvo (ver lição do item 2: com 48 Mbps de
  // folga ele nunca aperta), então teto alto não significa arquivo gordo.
  'leve-60': {
    cq: 20,
    maxrateKbps: 62500,
    bufsizeKbps: 125000,
    encoderPreset: 'p5',
    bframes: 0,
    lookahead: 16,
    bitrateKbps: 62500,
    width: 1600,
    height: 900,
    fps: 60,
  },
  performance: {
    cq: 22,
    maxrateKbps: 12000,
    bufsizeKbps: 24000,
    encoderPreset: 'p5',
    bframes: 2,
    lookahead: 16,
    bitrateKbps: 12000,
    width: 1280,
    height: 720,
    fps: 30,
  },
}

/**
 * Largura → altura do seletor de resolução. Fonte única porque o par é que define a
 * resolução: o código antigo usava uma ternária encadeada e qualquer largura desconhecida
 * caía em 1080p (o fallback silenciosamente entregava Full HD para quem pedia outra coisa).
 * Todos os pares são 16:9 e as duas dimensões são pares, como o encoder exige.
 */
export const RESOLUTION_HEIGHT: Record<number, number> = {
  854: 480,
  1280: 720,
  1600: 900,
  1920: 1080,
}

/**
 * Rótulo da grade de presets, derivado dos dados em vez de digitado à mão.
 *
 * A grade já mentia uma vez: o texto era uma string solta ('CQ 20 · 720p') que só
 * conferia por coincidência com o preset. Mudar a resolução do preset sem mexer no
 * texto produzia um botão que prometia uma coisa e entregava outra. Derivar o rótulo
 * dos próprios valores torna esse tipo de mentira impossível por construção.
 */
export function presetSubLabel(preset: Partial<ClipsConfig>): string {
  const partes: string[] = []
  if (preset.cq !== undefined) partes.push(`CQ ${preset.cq}`)
  if (preset.height !== undefined) {
    // 60fps é o esperado, então só entra no rótulo quando for diferente disso.
    const fps = preset.fps !== undefined && preset.fps !== 60 ? String(preset.fps) : ''
    partes.push(`${preset.height}p${fps}`)
  }
  return partes.length > 0 ? partes.join(' · ') : '—'
}
