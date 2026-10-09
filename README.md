<p align="center">
  <img src="resources/icon.png" alt="DiNho Optimizer" width="120" />
</p>

<h1 align="center">🛡️ DiNho Optimizer</h1>

<p align="center">
  <strong>Otimização, segurança e privacidade para Windows 10/11 — tudo numa app, 60+ módulos</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-2.0.9-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Versão" />
  <img src="https://img.shields.io/badge/plataforma-Windows%2010%2F11-22c55e?style=for-the-badge&logo=windows11&logoColor=white" alt="Plataforma" />
  <img src="https://img.shields.io/badge/build-passing-22c55e?style=for-the-badge&logo=githubactions&logoColor=white" alt="Build" />
  <img src="https://img.shields.io/badge/coverage-95.6%25-22c55e?style=for-the-badge&logo=vitest&logoColor=white" alt="Coverage" />
  <img src="https://img.shields.io/badge/licença-Comercial-ef4444?style=for-the-badge&logo=legal&logoColor=white" alt="Licença" />
</p>

<p align="center">
  <a href="#-download">📥 Download</a> •
  <a href="#-novidades">📝 Novidades</a> •
  <a href="#-funcionalidades">⚡ Funcionalidades</a> •
  <a href="#-tecnologias">🛠️ Tecnologias</a> •
  <a href="#-desenvolvimento">💻 Desenvolvimento</a>
</p>

---

## 📥 Download

<p align="center">
  <a href="https://github.com/optdinho/dinhoopt/releases/latest">
    <img src="https://img.shields.io/badge/Baixar-DiNho_Optimizer_2.0.9-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Download" />
  </a>
</p>

| Componente | Tamanho |
|------------|---------|
| Instalador (NSIS) | ~243 MB |
| Portable | ~243 MB |

> **⚠️ Requer:** Windows 10 (build 19041+) ou Windows 11, 4 GB RAM, 500 MB de espaço livre.

---

## 📝 Novidades

> Histórico completo das versões anteriores em **[CHANGELOG.md](CHANGELOG.md)**.

### 2.0.9

**🔧 Instalador e release mais robustos.** O `electron-builder` publicava os dois alvos
(**NSIS** + **portable**) em paralelo e cada um tentava criar a release no GitHub ao mesmo
tempo — o segundo recebia `422 already_exists` e o run abortava a meio (a release nascia só
com o `.blockmap`). A release passa a ser criada **uma única vez, de forma idempotente**,
antes do `electron-builder`; os publishers apenas sobem os assets. O **body** da release
também passa a ser gerado do `CHANGELOG.md`. Sem alterações funcionais.

### 2.0.8

**🎬 A captura deixa de ser desligada pelas próprias otimizações.** Quatro tweaks "gaming"
punham o **Game DVR a zero** (`GameDVR_Enabled`, `AppCaptureEnabled` e `AllowGameDVR` em duas
chaves de política). O motor de Clips assenta no **Windows Graphics Capture**, e o serviço de
captura recusa arrancar enquanto essas chaves estão a 0 — falhava com `0x80070422` a cada
arranque. As tweaks foram removidas do catálogo, e uma **migração versionada** corre uma vez
após a atualização para repor as 5 chaves a `=1` em instalações existentes (idempotente, só
elevada, retenta se falhar). O motor também passou a avaliar a disponibilidade do WGC **uma vez
por sessão** e a saltar diretamente para **DXGI** quando a captura está mesmo desligada.

**📉 Teto de bitrate dos Clips mais baixo.** Os presets **"boa"** (720p60) e **"leve-60"**
(900p60) tinham um teto generoso demais e passam de 40/62,5 Mbps para **24/37,5 Mbps**. O CQ
(16/18/20/22) não muda — o teto VBV é limite, não alvo, portanto a qualidade visível mantém-se.

---

## ⚡ Funcionalidades

### 🔒 Segurança — 14 módulos

