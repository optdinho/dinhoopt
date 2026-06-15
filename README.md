<p align="center">
  <img src="resources/icon.png" alt="DiNho Optimizer" width="120" />
</p>

<h1 align="center">🛡️ DiNho Optimizer</h1>

<p align="center">
  <strong>Plataforma completa de otimização, segurança e privacidade para Windows 10/11</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-1.0.3-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Versão" />
  <img src="https://img.shields.io/badge/plataforma-Windows%2010%2F11-22c55e?style=for-the-badge&logo=windows11&logoColor=white" alt="Plataforma" />
  <img src="https://img.shields.io/badge/build-passing-22c55e?style=for-the-badge&logo=githubactions&logoColor=white" alt="Build" />
  <img src="https://img.shields.io/badge/coverage-80%25-22c55e?style=for-the-badge&logo=vitest&logoColor=white" alt="Coverage" />
  <img src="https://img.shields.io/badge/licença-Comercial-ef4444?style=for-the-badge&logo=legal&logoColor=white" alt="Licença" />
</p>

<p align="center">
  <a href="#-download">📥 Download</a> •
  <a href="#-funcionalidades">⚡ Funcionalidades</a> •
  <a href="#-tecnologias">🛠️ Tecnologias</a> •
  <a href="#-arquitetura">🏗️ Arquitetura</a> •
  <a href="#-desenvolvimento">💻 Desenvolvimento</a>
</p>

---

## 📥 Download

<p align="center">
  <a href="https://github.com/optdinho/dinhoopt/releases/latest">
    <img src="https://img.shields.io/badge/Baixar-DiNho_Optimizer_1.0.3-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Download" />
  </a>
</p>

| Componente | Tamanho |
|------------|---------|
| Instalador (NSIS) | ~128 MB |
| Portable | ~65 MB (win-unpacked) |

> **⚠️ Requer:** Windows 10 (build 19041+) ou Windows 11, 4 GB RAM, 500 MB de espaço livre.

---

## ⚡ Funcionalidades

<details open>
<summary><strong>🧹 Limpeza</strong> — 12 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **System Cleaner** | Arquivos temporários, logs do Windows, crash dumps, prefetch, cache DNS, lixeira |
| **Browser Cleaner** | Chrome, Edge, Firefox, Brave, Opera, Vivaldi — cache, cookies, histórico, sessões |
| **App Cleaner** | Caches de aplicativos — Discord, VS Code, Spotify, Teams, Zoom, Slack e dezenas mais |
| **Gaming Cleaner** | Steam, Epic Games, EA App, GOG — caches, logs, shaders compilados |
| **Registry Cleaner** | Chaves quebradas, entradas órfãs, MRUs, atalhos inválidos — com backup automático |
| **Context Menu Cleaner** | Extensões de shell, menus de contexto obsoletos ou maliciosos |
| **Duplicate Finder** | Varredura por hash SHA-256 para localizar arquivos duplicados |
| **Large File Finder** | Identifica os maiores arquivos ocupando espaço em disco |
| **Empty Folder Cleaner** | Remove pastas vazias residual de desinstalações |
| **File Shredder** | Exclusão segura com sobrescrita aleatória (3 passadas) |
| **WinSxS Cleaner** | Redução do componente store via DISM — recupera gigabytes |
| **WinApp2 Import** | Importa regras personalizadas da comunidade WinApp2.log |

</details>

<details open>
<summary><strong>🔒 Segurança</strong> — 10 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Malware Scanner** | Motor YARA-X + heurística comportamental + integração Windows Defender |
| **Behavioral Sandbox** | Executa suspeitos em ambiente isolado e analisa comportamento |
| **Memory Scanner** | Escaneia a memória de processos ativos por assinaturas de malware |
| **PE Parser** | Analisa arquivos PE (portáteis executáveis) — seções, imports, hashes |
| **Exploit Detector** | Detecta explorações ativas — mimikatz, EternalBlue, juicing |
| **Vulnerability Scanner** | CVE scanner para software instalado vs banco de vulnerabilidades conhecidas |
| **Threat Intel** | Consulta cruzada a inteligência de ameaças (VirusTotal, AbuseIPDB) |
| **Threat Timeline** | Linha do tempo e correlação de eventos de segurança |
| **Custom YARA Rules** | Importa regras YARA personalizadas do usuário |
| **Quarantine** | Gerenciamento completo de quarentena com allowlist e restore |

</details>

<details open>
<summary><strong>🕵️ Privacidade</strong> — 5 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Privacy Shield** | 30+ configurações — telemetria, Cortana, rastreamento de localização, diagnósticos |
| **Firewall Audit** | Auditoria completa de regras do Windows Defender Firewall |
| **Breach Monitor** | Monitoramento de vazamentos via API Have I Been Pwned |
| **Hosts Editor** | Bloqueio de domínios por edição segura do arquivo hosts |
| **Protected Domains** | Protege domínios críticos contra alteração por malware |

