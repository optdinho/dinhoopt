# DiNho Optimizer



## O que está incluído

| Módulo | Descrição |
|--------|-----------|
| System Cleaner | Temp files, logs, caches, crash dumps |
| Browser Cleaner | Chrome, Edge, Firefox, Brave e mais |
| App Cleaner | Caches de apps (Discord, VS Code, Spotify…) |
| Gaming Cleaner | Steam, Epic, EA, caches de shader |
| Registry Cleaner | Entradas quebradas/órfãs com backup |
| Context Menu Cleaner | Extensões de shell do Windows |
| Startup Manager | Itens de inicialização com análise de impacto |
| Debloater | Remoção de bloatware do Windows |
| Disk Analyzer | Treemap interativo de uso de disco |
| Disk Repair | SFC, DISM, CHKDSK |
| Disk Maintenance | SSD TRIM |
| Duplicate Finder | Localiza arquivos duplicados |
| Large File Finder | Encontra arquivos grandes |
| Empty Folder Cleaner | Pastas vazias |
| File Shredder | Exclusão segura (sobrescreve com dados aleatórios) |
| Network Cleanup | DNS, perfis Wi-Fi, cache ARP |
| Malware Scanner | YARA-X + heurística + integração Windows Defender |
| Privacy Shield | 30+ configurações de privacidade do Windows |
| Firewall Audit | Auditoria de regras do Windows Defender Firewall |
| Service Manager | Otimização de serviços do Windows |
| Driver Manager | Limpeza de drivers obsoletos |
| Program Uninstaller | Desinstalação + limpeza de resíduos |
| Software Updater | Atualização em lote via winget |
| Performance Monitor | CPU, memória, disco, rede em tempo real + S.M.A.R.T. |
| Game Mode | Otimização para jogos |
| CVE Scanner | Scan de vulnerabilidades conhecidas |
| Breach Monitor | Monitor de vazamentos de dados |
| Schedules | Agendamento automático de scans |

## Pré-requisitos

- **Node.js** 20+ (LTS recomendado)
- **Windows** com Visual Studio Build Tools 2022 (para compilar `better-sqlite3`)
  - Instale via: `npm install -g windows-build-tools` (com PowerShell admin)
  - Ou baixe direto: https://visualstudio.microsoft.com/visual-cpp-build-tools/

## Instalação

```bash
npm install
```

> O `postinstall` executa automaticamente o `electron-rebuild` para compilar os módulos nativos (`better-sqlite3`, `@litko/yara-x`) para o Electron.

## Desenvolvimento

```bash
npm run dev
```

## Build

```bash
# Build para Windows (gera installer .exe em /dist)
npm run package
```

## Estrutura do projeto

```
dinho-optimizer/
├── src/
│   ├── main/                    # Processo principal (Node.js)
│   │   ├── index.ts             # Entry point + janela Electron
│   │   ├── cli.ts               # Modo CLI (--cli)
│   │   ├── daemon.ts            # Modo daemon (--daemon)
│   │   ├── i18n.ts              # Internacionalização (main)
│   │   ├── platform/
│   │   │   ├── index.ts         # Dispatcher — retorna win32 provider
│   │   │   ├── types.ts         # Interfaces da camada de plataforma
│   │   │   ├── config-utils.ts  # Utilitários de configuração
│   │   │   └── win32/           # ← TODA lógica Windows aqui
│   │   ├── ipc/                 # Handlers IPC (1 arquivo por módulo)
│   │   ├── services/            # Scheduler, auto-updater, cloud, etc.
│   │   └── constants/           # Constantes de paths e safelist
│   ├── preload/                 # Bridge renderer ↔ main
│   ├── renderer/                # UI React
│   │   └── src/
│   │       ├── App.tsx          # Router principal
│   │       ├── pages/           # 33 páginas (uma por módulo)
│   │       ├── stores/          # Estado Zustand (1 store por módulo)
│   │       ├── components/      # Componentes reutilizáveis
│   │       ├── hooks/           # Hooks customizados
│   │       ├── lib/             # Utilitários
│   │       └── locales/         # Traduções (en, pt, es)
│   └── shared/
│       ├── types.ts             # Tipos compartilhados main ↔ renderer
│       └── channels.ts          # Constantes dos canais IPC
├── rules/
│   └── win32/                   # JSON de targets de limpeza
│       ├── apps.json
│       ├── browsers.json
│       ├── gaming.json
│       ├── gpu-cache.json
│       ├── system.json
│       ├── databases.json
│       ├── steam.json
│       └── misc.json
├── resources/                   # Ícones e assets de build
├── package.json
├── electron-builder.yml         # Config de build (Windows only)
├── electron.vite.config.ts
└── ADDING_FEATURES.md           # Guia para adicionar módulos
```

## Adicionando novos módulos

Veja o arquivo **`ADDING_FEATURES.md`** para um guia passo a passo completo com exemplos de código.

## Adicionando cleaners (sem código)

Para adicionar suporte a um novo app nos módulos de limpeza, basta editar os JSON em `rules/win32/`:

```bash
# Gerador interativo
npm run new-rule

# Preview do que seria limpo
npm run preview-rule
```

## Configuração do app

Altere `electron-builder.yml`:
- `appId` → ID único do seu app (ex: `com.suaempresa.seuapp`)
- `productName` → Nome exibido ao usuário
- `nsis.shortcutName` → Nome do atalho no menu Iniciar

## Licença


