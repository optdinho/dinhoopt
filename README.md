<p align="center">
  <img src="resources/icon.png" alt="DiNho Optimizer" width="120" />
</p>

<h1 align="center">🛡️ DiNho Optimizer</h1>

<p align="center">
  <strong>Plataforma completa de otimização, segurança e privacidade para Windows 10/11 — 60+ módulos</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-1.0.7-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Versão" />
  <img src="https://img.shields.io/badge/plataforma-Windows%2010%2F11-22c55e?style=for-the-badge&logo=windows11&logoColor=white" alt="Plataforma" />
  <img src="https://img.shields.io/badge/build-passing-22c55e?style=for-the-badge&logo=githubactions&logoColor=white" alt="Build" />
  <img src="https://img.shields.io/badge/coverage-85%25-22c55e?style=for-the-badge&logo=vitest&logoColor=white" alt="Coverage" />
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
    <img src="https://img.shields.io/badge/Baixar-DiNho_Optimizer_1.0.7-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Download" />
  </a>
</p>

| Componente | Tamanho |
|------------|---------|
| Instalador (NSIS) | ~219 MB |
| Portable | ~219 MB |

> **⚠️ Requer:** Windows 10 (build 19041+) ou Windows 11, 4 GB RAM, 500 MB de espaço livre.

---

## ⚡ Funcionalidades

<details open>
<summary><strong>🔒 Segurança</strong> — 15 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Scanner de Malware** | Detecção de ameaças usando engine YARA-X + heurística comportamental |
| **Sandbox Comportamental** | Executa suspeitos em ambiente isolado e analisa comportamento |
| **Scanner de Memória** | Escaneia memória de processos ativos por assinaturas de malware |
| **Analisador PE** | Analisa arquivos PE (seções, imports, hashes) |
| **Detector de Explorações** | Detecta explorações ativas (mimikatz, EternalBlue…) |
| **Inteligência de Ameaças** | Consulta cruzada a VirusTotal, AbuseIPDB e outras fontes |
| **Linha do Tempo** | Correlação e timeline de eventos de segurança |
| **Regras YARA Custom** | Importa e gerencia regras YARA personalizadas |
| **Quarentena** | Gerenciamento completo com allowlist e restore |
| **Fortificação do Sistema** | Reforça a segurança com políticas e configurações do Windows |
| **Scanner de Vulnerabilidades** | CVE scanner para software instalado |
| **Escudo de Privacidade** | Bloqueia rastreadores, telemetria e coleta de dados |
| **Auditoria de Firewall** | Audita e gerencia regras do Windows Defender Firewall |
| **Editor de Hosts** | Bloqueia domínios via edição segura do arquivo hosts |
| **Domínios Protegidos** | Protege domínios críticos contra alteração por malware |

</details>

<details open>
<summary><strong>📊 Monitoramento</strong> — 3 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Monitor de Desempenho** | CPU, memória, disco, rede em tempo real + S.M.A.R.T. |
| **Scanner de Conformidade** | Verifica se o sistema segue boas práticas de segurança |
| **Coleta de Métricas** | Análise e coleta de métricas do sistema |

</details>