</details>

<details open>
<summary><strong>🔧 Manutenção</strong> — 12 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Disk Analyzer** | TreeMap interativo e drill-down do uso de disco |
| **Disk Repair** | SFC, DISM, CHKDSK com interface unificada |
| **SSD TRIM** | Manutenção e otimização de unidades de estado sólido |
| **Startup Manager** | Gerenciamento de inicialização com análise de impacto no boot |
| **Service Manager** | Otimização de serviços do Windows (configurações seguras por perfil) |
| **Driver Manager** | Detecção, backup e remoção de drivers obsoletos |
| **Debloater** | Remoção seletiva de bloatware e aplicativos pré-instalados |
| **Performance Monitor** | CPU, memória, disco, rede em tempo real + S.M.A.R.T. |
| **Game Mode** | Otimização automática para jogos — desativa serviços não essenciais |
| **Network Cleanup** | Limpeza de DNS, perfis Wi-Fi, cache ARP, rotas |
| **Windows Tweaks** | Ajustes finos de desempenho e comportamento do Windows |
| **Program Uninstaller** | Desinstalação forçada com limpeza de resíduos |

</details>

<details open>
<summary><strong>🤖 Automação</strong> — 5 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Schedules** | Agendamento flexível — scans diários, semanais, mensais |
| **Software Updater** | Atualização em lote de aplicativos via winget |
| **Auto-Updater** | Atualização automática do próprio DiNho Optimizer |
| **Daemon Mode** | Execução em segundo plano na bandeja do sistema |
| **CLI Mode** | Operação completa via linha de comando (headless/scripts) |

</details>

---

## 🛠️ Tecnologias

<p align="center">
  <img src="https://img.shields.io/badge/Electron-42-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/shadcn/ui-latest-000000?style=flat-square&logo=shadcnui&logoColor=white" alt="shadcn/ui" />
  <img src="https://img.shields.io/badge/Zustand-5-433E38?style=flat-square&logo=react&logoColor=white" alt="Zustand" />
  <img src="https://img.shields.io/badge/electron--vite-latest-47848F?style=flat-square&logo=electron&logoColor=white" alt="electron-vite" />
  <img src="https://img.shields.io/badge/YARA--X-5-00ADD8?style=flat-square&logo=python&logoColor=white" alt="YARA-X" />
  <img src="https://img.shields.io/badge/Vitest-3-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/Playwright-latest-45BA4B?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/electron--builder-26-47848F?style=flat-square&logo=electron&logoColor=white" alt="electron-builder" />
</p>

| Categoria | Tecnologias |
|-----------|-------------|
| **Runtime** | Electron 42, Node.js 20+ |
| **Linguagem** | TypeScript 5.8 (strict mode) |
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Recharts |
| **Estado** | Zustand 5 |
| **Build** | electron-vite, electron-builder (NSIS) |
| **Testes** | Vitest 3, Playwright, Testing Library |
| **Segurança** | YARA-X (bindings nativas), crypto (Node.js) |
| **Banco de Dados** | better-sqlite3 (SQLite), lowdb |

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                  Electron Window                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Renderer (React 19)               │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────┐  │  │
│  │  │  Pages   │ │  Stores  │ │  Components    │  │  │
│  │  │  (33)    │ │ (Zustand)│ │  (Reutiliz.)   │  │  │
│  │  └────┬────┘ └────┬─────┘ └───────┬────────┘  │  │
│  │       │           │               │            │  │
│  │  ┌────▼───────────▼───────────────▼────────┐  │  │
│  │  │           IPC Bridge (contextBridge)      │  │  │
│  │  └───────────────────┬──────────────────────┘  │  │
│  └──────────────────────┼──────────────────────────┘  │
└─────────────────────────┼─────────────────────────────┘
                          │
┌─────────────────────────┼─────────────────────────────┐
│              Main Process (Node.js)                    │
│  ┌──────────────────────┴──────────────────────┐      │
│  │              IPC Handlers (33)               │      │
│  └──────────────────────┬──────────────────────┘      │
│                         │                              │
│  ┌──────────────────────┴──────────────────────┐      │
│  │              Services Layer                   │      │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │      │
│  │  │ Scanner  │ │ Cleaner  │ │  Security    │ │      │
│  │  │ Engines  │ │ Pipeline │ │  Analyzers   │ │      │
│  │  └──────────┘ └──────────┘ └──────────────┘ │      │
│  └──────────────────────┬──────────────────────┘      │
│                         │                              │
│  ┌──────────────────────┴──────────────────────┐      │
│  │            Platform Abstraction               │      │
│  │  ┌────────────────────────────────────────┐ │      │
│  │  │          Win32 Provider                 │ │      │
│  │  │  (Registry, WMI, Win32 API, DISM, ...)  │ │      │
│  │  └────────────────────────────────────────┘ │      │
│  └─────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

