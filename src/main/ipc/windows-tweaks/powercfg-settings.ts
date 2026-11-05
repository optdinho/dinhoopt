export interface PowerCfgSetting {
  subgroup: string
  setting: string
  applyValue: number
  revertValue: number
}

export const POWERCFG_SETTINGS: Record<string, PowerCfgSetting[]> = {
  'pcie-aspm-off': [
    {
      subgroup: '501a4d13-42af-4429-9fd1-a8218c268e20',
      setting: 'ee12f906-d277-404b-b6da-e5fa1a576df5',
      applyValue: 0,
      revertValue: 2,
    },
  ],
  'usb-selective-suspend-off': [
    {
      subgroup: '2a737441-1930-4402-8d77-b2bebba308a3',
      setting: '48e6b7a6-50f5-4782-a5d4-53bb8f07e226',
      applyValue: 0,
      revertValue: 1,
    },
  ],
  'processor-min-max': [
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: '893dee8e-2bef-41e0-89c6-b55d0929964c',
      applyValue: 100,
      revertValue: 5,
    },
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: 'bc5038f7-23e0-4960-96da-33abaf5935ec',
      applyValue: 100,
      revertValue: 100,
    },
  ],
  'perf-boost-mode': [
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: 'be337238-0d82-4146-a960-4f3749d470c7',
      applyValue: 1,
      revertValue: 2,
    },
  ],
  'perf-epp': [
    {
      subgroup: '54533251-82be-4824-96c1-47b60b740d00',
      setting: '36687f9e-e3a5-4dbf-b1dc-15eb381c6863',
      applyValue: 0,
      revertValue: 50,
    },
  ],
}

const HEX_VALUE_LINES = /:\s*(0x[0-9a-fA-F]+)\s*$/gm

export function parsePowerCfgAcIndex(stdout: string): number | null {
  const matches = [...String(stdout).matchAll(HEX_VALUE_LINES)]
  if (matches.length === 0) return null
  const hex = matches.length === 1 ? matches[0]?.[1] : matches[matches.length - 2]?.[1]
  if (hex === undefined) return null
  return Number.parseInt(hex, 16)
}

/**
 * Reads the current AC and DC indices from `powercfg -qh` (or `powercfg /query`).
 * The output lists AC second to last and DC last whenever indices are present;
 * any preceding hex values (e.g. range min/max/increment) are ignored.
 */
export function parsePowerCfgIndices(stdout: string): { ac: number; dc: number } | null {
  const matches = [...String(stdout).matchAll(HEX_VALUE_LINES)]
  if (matches.length < 2) return null
  const ac = matches[matches.length - 2]?.[1]
  const dc = matches[matches.length - 1]?.[1]
  if (ac === undefined || dc === undefined) return null
  return { ac: Number.parseInt(ac, 16), dc: Number.parseInt(dc, 16) }
}