| Módulo | Descrição |
|--------|-----------|
| **Scanner de Malware** | Engine YARA-X + heurística comportamental |
| **Sandbox Comportamental** | Executa suspeitos em ambiente isolado |
| **Scanner de Memória** | Assinaturas de malware em memória de processos |
| **Analisador PE** | Secções, imports e hashes de ficheiros PE |
| **Detector de Explorações** | Shellcode em memória (NOP sled, heap spray, ROP) |
| **Inteligência de Ameaças** | abuse.ch (SSL Blacklist, Malware Bazaar) e PhishTank |
| **Linha do Tempo** | Correlação e timeline de eventos de segurança |
| **Regras YARA Custom** | Importa e gere regras YARA personalizadas |
| **Quarentena** | Gestão completa com allowlist e restore |
| **Scanner de Vulnerabilidades** | CVE scanner para software instalado |
| **Escudo de Privacidade** | Bloqueia rastreadores, telemetria e recolha de dados |
| **Auditoria de Firewall** | Audita e gere regras do Windows Defender Firewall |
| **Editor de Hosts** | Bloqueia domínios via edição segura do ficheiro hosts |
| **Domínios Protegidos** | Protege domínios críticos contra alteração |

### 📊 Monitorização — 3 módulos

| Módulo | Descrição |
|--------|-----------|
| **Monitor de Desempenho** | CPU, memória, disco, rede em tempo real + S.M.A.R.T. |
| **Scanner de Conformidade** | Verifica boas práticas de segurança do sistema |
| **Recolha de Métricas** | Análise e recolha de métricas do sistema |

### 🧹 Limpeza & Manutenção — 22 módulos

Limpeza do sistema (temp, logs, prefetch, DNS), navegadores, apps e jogos; registo com backup
automático e **restauro**; rede, atalhos, lixeira, variáveis de ambiente; WinSxS e WinApp2;
otimizador de base de dados; gestores de **inicialização**, **serviços** (incl. *STOPED*) e
**drivers**; removedor de bloatware e do **menu de contexto**; **Ajustes do Windows**, **Planos
de Energia**, **Tarefas Agendadas** e **Histórico**.

### 💾 Ferramentas de Disco — 7 módulos

Analisador (TreeMap), buscador de duplicatas (SHA-256) e de ficheiros grandes, limpeza de
pastas vazias, destruidor de ficheiros (sobrescrita), **Reparo de Disco** (SFC/DISM/CHKDSK) e
**Manutenção de Disco** (SSD TRIM).

### 📦 Software — 6 módulos

Atualizador de programas (winget) e de drivers; **Auto-Atualizador** (que *nunca reinicia por
cima de um trabalho em curso* — gravação, scan, re-encode ou upload adiam a instalação);
Desinstalador com limpeza de resíduos; Verificador de Segurança; Limpeza de Resíduos.

### ⚡ Ferramentas — 7 módulos

**Modo Jogo** (com deteção automática), **Benchmark**, Otimizador de Memória, **Modo Daemon**
(bandeja), **Modo CLI**, Onboarding e Exportação de Relatórios (CSV/JSON/TXT).

### ☁️ Cloud & Backup — 2 módulos

Cloud Backup de configurações e regras; Licenciamento via API remota.

### 🎮 Game Clips — 12 módulos

