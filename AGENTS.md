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

**Testes/Qualidade (contagens refrescadas em 2026-10-04):**
- TS: **7812 testes, 7812 verdes, 0 skipped**, 276 arquivos, 0 falhas, **0 warnings** (0 act, 0 React-prop, 0 dotenv — 355 warnings eliminados em 2026-09-27; o último, de react-i18next, corrigido em 2026-10-04)
- C#: **2525 testes verdes, 0 falhas, 3 ignorados em Release** (2528 total), 0 avisos de compilador. **Dois conjuntos de 3 que não são o mesmo** — medido hoje com o app ABERTO (4 processos `DiNho Optimizer`), engine parado e pipe livre:
  - `NamedPipeServerIntegrationTests` (3) são `[RequiresAdminFact]`: sem elevação dão **Ignorado**, não falha. Corrê-los exige sessão elevada.
  - `NamedPipeServerTests.RoundTrip_*` (3) **passaram hoje com o app aberto** ⇒ o que os faz falhar é o **engine a segurar `\\.\pipe\dinho-clips-engine`**, não o app aberto. O histórico diz "app aberto" e é por isso que vale a pena confirmar o pipe antes de atribuir uma falha a "colisão documentada". **Código C# não tocado em 2026-10-04** (a suíte foi corrida, não alterada).
- E2E: **40 testes verdes** em 23,9 min (`npm run test:e2e`; jornada completa navega + analisa + captura em todos os módulos). Só corre elevado, como o resto da app.
- Cobertura (`npm run test:coverage`): **linhas 95,69% · statements 94,53% · funções 94,36% · branches 86,55%** — todas acima do gate de 80% do AGENTS. Branches é a mais fraca das quatro; é onde olhar primeiro se a cobertura voltar a descer.
- Gate do ffmpeg: **`npm run verify:ffmpeg`** (que aponta para `resources/clips-engine-staging/ffmpeg.exe`, o binário que é realmente embarcado) **52/52**, exit 0 — revalidado em 2026-10-04. Existe também `resources/ffmpeg-custom/ffmpeg.exe`; para repetir o gate, usar o script e não o path à mão.
- Biome: **0 erros, 0 warnings, 0 infos** em **890 arquivos** (`npx biome check .`; schema migrado para `2.5.15` em 2026-10-02) · `tsc --noEmit` 0 · `npm run build` ok

**Armadilha ao comparar versões:** `package.json` declara *ranges* (`electron: ^44.4.5`) e o `package-lock.json` instala a resolvida (`44.5.1`). Comparar os dois números como se fossem o mesmo campo dá 6 "divergências" falsas — em 2026-10-04 vale a pena confirmar com `npm ci --dry-run` (exit 0 = em sincronia) e `npm ls --depth=0` (nenhum `invalid`/`missing`) antes de reportar um problema de dependências. O commit `3b34f16` só mudou os ranges nos dois majors (`@types/node` 24→26, `framer-motion` 13→14); o resto subiu dentro do mesmo caret.

**Dependências — estado 2026-10-02 (auditoria + `npm update` + majors):** aplicados — Electron 44.4.5→**44.5.1**, Vite 8.3.1→**8.3.2**, Biome 2.5.14→**2.5.15**, Vitest/@vitest/coverage-v8 5.0.2→**5.0.3**, electron-vite 6.0.0-beta.4→**beta.5**, framer-motion 13.4.4→**14.0.0** (major), lucide-react 1.48.0→**1.50.0**, systeminformation 5.33.14→**5.33.15**, dotenv 18.0.4→**18.0.5**, @types/node 24.19.0→**26.6.4** (major; Electron 44 embute Node 24 — tipos à frente do runtime, **vigiar uso de APIs novas**), CsWin32 0.3.335→**0.3.346**. **Adaptação exigida pelo @types/node 26:** `ExecException.cmd` passou a obrigatório → 6 mocks de `execFile` em `clips.ipc.test.ts`/`clips-engine-connection.test.ts` passaram a `Object.assign(new Error(...), { cmd: '' })`. `electron-builder`/`electron-updater` em `latest` no registry estão **abaixo** da versão instalada (sem downgrade). ffmpeg 9.0.2 = última estável (2026-09-18). **Vulns `npm audit`: 5 high, todas em dev/build tooling** (`patch-package`→`find-yarn-workspace-root`→`micromatch`→`braces`; `http-cache-semantics` via `@electron/get`→`got` dentro do `app-builder-lib`), **nenhuma no runtime embarcado** — verificado no lock: as 5 têm `dev: true` e o fecho de produção tem 111 pacotes. **Não era 12:** as actualizações de 2026-10-02 (`3b34f16`) reduziram de 12 para 5. `npm audit fix` (sem `--force`) resolve já o `http-cache-semantics`; para o resto só `npm audit fix --force`, que rebaixaria `electron-builder` para 26.5.0 (breaking) — **não aplicar**.

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