<details open>
<summary><strong>🧹 Limpeza & Manutenção</strong> — 22 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Limpeza do Sistema** | Temp files, logs, crash dumps, prefetch, cache DNS |
| **Limpeza de Navegadores** | Chrome, Edge, Firefox, Brave, Opera, Vivaldi e mais |
| **Limpeza de Apps** | Discord, VS Code, Spotify, Teams, Zoom, Slack e dezenas |
| **Limpeza de Jogos** | Steam, Epic Games, EA App, GOG — caches e shaders |
| **Limpeza do Registro** | Entradas inválidas e órfãs com backup automático |
| **Limpeza de Rede** | DNS, perfis Wi-Fi, cache ARP, rotas |
| **Limpeza de Atalhos** | Remove atalhos quebrados do sistema |
| **Limpeza de Lixeira** | Esvazia e gerencia a lixeira do Windows |
| **Variáveis de Ambiente** | Limpa variáveis de ambiente obsoletas |
| **Otimizador de Banco de Dados** | Compacta e otimiza bancos do sistema |
| **WinSxS Cleaner** | Reduz o componente store via DISM |
| **Importação WinApp2** | Importa regras de limpeza personalizadas |
| **Gerenciador de Inicialização** | Gerencia programas que iniciam com o Windows |
| **Gerenciador de Serviços** | Otimiza serviços do Windows por perfil |
| **Gerenciador de Drivers** | Detecta, backup e remove drivers obsoletos |
| **Removedor de Bloatware** | Remove aplicativos indesejados do Windows |
| **Menu de Contexto** | Gerencia entradas do menu de contexto do Explorer |
| **Ajustes do Windows** | Personaliza desempenho e comportamento do Windows |
| **Planos de Energia** | Cria, ativa e gerencia planos de energia |
| **Tarefas Agendadas** | Agenda limpezas e manutenções automáticas |
| ~~Pontos de Restauração~~ | ~~Cria e gerencia pontos de restauração do sistema~~ *(não implementado)* |
| **Histórico** | Histórico completo de scans e limpezas realizadas |

</details>

<details open>
<summary><strong>💾 Ferramentas de Disco</strong> — 7 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Analisador de Disco** | TreeMap interativo do uso de espaço no disco |
| **Buscador de Duplicatas** | Localiza duplicatas por hash SHA-256 |
| **Buscador de Arquivos Grandes** | Encontra os maiores arquivos do disco |
| **Limpeza de Pastas Vazias** | Remove pastas vazias residual |
| **Destruidor de Arquivos** | Exclusão segura com sobrescrita (3 passadas) |
| **Reparo de Disco** | SFC, DISM, CHKDSK com um clique |
| **Manutenção de Disco** | SSD TRIM e otimização de unidades |

</details>

<details open>
<summary><strong>📦 Software</strong> — 6 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Atualizador de Programas** | Atualiza programas instalados via winget |
| **Atualizador de Drivers** | Detecta e atualiza drivers desatualizados |
| **Auto-Atualizador** | Atualiza o próprio DiNho Optimizer automaticamente |
| **Desinstalador** | Remove programas e seus resíduos |
| **Verificador de Segurança** | Exibe classificação de segurança de programas (UI pronta; avaliação offline/stub no backend) |
| **Limpeza de Resíduos** | Remove sobras de desinstalações anteriores |

</details>

<details open>
<summary><strong>⚡ Ferramentas</strong> — 7 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Modo Jogo** | Otimiza o sistema para jogos |
| **Benchmark** | Testa e pontua o desempenho do hardware |
| **Otimizador de Memória** | Libera RAM em uso |
| **Modo Daemon** | Execução em segundo plano na bandeja |
| **Modo CLI** | Operação completa via linha de comando |
| **Onboarding** | Configuração inicial guiada do usuário |
| **Exportação de Relatórios** | Exporta resultados em PDF/CSV |

</details>

<details open>
<summary><strong>☁️ Cloud & Backup</strong> — 2 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Cloud Backup** | Backup em nuvem de configurações e regras |
| **Licenciamento** | Ativação e validação via API remota |

</details>

<details open>
<summary><strong>🎮 Game Clips</strong> — 12 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Gravador de Clipes** | Captura replay buffer de jogos (WGC + NVENC/AMF/QSV) |
| **Modo Só Jogo** | Captura apenas o jogo + microfone, mute de outras apps |
| **Áudio por Aplicativo** | Seleciona quais apps terão áudio no clip (por processo) |
| **Editor de Clipes** | Trim (fast copy ou re-encode), merge e enhance AMD via ffmpeg |
| **Preview de Vídeo** | Player integrado com seek por HTTP Range |
| **Publicação de Clipes** | Upload do clip e geração de link para compartilhar |
| **Push-to-Talk** | Ativa o microfone por tecla personalizável (hold/toggle) |
| **Redução de Ruído** | Denoising do microfone em tempo real (ffmpeg anlmdn) |
| **Replay Buffer** | Modo RAM ou híbrido com spill em disco para clips longos |
| **Qualidade Adaptativa** | Reduz resolução automaticamente em PC com pouca performance |
| **Configuração de Qualidade** | Presets CQ+VBV, resolução, nitidez (CAS), stretch |
| **Notificações & Hotkeys** | Hotkeys personalizáveis, toast ao salvar clip, favoritos e auto-limpeza |

