# DiNho Optimizer

![Versão](https://img.shields.io/badge/versão-1.0.3-blue)
![Plataforma](https://img.shields.io/badge/plataforma-Windows_10/11-brightgreen)
![Licença](https://img.shields.io/badge/licença-Comercial-red)

Otimizador completo para Windows 10/11 com mais de **35 módulos** de limpeza, segurança, privacidade e manutenção.

## Funcionalidades

### Limpeza
| Módulo | Descrição |
|--------|-----------|
| System Cleaner | Temp files, logs, caches, crash dumps, prefetch, DNS cache |
| Browser Cleaner | Chrome, Edge, Firefox, Brave, Opera, Vivaldi e mais |
| App Cleaner | Caches de apps (Discord, VS Code, Spotify, Steam…) |
| Gaming Cleaner | Steam, Epic Games, EA App, caches de shader |
| Registry Cleaner | Entradas quebradas, órfãs, MRUs, atalhos inválidos (com backup) |
| Context Menu Cleaner | Extensões de shell do Windows |
| Duplicate Finder | Localiza arquivos duplicados por hash |
| Large File Finder | Encontra os maiores arquivos no disco |
| Empty Folder Cleaner | Remove pastas vazias |
| File Shredder | Exclusão segura com sobrescrita aleatória |
| WinSxS Cleaner | Redução da WinSxS via DISM |
| WinApp2 Import | Importa regras personalizadas do WinApp2.log |

### Segurança
| Módulo | Descrição |
|--------|-----------|
| Malware Scanner | YARA-X + heurística comportamental + Windows Defender |
| Behavioral Sandbox | Análise de comportamento de processos em execução |
| Memory Scanner | Scaneia memória de processos por assinaturas |
| PE Parser | Análise de arquivos PE (portáteis executáveis) |
| Exploit Detector | Detecta explorações ativas (mimikatz, EternalBlue…) |
| Vulnerability Scanner | CVE scanner para software instalado |
| Threat Intel | Consulta a inteligência de ameaças (VirusTotal, AbuseIPDB) |
| Threat Timeline | Linha do tempo de eventos de segurança |
| Custom YARA Rules | Importa regras YARA personalizadas |
| Quarantine | Gerenciamento de quarentena com allowlist |

### Privacidade
| Módulo | Descrição |
|--------|-----------|
| Privacy Shield | 30+ configurações de privacidade do Windows (telemetria, Cortana, rastreamento) |
| Firewall Audit | Auditoria de regras do Windows Defender Firewall |
| Breach Monitor | Monitor de vazamentos via Have I Been Pwned |
| Hosts Editor | Bloqueio de domínios via arquivo hosts |
| Protected Domains | Domínios protegidos contra alteração |

### Manutenção
| Módulo | Descrição |
|--------|-----------|
| Disk Analyzer | TreeMap interativo de uso de disco |
| Disk Repair | SFC, DISM, CHKDSK com um clique |
| SSD TRIM | Manutenção de unidades SSD |
| Startup Manager | Itens de inicialização com análise de impacto |
| Service Manager | Otimização de serviços do Windows |
| Driver Manager | Detecção e limpeza de drivers obsoletos |
| Debloater | Remoção de bloatware do Windows |
| Performance Monitor | CPU, memória, disco, rede em tempo real + S.M.A.R.T. |
| Game Mode | Otimização de sistema para jogos |
| Network Cleanup | DNS, perfis Wi-Fi, cache ARP |
| Windows Tweaks | Ajustes de desempenho do Windows |

### Automação
| Módulo | Descrição |
|--------|-----------|
| Schedules | Agendamento automático de scans (diário, semanal, mensal) |
| Software Updater | Atualização em lote via winget |
| Auto-Updater | Atualização automática do próprio DiNho Optimizer |
| Daemon Mode | Execução em segundo plano na bandeja do sistema |
| CLI Mode | Execução via linha de comando (--cli) |

## Download

Baixe o instalador mais recente em: [Releases](https://github.com/optdinho/dinhoopt/releases)

## Tecnologias

- **Runtime:** Electron 42
- **Linguagem:** TypeScript (strict)
- **UI:** React 19 + Tailwind CSS + shadcn/ui
- **Build:** Electron Vite + electron-builder
- **Estado:** Zustand
- **Testes:** Vitest + Playwright
- **Anti-malware:** YARA-X (bindings nativas)

## Desenvolvimento

```bash
# Instalar dependências
npm install

# Servidor de desenvolvimento
npm run dev

# Build para produção
npm run package

# Testes
npm test

# Cobertura
npm run coverage
```

### Pré-requisitos

- **Node.js** 20+
- **Windows** com Visual Studio Build Tools 2022 (para compilar `better-sqlite3`)
  - `npm install -g windows-build-tools`

## Estrutura do projeto

```
src/
├── main/              # Processo principal (Node.js)
│   ├── index.ts       # Entry point + janela Electron
│   ├── cli.ts         # Modo CLI
│   ├── daemon.ts      # Modo daemon
│   ├── ipc/           # Handlers IPC
│   ├── services/      # Lógica de negócio
│   └── platform/      # Abstração de plataforma (win32/)
├── preload/           # Bridge renderer ↔ main
├── renderer/          # UI React
│   └── src/
│       ├── App.tsx
│       ├── pages/     # Páginas (uma por módulo)
│       ├── stores/    # Zustand stores
│       ├── components/# Componentes reutilizáveis
│       └── locales/   # Traduções (en, pt, es)
└── shared/            # Tipos e canais IPC compartilhados
```

## Licença

Comercial — todos os direitos reservados.
