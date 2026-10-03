# DiNho Optimizer — Agent Instructions

## Project Overview

DiNho Optimizer is an Electron desktop application for Windows system optimization, built with TypeScript, React, and Electron Vite. It provides system cleaning, registry optimization, malware scanning, privacy protection, driver management, and more.

## Tech Stack

- **Runtime:** Electron (main + renderer process)
- **Language:** TypeScript (strict mode)
- **UI:** React + Tailwind CSS + shadcn/ui
- **Build:** Electron Vite
- **State:** Zustand
- **Testing:** Vitest + Playwright (E2E)
- **Package Manager:** npm

## Core Principles

1. **Test-Driven** — Write tests before implementation, 80%+ coverage required
2. **Security-First** — Validate all inputs, sanitize paths, never mutate
3. **Immutability** — Create new objects, never mutate existing state
4. **Agent-First** — Delegate complex tasks to specialized agents
5. **Plan Before Execute** — Plan complex features before writing code

## Agent Orchestration

Use agents proactively without explicit user prompt:
- Complex feature requests → **planner**
- Code just written/modified → **code-reviewer**
- Bug fix or new feature → **tdd-guide**
- Architectural decision → **architect**
- Security-sensitive code → **security-reviewer**
- Build/type errors → **build-error-resolver**
- E2E critical flows → **e2e-runner**

Use parallel execution for independent operations.

## Security Guidelines

**Before ANY commit:**
- No hardcoded secrets (API keys, passwords, tokens)
- All user inputs validated
- SQL injection prevention (parameterized queries)
- XSS prevention (sanitized HTML)
- CSRF protection enabled
- Error messages don't leak sensitive data

**If security issue found:** STOP → use security-reviewer agent → fix CRITICAL issues

## Coding Style

- Many small files over few large ones (200–400 lines typical, 800 max)
- Functions small (<50 lines), files focused (<800 lines)
- No deep nesting (>4 levels)
- Proper error handling — never silently swallow errors
- File organization by feature/domain, not by type

## Running Dev (Windows)

The app requires admin privileges (`requestedExecutionLevel: requireAdministrator`). `npm run dev` auto-elevates itself: the un-elevated instance detects `!isAdmin()` and relaunches the **whole `npm run dev` command** elevated via UAC (`Start-Process cmd.exe -ArgumentList '/c cd /d <project> && npm run dev' -Verb RunAs`), then exits. Accept the UAC prompt and the app opens elevated with the renderer on `localhost:5173`.

```powershell
cd <raiz-do-projeto>   # ex.: C:\Users\<voce>\Desktop\001
npm run dev   # prompts UAC once, then runs elevated
```

**Why relaunch the whole command (not just electron.exe):** in dev `app.getPath('exe')` is the bare `electron.exe` (no entry point), and electron-vite kills the Vite dev server when the electron child exits (`ps.on('close', process.exit)`). Re-running `npm run dev` elevated starts a fresh electron-vite + elevated electron, which binds the port the original instance just released. Production builds elevate correctly via the manifest + runtime auto-elevation (`src/main/index.ts`).

## Testing Requirements

**Minimum coverage: 80%**
- Unit tests — individual functions, utilities
- Integration tests — IPC handlers, stores
- E2E tests — critical user flows

## Git Workflow

Commit format: `<type>: <description>` — Types: feat, fix, refactor, docs, test, chore, perf

---

## Current Status (consolidado — 2026-09-29)

**Resumos de sessões 2026-09-13 → 2026-09-29 MOVIDOS para o histórico em 2026-09-29** — conteúdo completo verbatim em `SESSION-HISTORY-FULL.md` (entradas `## Session Summary (AAAA-MM-DD …)`), índice condensado por sessão em `SESSION-HISTORY.md` (entradas `- **AAAA-MM-DD** — …`). Blocos movidos: **09-25** PLANO "Clips Leve" 60fps + vitest.explorer, **09-27** limpeza de warnings, **09-29** INCIDENTE AAC + bordas/áudio + defeitos do log + análise da log do dia (09-29d). Consulte esses arquivos antes de reabrir uma investigação.

