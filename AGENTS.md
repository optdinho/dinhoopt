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

## Current Status (consolidado — 2026-10-04)

### Auditoria à release 2.0.6 (2026-10-04) — packaging PASS, 3 defeitos de log corrigidos

**A release entrega tudo o que promete.** Setup publicado byte-idêntico ao local (254 753 479 B, SHA-512 `D1EmyRz5LNEaBoAF…`, conferido por `node scripts/verify-release.js` contra o feed do electron-updater) · `resources/clips-engine` instalado == staging (296 ficheiros; o único extra é `games-update-check.json`, gerado em runtime) · ffmpeg embarcado **52/52** no gate · log de produção a executar `C:\Program Files\DiNho Optimizer\resources\clips-engine\DiNho.Capture.Poc.exe` com `av1_nvenc` + AAC e padding de frames activo. **Não é um problema de empacotamento.**

**⚠️ Os "falsos erros" no log são um defeito real, e maior do que pareciam.** O `ConsoleLogger` do engine usa `Console.Error` como writer para **todas** as gamas (`ConsoleLogger.cs:16`), mas o Electron prefixava stderr inteiro como `[ENGINE:ERR]`. Pior: o nível vinha **metade** da linha — o flush é de 64 linhas (`ConsoleLogger.cs:35`) e um pipe não respeita fronteiras. Medido no log de 2026-10-04, nas **duas** metades:
- **68 caudas** sem prefixo → `level:"error"` (`"Pause=26ms (+0ms)"`, `"e=0.1 avg / 1 max | codec=av1_nvenc…"`);
- **7 cabeças** truncadas a meio de uma palavra (`"| queu"`) em 1168 linhas do formato novo — nível certo, **texto cortado**, logo escapavam a qualquer contagem por nível.

As duas metades da mesma linha estão no ficheiro como entradas separadas ⇒ **a linha real nunca era registada**: uma linha partida virava dois registos, um deles falso erro. Corrigido em `0cd3b59` (`engine-log-reader.ts`): retém a cauda, `TextDecoder` streaming (multi-byte partido deixa de corromper), tecto de 64 KB, drenagem em `end`/`exit`. **O item 6 do plano (avisos amarelos `[ENGINE:ERR]`) era o mesmo defeito, não um problema separado.**

**`fps=undefined` — 4039 de 4039** broadcasts de estado. A linha lia `src.fps`, mas `EngineStatusValue` (`NamedPipeServer.cs:86`) **não tem campo `fps`** (tem `lastFrameMs`). Nenhum consumidor TS usa `fps`, portanto nunca chegou à UI: era o log a enganar quem o lia. Corrigido em `be32760` (passa a `lastFrameMs`/`activePipelines`, e `game=null` JSON null sai como `none`).

**Pendentes (bloqueados, não são bugs de código):**
- **Body da `v2.0.6` vazio** — **RESOLVIDO**: escrito com `PATCH /releases/402807650` (5021 chars, idêntico ao README §2.0.6). O `GH_TOKEN` do `.env` local responde 401; o do CI (secret do repo) também. **Falta actualizar o secret `GH_TOKEN` no repo**, senão o próximo tag volta a falhar só no upload.
- **Causa do CI resolvida (2026-10-04, com token): o `GH_TOKEN` do repo está inválido — não é bug de build.** O log do run `37172844739` mostra os três estágios a passarem (ffmpeg 217,3 MB descarregado e gate OK, `Copied 296 engine files`, `building target=nsis …Setup-2.0.6.exe`, blockmap criado) e a falhar **só** no upload: 6× `HttpError: 401 Unauthorized` / `"message": "Bad credentials"` em `GET /repos/optdinho/dinhoopt/releases`. A mesma coisa na `v2.0.5` (`36847199771`). **Último run verde: `v2.0.3` (30/09 23:41); primeira falha: `v2.0.4` (01/01 01:41)** — o token deixou de funcionar nessa janela, não o código. ⚠️ As hipóteses que **não** eram a causa (e que o log desmente): falta de SDK .NET, restore do NuGet, gate do ffmpeg. Por isso `ce2c4e3` (3 stages nomeados + diagnostics) fica como diagnosabilidade, **não** como a correcção.
- **ffmpeg de 217 MB embarcado** (o build full do Gyan). Fora de âmbito; reduzia o setup para ~40 MB.

**Gate novo no CI:** `5eb86f8` acrescenta um step pós-publish `npm run verify:release -- --expect <versão do package.json>`, com `if: always()`. **Sem isto o job ficava verde com um auto-update partido** — o electron-builder publicar não é o mesmo que o CDN servir o `latest.yml` novo, e foi exactamente esse o modo de falha que a auditoria encontrou (release existia na API, `dist/latest.yml` órfão). O `if: always()` deixa-o correr também quando o publish falha: aí o resultado útil é ver que o feed ficou na versão anterior, o que distingue "não publicou" de "publicou mas não propagou". Só metadados (o sha512 do que foi uploaded já é conferido); `verify:release:full` continua para a descarga. Testado nas duas direções contra a release real: `--expect 2.0.6` → PASS/exit 0, `--expect 2.0.7` → FAIL/exit 1.

**Números desta sessão:** TS **7812 testes verdes, 0 skipped**, 276 arquivos · C# **2525 verdes, 0 falhas, 3 ignorados** (2528 total; os 3 são `RequiresAdminFact` e só correm elevada) · Biome 0 em **890** · `tsc --noEmit` 0. O número C# que estava aqui (**2443**) estava errado — corrigido para o medido hoje.

**Correções a diagnósticos anteriores desta sessão:** `out/undefined` **não existe** (erro meu de leitura — o defeito no mesmo sítio era o `fps=undefined`); as `[FeedTelemetry]` "truncadas" das 00:05 eram só **formato antigo**, de antes da reinstalação (sem `totalMax`/`dup`/`skip`, `lag=` em vez de `outLag=`+`feedLag=`).

---

**Resumos de sessões 2026-09-13 → 2026-09-29 MOVIDOS para o histórico em 2026-09-29** — conteúdo completo verbatim em `SESSION-HISTORY-FULL.md` (entradas `## Session Summary (AAAA-MM-DD …)`), índice condensado por sessão em `SESSION-HISTORY.md` (entradas `- **AAAA-MM-DD** — …`). Blocos movidos: **09-25** PLANO "Clips Leve" 60fps + vitest.explorer, **09-27** limpeza de warnings, **09-29** INCIDENTE AAC + bordas/áudio + defeitos do log + análise da log do dia (09-29d). Consulte esses arquivos antes de reabrir uma investigação.

**Stack (versões atuais):** Electron 44.5.1 · Vite 8.3.2 · Biome 2.5.15 · Vitest 5.0.3 · TypeScript 7.0.2 · React 19.3.0 · NAudio 3.1.0 · ffmpeg 9.0.2 · electron-vite 6.0.0-beta.5 (intencional, beta mais novo que o 5.0.0 estável) · framer-motion 14.0.0 · lucide-react 1.50.0 · react-router-dom 7.18.4 · systeminformation 5.33.15 · jsdom 30.1.1 · dotenv 18.0.5 · electron-builder 26.17.0 · electron-updater 6.8.10 · Microsoft.NET.Test.Sdk 18.10.1 · CsWin32 0.3.346

**Testes/Qualidade (contagens refrescadas em 2026-10-06 — Lotes 0+1+2+3+4 da auditoria):**
- TS: **7804 testes, 7804 verdes, 0 skipped**, 282 arquivos, 0 falhas, **0 warnings** (0 act, 0 React-prop, 0 dotenv — 355 warnings eliminados em 2026-09-27; o último, de react-i18next, corrigido em 2026-10-04)
- C#: **2528 testes verdes, 0 falhas, 0 ignorados em Release**, 0 avisos de compilador. ⚠️ Histórico: eram "2525 verdes, 3 ignorados" porque os 3 `NamedPipeServerIntegrationTests` usavam `[RequiresAdminFact]`; **provado em 2026-10-06 que passam SEM elevação** (3/3, igual ao round-trip dos `NamedPipeServerTests`) — o atributo foi removido (órfão). O que fazia falhar os `RoundTrip_*` era o **engine a segurar `\\.\pipe\dinho-clips-engine`** (pipe com nome fixo), não a elevação nem o app aberto.
- E2E: **40 testes verdes** em 23,9 min (`npm run test:e2e`). ⚠️ **Claims precisas (re-registadas 2026-10-06):** corre **NÃO-elevado** (`DINHO_E2E=1` salta a elevação em `src/main/index.ts:147`); a journey visita **26/38** rotas (não "todos os módulos"); 3/40 testes têm 0 `expect` (`dbg-buttons`, `journey`, `session-record`); nenhuma spec faz save de clip real. Ver secção "Auditoria Qualidade dos Testes".
- Cobertura (`npm run test:coverage`): **linhas 95,62% · statements 94,48% · funções 94,31% · branches 86,65%** — todas acima do gate de 80% do AGENTS. Branches é a mais fraca das quatro; é onde olhar primeiro se a cobertura voltar a descer. **Medida depois do Lote 4** — desceu ligeiramente (Lote 3: 95,72/94,58/94,33/86,69) porque as linhas novas da assinatura HMAC do cache (ramos de erro de `verifyCacheSignature`) não são todas percorridas; nenhuma métrica encostou ao gate.
- Gate do ffmpeg: **`npm run verify:ffmpeg`** (que aponta para `resources/clips-engine-staging/ffmpeg.exe`, o binário que é realmente embarcado) **52/52**, exit 0 — revalidado em 2026-10-04. Existe também `resources/ffmpeg-custom/ffmpeg.exe`; para repetir o gate, usar o script e não o path à mão.
- Biome: **0 erros, 0 warnings, 0 infos** em **859 arquivos** (`npx biome check .`; schema migrado para `2.5.15` em 2026-10-02) · `tsc --noEmit` 0 · `npm run build` ok

**Armadilha ao comparar versões:** `package.json` declara *ranges* (`electron: ^44.4.5`) e o `package-lock.json` instala a resolvida (`44.5.1`). Comparar os dois números como se fossem o mesmo campo dá 6 "divergências" falsas — em 2026-10-04 vale a pena confirmar com `npm ci --dry-run` (exit 0 = em sincronia) e `npm ls --depth=0` (nenhum `invalid`/`missing`) antes de reportar um problema de dependências. O commit `3b34f16` só mudou os ranges nos dois majors (`@types/node` 24→26, `framer-motion` 13→14); o resto subiu dentro do mesmo caret.