</details>

---

## 🛠️ Tecnologias

<p align="center">
  <img src="https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/shadcn/ui-latest-000000?style=flat-square&logo=shadcnui&logoColor=white" alt="shadcn/ui" />
  <img src="https://img.shields.io/badge/Zustand-5-433E38?style=flat-square&logo=react&logoColor=white" alt="Zustand" />
  <img src="https://img.shields.io/badge/electron--vite-6-47848F?style=flat-square&logo=electron&logoColor=white" alt="electron-vite" />
  <img src="https://img.shields.io/badge/YARA--X-0.7-00ADD8?style=flat-square&logo=python&logoColor=white" alt="YARA-X" />
  <img src="https://img.shields.io/badge/Vitest-4-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/Playwright-latest-45BA4B?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/electron--builder-26-47848F?style=flat-square&logo=electron&logoColor=white" alt="electron-builder" />
</p>

| Categoria | Tecnologias |
|-----------|-------------|
| **Runtime** | Electron 43, Node.js 22+ |
| **Linguagem** | TypeScript 7 (strict mode) |
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Recharts |
| **Estado** | Zustand 5 |
| **Build** | electron-vite 6, electron-builder (NSIS) |
| **Testes** | Vitest 4, Playwright, Testing Library |
| **Segurança** | YARA-X 0.7 (bindings nativas), crypto (Node.js) |
| **Banco de Dados** | better-sqlite3 (SQLite) |

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                  Electron Window                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Renderer (React 19)               │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────┐  │  │
│  │  │  Pages   │ │  Stores  │ │  Components    │  │  │
│  │  │  (37)    │ │ (Zustand)│ │  (Reutiliz.)   │  │  │
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
│  │              IPC Handlers (237)               │      │
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
│   ├── cli/                    # Modo linha de comando (headless)
│   ├── daemon.ts               # Modo serviço (bandeja do sistema)
│   ├── ipc/                    # 237 handlers IPC (1 por módulo)
│   ├── services/               # Lógica de negócio (61 serviços)
│   ├── platform/               # Abstração de plataforma
│   │   └── win32/              # Implementação Windows (registry, WMI, API)
│   └── constants/              # Paths, safelists, configurações
├── preload/                    # Bridge renderer ↔ main (contextBridge)
├── renderer/                   # Interface React
│   └── src/
│       ├── App.tsx             # Router + layout principal
│       ├── pages/              # 37 páginas (uma por módulo funcional)
│       ├── stores/             # Estado global (Zustand, 37 stores)
│       ├── components/         # Componentes reutilizáveis (125)
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

- **Node.js** 22+ (LTS)
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
| `npm run test:coverage` | Executa testes com relatório de cobertura |
| `npm run lint` | Verifica código com Biome |
| `npm run lint:fix` | Corrige problemas de formatação automaticamente |
| `npm run typecheck` | Verificação de tipos TypeScript |

### 🧪 Testes

```bash
# Todos os testes
npm test

# Com cobertura (80%+ requerido)
npm run test:coverage

# Modo watch
npx vitest

# E2E (Playwright)
npx playwright test
```

```
📊 Cobertura atual: ~85%+ — 227 arquivos de teste, ~6.900 testes
```

---

## 📊 Estatísticas do projeto

| Métrica | Valor |
|---------|-------|
| Módulos | 60+ |
| Páginas | 37 |
| Stores (Zustand) | 37 |
| Componentes React | 125 |
| Serviços | 61 |
| Handlers IPC | 237 |
| Arquivos de teste | 227 |
| Testes | ~6.900 |
| Cobertura | ~85%+ |
| Linhas de código | ~106.000+ |

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