**Stack (versões atuais):** Electron 44.5.1 · Vite 8.3.2 · Biome 2.5.15 · Vitest 5.0.3 · TypeScript 7.0.2 · React 19.3.0 · NAudio 3.1.0 · ffmpeg 9.0.2 · electron-vite 6.0.0-beta.5 (intencional, beta mais novo que o 5.0.0 estável) · framer-motion 14.0.0 · lucide-react 1.50.0 · react-router-dom 7.18.4 · systeminformation 5.33.15 · jsdom 30.1.1 · dotenv 18.0.5 · electron-builder 26.17.0 · electron-updater 6.8.10 · Microsoft.NET.Test.Sdk 18.10.1 · CsWin32 0.3.346

**Testes/Qualidade (contagens refrescadas em 2026-10-02 após atualização de dependências):**
- TS: **7800 testes, 7800 verdes, 0 skipped**, 275 arquivos, 0 falhas, **0 warnings** (0 act, 0 React-prop, 0 dotenv — 355 warnings eliminados em 2026-09-27)
- C#: **2443 testes, 0 falhas em Release** (as 3 falhas `NamedPipeServerTests.RoundTrip_*` só ocorrem rodando a suíte com o app aberto: colisão documentada do pipe `\\.\pipe\dinho-clips-engine`, não é regressão)
- Gate do ffmpeg: `node scripts/verify-ffmpeg.js --ffmpeg=resources/ffmpeg-custom/ffmpeg.exe` **52/52** contra o binário embarcado real, exit 0 (revalidado em 2026-09-29; `node scripts/copy-engine.js` exit 0, 296 arquivos)
- Biome: **0 erros, 0 warnings, 0 infos** em **888 arquivos** (`npx biome check .`; schema migrado para `2.5.15` em 2026-10-02) · `tsc --noEmit` 0 · `npm run build` ok

**Dependências — estado 2026-10-02 (auditoria + `npm update` + majors):** aplicados — Electron 44.4.5→**44.5.1**, Vite 8.3.1→**8.3.2**, Biome 2.5.14→**2.5.15**, Vitest/@vitest/coverage-v8 5.0.2→**5.0.3**, electron-vite 6.0.0-beta.4→**beta.5**, framer-motion 13.4.4→**14.0.0** (major), lucide-react 1.48.0→**1.50.0**, systeminformation 5.33.14→**5.33.15**, dotenv 18.0.4→**18.0.5**, @types/node 24.19.0→**26.6.4** (major; Electron 44 embute Node 24 — tipos à frente do runtime, **vigiar uso de APIs novas**), CsWin32 0.3.335→**0.3.346**. **Adaptação exigida pelo @types/node 26:** `ExecException.cmd` passou a obrigatório → 6 mocks de `execFile` em `clips.ipc.test.ts`/`clips-engine-connection.test.ts` passaram a `Object.assign(new Error(...), { cmd: '' })`. `electron-builder`/`electron-updater` em `latest` no registry estão **abaixo** da versão instalada (sem downgrade). ffmpeg 9.0.2 = última estável (2026-09-18). **Vulns `npm audit`: 12 high, todas em dev/build tooling** (`patch-package`→`find-yarn-workspace-root`; `http-cache-semantics` via `@electron/get`→`got` dentro do `app-builder-lib`), **não no runtime embarcado**; `npm audit fix --force` rebaixaria `electron-builder` para 26.5.0 (breaking) — **não aplicar**.