**Dependências — estado 2026-10-02 (auditoria + `npm update` + majors):** aplicados — Electron 44.4.5→**44.5.1**, Vite 8.3.1→**8.3.2**, Biome 2.5.14→**2.5.15**, Vitest/@vitest/coverage-v8 5.0.2→**5.0.3**, electron-vite 6.0.0-beta.4→**beta.5**, framer-motion 13.4.4→**14.0.0** (major), lucide-react 1.48.0→**1.50.0**, systeminformation 5.33.14→**5.33.15**, dotenv 18.0.4→**18.0.5**, @types/node 24.19.0→**26.6.4** (major; Electron 44 embute Node 24 — tipos à frente do runtime, **vigiar uso de APIs novas**), CsWin32 0.3.335→**0.3.346**. **Adaptação exigida pelo @types/node 26:** `ExecException.cmd` passou a obrigatório → 6 mocks de `execFile` em `clips.ipc.test.ts`/`clips-engine-connection.test.ts` passaram a `Object.assign(new Error(...), { cmd: '' })`. `electron-builder`/`electron-updater` em `latest` no registry estão **abaixo** da versão instalada (sem downgrade). ffmpeg 9.0.2 = última estável (2026-09-18). **Vulns `npm audit` (estado 2026-10-06, Lote 1): 0 high + 8 moderate.** Eram 5 high até 2026-10-06 (`patch-package`→`find-yarn-workspace-root`→`micromatch`→`braces`; `http-cache-semantics` via `@electron/get`→`got` dentro do `app-builder-lib`), **nenhuma no runtime embarcado** — verificado no lock: todas as highs têm `dev: true` e o fecho de produção tem 111 pacotes. Histórico: 12 → 5 high (actualizações de 2026-10-02, `3b34f16`) → **0 high** (Lote 1: as 4 da cadeia `patch-package` saíram com a remoção; a 5.ª, `http-cache-semantics`, com `npm audit fix` **sem `--force`**, que só subiu `http-cache-semantics` 4.2.0→4.3.0 dentro do range). **Os 8 moderate** são todos a cadeia `electron-builder → app-builder-lib → @electron/get → global-agent → roarr → sprintf-js` e só saem com `npm audit fix --force`, que rebaixaria `electron-builder` 26.17.0 → 26.5.0 (breaking) — **não aplicar**.

**Em andamento — A/V drift + bottleneck do feed (~46fps, FiveM + av1_nvenc 1080p60):**
- **Probe NVENC (`--probe-nvenc [W H FPS]`)** criado e validado: av1_nvenc sustenta 204–226 fps em TODOS os presets (p1–p7) com cadeia de produção (cq18/lookahead16/multipass fullres) — **encoder NÃO é o gargalo** (corrige diagnóstico anterior que culpava o NVENC).
- Log 2026-09-14: 25924 frames → ~46.3 fps de feed; **0 output-channel overflows / 1 input overflow** em 9min → o limite (~46fps) está na alimentação (captura→NV12→stdin), não no encodador.
- **Bug de PTS corrigido (av1_nvenc/IVF)**: `ProcessIvfFrames` usava PTS sintético por frame-index em vez do PTS real de captura (`_inputPtsQueue`, como a rota AnnexB) ⇒ drift A/V crescente ~0,23 s/s quando feed < 60fps. Fix espelha `EmitPacket` (dequeue real / extrapola / não-monotônico). 4 testes novos.
- **Instrumentação `FeedTelemetry` criada (TDD, 7 testes, 1459/1459 GREEN):** loga a cada ~5s o breakdown por estágio do feed — `fps good fail enqNull | wait=x ms copy=x ms convert=x ms total=x ms | queue=avg/max` (canal `FeedTelemetry` no JSONL). `wait` = WaitOne do WGC, `copy` = CopyResource p/ pool, `convert` = ConvertGpuNv12+enqueue, `total` = iteração inteira. `TryCaptureFrame` já media wait/copy (`WaitEndTicks`/`CopyEndTicks`) mas NADA disso ia pro log.
- **Diagnóstico concluído (sessão real FiveM, 2026-09-15):** `wait`=11,6ms dominante (69% do budget), `convert`=2,5ms (GPU **NÃO** saturada — 15% do budget), `copy`=0,1ms, `queue`=0 (encoder nunca engasga). Feed = 46,9fps ≈ cadência de entrega do WGC (game render ~47fps sob carga de captura+NVENC). Encoder (probe 204–226fps) e convert (2,5ms) **NÃO são gargalo** — preset adaptativo NVENC **despriorizado**. Fix de PTS IVF confirmado: exports com PTS-DRIFT ±10ms.
- **Análise da log 2026-09-29 (10,5h, entrada 09-29d):** feed 39–42fps confirmado (gargalo = cadência WGC, `wait` 9–10ms, `queue`≈0); drops = alt-tab/paradas/restarts (não defeito); `lag=5936s` = artefato do `-r 60` vs entrega 40fps (zera em restart), não slow-motion. **ANOMALIA SOB OBSERVAÇÃO:** `convert` cresce com uptime (2ms→10,6ms h05, máx 23,8ms; reset no restart e volta a subir até 9ms h10) — único sintoma sem explicação; se repetir, medir `nvidia-smi` (clock/temp) quando `convert>10ms`.

**ADIADO pelo usuário (2026-10-02) → REABERTO em 2026-10-03 — judder residual / CFR 60 fps:** com o engine novo (C1/C5/C6 + cap fix, commit `a412d49`) os defeitos de pipeline foram eliminados — arranque 35 vs 392 drops (sem restart-loop), `gapsRemoved` ~540→24–30, `activeFps` 57,8–58,3. Resta **judder residual**. ~~A fonte WGC entrega ~57,75fps VFR~~ → **DIAGNÓSTICO CORRIGIDO (2026-10-03): a WGC entrega uma grelha CFR 60 Hz perfeita** (padrão `16/17/17` = 16,667 ms exactos, 95,4% dos deltas; 72 s seguidos sem uma única anomalia provam que não há saturação de recurso). **As 3 causas são distintas e todas medidas no clip real** (`DiNho Optimizer 2026-10-03_06-46-04.mp4`, 542 ΔPTS ≥18,5 ms em 305 s = +3,98 s de timeline): **(1) ~360 anómalos de 18–21 ms** = pacer **relativo** (`EngineCoordinator.Capture.cs:1106/1110`, `beforeCapture + intervalo`) que desloca a grelha de PTS permanentemente; **(2) 58 anómalos de 38–46 ms** = **timeout composto** (22 ms de `WaitOne` + os 22 ms da iteração seguinte, já atrasada); **(3) ~124 anómalos de 22–23 ms** = timeout isolado = 1 slot perdido. **Plano autoritativo: `docs/plans/clips-cfr-60fps-padding-2026-10-03.md`** (8 steps TDD: `FrameGrid` + relógio no topo + padding + telemetria `totalMax`/`over`/`dup`/`skip`). **Investigação online (2026-10-03):** Microsoft #142 — *"MinUpdateInterval is a throttling mechanism"* (é **teto**, não piso) e *"not rely on the frame capture itself providing the update loop"*; OBS `video-io.c` — `frame.timestamp += frame_time` exacto mas **descarta** em cache vazio (nós **duplicamos**, porque o entregável é ficheiro, não live); ffmpeg `video_sync_process` — `delta > 1.1` duplica mas `nb_frames > dts_error_threshold*30` **descarta** ⇒ **não usar `-fps_mode cfr`/`-vf fps=`**. **Achado decisivo:** o `TexturePool` ping-pong de 2 (`TexturePool.cs:21`) **já é o cache de duplicação a custo zero** — num miss o `TryCaptureFrame` não faz `Rent`/`CopyResource`, logo a textura do frame anterior continua válida; `CapturedFrame.Dispose()` é no-op com `OwnsTexture: false`. Pool 2→3 dá 2 duplicados consecutivos por +8,3 MB VRAM. **Controlamos o PTS ao nível do pacote** (`FfmpegEncoder.NalParsing.cs:289-295` substitui o PTS de cada pacote AV1 via `_inputPtsQueue`) ⇒ grelha absoluta e padding são 100% do lado C#, sem filters, sem re-encode no save. **Fora de âmbito:** `TimecodeScale` do MKV (1 ms = padrão `16/17/17`, ±0,33 ms), atacar a fonte, `-forced-idr`. **Regra de diagnóstico:** `dup` >10% dos ticks com o jogo acima de 60 fps ⇒ **parar**: o problema é a captura, o padding só o está a esconder.

**SOAK COMPLETO 6/6 (2026-10-03 19:33→21:05) — o CFR 60 está VALIDADO em sessão longa.** Fase 1 (captura, 6×300 s, `saveClip` pelo pipe, 6/6 sem abortos, `dropped` 51→51) e fase 2 (medição `showinfo` com a app fechada).

| Clip | segundos | frames | fps | D18 | D34 | DMax | excesso | T2 |
|---|---|---|---|---|---|---|---|---|
| `…19-33-53` | 303,8 | 18 224 | 59,98 | 4 | 1 | 50 ms | +0,084 s | 3 |
| `…19-39-15` | 304,2 | 18 251 | 59,99 | 2 | 0 | 34 ms | +0,033 s | 2 |
| `…19-44-34` | 304,13 | 18 247 | 59,99 | 2 | 0 | 33 ms | +0,034 s | 2 |
| `…19-49-54` | 304,67 | 18 281 | **60,00** | **0** | **0** | **17 ms** | **+0 s** | 0 |
| `…19-55-18` | 296,22 | 17 773 | **60,00** | 1 | 0 | 33 ms | +0,017 s | 1 |
| `…20-00-35` | 304,47 | 18 269 | **60,00** | **0** | **0** | **17 ms** | **+0 s** | 0 |
| **TOTAL** | **1 817,5** | **109 045** | 59,99 | **9** | **1** | — | **+0,168 s** | 8 |

Baseline (1 clip de 305 s): 542 D18, 58 D34, **+3,987 s** de excesso, 59,18 fps.
**Taxa de D18: 3,006% → 0,0083% (redução 364×). Excesso na timeline: +0,009% vs +1,3%.** 2 dos 6 clips são matematicamente perfeitos (só os dois valores da grelha `16/17`).

**7.º CLIP MEDIDO (2026-10-03 22:04 e 22:44, `…19-27-28.mp4`, 1421 MB) — PASS.** 304,13 s · 18 242 frames · 59,98 fps · **D18=5, D34=2**, DMax 50 ms · excesso **+0,116 s** (0,0381%) · T2=3/T3=2 · `Monotonico=True`. Histograma `16:6078 17:12158 33:3 50:2` ⇒ **18 236/18 242 frames (99,97%) exactamente na grelha `16/17`**; as 5 anómalas são 3 de 33 ms e 2 de 50 ms. Medido **duas vezes** (invocação explícita elevada e auto-elevação) com resultados **idênticos** ⇒ reprodutível.

| Clip | segundos | frames | fps | D18 | D34 | DMax | excesso | T2 |
|---|---|---|---|---|---|---|---|---|
| `…19-27-28` (7.º) | 304,13 | 18 242 | 59,98 | 5 | 2 | 50 ms | +0,116 s | 3 |
| **TOTAL 7 clips** | **2 121,6** | **127 287** | **60,00** | **14** | **3** | — | **+0,284 s** | 11 |

**Agregado dos 7 clips** (soak 6/6 + 7.º): taxa D18 **0,011%** (14/127 287) vs baseline 3,006% ⇒ **redução 273×**; excesso total **0,284 s em 2121,6 s = 0,0134%** vs +1,3% do baseline ⇒ **14× menor**; fps 60,00 vs 59,18. ⚠️ O 7.º clip é o **pior em D18 (5) e o único com D34=2**, por isso a taxa agregado subiu de 0,0083% para 0,011% e a redução caiu de 364× para 273×. **Isto é o número honesto** — não volta a 364× escolhendo o subconjunto. O `Monotonico=True` e o `excesso ≈ 0` mantêm-se, que é o critério real.

⚠️ **O critério `D18==0` do `-Measure` era demasiado rígido e dá FAIL enganador.** Anomalia isolada de 33–50 ms **não acumula** (o excesso total dos 7 clips é 0,284 s em 2121,6 s), logo o pacer está correcto; `D18==0` só se atinge em condições de máquina folgada. **Critério correcto a adoptar: excesso ≈ 0 e fps = 60**, não "zero anomalias de qualquer tamanho".