### 📁 Estrutura de diretórios

```
src/
├── main/                       # Processo principal (Node.js)
│   ├── index.ts                # Entry point + gerenciamento de janela
│   ├── cli.ts                  # Modo linha de comando (headless)
│   ├── daemon.ts               # Modo serviço (bandeja do sistema)
│   ├── ipc/                    # 33 handlers IPC (1 por módulo)
│   ├── services/               # Lógica de negócio (~40 serviços)
│   ├── platform/               # Abstração de plataforma
│   │   └── win32/              # Implementação Windows (registry, WMI, API)
│   └── constants/              # Paths, safelists, configurações
├── preload/                    # Bridge renderer ↔ main (contextBridge)
├── renderer/                   # Interface React
│   └── src/
│       ├── App.tsx             # Router + layout principal
│       ├── pages/              # 33 páginas (uma por módulo funcional)
│       ├── stores/             # Estado global (Zustand, 30+ stores)
│       ├── components/         # Componentes reutilizáveis (~60)
│       ├── hooks/              # Hooks customizados
│       ├── lib/                # Utilitários e helpers
│       └── locales/            # i18n (inglês, português, espanhol)
├── shared/                     # Código compartilhado
│   ├── types.ts                # Interfaces e tipos globais
│   └── channels.ts             # Constantes dos canais IPC
└── rules/
    └── win32/                  # Regras de limpeza (JSON)
```

---

## 💻 Desenvolvimento

### Pré-requisitos

- **Node.js** 20+ (LTS)
- **npm** 10+
- **Windows** com **Visual Studio Build Tools 2022**
  ```bash
  npm install -g windows-build-tools
  ```

### Setup

```bash
# 1. Clone
git clone https://github.com/optdinho/dinhoopt.git
cd dinhoopt

# 2. Instale as dependências
npm install

# 3. Inicie o servidor de desenvolvimento
npm run dev
```

### Scripts disponíveis

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Inicia em modo desenvolvimento (hot reload) |
| `npm run build` | Compila TypeScript + bundler |
| `npm run package` | Gera instalador NSIS em `dist/` |
| `npm test` | Executa testes unitários e de integração |
| `npm run coverage` | Executa testes com relatório de cobertura |
| `npm run lint` | Verifica código com Biome |
| `npm run lint:fix` | Corrige problemas de formatação automaticamente |
| `npm run typecheck` | Verificação de tipos TypeScript |

### 🧪 Testes

```bash
# Todos os testes
npm test

# Com cobertura (80%+ requerido)
npm run coverage

# Modo watch
npx vitest

# E2E (Playwright)
npx playwright test
```

```
📊 Cobertura atual: 80.3% — 161 arquivos de teste, 4.476 testes
```

---

## 📊 Estatísticas do projeto

| Métrica | Valor |
|---------|-------|
| Módulos | 35+ |
| Páginas | 33 |
| Stores (Zustand) | 30+ |
| Componentes React | 60+ |
| Serviços | ~40 |
| Handlers IPC | 33 |
| Arquivos de teste | 161 |
| Testes | 4.476 |
| Cobertura | 80.3% |
| Linhas de código | ~100.000+ |

---

## 🤝 Contribuindo

1. Faça um fork do projeto
2. Crie uma branch: `git checkout -b feat/nova-funcionalidade`
3. Commit suas mudanças: `git commit -m 'feat: adiciona nova funcionalidade'`
4. Push: `git push origin feat/nova-funcionalidade`
5. Abra um Pull Request

### Convenções

- **Commits:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
- **Cobertura:** Mínimo 80% para código novo
- **Lint:** Biome — `npm run lint` deve passar
- **TDD:** Escreva testes antes da implementação

---

## 📄 Licença

**Comercial** — todos os direitos reservados.

© 2026 DiNho. Este software não pode ser copiado, distribuído ou modificado sem autorização expressa.

🌐 [https://dinhooptimizer.netlify.app/](https://dinhooptimizer.netlify.app/)

---

<p align="center">
  <a href="https://github.com/optdinho/dinhoopt">🏠 Home</a> •
  <a href="https://github.com/optdinho/dinhoopt/releases">📦 Releases</a> •
  <a href="https://github.com/optdinho/dinhoopt/issues">🐛 Reportar Bug</a>
</p>

<p align="center">
  <sub>Feito com 🧠 e ☕ pelo time DiNho</sub>
</p>