**Em andamento — A/V drift + bottleneck do feed (~46fps, FiveM + av1_nvenc 1080p60):**
- **Probe NVENC (`--probe-nvenc [W H FPS]`)** criado e validado: av1_nvenc sustenta 204–226 fps em TODOS os presets (p1–p7) com cadeia de produção (cq18/lookahead16/multipass fullres) — **encoder NÃO é o gargalo** (corrige diagnóstico anterior que culpava o NVENC).
- Log 2026-09-14: 25924 frames → ~46.3 fps de feed; **0 output-channel overflows / 1 input overflow** em 9min → o limite (~46fps) está na alimentação (captura→NV12→stdin), não no encodador.
- **Bug de PTS corrigido (av1_nvenc/IVF)**: `ProcessIvfFrames` usava PTS sintético por frame-index em vez do PTS real de captura (`_inputPtsQueue`, como a rota AnnexB) ⇒ drift A/V crescente ~0,23 s/s quando feed < 60fps. Fix espelha `EmitPacket` (dequeue real / extrapola / não-monotônico). 4 testes novos.
- **Instrumentação `FeedTelemetry` criada (TDD, 7 testes, 1459/1459 GREEN):** loga a cada ~5s o breakdown por estágio do feed — `fps good fail enqNull | wait=x ms copy=x ms convert=x ms total=x ms | queue=avg/max` (canal `FeedTelemetry` no JSONL). `wait` = WaitOne do WGC, `copy` = CopyResource p/ pool, `convert` = ConvertGpuNv12+enqueue, `total` = iteração inteira. `TryCaptureFrame` já media wait/copy (`WaitEndTicks`/`CopyEndTicks`) mas NADA disso ia pro log.
- **Diagnóstico concluído (sessão real FiveM, 2026-09-15):** `wait`=11,6ms dominante (69% do budget), `convert`=2,5ms (GPU **NÃO** saturada — 15% do budget), `copy`=0,1ms, `queue`=0 (encoder nunca engasga). Feed = 46,9fps ≈ cadência de entrega do WGC (game render ~47fps sob carga de captura+NVENC). Encoder (probe 204–226fps) e convert (2,5ms) **NÃO são gargalo** — preset adaptativo NVENC **despriorizado**. Fix de PTS IVF confirmado: exports com PTS-DRIFT ±10ms.
- **Análise da log 2026-09-29 (10,5h, entrada 09-29d):** feed 39–42fps confirmado (gargalo = cadência WGC, `wait` 9–10ms, `queue`≈0); drops = alt-tab/paradas/restarts (não defeito); `lag=5936s` = artefato do `-r 60` vs entrega 40fps (zera em restart), não slow-motion. **ANOMALIA SOB OBSERVAÇÃO:** `convert` cresce com uptime (2ms→10,6ms h05, máx 23,8ms; reset no restart e volta a subir até 9ms h10) — único sintoma sem explicação; se repetir, medir `nvidia-smi` (clock/temp) quando `convert>10ms`.

**ADIADO pelo usuário (2026-10-02) — judder residual dos clipes (CFR padding):** com o engine novo (C1/C5/C6 + cap fix, commit `a412d49`) os defeitos de pipeline foram eliminados — arranque 35 vs 392 drops (sem restart-loop), `gapsRemoved` ~540→24–30, outliers de ΔPTS estáveis, `activeFps` 57,8–58,3. Resta **judder residual** = a fonte **WGC entrega ~57,75fps VFR** (janela FiveM renderiza <60 sob captura+NVENC), gaps de 33–50ms preservados pelo `-c:v copy`. **Decisão do usuário: NÃO implementar agora — registar e estudar depois.** Fix proposto (**Opção 1 — CFR padding na captura**): no slot de 1/60s sem frame novo, reenviar o último frame NV12 com o PTS do slot (grade CFR ancorada ao relógio real) → av 57,75→60 sem re-encode no save; mantém CQ/`-r 60`/cap 60/áudio intactos; duplicados são P-frames resíduo ~0 → **sem artefato de imagem** (só regulariza a cadência; não inventa movimento; sem ghosting/tearing). Risco: PTS do duplicado não ancorado → dessincronia A/V. **Spec completa + medições + alternativas em `docs/plans/clips-feed-investigacao-candidatos-2026-10-02.md` (secção "Judder residual … CFR padding (ADIADO)"). Não reabrir sem novo pedido explícito.**

