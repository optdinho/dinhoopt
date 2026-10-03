<p align="center">
  <img src="resources/icon.png" alt="DiNho Optimizer" width="120" />
</p>

<h1 align="center">🛡️ DiNho Optimizer</h1>

<p align="center">
  <strong>Plataforma completa de otimização, segurança e privacidade para Windows 10/11 — 60+ módulos</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/versão-2.0.4-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Versão" />
  <img src="https://img.shields.io/badge/plataforma-Windows%2010%2F11-22c55e?style=for-the-badge&logo=windows11&logoColor=white" alt="Plataforma" />
  <img src="https://img.shields.io/badge/build-passing-22c55e?style=for-the-badge&logo=githubactions&logoColor=white" alt="Build" />
  <img src="https://img.shields.io/badge/coverage-95.8%25-22c55e?style=for-the-badge&logo=vitest&logoColor=white" alt="Coverage" />
  <img src="https://img.shields.io/badge/licença-Comercial-ef4444?style=for-the-badge&logo=legal&logoColor=white" alt="Licença" />
</p>

<p align="center">
  <a href="#-download">📥 Download</a> •
  <a href="#-novidades-da-203">📝 Novidades</a> •
  <a href="#-funcionalidades">⚡ Funcionalidades</a> •
  <a href="#-tecnologias">🛠️ Tecnologias</a> •
  <a href="#-arquitetura">🏗️ Arquitetura</a> •
  <a href="#-desenvolvimento">💻 Desenvolvimento</a>
</p>

---

## 📥 Download

<p align="center">
  <a href="https://github.com/optdinho/dinhoopt/releases/latest">
    <img src="https://img.shields.io/badge/Baixar-DiNho_Optimizer_2.0.4-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Download" />
  </a>
</p>

| Componente | Tamanho |
|------------|---------|
| Instalador (NSIS) | ~243 MB |
| Portable | ~243 MB |

> **⚠️ Requer:** Windows 10 (build 19041+) ou Windows 11, 4 GB RAM, 500 MB de espaço livre.

---

## 📝 Novidades da 2.0.6

### 🎯 A resolução que escolhes é a que é gravada

O motor de Clips podia **degradar a resolução escolhida a meio de uma gravação**. Ao
detetar que o encoder "não acompanhava", o *capacity guard* baixava de 1080p para 720p e
reiniciava o ffmpeg — e esse reinício descartava o backlog de output e o estado de PTS,
deixando o áudio dessincronizado do vídeo (num clip real, ~9,5 s de desvio).

O sinal que disparava o guard estava errado: `speed` e `outLag` do ffmpeg medem o
**feed** (a taxa a que os frames chegam ao encoder), não o trabalho do encoder. Um jogo a
renderizar abaixo de 60 fps fazia parecer saturação onde não havia nenhuma — a fila estava
vazia e não se perdia um único frame.

A regra passou a ser explícita: o divisor de fallback e o *capacity guard* **só reduzem a
resolução quando não há alvo explícito** (modo nativo). Logo que escolhes uma resolução, é
essa que sai — e o guard deixa de reiniciar o ffmpeg a meio da sessão.

### 📦 Dependências em dia

Electron 44.5.1, Vite 8.3.2, Biome 2.5.15, Vitest 5.0.3, framer-motion 14 e
`@types/node` 26 (tipos alinhados com o Node 24 embutido no Electron 44), CsWin32 0.3.346.
A suíte cobre a adaptação — `ExecException.cmd` passou a obrigatório e os mocks de
`execFile` foram ajustados. Os advisories de `npm audit` que restam são todos de
ferramentas de build (dev), nenhum no runtime embarcado.

### ✅ Qualidade interna

