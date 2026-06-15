export interface ScanProfile {
  id: string
  name: string
  description: string
  icon: string
  scanDirs: string[]
  scanTypes: ('yara' | 'heuristic' | 'script' | 'persistence' | 'ads' | 'hosts')[]
  maxFileSize: number
  maxDepth: number
  duration: 'quick' | 'normal' | 'full'
}

export const SCAN_PROFILES: Record<string, ScanProfile> = {
  quick: {
    id: 'quick',
    name: 'R\u00e1pido',
    description: 'Escaneia apenas \u00e1reas cr\u00edticas (Temp, Downloads) com YARA',
    icon: '\u26a1',
    scanDirs: ['%TEMP%', '%USERPROFILE%\\Downloads'],
    scanTypes: ['yara'],
    maxFileSize: 10,
    maxDepth: 2,
    duration: 'quick',
  },
  normal: {
    id: 'normal',
    name: 'Normal',
    description: 'Escaneio completo de \u00e1reas de usu\u00e1rio com todas as t\u00e9cnicas',
    icon: '\ud83d\udee1\ufe0f',
    scanDirs: ['%TEMP%', '%USERPROFILE%\\Downloads', '%APPDATA%', '%LOCALAPPDATA%', '%USERPROFILE%\\Desktop'],
    scanTypes: ['yara', 'heuristic', 'script', 'persistence', 'ads', 'hosts'],
    maxFileSize: 50,
    maxDepth: 5,
    duration: 'normal',
  },
  full: {
    id: 'full',
    name: 'Completo',
    description: 'Escaneio profundo de todos os usu\u00e1rios, m\u00e1xima profundidade',
    icon: '\ud83d\udd0d',
    scanDirs: ['C:\\Users\\*\\AppData', 'C:\\Users\\*\\Downloads', 'C:\\Users\\*\\Desktop', 'C:\\Users\\*\\Documents'],
    scanTypes: ['yara', 'heuristic', 'script', 'persistence', 'ads', 'hosts'],
    maxFileSize: 200,
    maxDepth: 10,
    duration: 'full',
  },
  custom: {
    id: 'custom',
    name: 'Personalizado',
    description: 'Configure quais diret\u00f3rios e t\u00e9cnicas escanear',
    icon: '\u2699\ufe0f',
    scanDirs: [],
    scanTypes: ['yara', 'heuristic', 'script', 'persistence', 'ads', 'hosts'],
    maxFileSize: 50,
    maxDepth: 5,
    duration: 'normal',
  },
}
