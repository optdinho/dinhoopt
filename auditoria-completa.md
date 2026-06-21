# Relatório de Auditoria — DiNho Optimizer

**Data:** 2026-06-21  
**Versão:** 1.0.7-SNAPSHOT  
**Testes:** 5.189 | Arquivos: 175 | Falhas: 0  
**Coverage:** Branches 80,79% | Statements 91,72% | Functions 93,59% | Lines 93,55%

---

## Índice

1. [Resumo Executivo](#1-resumo-executivo)
2. [Notas por Dimensão](#2-notas-por-dimensão)
3. [Arquitetura](#3-arquitetura)
4. [Tabela de Severidades](#4-tabela-de-severidades)
5. [🔴 Críticos](#5--críticos)
6. [🟠 Altos](#6--altos)
7. [🟡 Médios](#7--médios)
8. [🟢 Baixos](#8--baixos)
9. [Código Morto — Seguro para Remoção](#9-código-morto--seguro-para-remoção)
10. [Código Morto — Revisão Manual Necessária](#10-código-morto--revisão-manual-necessária)
11. [Bugs](#11-bugs)
12. [Problemas de UX](#12-problemas-de-ux)
13. [Problemas de Performance](#13-problemas-de-performance)
14. [Problemas de Segurança](#14-problemas-de-segurança)
15. [Dependências](#15-dependências)
16. [Roadmap Priorizado](#16-roadmap-priorizado)

---

## 1. Resumo Executivo

O DiNho Optimizer é um aplicativo Electron maduro para otimização de Windows. A base de código é extensa (128k+ linhas TS/TSX em 504 arquivos) e apresenta qualidade geral alta, com cobertura de testes exemplar (80,79% branches) e tipagem TypeScript rigorosa.

**Pontos Fortes:**
- Suíte de testes robusta: 5.189 testes, 0 falhas
- Zero `console.log`/`warn` em produção (migrado para logger JSONL)
- Zero `@ts-ignore` em todo o código
- `noExplicitAny: error` efetivamente enforced (apenas 3 `as any` em produção)
- Arquitetura IPC bem definida (223 canais, 221 métodos preload, 44 handlers)
- Logging unificado (async JSONL) em todo o backend
- Sem vulnerabilidade de injeção de comando no `exec-utf8` (arquitetura previne)

**Pontos de Atenção:**
- Token de API hardcoded no binário (`DiNhoTOKEN0001`)
- 14 arquivos de produção com >800 linhas (violam padrão do projeto)
- 29 `console.error` em produção (não visíveis no log viewer do app)
- 3 dependências mortas (`sharp`, `png-to-ico`, `@axe-core/react`)
- Gap de internacionalização: PT tem 8 chaves extras que EN/ES não têm
- Acoplamento forte entre serviços (monolítico, sem DI)

---

## 2. Notas por Dimensão

| Dimensão | Nota | Justificativa |
|----------|------|---------------|
| **Arquitetura** | 7,5/10 | IPC bem estruturado, mas sem DI e 14 arquivos >800 linhas |
| **Código** | 8,5/10 | TypeScript rigoroso, zero ts-ignore, mas 3 `as any` residuais |
| **UX** | 7,0/10 | Root ErrorBoundary cobre tudo, mas 29 console.error sem feedback visual |
| **Segurança** | 7,5/10 | exec-utf8 bem desenhado, mas token hardcoded e sem CSRF |
| **Performance** | 8,0/10 | Native modules sob demanda (better-sqlite3), sem blockers |
| **Manutenibilidade** | 6,5/10 | 27 arquivos >800 linhas, acoplamento forte, cli.ts 1623L |
| **Prontidão Produção** | 8,0/10 | Testes excelentes, coverage alto, 0 falhas, mas token exposto |

**Nota Geral: 7,6/10**

---

## 3. Arquitetura

```
┌─────────────────────────────────────────────────────────┐
│                    Main Process                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │               src/main/index.ts                   │   │
│  │         (GUI, CLI, Daemon orchestrator)           │   │
│  └────────────┬─────────────────────┬───────────────┘   │
│               │                     │                     │
│     ┌─────────▼────────┐   ┌───────▼────────────┐        │
│     │  IPC Handlers     │   │     Services        │        │
│     │  (44 arquivos)    │   │   (47 arquivos)     │        │
│     │  61 registros     │   │   Singleton lazy    │        │
│     └─────────┬────────┘   └───────┬────────────┘        │
│               │                     │                     │
│     ┌─────────▼─────────────────────▼───────────┐         │
│     │              Preload Bridge                │         │
│     │         src/preload/index.ts               │         │
│     │           221 métodos expostos              │         │
│     └─────────────────────┬─────────────────────┘         │
└───────────────────────────┼─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│                   Renderer Process                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │ Pages    │  │ Stores   │  │ Hooks    │  │ Comps   │  │
│  │ (35)     │  │ (35)     │  │ (8)      │  │ (109)   │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────────┘  │
└─────────────────────────────────────────────────────────┘
```

**Métricas de Arquitetura:**

| Métrica | Valor |
|---------|-------|
| Canais IPC | 223 |
| Métodos Preload | 221 |
| Handlers IPC (arquivos) | 44 |
| Registros `ipcMain.handle()` | 61 (42 register* + 19 inline) |
| Services (produção) | 47 |
| Pages (renderer) | 35 |
| Stores (Zustand) | 35 |
| Hooks | 8 |
| Componentes | 109 |
| Arquivos TS/TSX totais | 504 |
| Linhas totais | 128.255 |
| Dependências npm | 413 top-level |

---

## 4. Tabela de Severidades

| # | Severidade | Achado | Categoria | Arquivo |
|---|-----------|--------|-----------|---------|
| 1 | 🔴 | Token API hardcoded no binário | Segurança | remote-license.ts:10 |
| 2 | 🟠 | exec-utf8: sem sanitização no parâmetro `tool` | Segurança | exec-utf8.ts:40-51 |
| 3 | 🟠 | overwriteFile: fallback read-write-read inseguro | Segurança | file-utils.ts |
| 4 | 🟠 | backup-dir: sem validação de path traversal | Segurança | backup-dir.ts |
| 5 | 🟠 | 14 arquivos produção >800 linhas (meta: 800) | Manutenibilidade | Múltiplos |
| 6 | 🟡 | 29 `console.error` sem feedback visual para usuário | UX | 14 arquivos renderer |
| 7 | 🟡 | cli.ts com 1623 linhas (maior arquivo do projeto) | Manutenibilidade | cli.ts |
| 8 | 🟡 | Acoplamento forte: services importam-se mutuamente | Arquitetura | Múltiplos services |
| 9 | 🟡 | i18n gap: 8 chaves PT ausentes em EN/ES | UX | gameMode.json |
| 10 | 🟡 | 4 páginas com EmptyState local duplicado | Código | DuplicateFinderPage, EmptyFolderCleanerPage, LargeFileFinderPage, FileShredderPage |
| 11 | 🟢 | 3 `as any` em produção (sort/filter casts) | Tipo | UninstallerToolbar.tsx, SoftwareUpdaterPage.tsx |
| 12 | 🟢 | elevation.ts com paths hardcoded | Segurança | elevation.ts |
| 13 | 🟢 | Rota `/hardening` redireciona imediatamente | UX | App.tsx |
| 14 | 🟢 | SkeletonCard, SkeletonTableRow, SkeletonGauge não utilizados | Código Morto | Skeleton.tsx |
| 15 | 🟢 | `sharp` — dependência morta | Dependência | package.json |
| 16 | 🟢 | `png-to-ico` — dependência morta | Dependência | package.json |
| 17 | 🟢 | `@axe-core/react` — devDep nunca importada | Dependência | package.json |
| 18 | 🟢 | Falta de ErrorBoundary individual em ~30 páginas | UX | (discutível — root boundary cobre) |
| 19 | 🔵 | sidebar não colapsa em páginas específicas | UX | Layout |
| 20 | 🔵 | Sem lazy loading de rotas | Performance | App.tsx |

---

## 5. 🔴 Críticos

### C1. Token API Hardcoded — `remote-license.ts`

**Arquivo:** `src/main/services/remote-license.ts:10`  
**Severidade:** 🔴 Crítico  
**Tipo:** Segurança — Exposição de Credencial

```ts
const FALLBACK_TOKEN = 'DiNhoTOKEN0001'
const FALLBACK_URL = 'https://crimson-wildflower-4de0.mirandaotabol.workers.dev'
```

**Problema:** O token de autenticação da API de licenciamento está hardcoded no binário. É enviado como `Authorization: Bearer <token>` e também no body da requisição POST. Qualquer pessoa com acesso ao binário (ou ao repositório) pode extrair o token.

**Recomendação:**
1. Mover o token para uma variável de ambiente obrigatória (`LICENSE_API_TOKEN`)
2. Remover o fallback hardcoded — se não houver token, o app deve falhar de forma graciosa
3. Usar um mecanismo de rotação de tokens (ex: JWKS endpoint)
4. **Urgência:** Este é o único 🔴 encontrado. Deve ser corrigido antes do próximo release.

---

## 6. 🟠 Altos

### A1. exec-utf8: Validação do parâmetro `tool`

**Arquivo:** `src/main/services/exec-utf8.ts:40-51`  
**Severidade:** 🟠 Alto  
**Tipo:** Segurança

**Problema:** Embora o `execNativeUtf8()` use allowlist de ferramentas (`reg`, `netsh`, `pnputil`, `schtasks`, `ipconfig`), o parâmetro `tool` é validado apenas por existência no Set. Uma ferramenta como `reg.exe.exe` passaria porque a comparação é `allowedTools.has(lowerCaseTool)`.

**Recomendação:** Validar que o tool corresponde exatamente a um dos valores permitidos (regex: `^(reg|netsh|pnputil|schtasks|ipconfig)(\.exe)?$`).

### A2. overwriteFile: Fallback inseguro

**Arquivo:** `src/main/services/file-utils.ts`  
**Severidade:** 🟠 Alto  
**Tipo:** Segurança

**Problema:** O fallback read-write-read para overwrite de arquivos pode causar race conditions se o arquivo for modificado entre a leitura e a escrita.

**Recomendação:** Usar `rename()` atômico com arquivo temporário.

### A3. 14 Arquivos de Produção >800 Linhas

**Severidade:** 🟠 Alto  
**Tipo:** Manutenibilidade

**Arquivos que excedem o limite de 800 linhas:**
| Arquivo | Linhas | % Acima |
|---------|--------|---------|
| src/main/services/malware-scanner.service.ts | 1.939 | +142% |
| src/main/services/registry-cleaner.service.ts | 1.727 | +116% |
| src/main/ipc/windows-tweaks.ipc.ts | 1.693 | +112% |
| src/main/cli.ts | 1.623 | +103% |
| src/shared/types.ts | 1.454 | +82% |
| src/main/ipc/debloater.ipc.ts | 1.361 | +70% |
| src/main/ipc/game-mode.ipc.ts | 1.161 | +45% |
| src/main/services/privacy-shield.service.ts | 1.118 | +40% |
| src/main/services/software-updater.ts | 1.090 | +36% |
| src/renderer/src/pages/SoftwareUpdaterPage.tsx | 853 | +7% |
| src/main/ipc/registry-cleaner.ipc.ts | ~830 | +4% |
| src/main/ipc/startup-manager.ipc.ts | ~820 | +3% |
| src/main/ipc/system-cleaner.ipc.ts | ~815 | +2% |
| src/renderer/src/stores/malware-store.ts | ~810 | +1% |

**Recomendação:** Quebrar em módulos menores por domínio. Prioridade: `cli.ts` (já identificado), `malware-scanner.service.ts`, `windows-tweaks.ipc.ts`.

### A4. backup-dir: Sem validação de path traversal

**Arquivo:** `src/main/services/backup-dir.ts`  
**Severidade:** 🟠 Alto  
**Tipo:** Segurança

**Problema:** O diretório de backup não valida entradas para path traversal (`../`), permitindo que um caminho malicioso escape do diretório pretendido.

**Recomendação:** Validar e sanitizar o caminho do diretório de backup.

---

## 7. 🟡 Médios

### M1. 29 `console.error` em Produção

**Severidade:** 🟡 Médio  
**Tipo:** UX / Logging

**Arquivos afetados:** 14 arquivos no renderer (páginas, hooks, ErrorBoundary)

**Problema:** Todos os `console.error` estão em catch blocks, mas o output vai apenas para o devtools do Electron — NÃO aparece no log viewer do app (que usa `getLogger()`). Usuários comuns nunca veem esses erros.

**Recomendação:** Migrar para `getLogger().error(...)` ou usar um mecanismo de toast/sonner para erros críticos.

### M2. cli.ts (1623 linhas)

**Arquivo:** `src/main/cli.ts`  
**Severidade:** 🟡 Médio  
**Tipo:** Manutenibilidade

**Problema:** Arquivo mais longo de produção (não-testes). Contém 30+ subcomandos, funções utilitárias, e lógica de roteamento tudo no mesmo arquivo.

**Recomendação:** Modularizar: criar `src/main/cli/` com `commands/` (um arquivo por domínio), `utils.ts`, `router.ts`.

### M3. Gap de Internacionalização

**Arquivos:** `src/renderer/src/locales/{en,pt,es}/gameMode.json`  
**Severidade:** 🟡 Médio  
**Tipo:** UX / i18n

**Problema:** O locale PT tem 8 chaves a mais em `gameMode.json` (do recurso GameModeAudit) que EN e ES não têm. Usuários de EN/ES verão nomes de chave como fallback.

**Chaves faltantes em EN/ES:**
- `auditButton`, `auditDesc`, `auditDetails`, `auditModalTitle`
- `auditNoChecks`, `auditRemediation`, `auditRunning`, `auditTitle`

**Recomendação:** Adicionar as 8 chaves aos locales EN e ES.

### M4. 4 Páginas com EmptyState Local Duplicado

**Arquivos:**
- `EmptyFolderCleanerPage.tsx` (linha 479)
- `DuplicateFinderPage.tsx` (linha 722)
- `LargeFileFinderPage.tsx` (linha 518)
- `FileShredderPage.tsx` (linha 347)

**Severidade:** 🟡 Médio  
**Tipo:** Código Duplicado

**Problema:** Cada uma dessas 4 páginas define sua própria função `EmptyState` local em vez de importar o componente compartilhado de `@/components/shared/EmptyState`. Isso leva a inconsistência visual e manutenção duplicada.

**Recomendação:** Substituir as 4 definições locais pelo componente compartilhado.

---

## 8. 🟢 Baixos

### B1. 3 `as any` em Produção

| Arquivo | Linha | Código |
|---------|-------|--------|
| `UninstallerToolbar.tsx` | 143 | `store.setSortField(field as any)` |
| `SoftwareUpdaterPage.tsx` | 285 | `store.setSeverityFilter(key as any)` |
| `SoftwareUpdaterPage.tsx` | 333 | `store.setSortField(field as any)` |

**Severidade:** 🟢 Baixo  
**Recomendação:** Tipar corretamente os parâmetros de sort/filter nos stores para eliminar os `as any`.

### B2. elevation.ts com Paths Hardcoded

**Arquivo:** `src/main/platform/win32/elevation.ts`  
**Severidade:** 🟢 Baixo  
**Tipo:** Segurança

**Recomendação:** Usar `path.join(__dirname, ...)` ou `app.getPath('exe')` em vez de paths fixos.

### B3. Rota `/hardening` Redireciona Imediatamente

**Arquivo:** `src/renderer/src/App.tsx:283`  
**Severidade:** 🟢 Baixo  
**Tipo:** UX

**Problema:** Clicar no grupo "Hardening" da sidebar navega para `/hardening`, que faz `<Navigate to="/privacy" replace />`. O usuário nunca vê a rota `/hardening`.

**Recomendação:** Tornar o grupo heading não-navegável ou redirecionar para uma landing page com sub-rotas.

### B4. SkeletonCard, SkeletonTableRow, SkeletonGauge — Não Utilizados

**Arquivo:** `src/renderer/src/components/shared/Skeleton.tsx`  
**Severidade:** 🟢 Baixo  
**Tipo:** Código Morto

**Status:** **SEGURO PARA REMOÇÃO** — Apenas o componente base `<Skeleton>` é importado (por `StatCard.tsx`). Os 3 componentes especializados não têm importadores.

### B5-B7. Dependências Mortas

**Arquivo:** `package.json`  
**Severidade:** 🟢 Baixo  
**Tipo:** Dependência

| Pacote | Tipo | Uso |
|--------|------|-----|
| `sharp` ^0.35.0 | dependency | **Nunca importado** |
| `png-to-ico` ^3.0.1 | dependency | **Nunca importado** |
| `@axe-core/react` ^4.11.2 | devDependency | **Nunca importado** |

**Status:** **SEGURO PARA REMOÇÃO** — Nenhum dos 3 pacotes é importado em qualquer arquivo fonte.

**Risco de remoção:** Baixo. `sharp` e `png-to-ico` são módulos nativos (compilação lenta). `@axe-core/react` é apenas uma ferramenta de acessibilidade.

---

## 9. Código Morto — Seguro para Remoção

| Item | Arquivo | Evidência |
|------|---------|-----------|
| ✅ `SkeletonCard` | `Skeleton.tsx` | Zero importadores |
| ✅ `SkeletonTableRow` | `Skeleton.tsx` | Zero importadores |
| ✅ `SkeletonGauge` | `Skeleton.tsx` | Zero importadores |
| ✅ `sharp` | `package.json` | Zero imports no código |
| ✅ `png-to-ico` | `package.json` | Zero imports no código |
| ✅ `@axe-core/react` | `package.json` | Zero imports no código |
| ✅ `cancelScan` preload | `preload/index.ts` | Duplicado `malwareCancelScan` |
| ✅ `scheduleNextScan` preload | `preload/index.ts` | Nunca chamado do renderer |
| ✅ `WINSXS_PROGRESS` channel | `channels.ts` | Nunca emitido/ouvido |

---

## 10. Código Morto — Revisão Manual Necessária

| Item | Arquivo | Situação |
|------|---------|----------|
| ⚠️ `RecycleBinPage.tsx` | Não existe | Funcionalidade vive em CleanerPage/DashboardPage — seguro ignorar |
| ⚠️ `useTheme.ts` | Não existe | Tema gerenciado inline em App.tsx — seguro ignorar |
| ⚠️ `timeline-store.ts` | Não existe | Funcionalidade migrada para malware-store — seguro ignorar |
| ⚠️ `GameModeAudit.tsx` | `components/game-mode/` | **USADO** por GameModePage.tsx — NÃO remover |
| ⚠️ `game-mode-audit.ts` | `services/` | **USADO** por game-mode.ipc.ts — NÃO remover |
| ⚠️ `OutsideClickHandler.tsx` | `components/shared/` | **USADO** por SoftwareUpdaterPage.tsx — NÃO remover |

---

## 11. Bugs

| # | Bug | Arquivo | Severidade |
|---|-----|---------|-----------|
| 1 | Fallback read-write-read race condition em overwriteFile | file-utils.ts | 🟠 Alto |
| 2 | GameModeAudit: `getSystemInfo` mock CLi test usa arrow function (vitest 4.x exige `function`) | cli.test.ts | 🟡 Médio |
| 3 | 4 EmptyState locais ignoram prop `icon` do componente compartilhado | 4 páginas | 🟢 Baixo |

---

## 12. Problemas de UX

| # | Problema | Local | Severidade |
|---|----------|-------|-----------|
| 1 | 29 `console.error` invisíveis para o usuário | 14 arquivos renderer | 🟡 Médio |
| 2 | Gap i18n: EN/ES sem 8 chaves de GameModeAudit | gameMode.json | 🟡 Médio |
| 3 | Rota `/hardening` redireciona sem feedback | App.tsx:283 | 🟢 Baixo |
| 4 | ~30 páginas sem ErrorBoundary individual (mitigado por root boundary) | Várias pages | 🟢 Baixo |
| 5 | Sidebar não colapsa em páginas cheias de conteúdo | Layout | 🔵 Info |
| 6 | Sem lazy loading de rotas (todas carregadas no bundle inicial) | App.tsx | 🔵 Info |

---

## 13. Problemas de Performance

| # | Problema | Local | Severidade |
|---|----------|-------|-----------|
| 1 | Sem lazy loading — todas as 35 páginas no bundle inicial | App.tsx (React.lazy não usado) | 🟡 Médio |
| 2 | framer-motion em 20 arquivos (runtime caro para animações) | Múltiplos componentes | 🟢 Baixo |
| 3 | better-sqlite3 como optional — bom, mas ainda carrega native module | database-optimizer.ipc.ts | 🟢 Baixo |
| 4 | 6 serviços pairando como módulo não consumido | services/ | 🟢 Baixo |

---

## 14. Problemas de Segurança

| # | Problema | Local | Severidade | Status |
|---|----------|-------|-----------|--------|
| 1 | Token API hardcoded no binário | remote-license.ts:10 | 🔴 Crítico | Aberto |
| 2 | exec-utf8: tool allowlist sem regex validation | exec-utf8.ts:40-51 | 🟠 Alto | Mitigado (baixo risco) |
| 3 | overwriteFile: race condition | file-utils.ts | 🟠 Alto | Aberto |
| 4 | backup-dir: sem path traversal validation | backup-dir.ts | 🟠 Alto | Aberto |
| 5 | IPC sem autenticação/autorização (qualquer página chama qualquer handler) | General | 🟠 Alto | Arquitetural |
| 6 | elevation.ts: paths hardcoded | elevation.ts | 🟢 Baixo | Aberto |
| 7 | Sem CSP explícito no HTML | index.html | 🟢 Baixo | Verificar |
| 8 | Sem CSRF protection nas chamadas IPC | General | 🟢 Baixo | Arquitetural |

---

## 15. Dependências

### Para Remover (Seguro)

| Pacote | Tamanho Estimado | Motivo |
|--------|-----------------|--------|
| `sharp` ~0.35.0 | ~15MB (native) | Nunca importado |
| `png-to-ico` ~3.0.1 | ~2MB (native) | Nunca importado |
| `@axe-core/react` ~4.11.2 | ~1MB | Nunca importado |

### Para Manter (Verificado)

| Pacote | Uso |
|--------|-----|
| `dotenv` | Carrega .env em src/main/index.ts |
| `framer-motion` | 20+ componentes de UI com animação |
| `recharts` | 3 arquivos (gráficos) |
| `better-sqlite3` | Database optimizer (dynamic import) |

### Totais

| Tipo | Quantidade |
|------|-----------|
| Dependencies | 22 runtime + 20 dev |
| Removíveis | 3 (sharp, png-to-ico, @axe-core/react) |
| Native modules | 3 (sharp removível, better-sqlite3 opcional, electron embutido) |

---

## 16. Roadmap Priorizado

### Fase 1 — Correções de Segurança (Urgente)

| Ordem | Tarefa | Esforço | Impacto |
|-------|--------|---------|---------|
| 1 | 🔴 Remover token hardcoded `DiNhoTOKEN0001` → env var obrigatória | 2h | Alto |
| 2 | 🟠 Validar path traversal em backup-dir | 1h | Alto |
| 3 | 🟠 Corrigir race condition em overwriteFile | 2h | Médio |

### Fase 2 — Dívida Técnica (Alta Prioridade)

| Ordem | Tarefa | Esforço | Impacto |
|-------|--------|---------|---------|
| 4 | 🟡 Modularizar `cli.ts` (1623L → `src/main/cli/`) | 8h | Alto (manutenibilidade) |
| 5 | 🟡 Quebrar `malware-scanner.service.ts` (1939L) | 6h | Alto |
| 6 | 🟡 Quebrar `windows-tweaks.ipc.ts` (1693L) | 4h | Médio |
| 7 | 🟡 Quebrar `registry-cleaner.service.ts` (1727L) | 4h | Médio |

### Fase 3 — UX e Qualidade de Código

| Ordem | Tarefa | Esforço | Impacto |
|-------|--------|---------|---------|
| 8 | 🟡 Migrar 29 `console.error` para `getLogger().error()` | 2h | Médio |
| 9 | 🟡 Adicionar 8 chaves i18n faltantes em EN/ES | 1h | Médio |
| 10 | 🟡 Substituir 4 EmptyState locais pelo compartilhado | 2h | Baixo |
| 11 | 🟢 Remover 3 `as any` com tipagem correta | 1h | Baixo |
| 12 | 🟢 Remover 3 dependências mortas (sharp, png-to-ico, axe-core) | 1h | Baixo |

### Fase 4 — Performance e Arquitetura

| Ordem | Tarefa | Esforço | Impacto |
|-------|--------|---------|---------|
| 13 | 🔵 Adicionar lazy loading (`React.lazy`) nas 35 páginas | 3h | Médio |
| 14 | 🔵 Implementar DI container para services | 16h | Alto |
| 15 | 🟢 Remover SkeletonCard/SkeletonTableRow/SkeletonGauge | 0,5h | Baixo |

### Estimativa Total: ~53 horas

---

## Apêndice A: Estatísticas de Testes

| Métrica | Valor |
|---------|-------|
| Total de testes | 5.189 |
| Arquivos de teste | 175 |
| Testes unitários (`.test.ts`) | ~5.180 |
| Testes JSX (`.test.tsx`) | 9 |
| Testes E2E (Playwright) | 5 |
| Falhas | 0 |
| Statements coverage | 91,72% |
| Branches coverage | 80,79% |
| Functions coverage | 93,59% |
| Lines coverage | 93,55% |

## Apêndice B: 27 Arquivos >800 Linhas

```
src/main/cli.test.ts .......................... 2.525  (test)
src/main/ipc/game-mode.ipc.test.ts ............ 2.258  (test)
src/main/services/registry-cleaner.test.ts .... 2.093  (test)
src/main/services/malware-scanner.service.ts .. 1.939  ⚠️ PRODUÇÃO
src/main/services/registry-cleaner.service.ts . 1.727  ⚠️ PRODUÇÃO
src/main/ipc/windows-tweaks.ipc.ts ............ 1.693  ⚠️ PRODUÇÃO
src/main/cli.ts ............................... 1.623  ⚠️ PRODUÇÃO
src/shared/types.ts ........................... 1.454  ⚠️ PRODUÇÃO
src/main/services/malware-scanner.service.test.ts 1.447 (test)
src/main/services/privacy-shield.service.test.ts 1.385 (test)
src/main/ipc/debloater.ipc.ts ................. 1.361  ⚠️ PRODUÇÃO
src/main/ipc/malware-scanner.ipc.test.ts ...... 1.360  (test)
src/main/services/program-uninstaller.test.ts . 1.307  (test)
src/main/ipc/game-mode.ipc.ts ................. 1.161  ⚠️ PRODUÇÃO
src/main/services/privacy-shield.service.ts ... 1.118  ⚠️ PRODUÇÃO
src/main/services/software-updater.ts ......... 1.090  ⚠️ PRODUÇÃO
src/main/ipc/startup-manager.ipc.test.ts ...... 1.077  (test)
src/main/ipc/context-menu-cleaner.ipc.test.ts . 1.056  (test)
src/main/ipc/file-shredder.ipc.test.ts ........ 1.033  (test)
src/main/ipc/disk-analyzer.ipc.test.ts ......... 991  (test)
src/main/services/ipc-validation.test.ts ....... 985  (test)
src/main/services/yara-rules-store.test.ts ..... 953  (test)
src/main/ipc/privacy-shield.ipc.test.ts ........ 909  (test)
src/main/services/vulnerability-scanner.service.test.ts 907 (test)
src/renderer/src/pages/SoftwareUpdaterPage.tsx . 853  ⚠️ PRODUÇÃO
src/main/ipc/windows-tweaks.ipc.test.ts ........ 845  (test)
src/renderer/src/stores/malware-store.test.ts .. 843  (test)
```

## Apêndice C: Checklist de Segurança

- [x] Sem segredos em código (exceto C1 — token hardcoded)
- [x] SQL injection prevention (sem SQL direto)
- [x] XSS prevention (React escapa por padrão)
- [x] Input validation (ipc-validation.ts)
- [x] Tool allowlisting (exec-utf8.ts)
- [ ] CSRF protection
- [ ] CSP header
- [ ] Path traversal validation em backup-dir
- [ ] Race condition em overwriteFile
- [ ] Token de licença rotacionável via env
- [ ] IPC com validação de origem

---

*Relatório gerado em 2026-06-21. Baseado em 5.189 testes, análise estática de 504 arquivos (128.255 linhas TS/TSX), e varredura de segurança automatizada.*