Gravador de clipes (replay buffer, **WGC + NVENC/AMF/QSV**), Modo Só Jogo, áudio por
aplicativo, editor (trim/merge/enhance), preview com seek por HTTP Range, publicação por link,
push-to-talk, redução de ruído (anlmdn), replay buffer RAM/híbrido, qualidade adaptativa,
presets CQ+VBV e notificações/hotkeys. Ver **[Tecnologias → Motor de Clips](#-motor-de-clips)**.

---

## 🛠️ Tecnologias

<p align="center">
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Zustand-5-433E38?style=flat-square&logo=react&logoColor=white" alt="Zustand" />
  <img src="https://img.shields.io/badge/YARA--X-0.7-00ADD8?style=flat-square" alt="YARA-X" />
  <img src="https://img.shields.io/badge/.NET-10-512BD4?style=flat-square&logo=dotnet&logoColor=white" alt=".NET" />
  <img src="https://img.shields.io/badge/ffmpeg-9.0-008000?style=flat-square&logo=ffmpeg&logoColor=white" alt="ffmpeg" />
</p>

| Categoria | Tecnologias |
|-----------|-------------|
| **Runtime** | Electron 44, Node.js 24+ |
| **Linguagem** | TypeScript 7 (strict mode) |
| **Frontend** | React 19, Tailwind CSS 4, shadcn/ui, Recharts |
| **Estado** | Zustand 5 |
| **Build** | electron-vite 6, electron-builder (NSIS) |
| **Testes** | Vitest 5, Playwright, Testing Library |
| **Segurança** | YARA-X 0.7 (bindings nativas), crypto (Node.js) |
| **Base de dados** | better-sqlite3 v13 (SQLite) |
| **Motor de Clips** | .NET 10 (C#), ffmpeg 9.0, NVENC/AMF/QSV, WGC, NAudio, Vortice (D3D11) |

### 🎬 Motor de Clips

O sistema de Game Clips usa um **motor de captura separado em C#** (`.NET 10`, self-contained,
Windows-only) que corre ao lado do app Electron e comunica por **named pipes**:

| Tecnologia | Uso |
|------------|-----|
| **.NET 10 (C#)** | Motor `DiNho.Capture.Poc` (self-contained, sem runtime externo) |
| **ffmpeg 9.0** | Encoders, mux MP4/Matroska, trim/merge, thumbnails (embarcado) |
| **NVENC / AMF / QSV** | Encoders de hardware NVIDIA / AMD / Intel (h264, HEVC, AV1) |
| **libx264 / libx265 / SVT-AV1** | Fallback de software |
| **Windows.Graphics.Capture (WGC)** | Captura de janela/desktop em alta qualidade |
| **DXGI Desktop Duplication** | Fallback de captura quando o WGC não está disponível |
| **NAudio (WASAPI)** | Áudio (loopback do sistema + microfone) |
| **Vortice (DXGI/D3D11)** | Conversão e processamento de frames na GPU |
| **ApplicationLoopback.dll (C++)** | Áudio por aplicativo (só o jogo) |
| **Named pipes** | IPC engine ↔ Electron (status, comandos, clips salvos) |

---

## 💻 Desenvolvimento

### Pré-requisitos

- **Node.js** 24+ (LTS) e **npm** 10+
- **Windows** com **Visual Studio Build Tools 2022** (motor de Clips em .NET 10)

### Setup

```bash
git clone https://github.com/optdinho/dinhoopt.git
cd dinhoopt
npm install
npm run dev
```

> O `npm run dev` **auto-eleva** (o app precisa de privilégios de administrador): aceita o
> prompt UAC uma vez e a app abre elevada com o renderer em `localhost:5173`.

### Scripts

| Comando | Descrição |
|---------|-----------|
| `npm run dev` | Modo desenvolvimento (hot reload, auto-elevação) |
| `npm run build` | Compila TypeScript + bundler |
| `npm run package` | Gera o instalador NSIS em `dist/` |
| `npm run publish` | Empacota e publica a release no GitHub Releases |
| `npm test` | Testes unitários e de integração (Vitest) |
| `npm run test:coverage` | Testes com relatório de cobertura |
| `npm run test:e2e` | Journey E2E (Playwright) |
| `npm run lint` / `lint:fix` | Verifica / corrige com Biome |
| `npm run typecheck` | Verificação de tipos TypeScript |

### 🧪 Qualidade

```
Cobertura: 95,6% linhas · 94,3% funções · 86,7% branches  (gate mínimo: 80%)
TS:  7.852 testes em 288 ficheiros (Vitest) · Biome 0 · tsc 0
C#:  2.539 testes (Release), 0 falhas, 0 ignorados
```

A app eleva-se sozinha em desenvolvimento; para correr E2E sem elevação use `DINHO_E2E=1`.

---

## 🤝 Contribuindo

1. Fork do projeto e branch: `git checkout -b feat/nova-funcionalidade`
2. Commit no padrão [Conventional Commits](https://www.conventionalcommits.org/) —
   `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`
3. Garanta **80%+ de cobertura** para código novo e `npm run lint` a passar (TDD)
4. Pull Request

---

## 📄 Licença

**Comercial** — todos os direitos reservados. © 2026 DiNho. Este software não pode ser
copiado, distribuído ou modificado sem autorização expressa.

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