**PLANO "Clips Leve 60fps AMD/NVIDIA" (2026-09-25, concluído):** 10 itens — 9 DONE (TDD) + Item 7 (B-frames) MEDIDO e encerrado como **"não promove"** (decisão do usuário). Detalhe item a item, gates e medições (09-25 → 09-29) em `SESSION-HISTORY-FULL.md` (2026-09-25b) e `docs/plans/clips-leve-60fps-amd-nvidia-2026-09-25.md`.

- **INVARIANTE (bloqueante, explícito no plano):** o CQ escolhido pelo usuário é sagrado — 16/18/20/22 (`clips-quality-presets.ts`, default 20 em `clips-config-manager.ts:63`), clamp 0..51 (`clips.ipc.ts:332`/`ConfigManager.cs:294`), derivação `cq − 4` do QSV (`FfmpegEncoder.cs:221`). **Nenhuma mudança futura pode alterar CQ nem introduzir valor novo.**
- **INVARIANTE (bloqueante) — RESOLUÇÃO DA UI É SAGRADA (decidido pelo usuário 2026-10-03):** a resolução escolhida na UI (`_config.Config.Width/Height` → `EngineCoordinator.Capture.cs` → `SetOutputResolution`) nunca pode ser reduzida automaticamente. O divisor de escala (cascata de fallback HW 1/2 → HW 1/4 → CPU 1/2) e o **capacity guard** só agem quando NÃO há alvo explícito (native, `outputW <= 0`); em produção o coordinator manda sempre alvo explícito, logo o divisor é **inerte** e o guard **não** reinicia o ffmpeg mid-session. Fix: gate `scaleDivisor > 1 && outputW <= 0` em `FfmpegEncoder.ComputeScaleTarget`, revertendo o "Item 1" (piso absoluto 1280×720 que degradava 1080p→720p). Regressão que motivou: sessão FiveM 2026-10-03 — o guard disparou por ruído (feed ~58–59fps lido como "saudável" num tick + `speed`/`outLag` medem o feed, não o encoder), degradou 1080p→720p e reiniciou o ffmpeg mid-session → PTS não-monotónico, `DriftMonitor -8835ms`, save com `AlignAudio -9453ms` (A/V dessincronizado). **2443/2443 C# GREEN.** *(Nota: blindar o restart em si — preservar PTS/backlog num restart legítimo de crash — segue NÃO feito; só o disparo indevido foi eliminado.)*

**DESCARTADA pelo usuário (2026-09-16) — Multi-Track Audio** (Item 5): commit `14d939b` trouxe a política pura `MultiTrackAudioPolicy.ResolveTracks` + `AudioTrackKind` (5/5 GREEN), mas o usuário **descartou a feature inteira** antes da implementação HW (AudioMixer multi-stream WASAPI, N encoders AAC, N streams ADTS→MKV) e o código morto foi **removido** (`commit <pending>`: `MultiTrackAudioPolicy.cs`, `AudioTrackKind.cs`, `AudioInputConfig.cs`, `MultiTrackAudioPolicyTests.cs`). Não reabrir sem novo pedido explícito.

**Rejeitado pelo usuário — não reabrir sem novo pedido explícito:**
AI auto-clipping (detecção de eventos), clip por comando de voz, gravação de sessão completa + bookmarks, compilação automática de highlights, compartilhamento/links instantâneos, cloud storage, app mobile, **Multi-Track Audio (Item 5)**.

## Histórico Detalhado de Sessões

**2026-09-29:** o log de sessões (causas-raiz, números de teste, decisões técnicas pontuais) foi movido deste arquivo para `SESSION-HISTORY.md` (condensado) e `SESSION-HISTORY-FULL.md` (verbatim). As sessões **2026-09-13 → 2026-09-25a** já estavam em `SESSION-HISTORY.md`; os blocos **09-25b/09-25c/09-27/09-29/09-29b/09-29c e 09-29d** saíram do AGENTS.md nesta data. Consulte esses arquivos antes de reabrir uma investigação — é bem provável que o bug já tenha sido corrigido e documentado lá.