**As 9 anóm residuais NÃO têm causa identificada — 3 hipóteses testadas e descartadas** (não adivinhar):
- **Resyncs**: não há correlação. `…19-49-54` teve 2 resyncs (84 slots) e D18=**0**; `…19-33-53` teve 2 (87 slots) e D18=4.
- **Iterações over-budget**: não há correlação. `…20-00-35` teve **573** over e D18=**0**.
- **`skip`**: explica a **duração** curta de `…19-55-18` (17 773 frames em vez de ~18 250, `skipMax=472` ≈ 7,9 s) mas **não** cria ΔPTS — saltar slots encurta o clip, não abre buracos nele.

**`FrameGrid.Resync` não abre buracos no ficheiro.** A nota antiga de "insere de propósito um buraco de `lost × 16,667 ms`" foi refutada pelos dados: houve resyncs de 142 e 272 slots e mesmo assim o excesso total dos 6 clips é **0,168 s em 1817 s**. O resync **reancora** a grelha; o PTS dos pacotes é absoluto e gerado no nível do pacote, logo o shift é absorvido em vez de virar ΔPTS. Consequência prática: **nunca contar ΔPTS grande sem o confrontar com o `skip=` da mesma janela**, e não usar o resync como explicação automática.

**Evento das 17:43 — NÃO foi crash nem pressão de memória.** O utilizador fechou a app. O `Renderer process gone: reason=killed exitCode=0xC0000409` é apenas o Electron a reportar o renderer morto durante o encerramento normal, e as linhas `[RAM]` do engine param em `17:43:01` (`proc=986MB | gcManaged=264MB | native=722MB | loh=223MB`) porque o engine é filho do Electron e morre com ele. **A única lição real é do harness:** o `soak-hotkey.ps1` antigo continuava a injectar F12 das 17:45 às 18:10 sem app nenhuma (6 clips que nunca existiram) — foi isso que motivou as guardas de vivacidade descritas abaixo. ~~Hipótese descartada: medição `showinfo` em paralelo~~ (medir em paralelo continua a ser má ideia por tempo de CPU, mas **não** matou a app).

**SOAK REARMADO — 2 FASES NUNCA MISTURADAS (2026-10-03).** Orquestrador novo `%TEMP%\opencode\soak-cfr.ps1`, com as guardas que faltavam ao `soak-hotkey.ps1` (que premia F12 às cegas durante 25 min depois de a app morrer):
- **Fase 1 `-Capture`** — só com a app a gravar. Antes de cada pressão verifica `engine vivo + pipe + recording + pipelines>=1`; se o engine morreu, **aborta com diagnóstico** em vez de premir no vazio. Depois de cada pressão **confirma que o clip apareceu** com tamanho estável (um save falhado não passa por "ok"). Amostra memória/estado cada 15 s para `health-<stamp>.csv`.
- **Fase 2 `-Measure`** — só com a app **fechada** (aborta se o engine ainda estiver a correr). Mede cada clip do manifesto com `showinfo`, incrementalmente para `results-<stamp>.csv`. ⚠️ O veredicto impresso usa `D18==0` e por isso dá **FAIL enganador** num clip perfeitamente válido; aplicar o critério real (excesso ≈ 0 e fps = 60) — ver a tabela do soak 6/6 acima.
- **Guardas validadas por teste**: sem engine → aborta em 4 s; engine vivo sem gravação → aborta. As 14 colunas de `health-*.csv` Including `ProcMB/GcManaged/NativeMB/LohMB` foram confirmadas contra a linha `[RAM]` real da morte (17:43:01).
- **Comandos**: `soak-cfr.ps1 -Capture -Presses 7 -IntervalSec 300` → fechar a app → `soak-cfr.ps1 -Measure`.
- **NÃO usar injectores de tecla**: o `HotkeyManager` do engine faz *poll* de `GetAsyncKeyState` e o `SendInput` prime/prime passa entre dois tiques. A 2026-10-03 injectou-se F12 7× com a app viva e **zero saves** aconteceram. O soak usa `saveClip` pelo pipe (determinístico, devolve o resultado) — o que só é possível por causa do fix multi-cliente. No reader: **nunca abandonar um `ReadLineAsync` pendente** (dessincroniza o stream) e confirmar pelo **ficheiro em disco**, não pela resposta do pipe.
- **`getStatus` responde `payload.value` (2 níveis)**, não `payload`. Ler só `.payload` dá `null` e faz o preflight abortar com a app saudável.
- **Memória por save (medido, NÃO é leak)**: base ~935 MB (`gcManaged=223 native=712 loh=218`) → spike para **1989 MB** logo após o save (`gcManaged=1820 loh=801`) → plateau de ~5 min → gen2 recolhe (`gcManaged=270 loh=221`) → estabiliza em ~1100 MB. O `loh` (Large Object Heap) é lixo do export à espera de gen2; **sobe ~1 GB acima da base durante ~5 minutos** e o GC trata sozinho. Se algum dia isto não voltar à base, *então* é leak — vale comparar com estas linhas.

**IPC MULTI-CLIENTE (2026-10-03) — corrigido e validado.** Defeito: `maxNumberOfServerInstances: 1` ⇒ o Electron mantinha o pipe ocupado, o accept loop caía em retry silencioso de 1 s (`DebugWrite` engolia a excepção) e qualquer 2.º cliente expirava com `TimeoutException` em `ConnectInternal` — confirmado tanto com o engine vivo (`pipe-diag.log`) como por teste. Desenho aplicado (`NamedPipeServer.cs` + novos `PipeClientChannel.cs` e `ClientResponseRouter.cs`): semáforo de capacidade (`MaxConcurrentClients = 16`), `maxNumberOfServerInstances` explícito, **fan-out** de `BroadcastRaw` para todos os clientes, canal `Responses` por cliente e **roteamento por `reqId`** com `ForgetClient` no disconnect; clientes legacy sem `reqId` (é o caso do Electron) caem na fila órfã partilhada, preservando o comportamento anterior. Plano em `docs/plans/pipe-ipc-multiclient-2026-10-03.md`. **2503/2503 verdes** (suite completa, elevada); os 3 testes IPC reais usam `RequiresAdminFact` (xUnit 2.9.3 não tem `Assert.Skip`) ⇒ 3 ignorados sem elevação. **Prova de não-vacuidade:** mutação temporária `MaxConcurrentClients = 1` (já revertida) reproduz a excepção exacta de produção. Duas fragilidades reais encontradas pelos testes: (1) broadcast emitido entre a ligação do pipe e o registo em `_clients` é perdido — inerente, o cliente tolera porque o `engineStatus` seguinte chega em ~2 s; (2) testes não podem assumir que o seu broadcast é a primeira linha da fila, porque o timer de status escreve nas mesmas filas.

**FASE 2 IMPLEMENTADA (2026-10-03) — C# 2503/2503 verdes, 0 ignorados (suite completa, elevada), build 0 erros, `copy-engine` exit 0:** `FrameGrid` (grelha CFR absoluta QPC, 22 testes), `FramePadder<T>` (orçamento `poolSize−1`, 12 testes), `FeedTelemetry`/`FeedLogLine` com `totalMax`/`over`/`dup`/`dupMax`/`skip`, `PipelineLoop` com wait orientado ao deadline + padding sem `continue` que salte o pacing, `TexturePool.DefaultPoolSize` 2→3. **Medição VALIDADA contra o clip de referência:** `%TEMP%\opencode\cfr-soak.ps1 -Glob` reproduz o baseline exactamente (18 034 frames · 304,537 s · **542** ΔPTS ≥18,5 ms · **58** ≥34 ms · **+3,987 s** · T2=177/T3=22 · monotónico). ⚠️ **Armadilha do `framecrc`:** ele reduz o timescale a `1001/60000` (tick 16,6833 ms), **não** `1/16000`, e o PTS é o campo **2** (`stream#, dts, pts, …`) — lê-lo dá `dts`, e o campo 0 dá sempre 0. Só serve para contar frames ausentes (Δ2/Δ3 ticks), **nunca** para o critério dos 18,5 ms: esse exige `showinfo` (descodifica, **~4 min/clip** — e para estes clips de 1,4 GB são ~5 min reais).

**FASE 3 VALIDADA — PADDING EXERCITADO EM PRODUÇÃO (2026-10-03 23:11→23:16).** Era o que faltava: até aqui a duplicação estava provada por simulação mas nunca num ficheiro real.

| Fonte | Alvo | Telemetria | Ficheiro | Veredicto |
|---|---|---|---|---|
| ~30 fps | 30 | `dup=0 skip=0` | `…22-56-43.mp4` 191,33 s · 5741 · 30,00 fps · `D18=0 D34=0` · excesso −0 s · hist `33:3827 34:1913` | PASS |
| ~30 fps | **60** | `dup≈50% dupMax=2 skip=0` | `…23-11-16.mp4` 85,2 s · 5110 · **59,96 fps** · D18=3 · D34=1 · excesso **+0,05 s** · DAvg 16,676 · hist `16:1702 17:3404 33:2 34:1` | PASS |

5110 frames com **5106 (99,92%) exactamente na grelha 16/17**. `dupMax=2` nunca excedeu o orçamento e `skip=0` — exactamente o que `CfrPacerSimulationTests` previu para fonte a 30 numa grelha a 60 (1 duplicata por frame real, orçamento de 2 nunca esgota). **O CFR-60 por duplicação está confirmado em produção.**

**Alvo 120 fps foi descartado como via de teste — e é por desenho, não por bug.** `normalizeFps` (`src/renderer/src/components/clips/clips-quality-presets.ts:13`) só aceita 30 ou 60; qualquer outro valor normaliza para 60. Comentário no código: *"Clip recording only supports 30/60 FPS (UI + engine whitelist)"*. Logo **a única forma legítima de ter fonte abaixo do alvo é a fonte deixar de entregar frames** — o que acontece sem qualquer limiter quando se faz alt-tab/oclusão. É esse o mecanismo do P3.

**HARNESS TARGET-AWARE (2026-10-03 23:22).** O `-Measure` era fixo em 60 e deu **FAIL enganador** no clip CFR-30 perfeito: `fps >= 59,95`, `D18 >= 18,5 ms`, `D34 >= 34 ms` e `nominal = frames/60` estão todos hardcoded, logo o `ExcessoS` de um clip a 30 dava 95,666 s (50% de deriva,fiction). Corrigido com `-TargetFps` (`ValidateSet 30,60`, default 60) em `cfr-soak.ps1` **e** `soak-cfr.ps1`, toda a grelha derivada do alvo (`period = 1000/alvo`; limiares `1,1×` e `2,0×`), nova coluna `AlvoFps` por linha e veredicto passa a ler o alvo da linha em vez da constante. **Verificado nos dois sentidos:** o clip de 30 passou de FAIL a `PASS` com `D18=0 D34=0` (re-medido, não só rejulgado — o `ExcessoS` só é recalculado na medição), e o de 60 deu números **idênticos** ao baseline. ⚠️ `-TargetFps` tem de bater certo com a config no momento da captura; por omissão 60.

**P4 (2026-10-03 23:38) — NÃO HÁ BUG DE RECUPERAÇÃO DE OCLUSÃO. Os 30 fps do P3b eram a oclusão, e foi induzida pelo meu próprio teste.** O P3b tinha-me deixado uma dúvida: a fonte ficou em ~30 fps e **nunca recuperou** nos ~80 s seguintes, o que podia ser um defeito real. Teste controlado: gravar, 1-2 s de oclusão ao trocar para o jogo, **60 s em primeiro plano**, gravar, oclusão ao voltar. Resposta da telemetria: `dup` cai de ~50% para **3-6%** imediatamente e estabiliza, `fps` sobe a 56-64, e **`outLag` fica pinned em +1 s** (contra os −83 s do P3b). A captura recupera na hora. O `outLag` negativo do P3b era consequência directa da fonte a meia taxa — não é anomalia de bookkeeping.

