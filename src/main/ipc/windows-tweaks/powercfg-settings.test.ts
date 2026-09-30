import { describe, expect, it } from 'vitest'
import { POWERCFG_SETTINGS, parsePowerCfgAcIndex } from './powercfg-settings'

const PT_BR_OUTPUT = [
  'GUID do Esquema de Energia: 0f25382e-e29e-4f06-8898-7998112419de  (Desempenho Máximo)',
  '  GUID de Subgrupos: 2a737441-1930-4402-8d77-b2bebba308a3  (Configurações USB)',
  '    GUID de Configuração de Energia: 48e6b7a6-50f5-4782-a5d4-53bb8f07e226  (Configuração de suspensão seletiva USB)',
  '      Índice de Configurações Possíveis: 000',
  '      Nome Amigável de Configuração Possível: Desabilitado',
  '      Índice de Configurações Possíveis: 001',
  '      Nome Amigável de Configuração Possível: Ativado',
  '    Índice de Configurações de Correntes Alternadas Atuais: 0x00000000',
  '    Índice de Configurações de Correntes Contínuas Atuais: 0x00000064',
].join('\r\n')

const EN_OUTPUT = [
  'Power Scheme GUID: 0f25382e-e29e-4f06-8898-7998112419de  (High performance)',
  '  Subgroup GUID: 2a737441-1930-4402-8d77-b2bebba308a3  (USB settings)',
  '    Power Setting GUID: 48e6b7a6-50f5-4782-a5d4-53bb8f07e226  (USB selective suspend setting)',
  '      Possible Setting Index: 000',
  '      Possible Setting Friendly Name: Disabled',
  '      Possible Setting Index: 001',
  '      Possible Setting Friendly Name: Enabled',
  '    Current AC Power Setting Index: 0x00000000',
  '    Current DC Power Setting Index: 0x00000064',
].join('\r\n')

const ES_OUTPUT = [
  'GUID del esquema de energia: 0f25382e-e29e-4f06-8898-7998112419de  (Rendimiento máximo)',
  '    Índice de configuración de corriente alterna actual: 0x00000001',
  '    Índice de configuración de corriente continua actual: 0x00000000',
].join('\r\n')

const DE_OUTPUT = [
  'Energieschema-GUID: 0f25382e-e29e-4f06-8898-7998112419de  (Höchstleistung)',
  '    Aktueller Wechselstrom-Energieeinstellungsindex: 0x00000005',
  '    Aktueller Gleichstrom-Energieeinstellungsindex: 0x00000000',
].join('\r\n')

describe('parsePowerCfgAcIndex', () => {
  it('reads the AC index from English output', () => {
    expect(parsePowerCfgAcIndex(EN_OUTPUT)).toBe(0)
  })

  it('reads the AC index from Portuguese output', () => {
    expect(parsePowerCfgAcIndex(PT_BR_OUTPUT)).toBe(0)
  })

  it('reads the AC index from Spanish output', () => {
    expect(parsePowerCfgAcIndex(ES_OUTPUT)).toBe(1)
  })

  it('reads the AC index from German output', () => {
    expect(parsePowerCfgAcIndex(DE_OUTPUT)).toBe(5)
  })

  it('returns the AC index and ignores the DC index', () => {
    expect(parsePowerCfgAcIndex(PT_BR_OUTPUT)).toBe(0)
    expect(parsePowerCfgAcIndex(DE_OUTPUT)).not.toBe(0)
  })

  it('returns the first index when AC and DC differ and AC is non-zero', () => {
    const both = [
      '    Current AC Power Setting Index: 0x00000064',
      '    Current DC Power Setting Index: 0x00000000',
    ].join('\r\n')
    expect(parsePowerCfgAcIndex(both)).toBe(100)
  })

  it('ignores bare decimal "Possible Setting Index" lines', () => {
    const onlyPossible = ['      Possible Setting Index: 000', '      Possible Setting Index: 001'].join('\r\n')
    expect(parsePowerCfgAcIndex(onlyPossible)).toBeNull()
  })

  it('returns null when there is no index line', () => {
    expect(parsePowerCfgAcIndex('Power Scheme GUID: 0f25382e-e29e-4f06-8898-7998112419de')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parsePowerCfgAcIndex('')).toBeNull()
  })

  it('tolerates mixed line endings', () => {
    const mixed = [
      '    Current AC Power Setting Index: 0x0000000a',
      '    Current DC Power Setting Index: 0x0000000b',
    ].join('\n')
    expect(parsePowerCfgAcIndex(mixed)).toBe(10)
  })
})

describe('POWERCFG_SETTINGS', () => {
  it('uses the real SUB_PCIEXPRESS subgroup and ASPM setting GUIDs', () => {
    const aspm = POWERCFG_SETTINGS['pcie-aspm-off']!
    expect(aspm).toHaveLength(1)
    expect(aspm[0]?.subgroup).toBe('501a4d13-42af-4429-9fd1-a8218c268e20')
    expect(aspm[0]?.setting).toBe('ee12f906-d277-404b-b6da-e5fa1a576df5')
  })

  it('uses the real USB selective suspend GUIDs', () => {
    const usb = POWERCFG_SETTINGS['usb-selective-suspend-off']!
    expect(usb[0]?.subgroup).toBe('2a737441-1930-4402-8d77-b2bebba308a3')
    expect(usb[0]?.setting).toBe('48e6b7a6-50f5-4782-a5d4-53bb8f07e226')
  })

  it('restores the processor minimum to 5 on revert, not 100', () => {
    const proc = POWERCFG_SETTINGS['processor-min-max']!
    const min = proc.find((s) => s.setting === '893dee8e-2bef-41e0-89c6-b55d0929964c')
    expect(min?.applyValue).toBe(100)
    expect(min?.revertValue).toBe(5)
  })

  it('keeps the processor maximum at 100 on revert', () => {
    const proc = POWERCFG_SETTINGS['processor-min-max']!
    const max = proc.find((s) => s.setting === 'bc5038f7-23e0-4960-96da-33abaf5935ec')
    expect(max?.applyValue).toBe(100)
    expect(max?.revertValue).toBe(100)
  })
})