| | Antes | Agora |
|---|---|---|
| Testes (TS) | 7.792 | **7.800** |
| Testes (C#, Release) | 2.212 | **2.443** |

`biome` limpo em 888 ficheiros, `tsc --noEmit` sem erros, build sem avisos.

---

## 📝 Novidades da 2.0.5

### 🎮 Modo Jogo realmente automático

A **Detecção Automática** estava a meio caminho: quando um jogo era detectado, o app
abria a captura de Clips sem o motor de captura estar a correr. O `startClipCapture()`
respondia `Engine not running` e a gravação não começava — sem erro visível, porque o
resultado era engolido.

Agora o Modo Jogo **sobe o motor de captura** quando precisa e só depois inicia a
gravação, com 3 tentativas separadas por 2 s para cobrir a subida do processo C#. Se
ainda assim falhar, o motivo fica no log em vez de desaparecer.

### ⏱️ 5 minutos de tolerância ao sair do jogo

Desligar o Modo Jogo no instante em que o processo sumia era frágil demais — o FiveM
relança o `GTAProcess.exe`, e uma janela que pisca podia derrubar a sessão a meio da
partida. Agora o app espera **5 minutos** sem jogo antes de reagir:

- O jogo voltou dentro do prazo → **nada acontece**, a sessão continua.
- Passou o prazo → restaura o sistema e **para a gravação**.

Quem liga a captura é quem a para. Mesmo que a restauração falhe, a gravação é
encerrada na mesma medida — não há cenário em que a captura fica a correr sozinha.

### 🎛️ Pré-configuração chega a toda a gente

As 16 otimizações do Modo Jogo passaram a ser a **pré-configuração do app**, definida
num único sítio e consumida pelo processo principal e pelos dois stores do renderer
(antes havia três listas, todas diferentes).

O ponto que faltava: instalações **já existentes** nunca recebiam novidades, porque a
leitura da configuração só acrescenta chaves em falta — nunca atualiza listas. Uma
migração versionada resolve isso e corre **uma única vez**, carimbando a configuração
com a versão aplicada. A partir daí o utilizador decide, e a migração não volta a mexer.

### 🐛 Correções

- O detector de jogos passa a arrancar no **boot do app**. Antes só começava ao abrir a
  página do Modo Jogo ou dos Clips — e pior, **sair** de uma dessas páginas desligava
  a detecção a meio.
- `svc-sysmain` saiu da lista padrão: desligar o Superfetch prejudica o carregamento
  inicial dos jogos, que é justamente quando se quer o sistema rápido.
- `svc-diagtrack` saiu da lista padrão: os serviços de diagnóstico são uma porta de
  entrada para rastreio, e não é um risco que valha a pena por omissão.

### ✅ Qualidade interna

| | Antes | Agora |
|---|---|---|
| Testes (TS) | 7.741 | **7.792** |
| Arquivos de teste | 272 | **275** |

`biome` limpo em 888 ficheiros, `tsc --noEmit` sem erros, build sem avisos.

---

## 📝 Novidades da 2.0.4

### ⚡ Instalação 96% mais rápida

O DiNho passa a ser empacotado em **asar** — um arquivo único — em vez de ~10.900 ficheiros
soltos no disco. Na prática, o que muda para quem instala:

- **10.939 → 449 ficheiros** copiados durante a instalação (−96%).
- O antivírus scanneia **cada ficheiro escrito**, portanto o custo de segurança cai na
  mesma proporção. A instalação deixou de arrastar o Defender durante vários minutos.
- Instalador ligeiramente **mais pequeno**: ~250 MB → **~243 MB**.

### 🧹 Porque estava desligado (e porque voltou)

Em agosto de 2026 o asar foi desligado por causa de um bug do Chromium: o `netstack` do
renderer devolvia `ERR_FILE_NOT_FOUND` e o app abria com ecrã preto. O `fs` do Node lia o
mesmo asar sem qualquer problema — a causa nunca foi isolada com precisão.

Em 2026-09-30 voltámos a testar em profundidade (Electron 44.4.5 + electron-vite 6.0.0) e
**o problema já não se reproduz**. A explicação provável: o Electron reescreveu a camada de
leitura de asar para servir ficheiros diretamente do arquivo, sem extrair uma cópia
temporária. O bug que nos travou foi corrigido a montante.

### 🔐 Invariantes de segurança mantidos

Os módulos nativos (`better-sqlite3` e o motor de malware) continuam **fora** do asar, onde
têm de estar para o carregamento via `dlopen` funcionar. E nada foi afrouxado nas restantes
fuses de segurança do Electron.

---

## 📝 Novidades da 2.0.3

### 🌐 Escolher e medir o DNS de verdade

A escolha de DNS deixou de ser uma caixa cega. O **teste de velocidade mede agora o
resolvedor por UDP** — o mesmo mecanismo que o Windows usa para resolver nomes — em vez
de fazer `ping`, que media o caminho até ao servidor e não a resposta do resolvedor.

Todas as opções (Cloudflare, Google, OpenDNS, Quad9) ficam sempre visíveis: **pode
aplicar qualquer uma**, o teste apenas ordena a lista por velocidade. O servidor mais
rápido ganha o selo **Melhor**, e há ação rápida para o aplicar. Servers que não
respondem dentro do tempo limite vão para o fim, marcados como sem resposta.

O app passa a **detetar o DNS que está em uso**, lendo o servidor da interface que tem a
rota por omissão, e mostra se veio por DHCP. Depois de aplicar, volta a ler o estado real
— o selo **Atual** já não fica desatualizado depois de uma escolha manual.

### ⚡ Planos de Energia reconstruídos

A página foi reescrita: planos agrupados entre **Planos do sistema** e **Planos
personalizados**, com o tipo de cada plano identificado (Desempenho máximo, Alto
desempenho, Equilibrado, Poupança, Personalizado).

O plano **Desempenho Máximo** desbloqueia com um clique. O Windows oculta-o em quase todas
as editions, e é o único que desliga a poupança de energia ao nível do hardware — útil em
máquinas de secretária ligadas à corrente. O botão avisa que consome mais energia e pode
subir a temperatura.

### 🧰 Otimizações do Windows — Ferramentas Avançadas

Três tweaks que mexem no comportamento interno do Windows, com explicação do que fazem,
o respetivo link de documentação da Microsoft e os avisos correspondentes: ajustes da
pilha **TCP/IP** (chimney, timestamps, RTO) e do **timer** (HPET, TSC Sync, Dynamic
Tick). Não são necessários para o dia a dia — a secção diz isso explicitamente, porque a
Microsoft os documenta como opções de depuração e podem destabilizar o sistema.

### 🔧 Correções no `powercfg`

O leitor de saída do `powercfg` dependia de texto em inglês e passava a falhar em
Windows português ou deutsch. Passou a ser **independente do idioma**.

Corrigidos ainda os **GUIDs do ASPM**, que não endereçavam o subgrupo correto, e o revert
do `PROCTHROTTLEMIN`, que restaurava o mínimo do processador em 100% em vez dos 5%
originais.

### 🧹 Limpeza

A página passa a chamar-se **Limpeza**, com os resultados agrupados em **Sistema**,
**Aplicações** e **Manutenção**.

A barra de ação inferior deixava de estardes "solta": estava fixa à janela, começava em
`x=0` e ficava **por cima da barra lateral**. Agora está alinhada à coluna de conteúdo,
encostada ao fundo, e **acompanha a barra lateral quando a recolhemos** — durante a
animação, píxel a píxel.

### 🛠️ Reparo do Windows

Passa a chamar-se **Reparo do Windows** (as ferramentas são DISM e SFC, não de disco) e
avisa quando passa mais de 15 dias sem uma verificação, para apanhar ficheiros de sistema
corrompidos antes que causem instabilidade.

### ✅ Qualidade interna

- `powercfg` coberto por testes contra o parser locale-independent
- DNS: benchmark, leitura do estado atual e refresh pós-aplicação com testes
- Geometria da barra de ação verificada em browser real (19 medições: fundo da janela,
  sidebar recolhida, alinhamento, zero scroll horizontal)
- 7741 testes em 272 ficheiros · `tsc` 0 · Biome 0 em 882 ficheiros · build ok
- `npm audit` em 0 vulnerabilidades

---

## ⚡ Funcionalidades

<details open>
<summary><strong>🔒 Segurança</strong> — 14 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Scanner de Malware** | Detecção de ameaças usando engine YARA-X + heurística comportamental |
| **Sandbox Comportamental** | Executa suspeitos em ambiente isolado e analisa comportamento |
| **Scanner de Memória** | Escaneia memória de processos ativos por assinaturas de malware |
| **Analisador PE** | Analisa arquivos PE (seções, imports, hashes) |
| **Detector de Explorações** | Assinaturas de shellcode em memória (NOP sled, heap spray, ROP, egg hunter) |
| **Inteligência de Ameaças** | Consulta cruzada a feeds do abuse.ch (SSL Blacklist, Malware Bazaar) e PhishTank |
| **Linha do Tempo** | Correlação e timeline de eventos de segurança |
| **Regras YARA Custom** | Importa e gerencia regras YARA personalizadas |
| **Quarentena** | Gerenciamento completo com allowlist e restore |
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
| **Limpeza de Navegadores** | Chrome, Edge, Firefox, Brave, Opera, Vivaldi e mais — com proteção de cookies por padrão |
| **Limpeza de Apps** | Discord, VS Code, Spotify, Teams, Zoom, Slack e dezenas |
| **Limpeza de Jogos** | Steam, Epic Games, EA App, GOG — caches e shaders |
| **Limpeza do Registro** | Entradas inválidas ou órfãs com backup automático |
| **Limpeza de Rede** | DNS, perfis Wi-Fi, cache ARP, rotas |
| **Limpeza de Atalhos** | Remove atalhos quebrados do sistema |
| **Limpeza de Lixeira** | Esvazia e gerencia a lixeira do Windows |
| **Variáveis de Ambiente** | Limpa variáveis de ambiente obsoletas |
| **Otimizador de Banco de Dados** | Compacta e otimiza bancos do sistema |
| **WinSxS Cleaner** | Reduz o componente store via DISM |
| **Importação WinApp2** | Importa regras de limpeza personalizadas |
| **Gerenciador de Inicialização** | Gerencia programas que iniciam com o Windows |
| **Gerenciador de Serviços** | Otimiza serviços do Windows por perfil |
| **STOPED** | Para os 7 serviços que degradam o Windows (DiagTrack, DPS, SysMain, PcaSvc, EventLog, AdpSvc, UmRdp) com status exato e ações em massa |
| **Gerenciador de Drivers** | Detecta, backup e remove drivers obsoletos |
| **Removedor de Bloatware** | Remove aplicativos indesejados do Windows |
| **Menu de Contexto** | Gerencia entradas do menu de contexto do Explorer |
| **Ajustes do Windows** | Personaliza desempenho e comportamento do Windows |
| **Planos de Energia** | Cria, ativa e gerencia planos de energia |
| **Tarefas Agendadas** | Agenda limpezas e manutenções automáticas |
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
| **Destruidor de Arquivos** | Exclusão segura com sobrescrita (2 passadas) |
| **Reparo de Disco** | SFC, DISM, CHKDSK com um clique |
| **Manutenção de Disco** | SSD TRIM e otimização de unidades |

</details>

<details open>
<summary><strong>📦 Software</strong> — 6 módulos</summary>

| Módulo | Descrição |
|--------|-----------|
| **Atualizador de Programas** | Atualiza programas instalados via winget |
| **Atualizador de Drivers** | Detecta e atualiza drivers desatualizados |
| **Auto-Atualizador** | Atualiza o próprio DiNho Optimizer automaticamente — e **nunca reinicia por cima de um trabalho em andamento**: se uma gravação, um scan, um re-encode ou um upload estiver ativo, a instalação é adiada e retoma sozinha quando o app fica ocioso |
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
| **Exportação de Relatórios** | Exporta resultados em CSV, JSON e TXT |

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
| **Qualidade Adaptativa** | Calibra preset e limita a resolução ao perfil de RAM da máquina (opcional); a resolução escolhida nunca é degradada por fallback a meio da gravação |
| **Configuração de Qualidade** | Presets CQ+VBV, resolução, nitidez (CAS), stretch |
| **Notificações & Hotkeys** | Hotkeys personalizáveis, toast ao salvar clip, favoritos e auto-limpeza |

</details>

---

## 🛠️ Tecnologias

<p align="center">
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron" />
  <img src="https://img.shields.io/badge/TypeScript-7-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/shadcn/ui-latest-000000?style=flat-square&logo=shadcnui&logoColor=white" alt="shadcn/ui" />
  <img src="https://img.shields.io/badge/Zustand-5-433E38?style=flat-square&logo=react&logoColor=white" alt="Zustand" />
  <img src="https://img.shields.io/badge/electron--vite-6-47848F?style=flat-square&logo=electron&logoColor=white" alt="electron-vite" />
  <img src="https://img.shields.io/badge/YARA--X-0.7-00ADD8?style=flat-square&logo=python&logoColor=white" alt="YARA-X" />
  <img src="https://img.shields.io/badge/Vitest-5-6E9F18?style=flat-square&logo=vitest&logoColor=white" alt="Vitest" />
  <img src="https://img.shields.io/badge/Playwright-latest-45BA4B?style=flat-square&logo=playwright&logoColor=white" alt="Playwright" />
  <img src="https://img.shields.io/badge/electron--builder-26-47848F?style=flat-square&logo=electron&logoColor=white" alt="electron-builder" />
  <img src="https://img.shields.io/badge/.NET-10-512BD4?style=flat-square&logo=dotnet&logoColor=white" alt=".NET" />
  <img src="https://img.shields.io/badge/ffmpeg-9.0-008000?style=flat-square&logo=ffmpeg&logoColor=white" alt="ffmpeg" />
  <img src="https://img.shields.io/badge/NVENC/AMF/QSV-HW%20Encoders-76B900?style=flat-square" alt="HW Encoders" />
  <img src="https://img.shields.io/badge/Windows.Graphics.Capture-WGC-0078D4?style=flat-square&logo=windows&logoColor=white" alt="WGC" />
  <img src="https://img.shields.io/badge/NAudio-3.1-512BD4?style=flat-square" alt="NAudio" />
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
| **Banco de Dados** | better-sqlite3 v13 (SQLite) |
| **Motor de Clips** | .NET 10 (C#), ffmpeg 9.0, NVENC/AMF/QSV, WGC, NAudio, RNNoise, Vortice (D3D11) |

### 🎬 Motor de Clips

O sistema de Game Clips usa um **motor de captura separado em C#** (`.NET 10`, self-contained, Windows-only) que roda ao lado do app Electron e se comunica via named pipes:

| Tecnologia | Uso |
|------------|-----|
| **.NET 10 (C#)** | Motor de captura `DiNho.Capture.Poc` (self-contained, sem runtime externo) |
| **ffmpeg 9.0** | Encoders, mux MP4/Matroska, trim/merge, thumbnails (embarcado no instalador) |
| **NVENC / AMF / QSV** | Encoders de hardware NVIDIA / AMD / Intel (h264, HEVC, AV1) |
| **libx264 / libx265 / SVT-AV1** | Fallback de software quando HW não está disponível |
| **Windows.Graphics.Capture (WGC)** | Captura de janela/desktop em alta qualidade |
| **NAudio (WASAPI)** | Captura de áudio (loopback do sistema + microfone) |
| **Vortice (DXGI/D3D11)** | Renderização, conversão e processamento de frames GPU |
| **RNNoise (anlmdn)** | Supressão de ruído do microfone |
| **ApplicationLoopback.dll (C++)** | Áudio por aplicativo (só o jogo, sem Discord/navegador) |
| **Matroska/EBML + MP4** | Container intermediário com timestamps e mux final |
| **Named pipes** | IPC engine ↔ Electron (status, comandos, clips salvos) |

### 🎮 Detecção de jogos no Modo Jogo

Com **Detecção Automática** ligada, o Modo Jogo ativa as otimizações quando um jogo é
detectado e as reverte quando ele fecha. O detector é iniciado no **boot do app**, pelo
processo principal — não depende de nenhuma página estar aberta, portanto navegar para
fora do Modo Jogo não desliga a detecção.

A detecção tem duas etapas, porque nenhuma delas sozinha cobre tudo:

1. **Por nome de processo** — polling de `tasklist` a cada 30 s contra a lista embutida
   mais o catálogo `games.json` do motor de clips (452 jogos), incluindo aliases.
2. **Por classe de janela (fallback)** — quando nenhum nome corresponde, uma sonda
   Win32 (`EnumWindows` + `GetClassName`) enumera as janelas visíveis e compara a
   classe de cada uma contra as 177 `windowClass` do catálogo (mais 7 entradas
   fixas espelhadas do C#). É o que detecta jogos com nome versionado, como
   `FiveM_b3258_GTAProcess.exe`, que nenhum catálogo de nomes consegue enumerar.

A sonda é cara de propósito: iniciar o PowerShell já custa ~1,3 s (medido), e a
enumeração completa leva ~1,8 s. Por isso ela **só roda quando algum processo novo
apareceu desde o último polling** — nunca a cada 30 s. Também não depende do motor
C# estar rodando, aborta junto com o detector, e qualquer falha dela (PowerShell
bloqueado por política, `Add-Type` negado) devolve lista vazia sem quebrar a
detecção por nome.

Quando o jogo vem da classe de janela, o evento carrega também o nome amigável do
catálogo (ex.: `FiveM (GTA V)`), usado no banner e como chave alternativa para o
perfil de otimizações do jogo.

### ⏱️ Tolerância de 5 minutos ao sair do jogo

Quando o jogo deixa de ser detectado, o Modo Jogo **não desativa imediatamente**. Um
jogo pode fechar a janela, trocar de executável ou reaparecer com outro nome durante
segundos — FiveM relança `GTAProcess.exe`, por exemplo. Desativar nesse instante
derrubia as otimizações e a gravação no meio da sessão.

O comportamento é agora:

| Situação | O que acontece |
|----------|----------------|
| Jogo detectado | Motor de captura subido (se preciso) e gravação iniciada |
| Jogo ausente **< 5 min** | Tolerância cancelada se voltar — a sessão continua intacta |
| Jogo ausente **≥ 5 min** | Restaura o sistema **e para a gravação**, sempre |
| Desativar manualmente | Restaura o sistema e para a gravação |

A gravação automática é pareada com a sessão: quem inicia, para. O `finally` garante que
uma falha na restauração **nunca** deixa a captura rodando. Se o jogo voltar dentro da
tolerância, a verificação final aborta o teardown.

### 🎛️ Pré-configuração do Modo Jogo

O app traz uma lista canônica de 16 otimizações, definida num único lugar
(`src/shared/game-mode-preconfig.ts`) e consumida pelo processo principal e pelos dois
stores do renderer — as listas não podem divergir entre si.

Para que **instalações já existentes** também recebam a pré-config, uma migração
versionada roda uma única vez no boot: grava a lista e carimba `preconfigVersion`.
Depois disso o arquivo fica congelado e o utilizador configura à vontade — a
migração nunca mais toca nele. Instalações novas já nascem com a lista e o marcador.

Um teste garante que todo id da lista canônica existe no allowlist
(`VALID_OPTIMIZATION_IDS`) e que não há duplicados, portanto o catálogo e a
validação não podem ficar dessincronizados.

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────┐
│                  Electron Window                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Renderer (React 19)               │  │
│  │  ┌─────────┐ ┌──────────┐ ┌────────────────┐  │  │
│  │  │  Pages   │ │  Stores  │ │  Components    │  │  │
│  │  │  (40)    │ │ (Zustand)│ │  (Reutiliz.)   │  │  │
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
│  │              IPC Handlers (~233)              │      │
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
│                                                         │
│            Named Pipe (status, comandos, clips)         │
│                         │                               │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│            Motor de Clips (.NET 10 / C#)                 │
│  ┌──────────────────────┴──────────────────────┐        │
│  │          Windows.Graphics.Capture           │        │
│  │          + DXGI / D3D11 (Vortice)            │        │
│  └──────────────────────┬──────────────────────┘        │
│  ┌──────────────────────┴──────────────────────┐        │
│  │       Encoders (ffmpeg 9.0)                  │        │
│  │  NVENC · AMF · QSV · libx264/x265/SVT-AV1   │        │
│  └──────────────────────┬──────────────────────┘        │
│  ┌──────────────────────┴──────────────────────┐        │
│  │   Áudio (NAudio WASAPI + ApplicationLoopback)│        │
│  └──────────────────────┬──────────────────────┘        │
│  ┌──────────────────────┴──────────────────────┐        │
│  │   Replay Buffer + Export (Matroska → MP4)    │        │
│  └─────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

### 📁 Estrutura de diretórios

```
src/
├── main/                       # Processo principal (Node.js)
│   ├── index.ts                # Entry point + gerenciamento de janela
│   ├── cli/                    # Modo linha de comando (headless)
│   ├── daemon.ts               # Modo serviço (bandeja do sistema)
│   ├── ipc/                    # ~233 handlers IPC (1 por módulo)
│   ├── services/               # Lógica de negócio (123 serviços)
│   ├── platform/               # Abstração de plataforma
│   │   └── win32/              # Implementação Windows (registry, WMI, API)
│   └── constants/              # Paths, safelists, configurações
├── preload/                    # Bridge renderer ↔ main (contextBridge)
├── renderer/                   # Interface React
│   └── src/
│       ├── App.tsx             # Router + layout principal
│       ├── pages/              # 40 rotas (uma por módulo funcional)
│       ├── stores/             # Estado global (Zustand, 37 stores)
│       ├── components/         # Componentes reutilizáveis (127)
│       ├── hooks/              # Hooks customizados
│       ├── lib/                # Utilitários e helpers
│       └── locales/            # i18n (inglês, português, espanhol)
├── shared/                     # Código compartilhado
│   ├── types.ts                # Interfaces e tipos globais
│   └── channels.ts             # Constantes dos canais IPC
└── rules/
    └── win32/                  # Regras de limpeza (JSON)

dinho-clips-poc/                # Motor de Clips (.NET 10, self-contained)
└── src/
    └── DiNho.Capture.Poc/
        ├── Capture/            # WGC, DXGI, hotkeys
        ├── Encoders/           # NVENC/AMF/QSV + fallback software
        ├── Audio/              # NAudio WASAPI, RNNoise, loopback
        ├── Buffer/             # Replay buffer (RAM + disk spill)
        ├── Export/             # Matroska/EBML → MP4, thumbnails
        ├── GameDetection/      # Detecção de jogos (games.json)
        └── EngineCoordinator*  # Orquestração + IPC via named pipe
```

---

## 💻 Desenvolvimento

### Pré-requisitos

- **Node.js** 24+ (LTS)
- **npm** 10+
- **Windows** com **Visual Studio Build Tools 2022** (motor de Clips em .NET 10)
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
| `npm run publish` | Empacota e publica a release no GitHub Releases |
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
📊 Cobertura atual: 95,8% de linhas · 94,5% de funções · 86,6% de branches
   275 arquivos de teste · 7.800 testes (Vitest) · 2.443 testes (C#, Release)
```

---

## 📊 Estatísticas do projeto

| Métrica | Valor |
|---------|-------|
| Módulos | 60+ |
| Rotas | 40 |
| Stores (Zustand) | 37 |
| Componentes React | 127 |
| Serviços | 123 |
| Handlers IPC | 237 |
| Arquivos de teste (TS) | 275 |
| Testes (TS) | 7.800 |
| Testes (C#) | 2.443 |
| Cobertura de linhas | 95,8% |
| Cobertura de branches | 86,6% |
| Linhas de código (TS, sem testes) | ~87.000 |
| Linhas de código (C#, sem testes) | ~27.000 |

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