Ficheiro `…23-38-33.mp4`: **113,5 s · 6811 frames · 60,00 fps · D18=0 · D34=0 · DMax=17 ms · excesso 0 s · T2=0 · PASS.** É o **primeiro clip matematicamente perfeito do projecto**: `DMax=17 ms` significa que *todos* os deltas são 16 ou 17 ms — zero anomalias de qualquer tamanho, não apenas "poucas". E foi produzido **com padding activo** (3-6% de `dup`), não num caso fácil de `dup=0`.

**Os três regimes de padding estão agora validados em produção, com ficheiro real:**

| Regime | `dup` | Ficheiro | D18 | D34 | DMax | Excesso |
|---|---|---|---|---|---|---|
| Fonte = alvo (sem padding) | 0% | 7 clips do soak | 0-5 | 0-2 | 17-50 ms | +0,284 s |
| **Padding leve** (jogo à frente) | 3-6% | `…23-38-33.mp4` | **0** | **0** | **17 ms** | **0 s** |
| **Padding pesado** (fonte a ~30) | ~50% | `…23-11-16.mp4` | 3 | 1 | 34 ms | +0,05 s |

Nota de produto: `dup` de 3-6% com o jogo acima de 60 fps está **abaixo** do limiar de 10% que a regra de diagnóstico deste ficheiro define para parar ("o problema é a captura, o padding só o está a esconder"). Logo o padding **não** está a mascarar um defeito de alimentação.

**O P4 TAMBÉM VALIDOU O CAMINHO DO `skip` EM PRODUÇÃO — e fecha a pergunta que estava em aberto.** A oclusão no início e no fim da captura fez a fonte cair abaixo do orçamento de 2 duplicatas: `skip=5` na primeira oclusão e `skip=32`/`skip=6` no fim (37 skips no total). Resultado: `…23-38-33.mp4` com **T2=0, D18=0, DMax=17 ms, excesso 0 s**. Ou seja, **37 skips não abriram um único buraco no ficheiro** — o PTS absoluto ao nível do pacote absorve-os, como `FrameGrid.Resync` reancora a grelha. Isto substitui a prudência anterior ("não afirmar que skip não cria buracos") por um facto medido: com PTS preservado, não cria. Cuidado: isto é sobre *skip com PTS preservado*; um bug que emitisse PTS sintético por índice reintroduziria buracos, e é por isso que o fix de PTS da rota IVF se mantinha.

**Duas coisas da telemetria que NÃO batem certo, sem impacto no ficheiro (2026-10-03).** (1) `iters=330` e `fps=66.0` por janela aparecem **também no estado saudável** (330 slots, 330 reais, 0 dup), logo não são sobreprodução do padding: a telemetria divide por uma janela de 5,0 s quando a real é 5,5 s. O ficheiro a 59,96-60,00 fps prova que a grelha é 60/s. (2) `outLag` — **explicado**, ver P4: negativo e crescente é o sintoma de fonte a meia taxa, e com fonte saudável fica em +1 s. `feedLag` é a medida honesta (ver `FeedLogLine`), não `outLag`.

## Auditoria Pedido 2 — código morto e licence (2026-10-05) · relatório completo em `AUDITORIA-PEDIDO-2-CODIGO-QUEBRADO.md` (gitignored, 723 linhas)

**Relatório:** 12 achados A (A1–A12) com `ficheiro:linha`, procedimento e certeza, mais 7 frentes F1–F7. **21 correcções feitas e SEM COMMIT:** A3, A5, A8, A2, A6, A7, A9, A10, A11, A12 + os 4 da frente G + os 5 do **Lote 1** + a frente **F1** + **A1** e **A4** (Lote 4). **Com o Lote 4, não resta nenhum achado "por corrigir"** — os 12 A estão todos ✅. As decisões D1 (A1 → `backupFailed`) e D2 (A4 → cache assinado HMAC) foram implementadas.

**Duas armadilhas de método que custaram tempo e quase produziram falsidades** — não repetir:
1. **`knip` sem config é ruído:** reportou 153 ficheiros "mortos" incluindo `main.tsx` e todas as Pages (não entende `lazy()` nem entry points do Electron-Vite). Precisaria de entry points + aliases declarados para servir de barreira.
2. **Análise de reachability por `rg` tem de resolver aliases:** o renderer usa `@/` (`electron.vite.config.ts:73`) e todos usam `@shared/` (`:26,:41`). Só caminhos relativos dá 306 falsos órfãos, incluindo `StatCard.tsx`. Com os dois aliases + seeds absolutos: **306 → 38**, e cada candidato confirmado por `rg` independente.

**Métrica — ✅ CÓDIGO APAGADO NO LOTE 3 (2026-10-06), medido pelo git:** `src/main` tinha **1 228 linhas órfãs** confirmadas — `constants/paths.ts` (291; **os 8 exports sem um único uso em produção**), `services/vulnerability-checks.ts` (160) + `vulnerability-fixes.ts` (259) — mais o **A2** `ipc/context-menu-scan.ts` (518). Renderer: **27 componentes `.tsx` órfãos**. **Apagado: 35 ficheiros · 4 503 linhas não vazias / 4 851 totais** (1 228 fontes `src/main` + 815 dos seus 4 testes + 2 460 renderer). ⚠️ As duas estimativas que circulavam (**3 112** no relatório, **3 630** aqui) não batiam entre si nem com o medido — para as fontes o real é **3 688**.

**Padrão recorrente:** refactor que cria subpasta e deixa o ficheiro do topo para trás — `ipc/context-menu-scan.ts` (518, = A2) e `services/vulnerability-*.ts`. **O scanner de vulnerabilidades NÃO está desligado** (caminho vivo é `services/vulnerability-scanner/`, via `ipc/index.ts:73,102`); o que morreu foi a cópia do topo.

**Suspeita que se provou errada (não repetir o receio):** 5 secções órfãs em `components/windows-tweaks/` pareciam feature regredida. **Não são** — `WindowsTweaksPage` foi reescrita para UI data-driven (`TweakRow`) e `pages/windows-tweaks/AdvancedTools.tsx:99` serve `dnsPresets`/`dnsBenchmark`/`currentDns`/`gamingTimer`. **Zero bugs de produto em F1.**

**Dois achados de processo, mais duradouros que o código morto:**
- 🔴 **`Vortice.D3DCompiler`** era `PackageReference` **morta mas embarcada** — **✅ removido no Lote 1** (0 ocorrências na assets file; publish limpo com 25 ficheiros e nenhum D3DCompiler). `patch-package` era morto — **✅ removido no Lote 1** (`postinstall` + devDependency, 22 pacotes a menos, `npm audit` highs 5 → 1). `coverlet.collector` declarado e nunca invocado — **✅ removido em 2026-10-06** (0 referências na assets file).
- 🔴 **O CI não tem nenhum passo `dotnet`** — **✅ corrigido em 2026-10-06**: `ci.yml` ganhou o job `dotnet` (`dotnet --info` → `dotnet build -c Release` → `dotnet test --no-build`, os mesmos comandos dos gates locais) — os **2 525 testes C# passam a correr no CI** (eram mais de um quarto da suíte, sem barreira nenhuma).

**Três achados com efeito visível — ✅ todos corrigidos no Lote 1 (2026-10-06):**
- `addRuleButton` faltava **nos 3 locales** (é o botão principal da página de regras) → 8 chaves em `malware.json`.
- `disk.json` tinha `systemDrive` em `en`/`es` e **não** em `pt` → `"Sistema"`.
- `process.env.ELEVATED` nunca é definida em produção ⇒ o campo `admin` do audit log era **sempre `false`** → passou a `admin: isAdmin()` (helper já existia em `services/elevation.ts`, cache 60 s).

**GPU (F7):** o caminho de produção é **NVENC**; **AMF está implementado e é alcançável, mas só em AMD** (`clips-enhance.ts`, `clips-amd-cache.ts`, detecção VCN). **Não há QSV em TypeScript.** Nada disto é código morto; o enhance é condicionalmente inalcançável em NVIDIA **por desenho**.

**⚠️ Não reportar as 1 292 chaves i18n "sem uso" da extracção literal como mortas:** componentes usam `t(prop)` com a chave em variável e os namespaces são montados por prefixo. É **suspeito**, e resolver exige instrumentação em runtime, não `grep`.

**Lotes:** 1 ✅ 2 ✅ 3 ✅ **4 ✅** — auditoria concluída (os 12 achados A corrigidos). *(Lotes 0, 1, 3 e 4 executados em 2026-10-06.)*

**Lote 4 (A1 + A4) — ✅ EXECUTADO 2026-10-06, ambas com decisão de produto tomada (D1/D2).** **A1 (`backupFailed`, TDD):** `fixer.ts` devolve `backupFailed: boolean` (o `catch` `/* Backup failed, but continue */` passou a avisar o chamador) → propagado em `handlers.ts` (payload do `logAudit` + warning no logger) → tipo no preload → `FixResult.backupFailed?` na store → bloco do resultado **extraído** para `RegistryPage` em `FixResultCard.tsx` novo com aviso âmbar `backupFailedWarning` (3 locales). 12 testes novos; o `RegistryPage` perdeu os selectors `fixResult`/`showFailures` (a store lida no card). **A4 (cache assinado):** reproduzida a falsificação RED — `{"valid":true,"timestamp":Date.now()}` escrito à mão em `.license-cache.json` era servido **sem rede**; o cache passa a `{ payload, sig }` com `HMAC-SHA256(CACHE_SIGNING_SEED, getHwidSync())`, `readCache` rejeita sem assinatura / assinatura errada / outro HWID (`timingSafeEqual`), `getHwidSync()` novo em `hwid.ts` (determinístico e igual a `generateHwid`) — o cache fica **ligado à máquina**. 6 testes tocados (produzir o cache via `validateLicense` em vez de JSON cru) + 4 novos. Comportamentos antigos re-testados (fallback 24 h, revalidação background, corrompido → offline). **Gates:** vitest **7 757 / 277** · tsc 0 · biome **0 / 859** · build 0 (813 ms) · dotnet intocado. Detalhe em "LOTE 4" do relatório.

**Lote 2 (A6/A7/A9/A10/A11/A12) — ✅ EXECUTADO 2026-10-06, todos com RED reproduzido antes da correcção.** Detalhe item a item no relatório, secção "LOTE 2". **Feito:** `fixer.ts` ganhou `default: throw \`Unknown fix operation: ${String(fix.op)}\`` (RED: `fixed=1`) · `getLicenseConfig()` passou a `console.warn` fora do `catch {}` (3 testes, o de "ficheiro ausente não avisa" é a rede de segurança) · `loadOrCreateSalt()` **nunca escreve por cima de um salt ilegível** e ambas as falhas são registadas (3 testes, `node:fs` instrumentado) · `hwid.ts` sem `randomBytes(16)` na derivação + `.hwid` ilegível nunca sobreposto (2 testes) · **`vitest_output.txt` (814 KB)**, `vitest_error.txt`, `stderr/stdout.txt` do engine removidos e bloqueados no `.gitignore` · **`src/VadTest/` e `src/VadTestCpp/` apagados** (6 rastreados + `bin`/`obj`) — antes de apagar confirmou-se que a `ApplicationLoopback.dll` de **produção** e o `NativeMethods.txt` continuam rastreados e que nenhuma `.sln`/CI os referenciava. **Gates:** vitest **7 827 / 278** · tsc 0 · biome **0 / 890** · dotnet build 0 erros 0 avisos · dotnet test **2 525 verdes, 0 falhas, 3 ignorados**. **A10 apanhou um ficheiro não previsto:** `vitest_output.txt` tem 814 KB (o achado dizia "0 B / 460 B"). **Ficou por tocar, deliberadamente:** `legacyMachineId()` e a constante `'dinho-default-machine-id'` — **alcance RESOLVIDO em 2026-10-06:** não é código morto, é o *fallback de decrypt* em `license-store.ts:124` — se a chave actual não decifrar a key file, tenta com a derivação antiga (instalações antigas). Alcançável em produção (`decryptLicense` → `readSavedKey`) mas só exercido com dados legados. Mantido por desenho.

**Lote 1 (os 5 "bugs visíveis + deps mortas") — ✅ EXECUTADO 2026-10-06.** Detalhe na secção "LOTE 1" do relatório. **Feito:** 8 chaves `addRuleButton` nos 3 `malware.json` + **varrimento global de i18n que foi muito além do previsto** — dos "218/219 faltas" iniciais, **155–192 eram falsos positivos** (o `t` vinha por prop/parâmetro; pais com `useTranslation('clips'|'updates'|'uninstaller')`; 9 eram plurais `key_one/_other`; 1 era `useTranslation(['clips','common'])` a array; 2 eram `defaultValue` literal do i18next). Triado com a **barreira nova `src/renderer/src/i18n-usage.test.ts`** (4 testes, RED 55/54/54 → GREEN 4/4 — só avalia ficheiros com `useTranslation()` ou literal único, ignora arrays e ficheiros sem hook): **3 trocas de namespace** de 1 linha (`AdvancedTools.tsx:100` → `windowsTweaks`, fecha 31 ocorrências; `DiskRepairOption.tsx:37` → `disk`; `ServiceBulkActions.tsx:31` → `hardening`, porque `services.json` nunca existiu) + **64 chaves acrescentadas** a 33 ficheiros de locale · `disk.systemDrive` `"Sistema"` em pt · **`audit-log.ts` `admin: isAdmin()`** em vez de `process.env.ELEVATED === '1'` (2 testes RED) · **`patch-package`** fora do `package.json` (22 pacotes a menos, lock −317 linhas, **`npm audit` highs 5 → 0** — a cadeia `patch-package → micromatch → braces` saiu com a remoção, o último high `http-cache-semantics` com `npm audit fix` sem `--force`; restam **8 moderate** todos na cadeia `electron-builder`, que exigiriam `--force` e um downgrade breaking — **não aplicar**) · **`Vortice.D3DCompiler`** fora do csproj (0 ocorrências na assets file, nem transitiva). ⚠️ **A DLL continuou a aparecer em `bin/` depois da remoção e é resto estanque de 04/03/2026** — o MSBuild não apaga saídas velhas nem o `clean` as removeu; a prova foi apagá-las à mão e reconstruir (não voltaram) + `dotnet publish` para pasta temporária com 25 ficheiros e nenhum D3DCompiler. **Gates:** vitest **7 837 / 280** · tsc 0 · biome **0 / 892** · dotnet build 0 erros 0 avisos · dotnet test **2 525 verdes, 0 falhas, 3 ignorados**.

**Lote 3 (A2 + frente F1) — ✅ EXECUTADO 2026-10-06, 35 ficheiros apagados.** Detalhe na secção "LOTE 3" do relatório. **Apagado (medido pelo git): 4 503 linhas não vazias / 4 851 totais** = 1 228 de `src/main` (o A2 `ipc/context-menu-scan.ts` 518 + `constants/paths.ts` 291 + `vulnerability-checks.ts` 160 + `vulnerability-fixes.ts` 259) + 815 dos seus **4 testes** + **2 460 dos 27 componentes `.tsx` do renderer**. **Os 27 componentes não tinham teste nenhum** — a cirurgia temida só existia no `src/main`, e os 4 testes apagados cobriam exclusivamente código morto. **Verificado antes de apagar:** caminho vivo do scanner = `services/vulnerability-scanner/{checks,fixes}` (o re-export em `vulnerability-scanner.ipc.ts:13` vem de `vulnerability-scanner.service`, não do par apagado); caminho vivo do context menu = `ipc/context-menu-cleaner/context-menu-scan`; os 8 exports de `paths.ts` com **0** uso em produção (a primeira passagem deu 4–7 cada porque o `--glob` estava relativo à raiz errada); dos 27, **25 com zero referências** e 2 com **colisão de nome** (`ScanDetailPopup` — `TimelineView.tsx:204` define uma função local; `DnsCacheEntry` — interface C# em `platform/types.ts`). 4 directorios do renderer esvaziaram, incluindo `components/windows-tweaks/` (o cluster suspeito de feature regredida — **continua a não ser**: o que serve DNS/timer é `pages/windows-tweaks/AdvancedTools.tsx`). **Consequência do Lote 1:** 2 das suas 3 trocas de namespace (`DiskRepairOption`, `ServiceBulkActions`) eram em ficheiros que este lote apagou — `git rm` recusou-os por modificações locais e tiveram de ser forçados; só sobrevive `AdvancedTools.tsx → windowsTweaks`. **Gates finais:** vitest **7 741 / 276** · tsc 0 · biome **0 / 857** · build 0 · **cobertura 94,58% stmts / 95,72% linhas / 86,69% branches** (subiu) · dotnet test **2 525 verdes, 0 falhas, 3 ignorados**.

## Auditoria Pedido 3 — pontas soltas (2026-10-06) · secção G1–G8 do mesmo relatório (516 linhas após a revisão de 2026-10-06)

**283 canais IPC + 1 `RENDERER_LOG` = 284. O grosso está limpo: 0 `invoke` sem `ipcMain.handle`, 0 `send` sem `ipcMain.on`, 0 listener sem emissor, 0 evento sem listener, 0 canal declarado e não usado.** As 8 frentes (canais, pipe, rotas/menus, handlers de UI, stores, config) estão no relatório com `ficheiro:linha`.

**8 defeitos confirmados:** 2 handlers IPC sem chamador (`MALWARE_YARA_ROLLBACK` em `malware-scanner.ipc.ts:188`, `SCHEDULE_NEXT_SCAN` em `main/index.ts:660`) · **6 `case` C# mortos no pipe** (`IpcMessageHandler*.cs`): `renameClip` e `deleteClip` porque o main faz a operação por `fs` (`clips.ipc.ts:285` / `:221`), e `startEngine`, `listClips`, `setReplayTime`, `getStatus` por não terem emissor nenhum · 3 rotas de 40 sem item de menu (`/activation` inalcançável desde `a1f9000`, `/network` e `/schedules` desde `2007c8b`). *(Contagem corrigida em 2026-10-06: eram 41 elementos `<Route>` no `App.tsx` — 40 páginas + o `*` de404; o "38" não se reproduz.)*

**✅ CORRIGIDO (Lote 0, 2026-10-06):** `HistoryPage.tsx:100` fazia `window.location.assign('/cleaner')` numa app `HashRouter` (`App.tsx:193`) e o ficheiro não importava `react-router-dom` — saía do router e resolvia contra `app://dinho-renderer/cleaner`. **Passou a `navigate('/cleaner')`** com `useNavigate()`, **TDD**: `HistoryPage.test.tsx` criado de raiz, RED confirmado antes do GREEN.

**🔴 Quatro armadilhas de método, todas custaram tempo e produziram quase-falsidades** — não repetir:
1. **Um canal não é uma coisa só.** O primeiro diff procurava só `ipcMain.handle` e acusou **44 canais "sem handler"** que eram eventos `main → renderer`. Regra: um `invoke` exige `handle`; um `on` exige emissor. São contratos distintos.
2. **Os emissores não são todos `webContents.send`.** Mais 4 falsos positivos perdidos por não cobrir `this.sender.send` e o helper `sendClipProgress`.
3. **`onEvent` do preload é declaração de função, não arrow** — o regex de wrappers falhou e apagou 32 listeners, o que inventou 30 "eventos sem quem os ouça".
4. **`handshake` é enviado num envelope cru** (`clips-pipe.ts:78`), não pelo helper de comandos — appeared sem emissor, mas está vivo. Confirmado que **não há nome de comando dinâmico** (as únicas variáveis são o pass-through de `clips-pipe.ts:142,166`).

**⚠️ Subagentes desta auditoria entregaram resultados que não resistiram verificação — 3 falsidades concretas:**
- **Inventou três ficheiros de store.** Citou `malware-scanner-store.ts`, `disk-scanner-store.ts` e `optimizer-store.ts`; **nenhum existe** (os reais: `malware-store.ts`, `disk-store.ts`; não há `optimizer-store`). Reportou "achados confirmados" com contagem de linhas. **Descartados, não corrigidos.** O teste barato que o apanha: contar usos de cada `useXStore` hook — **zero stores órfãos**, todos os ~38 são usados.
- **Acusou 2 configurações fantasma que são lidas.** `autoInstallUpdates`/`autoInstallSchedule` — pesquisou só `src/main`; são lidas no renderer e a primeira **tem efeito real** (`SoftwareUpdaterPage.tsx:196-201` auto-instala todas as apps).
- **Acusou `cancelled` de morto num store que não existe.** O `cancelled` de produção pertence a `app-installer-store.ts`; são 26 ocorrências, todas de outras coisas.

⚠️ **Este é o 3.º falso positivo do `knip` na mesma sessão** (depois dos 153 do arranque e do `RenameDialog`/`PublishModal`, que **não** são órfãos — estão montados em `ClipsPage.tsx:9,87,90`; a feature funciona, o que morreu foi o handler C# que ficou para trás quando o main passou a `fs`). **Nenhum achado de subagente entra no relatório sem `rg` de confirmação.**

**Lote 0 (o de melhor relação custo/benefício) — ✅ EXECUTADO 2026-10-06.** Plano em `docs/plans/audit-g-pontas-soltas-2026-10-06.md` (10 passos, TDD). **Duas decisões do utilizador:** `getStatus` **fica** (a app não o invoca mas o harness de soak externo usa-o → scope C# = 5 comandos, não 6, e ficou com comentário a marcar porquê); as 3 rotas **ficam como estão** (dívida conhecida, sem tocar em UI/locales). **Executado:** `HistoryPage.tsx:100` → `navigate('/cleaner')` com `useNavigate()` (**TDD**: `HistoryPage.test.tsx` criado de raiz, RED confirmado antes do GREEN) · `SCHEDULE_NEXT_SCAN` + `MALWARE_YARA_ROLLBACK` removidos (handler, constante, import, mock e os **2 testes** do `describe`) · 5 `case` C# mortos · **`IpcMessageHandler.Clips.cs` apagado** (6 163 B) · ramos internos em `Config.cs` (arm + `HandleSetReplayTime` + if/else → `await StopAsync()`). **Gates:** vitest 7 818/277 (7819 −2 +1) · tsc 0 · biome 0/889 · **dotnet build 0 erros 0 avisos** · **dotnet test 2 525 verdes, 0 falhas, 3 ignorados**. `rollbackUpdate` **mantém-se** em `yara-rules-store.ts` (exportada, 7 testes próprios) e `StartAsync` **não** ficou órfã (`Program.cs:225` chama-a no arranque).

**Erro meu que o gate apanhou, para não repetir:** ao remover linhas do mock com um script, reinseri `fetchAndCacheRules` que já existia uma linha acima → chave duplicada. Apanhado pelo `biome check` (3 erros de formatação) e pelo `tsc`, resolvido com `--write`. **Diff final revisto linha a linha.**

---

## Auditoria Pedido 4 — falsa prontidão (2026-10-06) · relatório completo em `AUDITORIA-PEDIDO-4-FALSA-PRONTIDAO.md` (gitignored)

**Tema:** features que parecem feitas mas não executam a acção real. Método: 4 agentes explore em paralelo + verificação pessoal de cada achado grave por leitura/`rg`. **11 achados confirmados (F1–F11)**.

**Positivos REAL (confirmados por amostragem, não são fake):** compliance (re-scan pós-apply), privacy shield, threat intel/sandbox, benchmark, service apply backend, malware YARA, disk/cleaner scans. O fallback `scanner-network` (LLMNR/WPAD default habilitado) é defensível (default do Windows), não é falso.

**Decisão do utilizador (question tool): «Relatório + corrigir os graves (Recomendado)»** — corrigir **F5, F2, F1, F3, F7** com TDD; F4/F6/F8/F9/F10/F11 ficam "decisão aberta".

**Lote 1 — ✅ 5 correcções executadas (TDD, RED→GREEN):**
- **F5:** `backup.ts` — `exportHive` responde `boolean`; `createFullBackup`→false se algum dos 9 exports falhar (continua tentando os restantes); `createTargetedBackup`→false se houver keys esperadas e 0 bodies, ou tasks esperadas e nenhuma gravada. `fixer.ts` → `backupFailed = !ok`. Restauro (`reg import`) **não** existe — decisão de produto em aberto. `backup.test.ts` ganhou mock de node:fs; `fixer.test.ts` +2 casos.
- **F2:** scripts em `network.ts:305-337` reescritos: `$errs=@()`, `$LASTEXITCODE -ne 0` após cada `netsh`, `Write-Output "ERROR: netsh failed for: ..."` se `$errs.Count -gt 0` — reverte o `Write-Output "OK"` incondicional do revert. Testes no `windows-tweaks.ipc.test.ts` inspeccionam `mockExecFile.mock.calls[0][1][3]`.
- **F1:** removidos `CVE-2025-0001/0002/0003`, `CVE-2024-29059`, `CVE-2024-43579`, `CVE-2023-38169`, `CVE-2000-0001`, `CVE-2024-0057`. Mantidos só os canónicos: smbv1 `CVE-2017-0143` (EternalBlue), rdp `CVE-2019-0708` (BlueKeep), tls10 `CVE-2011-3389` (BEAST). Teste: `expect(finding.cve).toBeUndefined()`.
- **F3:** `WindowsTweaksPage.tsx` — `showApplyFeedback(result, verb)`: `null` → `toast.error('operationFailed')`; `failed>0` → `toast.error('someFailed')`; senão sucesso. Aplicado a apply (`lastResult`) e revert (`revertResult`). 5 testes novos no `WindowsTweaksPage.test.tsx`. A store já propagava via `lastResult` — só a página não lia.
- **F7:** `service-store.ts` ganhou `postApplyServices(current, scanResult)` puro (retorna `scanResult.services` se não-vazio, senão `current`); `ServiceManagerPage.tsx` passou de `setServices(getState().services)` (no-op) a `setServices(postApplyServices(...))`. 3 testes novos. A store já tinha o caminho correcto em `apply` — o defeito era a página contorná-lo.

**Gates (Lote 1):** vitest **7 773 verdes / 277 ficheiros** (baseline 7 757 → **+16**) · tsc 0 · biome 0/859 · build 0 (819 ms) · C# intocado (2525/0/3 de referência). **Sem commit** (16 ficheiros modificados na working tree).

**Lote 2 (restante) — ✅ concluído em 2026-10-06, TDD RED→GREEN, sem commit.**
- **F8:** `startup-manager/delete.ts` — um `reg delete` que falha já **não** conta como sucesso: `deletedSource = notFound` com `code===2` ou erro "cannot find / not found / não encontrad* / no se encuentr…" (registo novo `delete.test.ts`, 6 testes). ⚠️ **Correcção de suíte em `startup-manager.ipc.test.ts`:** o teste antigo mockava `Access denied` num caso intitulado "entry already gone" — com o comportamento novo, falhou (expected false to be true) e o mock passou a representar o erro real de "já não existe" (stderr + code 2); com isso a suíte inteira volta a 7 819.
- **F9:** `batch-totals.ts` + teste (novo) — totais reais por acção em `uninstaller`; `UninstallerPage.tsx` usa `leftoversFound` real do backend.
- **F6:** `registry-cleaner` devolve `fixedByType` real por categoria (fixer + handlers + preload + store); `category-breakdown.ts` + teste (novo); `RegistryPage.tsx` consome. 81/81 verdes na área.
- **F10 (=A):** `windows-tweaks/snapshot-store.ts` + teste (novo) — persistência de snapshot pré-apply (`reg add` com `defaultValue` como fallback de leitura); `handlers.ts` captura antes de aplicar e restaura (`reg add`/`reg delete`) no revert; `HostsEditorPage.tsx` lê a falha. Mocks electron/hwid no teste (`F4` lição: mockar a dependência de raiz, não o módulo novo). 93/93 verdes na área.
- **F4:** ver sessão abaixo ("Lote 2" do plano — snapshot do Hosts também capturado no apply/revert, testes do `windows-tweaks.ipc.test.ts`).

**F5b — RESTAURO do Registry Cleaner — ✅ implementado em 2026-10-06 (TDD, baixo).**
- `restore.ts` + `restore.test.ts` (novo, 8 testes): `listRegistryBackups()` classifica por timestamp (`YYYY-MM-DDTHH-MM-SS-mmmZ`) e `kind` (`targeted`/`full`/hive/`shell`/`tasks`), sort desc, tamanho; `restoreRegistryBackup(name)` valida o path (traversal → `{ok:false,message}`) e o padrão, corre `reg import` com timeout 120 s; **tasks → não suportado** (`{ok:false}` claro) — não-goal.
- IPC `registry-cleaner/handlers.ts`: `REGISTRY_RESTORE_LIST` + `REGISTRY_RESTORE` (`validateSender`, win32, nome ≤300, `logAudit`). 57 testes no `handlers.test.ts`; `registry-cleaner.ipc.test.ts` com 7 handlers.
- Channels `cleaner:registry:restore:list`/`cleaner:registry:restore`; tipos `RegistryBackupKind`/`RegistryBackupInfo`; preload `registryRestoreList`/`registryRestore`.
- UI: `RestoreBackupDialog.tsx` (novo, 6 testes) + botão (ícone History) em `RegistryPage.tsx`; 20 chaves novas em `pt/en/es/registry.json` (barreira i18n verde). `useEffect` com `onCloseRef`, deps `[open]` (biome `useExhaustiveDependencies`).

**Gates (fim do Lote 2 + F5b, 2026-10-06):** vitest **7 819 / 283 ficheiros, 7 819 verdes, 0 falhas** · tsc 0 · biome **0/870** · build 0 (923 ms) · C# intocado (2525/0/3 de referência). **Sem commit** (working tree com 25+ ficheiros).

**Armadilha de processo (F5b):** a barreira i18n exige **chaves reais nos locales** mesmo com defaultValue (`operationFailed`+`someFailed` adicionados aos 3 `windowsTweaks.json`) — literal default NÃO isenta da chave.

**F11 (=A) — superfície órfã `DRIVER_AGENT` removida em 2026-10-06.** O evaluator (`driver-agent-evaluator.ts`, real e testado) e `@shared/driver-agent-types.ts` **ficam**; o que era órfão era o espelho IPC — removidos: canais `DRIVER_AGENT_EVALUATE`/`DRIVER_AGENT_APPROVE` (`channels.ts`), `driverAgentEvaluate`/`driverAgentApprove` no preload (+ tipagem `AgentEvaluationResult`), `registerDriverAgentIpc` do `ipc/index.ts` e **`driver-agent.ipc.ts` + `.test.ts` apagados** (14 testes saíram com eles), refs em `test-utils.ts`, `preload/index.test.ts`, `e2e/ipc-roundtrip.test.ts`, mock e lista do `ipc/index.test.ts`. `rg "driverAgentEvaluate|driverAgentApprove|DRIVER_AGENT|driver-agent.ipc" src` → **0**.

**Gates finais (porta do Pedido 4, 2026-10-06):** vitest **7 805 / 282 ficheiros, 7 805 verdes, 0 falhas** · tsc 0 · biome **0/868** · build 0 (830 ms) · **dotnet build 0 erros 0 avisos** · **dotnet test 2 525 verdes, 0 falhas, 3 ignorados** (os 3 `RequiresAdminFact`, não elevado). **Sem commit** (working tree com 30+ ficheiros).

---

## Auditoria Qualidade dos Testes (2026-10-06) · relatório completo em `AUDITORIA-QUALIDADE-TESTES-2026-10-06.md` (gitignored)

**Tema:** "7812 testes TS + 2525 C# verdes não provam que o fluxo real funciona, principalmente com mock de IPC". Método: 4 agentes explore em paralelo + verificação pessoal de cada achado grave por leitura/`rg`. **Investigação pura — nenhum código alterado.** Números medidos: vitest **7 805 / 282 ficheiros** (7 517 blocos estáticos) · C# 2 525/3 · E2E 40 testes / 62 `expect`. *(O "7812" do enunciado não se reproduz; o medido é 7 805.)*

**Veredicto:** o código real do handler É exercitado (45/46 `*.ipc.test.ts` invocam o handler real), mas **100% dos testes vitest mockam o backend do SO** (reg.exe/netsh/secedit/winget/sc) ⇒ nenhum apply/fix/clean/quarantine correu contra o Windows numa suíte. Taurologias são poucas e concentradas (~15 de 7 517); os riscos maiores são **flakiness real** e **lacunas de integração**.

**6 achados confirmados (com `ficheiro:linha` no relatório):**
1. **Mock excessivo:** 45/46 `*.ipc.test.ts` mockam `electron` (invocam handler real); ~15 mockam o serviço inteiro; **47/94** testes de `src/main/services` mockam `child_process`/`fs`. Coerência 98–100% mas 100% mocked-path. Réplicas locais de funções privadas em `firewall-audit.ipc.test.ts:33-66` e `service-manager.ipc.test.ts:60-66` (mudar a fonte não quebra o teste). Ponte real só em `e2e/ipc-roundtrip.test.ts` — com SKIPs (`:28-77`), prova wiring, não operação.
2. **Asserções fracas (parser AST):** 11 testes com zero `expect`, 67 `not.toThrow`, 638 (8,5%) só mock-call (bridge = legítimo), 3 tauologias `expect(true).toBe(true)`, 0 `expect.assertions`. Confirmados vazios: `clips-engine-connection.test.ts:1546`, `threat-intel.test.ts:409`, `perf-monitor.ipc.test.ts:224`, `registry-cleaner.ipc.test.ts:400`, `scheduler.test.ts:240-261` (5), `benchmark.ipc.test.ts:299`, `disk-trim.ipc.test.ts:962`, `yara-engine.test.ts:143`. **Teste invertido:** `path-safety.test.ts:51-57` ("throws" mas asserta `not.toThrow()`). **Flaky:** `clips-engine-connection.test.ts:1112` (sleep fixo de 3,5 s), `game-detector.test.ts:223`, `thumbnail-generator.test.ts:306`, `yara-engine.test.ts:94-158`.
3. **Cobertura alta sem integração:** `app-installer`/`service-manager`/`network-monitor`/`vulnerability-scanner`/`stores/app-installer-store` a 100% com backend mockado. Zero testes vitest com renderer→preload→main reais.
4. **Os 3 C# ignorados têm justificação de elevação NÃO comprovada:** `NamedPipeServerIntegrationTests.cs` (2.º cliente while 1.º holds, fan-out 2 clientes, roteamento por reqId com `Drain` anti-positivo-falso) fazem pipe real; mas `NamedPipeServerTests.cs:942-977` faz round-trip real igual (`CurrentUserOnly`) **sem elevação** ⇒ os caminhos multi-cliente estão descobertos sem razão medida — experimentar corrê-los não elevado.
5. **GPU/vendor:** pipeline WGC→NV12→NVENC→mux **nunca** é exercitada por teste (só soak manual/CLI). NVENC = 3 testes reais com GPU exigida; **AMF ~20 ficheiros mas todos pure — zero spawn real; QSV só strings**. `WasapiSourceTests.cs:61-89` pass-and-skip. `ClipExporter*IntegrationTests` no-op sem ffmpeg no PATH — **a máquina sem ffmpeg passa-os sem asserir**. ~14/2528 (0,6%) tocam hardware.
6. **E2E (40/62 expects):** **"só corre elevado" é falso** — `src/main/index.ts:147` salta elevação com `DINHO_E2E=1` (corre não-admin). **"jornada completa em todos os módulos" é exagerado** — journey visita **26/38** rotas; 12 não visitadas (incl. `/clips`, `/game-mode`, `/uninstaller`, `/activation`); só `session-record` visita as 38 e navega sem asserir. **3/40 testes têm 0 `expect`** (`dbg-buttons`, `journey`, `session-record`). Nenhuma spec faz save de clip real (`.mp4` nunca verificado), engine/pipe nunca asserta sucesso, destrutivos todos no-op/SKIP.

**Correcções — R1 ✅ R2 ✅ R3 ✅ R6 ✅ executadas em 2026-10-06 (sem commit), ver "Correcções executadas" abaixo. Decisões de política (não aplicadas):** R4 (1 teste E2E de clip real — exige engine elevado + GPU + ffmpeg; fica nos scripts de soak existentes) · R5 (1 apply real revertível contra o SO — mutar o SO real em suite automática conflita com o princípio security-first "never mutate").

**🔜 PENDENTES REGISTADOS (2026-10-06) — para executar outro dia (não são bugs nem dívida urgente):**
- **R4 — E2E de clip real:** 1 teste/harness com engine **elevado** + GPU + ffmpeg embarcado que faça `saveClip` pelo pipe e verifique o `.mp4` com frames>0 (fechar o buraco "clips nunca é testado de verdade"). DoD: corre em máquina com GPU, fora do gate normal (CI não tem GPU); aproveitar os orquestradores `cfr-soak.ps1`/`soak-cfr.ps1` em vez de duplicar.
- **R5 — apply real revertível contra o SO:** ex. tweak HKCU reversível aplicado e revertido, provando o fluxo real além de mocks. DoD: capturar snapshot pré-apply (o mecanismo de F10 já existe: `windows-tweaks/snapshot-store.ts`), aplicar, rever, asserir que o reverter restaurou — sem deixar estado residual. Regra: os 3 filtros ASLR/quarantine **não** entram; garantir `finally` que reverte.
- Regra de ouro para qualquer um dos dois: **correr isolado e elevado**, nunca dentro do vitest default. Reabrir em AGENTS quando decidirmos fazê-los.

**Correcções executadas (R1/R2/R3) — gates finais em 2026-10-06: vitest 7 804 / 282 ficheiros, 7 804 verdes, 0 falhas** · biome 0 / 868 · tsc 0 · **dotnet test 2 528 verdes, 0 falhas, 0 ignorados**. Sem commit.
- **R1:** os 3 `NamedPipeServerIntegrationTests` provados SEM elevação (filtrado 3/3 verdes = round-trip real igual aos `NamedPipeServerTests`) → `[RequiresAdminFact]` → `[Fact]`; atributo órfão removido (`RequiresAdminFactAttribute.cs` apagado). **C# passou de 2 525/0/3 para 2 528/0/0** — a suíte inteira agora corre no gate normal.
- **R2 — testes vazios/tauologias asseridos:** `clips-engine-connection.test.ts:1546` → `expect(writeCount('stopEngine')).toBeGreaterThan(0)` · `threat-intel.test.ts:409` → `expect(spy).toHaveBeenCalled()` · `benchmark` "sets cancelled flag" deixou o spy impossível (`spyOn(await import(...))` não intercepta referência interna) → o mid-cycle chama `getHandler('benchmark:cancel')()` (flag → run cortado, semântica real) + teste standalone via `mocks.logger.info` com `'Benchmark cancelled by user'`; import `cancelBenchmark` removido · `perf-monitor.ipc.test.ts:224` reescrito (destroyed) com asserts reais de `mockStart` · `scheduler`: 5 testes `not.toThrow` rescritos com `toHaveBeenCalled`/`not.toHaveBeenCalled` (mock Notification hoisted construtível) + 1 positivo novo · `yara-engine.test.ts:138` tautologia → 2 readers concorrentes · `path-safety.test.ts:51` teste invertido ("throws"+`not.toThrow`) corrigido · placeholder `disk-trim` removido · `registry-cleaner` null-window: `mockSend` não existia nesse describe → asserção do contrato real (com `sender-validation` mocked `()=>true`, o fix executa com getter null e devolve o resultado intacto).
- **R3 — sleeps críticos → `vi.waitFor`:** `clips-engine-connection.test.ts:1112` (3,5 s fixo) → fake timers + `advanceTimersByTimeAsync(4000)` · `game-detector.test.ts:223` · `thumbnail-generator.test.ts:306` (2.ª `generateThumbnail` dentro do waitFor) · `yara-engine.test.ts:94`.
- **R6:** claims do E2E no AGENTS corrigidas (não-elevado via `DINHO_E2E=1`, journey 26/38 rotas, 3/40 com 0 expect) — ver bloco "Testes/Qualidade" acima.

---

## Auditoria "Falhas que não chegam ao usuário" (2026-10-07) · relatório completo em `AUDITORIA-FALHAS-SILENCIOSAS-2026-10-07.md` (gitignored)

**Tema:** "a UI mostra sucesso enquanto a operação falhou" (7 áreas). Método: 5 agentes explore em paralelo + verificação pessoal. **Investigação pura — nenhum código alterado, sem commit.** 6 achados confirmados (F1–F6) + 1 observação (F7):

- **F1 (ALTO) — settings rejeitados pela allow-list, UI mostra "salvo":** `ipc-validation.ts` — `allowedTopKeys` sem `backupMode`/`autoInstallUpdates`/`autoInstallSchedule`, `allowedCleanerKeys` sem `protectRecycleBin`, `allowedGameModeKeys` sem `preconfigVersion` (todos existem no tipo `common.ts:70,72,77,90` e `game-mode.ts:78`). `SETTINGS_SET` (`ipc/index.ts:158-160`) resolve `{success:false}` **sem rejeitar**; callers ignoram o resolve (`SettingsPage.tsx:27-30` `.catch(()=>{})`, `:163-164` `backupMode`, `:176-179` `protectRecycleBin`; `game-mode-store.ts:109-158` envia `{gameMode:{...config}}` com preconfigVersion ⇒ **todos os saves de game-mode rejeitados**; `preload/system.ts:199` tipa `Promise<void>`). Repro: trocar backupMode → Full → reiniciar → volta a `targeted`. Efeitos: backupMode nunca chega ao fixer, auto-install do updater nunca dispara, game-mode nunca persiste.
- **F2 (ALTO) — padrão `.catch(()=>{})` + resolve-`{success:false}` ignorado:** `registry-store.ts:56`, `useClipsActions.ts:237`, `useClipsState.ts:204,214` + todos os do F1. Contrato correcto: chamador DEVE ler `success`/`error`, não só tratar rejeição.
- **F3 (MÉDIO) — reverts mudos:** `CompliancePage.tsx:180-182` e `VulnerabilityScannerPage.tsx:175-177` → catch só `setStatus('done')`; `result.failed` nunca tostado; `applyResult` guardado mas nunca renderizado.
- **F4 (MÉDIO) — benchmark fabrica valores:** `benchmark.ipc.ts:48,67` (CPU→50 no catch/cancel), `:190` (RAM→0), `:200-201` (powerplan→'balanced'); tipo sem campo `error`; `BenchmarkPage.tsx:92-128` renderiza scores como reais.
- **F5 (MÉDIO-BAIXO) — quarantine delete:** `quarantine-ops.ts:112` `rm(...,{force:true})` conta ficheiro ausente como `succeeded++`; `MalwareScannerPage.tsx:341-349` não tosta `result.failed`.
- **F6 (MÉDIO-BAIXO) — clips config→engine:** `clips.ipc.ts:432-448` sync falhado/sem pipe só loga warning e devolve `{success:true}`; `useClipsActions.ts:51-58` ignora o resultado.
- **F7 (BAIXO, mitigado) — registry fix remove falhados da lista** (`registry-store.ts:134`); mitigado por `FixResultCard`.

**Falsos provados (agentes erraram — não re-investigar):** better-sqlite3 "sem try/catch em 6 sítios" (`src/main/database/` **não existe**; só 4 refs, o `database-optimizer` guarda com try/catch+fallback; `asarUnpack` OK em `electron-builder.yml:100-101`) · "yara-x ausente no main" (carregado em `yara-engine.ts:97,132`, unpacked) · "Rec venham para sempre na morte do engine" (poll 3 s + broadcast em `useClipsState.ts:327-337`) · privacy/network "sem feedback" (toasts `failed` existem) · licença offline (é desenho — fallback 24 h HMAC/HWID, A4).

**Área 6 sem falso sucesso confirmado:** `EngineCoordinator.Capture.cs:371-379` seta `Recording=true` logo após `_encoder.Initialize`; encoder morto a meio só se nota no `saveClip` (que devolve erro e a UI mostra). Sem verificação de ficheiro em disco pós-save (não reproduzido).

**Decisão do utilizador (2026-10-07): «F1+F2 agora, F3–F6 depois»** → mas apenas a pedra angular funda em ipc/allow-list + sucesso propagado. F3/F4/F5/F6 permanecem ABERTOS (não corrigidos).

**Lote F1+F2 — ✅ EXECUTADO em 2026-10-07, TDD RED→GREEN, sem commit.**
- **F1 (allow-list, `src/main/services/ipc-validation.ts`):** `allowedTopKeys` ganhou `backupMode`, `autoInstallUpdates`, `autoInstallSchedule`; `allowedCleanerKeys` ganhou `protectRecycleBin`; `allowedGameModeKeys` ganhou `preconfigVersion`; validação de valores nova (`backupMode: 'targeted'|'full'`, `autoInstallSchedule: 'daily'|'weekly'|null`, booleanos, `preconfigVersion` inteiro ≥0). **5 testes RED → 151/151 GREEN.** Os saves de `settings:set` deixam de ser rejeitados em silêncio: backupMode, auto-install do updater, protectRecycleBin e todo o game-mode agora persistem (`SETTINGS_SET` chama `setSettings` e o handler já tratava gameMode/language/intervalo — ver `src/main/ipc/index.ts:158-160`).
- **F2 (callers leem `success`/`error`):**
  - `src/preload/system.ts:199` — `settingsSet` de `Promise<void>` → `Promise<IpcResult>`.
  - `SettingsPage.tsx` — `save()` async lê o resultado; em `{success:false}` ou rejeição → `refreshSettings()` (store já tinha o helper) + `toast.error('settingsSaveFailed')` (3 locales). **`SettingsPage.test.tsx` novo** (3 testes: sucesso sem toast; resolve-failure com toast+refresh×2; rejeição com toast+refresh×2).
  - `game-mode-store.ts` — novo helper `persistGameModeConfig(previous, updated)` que **reverte** a config optimista em `{success:false}`/rejeição (guard: só se `getState().config === updated`, para não apagar alteração mais recente). 6 writers usam. **+4 testes** (sucesso mantém; failure reverte; rejeição reverte; revert não apaga change mais nova).
  - `registry-store.ts:50-66` — `persistTweakChoice` reverte a selecção optimista se `registrySetTweakIgnored` rejeitar. **+2 testes** (reject reverte, resolve mantém).
  - `useClipsActions.ts:228` — `toggleFavorite` reverte + `toast.error(result.error || 'favoriteFailed')` em falha/resolução `{success:false}`. **+3 testes** (sucesso sem toast; rejeição reverte+toast; resolve-failure reverte+toast). 2 chaves i18n novas: `settingsSaveFailed` (settings.json) e `favoriteFailed` (clips.json), nas 3 locales.
- **Gates (2026-10-07):** vitest **7 823 / 283 ficheiros, 7 823 verdes, 0 falhas** (baseline 7 804 → +19) · tsc 0 · biome **0 / 869** · C# intocado (2528/0/0 de referência). **Sem commit** (working tree com 20+ ficheiros).

**Pendente (superado):** F3 (reverts mudos Compliance/Vulnerability), F4 (benchmark fabrica valores), F5 (quarantine delete), F6 (clips config→engine) — **todas executadas no Lote F3–F6 abaixo.**

**Lote F3–F6 — ✅ EXECUTADO em 2026-10-07, TDD RED→GREEN, commit `c066ce3`** (`fix: feedback real em reverts, benchmark, quarantine delete e sync de clips (F3–F6)` — 26 ficheiros, 684 inserções).
- **F3 (reverts mudos):** `runRevert` em `CompliancePage.tsx` e `VulnerabilityScannerPage.tsx` — `result.failed > 0` → `toast.error(t('applyFailed'))` (chave já existia) e o `catch` passou de `setStatus('done')` mudo para toast + `setStatus`. **Testes de página novos** (`CompliancePage.test.tsx`, `VulnerabilityScannerPage.test.tsx`, 4+4 testes).
- **F4 (benchmark deixa de fabricar valores):** `BenchmarkResult` em `shared/types/performance.ts` ganhou `failure?: 'cancelled' | 'incomplete'` e `failedMetrics?: string[]`; as funções `measure*` em `benchmark.ipc.ts` devolvem **`null`** em falha/cancel em vez de valores inventados (CPU→50, RAM→0, ping→100, DPC→1000, powerplan→'balanced', etc.), o handler recolhe falhas via `markFailed`, as métricas falhadas saem com score 0 + detail `'Falha na medição'` (powerPlan: `'Indisponível'`) e `failure = cancelled|incomplete`. `BenchmarkPage.tsx` mostra um **banner âmbar** `cancelledWarning`/`incompleteWarning` (3 locales). 3 testes novos na página + 2 novos no ipc + 2 ajustados (partial/cancelado). Objeto de resultado construído sem `undefined` explícito (`exactOptionalPropertyTypes`). **`pingAvg` órfão removido**.
- **F5 (quarantine delete honesto):** `deleteMalware` em `quarantine-ops.ts` — ficheiro ausente (ENOENT) deixa de contar como `succeeded++` (o `rm({force:true})` engolia o erro); agora `stat` prévio + `s.isFile()`, ausente/não-ficheiro → `failed++` com `'File already deleted or not found'`, sem remover a entrada do manifest. `MalwareScannerPage.tsx` tosta `toastDeleteQuarantineFailed` (chave nova nos 3 locales) quando `result.failed > 0`. 1 teste novo.
- **F6 (clips config→engine honesto):** `CLIPS_SET_CONFIG` em `clips.ipc.ts` — só devolvia `{success:true}` mesmo quando o sync ao pipe falhava; agora pipe ligado + sync falhado → `{success:false, error}`. Pipe não ligado continua `{success:true}` (config persistida, aplicada no start do engine). `useClipsActions.handleConfigUpdate` lê o resultado: `success===false` → `toast.error(error || 'configSyncFailed')` e re-refresh (reverte o optimista); rejeição → `toast.error('configSyncFailed')`. 3 chaves `configSyncFailed` novas; 16 mocks `mockResolvedValue(true)` → `{success:true}` no teste de actions + 2 testes novos (resolve-failure e rejeição).
- **Gates (2026-10-07):** vitest **7 840 / 286 ficheiros, 7 840 verdes, 0 falhas** (baseline 7 804 → +36) · tsc 0 · biome **0 / 872** · build ok (821 ms) · C# intocado (2528/0/0 de referência). **Commit `c066ce3`** (só o lote F3–F6; o resto da working tree — Lote 4, Pedido 4, auditoria de testes, F5b — continua sem commit).

## Itens fechados por decisão (2026-10-03 23:45) — não reabrir sem sintoma novo

| Item | Decisão | Razão |
|---|---|---|
| 9 anomalias residuais do soak (0,008%) | **won't fix** | Não acumulam (+0,284 s em 2121 s), 3 hipóteses testadas e mortas, e o P4 provou que `DMax=17 ms` é alcançável — logo não são estruturais. Zero sintoma. |
| `convert` a crescer com uptime | **só vigiar** | Não reproduziu acima de 6 ms em nenhum dos últimos três clipes. Regra de disparo já escrita: medir `nvidia-smi` se `convert>10 ms`. Sem trabalho de código. |
| Divisor da janela de telemetria (5,0 vs 5,5 s) | **deixar o código** | Corrigir exige rebuild do engine + captura nova para revalidar — ou seja, invalidar a base de referência que acabámos de estabelecer. O efeito está documentado acima e `feedLag` já é declarado a medida honesta. Reabrir se a telemetria voltar a ser trabalhada. |
| Restart legítimo a preservar PTS/backlog | **won't fix por agora** | O disparo indevido (1080p→720p + restart a meio) já foi eliminado e não voltou a aparecer em nenhuma sessão. O caso restante — crash real — nunca foi observado por um utilizador. Reabrir no primeiro crash. |
| Regime <20 fps em produção | **já coberto** | Não precisou de teste forçado: a oclusão do P4 produziu-o naturalmente com 37 skips e ficheiro perfeito. |
| 17 ficheiros de rascunho na raiz | **removidos** | Output de diagnósticos descartáveis de 2026-10-01: quatro eram mensagens de erro de scripts Python que já não existem, o resto era saída de `grep` sobre código que continua no repo (regenerável a qualquer momento), e o `.md` tinha 0 bytes. Nada versionado os referenciava.
**Duas armadilhas do harness de medição, ambas corrigidas em 2026-10-03:**
1. **`-nostdin` é obrigatório nas duas invocações de ffmpeg.** Por omissão o ffmpeg lê stdin para comandos interactivos; lançado a partir de uma janela elevada oculta com o handle herdado partido fica **BLOQUEADO indefinidamente sem consumir CPU** (observado: 0,06 s de CPU em 20 min, nenhum `.crc` escrito, `framecrc` incompleto). **Não é timeout — não acaba sozinho**, e a corrida parece viva porque o processo `ffmpeg` continua listado. Sintoma: o log pára em `==> framecrc` e nunca mais avança.
2. **A auto-elevação perdia toda a saída e não esperava.** `Start-Process -Verb RunAs` não pode ser combinado com `-RedirectStandardOutput` (usa o parameter set *ShellExecute*), e o código original não usava `-Wait`: o processo elevado corria à deriva e o output ia todo para o lixo. Além disso reenviava os `[switch]` como `-Measure True`, que com `-File` chega ao script como argumento posicional. Agora passa por `cmd.exe` com `>> log 2>&1` (mesmo padrão de elevação documentado para `npm run dev`), com `-Wait`, e os switches vão **pelo nome**. **Pendente:** as 9 anóm residuais dos 6 clips (0,008% dos frames) continuam sem causa — 3 hipóteses já foram testadas e descartadas, ver acima.

**PLANO "Clips Leve 60fps AMD/NVIDIA" (2026-09-25, concluído):** 10 itens — 9 DONE (TDD) + Item 7 (B-frames) MEDIDO e encerrado como **"não promove"** (decisão do usuário). Detalhe item a item, gates e medições (09-25 → 09-29) em `SESSION-HISTORY-FULL.md` (2026-09-25b) e `docs/plans/clips-leve-60fps-amd-nvidia-2026-09-25.md`.

- **INVARIANTE (bloqueante, explícito no plano):** o CQ escolhido pelo usuário é sagrado — 16/18/20/22 (`clips-quality-presets.ts`, default 20 em `clips-config-manager.ts:63`), clamp 0..51 (`clips.ipc.ts:332`/`ConfigManager.cs:294`), derivação `cq − 4` do QSV (`FfmpegEncoder.cs:221`). **Nenhuma mudança futura pode alterar CQ nem introduzir valor novo.**
- **INVARIANTE (bloqueante) — RESOLUÇÃO DA UI É SAGRADA (decidido pelo usuário 2026-10-03):** a resolução escolhida na UI (`_config.Config.Width/Height` → `EngineCoordinator.Capture.cs` → `SetOutputResolution`) nunca pode ser reduzida automaticamente. O divisor de escala (cascata de fallback HW 1/2 → HW 1/4 → CPU 1/2) e o **capacity guard** só agem quando NÃO há alvo explícito (native, `outputW <= 0`); em produção o coordinator manda sempre alvo explícito, logo o divisor é **inerte** e o guard **não** reinicia o ffmpeg mid-session. Fix: gate `scaleDivisor > 1 && outputW <= 0` em `FfmpegEncoder.ComputeScaleTarget`, revertendo o "Item 1" (piso absoluto 1280×720 que degradava 1080p→720p). Regressão que motivou: sessão FiveM 2026-10-03 — o guard disparou por ruído (feed ~58–59fps lido como "saudável" num tick + `speed`/`outLag` medem o feed, não o encoder), degradou 1080p→720p e reiniciou o ffmpeg mid-session → PTS não-monotónico, `DriftMonitor -8835ms`, save com `AlignAudio -9453ms` (A/V dessincronizado). **2443/2443 C# GREEN.** *(Nota: blindar o restart em si — preservar PTS/backlog num restart legítimo de crash — segue NÃO feito; só o disparo indevido foi eliminado.)*

**DESCARTADA pelo usuário (2026-09-16) — Multi-Track Audio** (Item 5): commit `14d939b` trouxe a política pura `MultiTrackAudioPolicy.ResolveTracks` + `AudioTrackKind` (5/5 GREEN), mas o usuário **descartou a feature inteira** antes da implementação HW (AudioMixer multi-stream WASAPI, N encoders AAC, N streams ADTS→MKV) e o código morto foi **removido** (`commit <pending>`: `MultiTrackAudioPolicy.cs`, `AudioTrackKind.cs`, `AudioInputConfig.cs`, `MultiTrackAudioPolicyTests.cs`). Não reabrir sem novo pedido explícito.

**Rejeitado pelo usuário — não reabrir sem novo pedido explícito:**
AI auto-clipping (detecção de eventos), clip por comando de voz, gravação de sessão completa + bookmarks, compilação automática de highlights, compartilhamento/links instantâneos, cloud storage, app mobile, **Multi-Track Audio (Item 5)**.

## Histórico Detalhado de Sessões

**2026-09-29:** o log de sessões (causas-raiz, números de teste, decisões técnicas pontuais) foi movido deste arquivo para `SESSION-HISTORY.md` (condensado) e `SESSION-HISTORY-FULL.md` (verbatim). As sessões **2026-09-13 → 2026-09-25a** já estavam em `SESSION-HISTORY.md`; os blocos **09-25b/09-25c/09-27/09-29/09-29b/09-29c e 09-29d** saíram do AGENTS.md nesta data. Consulte esses arquivos antes de reabrir uma investigação — é bem provável que o bug já tenha sido corrigido e documentado lá.
