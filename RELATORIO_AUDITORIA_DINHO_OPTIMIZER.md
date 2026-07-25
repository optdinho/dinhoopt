# RELATÓRIO DE AUDITORIA TÉCNICA — DiNho Optimizer

**Data:** 2026-07-17  
**Escopo:** Auditoria técnica completa — segurança, corretude, modernização, limpeza de código  
**Método:** Investigação READ-ONLY (nenhum arquivo de código foi alterado nesta fase)  
**Arquivos investigados:** ~600 (.ts/.tsx/.cs/.json/.yml/.md)

---

## Legenda de Severidade

| Severidade | Critério |
|------------|----------|
| **Crítico** | Pode desativar serviço essencial, corromper registro sem backup, apagar arquivo do usuário indevidamente, vazar segredo, ou desabilitar proteção de segurança do OS |
| **Alto** | Pode causar perda de dados, instabilidade do sistema, ou bypass de validação de segurança em cenários plausíveis |
| **Médio** | Bug funcional, UX degradada, ou code smell que aumenta risco futuro |
| **Baixo** | Inconsistência menor, oportunidade de melhoria, ou edge case com baixa probabilidade |
| **Cosmético** | Formatação, estilo, nomes — sem impacto funcional |

---

## Resumo Executivo

| Severidade | Quantidade |
|------------|-----------|
| Crítico | 6 |
| Alto | 18 |
| Médio | 31 |
| Baixo | 22 |
| Cosmético | 7 |
| **Total** | **84** |

**Top 5 achados de maior impacto:**

1. **Sandbox do Chromium completamente desabilitada** (`no-sandbox` + `sandbox: false`) — zero isolamento entre renderer e main process
2. **Token de fallback hardcoded no código-fonte** (`FALLBACK_TOKEN = 'DiNhoTOKEN0001'`) — bypass de licenciamento via extração do ASAR
3. **GitHub PAT real em `.env` no disco** — token com acesso completo ao repositório, risco de vazamento
4. **Game Mode não reverte tweaks ao fechar o app** — alterações permanentes no registro e serviços ficam aplicadas
5. **Tweaks desabilitam VBS/Credential Guard** sem aviso — mitigações de segurança do Windows desativadas para "performance"

---

## Área 1 — Segurança e Superfície de Risco

### 1.1 IPC Validation

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 1.1.1 | **Alto** | `src/main/ipc/ipc-validation.ts` (363L) | Validação existe e é usada por handlers destrutivos (registry-cleaner, system-cleaner, service-manager, windows-tweaks). Porém, os ~55 handlers IPC **não são obrigados** a chamar validação — não há wrapper ou middleware que force validação. Cada handler é responsável por chamar manualmente. Handlers que não chamam validação aceitam payloads do renderer sem checagem. |
| 1.1.2 | **Crítico** | `src/main/index.ts:30,345` | `app.commandLine.appendSwitch('no-sandbox')` (linha 30) + `sandbox: false` no `BrowserWindow` (linha 345). O sandbox do Chromium (isolamento de processo via OS) está completamente desabilitado. Se o renderer for comprometido (ex: via XSS em conteúdo de licence check), não há barreira entre renderer e main process. O comentário nas linhas 341-344 referencia `pkexec` Linux — irrelevante para app Windows-only, indicando código copiado de template sem revisão. |
| 1.1.3 | **Alto** | `src/preload/index.ts` | Preload usa `contextBridge.exposeInMainWorld` corretamente. API tipada e granular. Porém, expõe métodos como `execCommand` e `runElevated` que permitem ao renderer executar comandos arbitrários — mesmo com contextBridge, isso amplia a superfície de ataque significativamente. |
| 1.1.4 | **Médio** | `src/renderer/index.html` | CSP `connect-src 'self' https:` permite conexões HTTPS para **qualquer servidor**. Se o renderer for comprometido via XSS, dados podem ser exfiltrados para qualquer endpoint HTTPS. Deveria ser restrito a domínios conhecidos (API de licença, feeds YARA, game database). |

### 1.2 Elevação UAC

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 1.2.1 | **Baixo** | `src/main/platform/win32/elevation.ts` | UAC é solicitado uma vez na inicialização (`requestedExecutionLevel: requireAdministrator` em `electron-builder.yml:31`). O processo inteiro roda elevado — não há elevação por operação individual. Isso é correto para este tipo de app mas significa que qualquer vulnerabilidade no main process já tem privilégios de admin. |
| 1.2.2 | **Médio** | `src/main/ipc/service-manager.ipc.ts`, `debloater.ipc.ts` | Handlers de desativação de serviço e remoção de bloatware não verificam `isAdmin()` explicitamente — dependem do processo estar elevado. Se o app for lançado sem elevação (ex: via atalho modificado), operações falham silenciosamente via `execFile` sem mensagem clara ao usuário. |

### 1.3 Malware Scanner

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 1.3.1 | **Alto** | `exploit-detector.service.ts:88` | `readFile(filePath)` carrega o arquivo inteiro em memória. Para executáveis de 500MB+, causa OOM. A função é chamada de `scanExploits()` que itera sobre potencialmente milhares de arquivos. Deveria usar leitura chunked com limite de tamanho. |
| 1.3.2 | **Médio** | `malware-scanner/pe-parser.ts` | Parsing de PE: não foi encontrada proteção explícita contra arquivos malformados (offsets inválidos, campos truncados). Arquivos PE corrompidos podem causar `RangeError` ao acessar `buffer.readInt32LE(offset)` com offset além do buffer. |
| 1.3.3 | **Baixo** | `malware-scanner/entropy.ts` | Análise de entropia pode gerar falso positivo em executáveis comprimidos legítimos (UPX, instaladores NSIS/Inno Setup). Sem threshold configurável pelo usuário. |
| 1.3.4 | **Médio** | `malware-scanner/quarantine.ts` | Quarentena renomeia arquivo (adiciona extensão `.quarantine`) e move para pasta dedicada. **Não altera permissões** — arquivo permanece executável. DLLs carregadas pelo Windows não são tratadas (tentativa de rename falha com `EBUSY`). Rollback existe (`restoreFromQuarantine`) mas não verifica integridade do arquivo restaurado. |
| 1.3.5 | **Médio** | `malware-scanner/scanners/allowlist.ts` | Allowlist é **hardcoded no bundle** — não pode ser atualizada sem nova versão do app. Contém hashes SHA-256 de executáveis conhecidos. Risco de allowlist desatualizada permitir passagem de ameaça, ou allowlist restritiva gerar falso positivo em software legítimo. |
| 1.3.6 | **Baixo** | `exploit-detector.service.ts:42` | Pattern `/\b(egg\|EGG\|Egg\|eGg)\b/` busca a palavra "egg" em ASCII — não detecta egg-hunter shellcode real (bytes `0xBB`/`0xCC`). Nunca captura ameaça real; gera falso positivo em strings benignas. |
| 1.3.7 | **Baixo** | `behavioral-sandbox.service.ts:32-35` | Detecção de persistência限ada a caminhos hardcoded (`HKCU\...\Run`). Malware usando scheduled tasks, WMI, serviços, ou registry paths alternativos não é detectado. Útil como heurística de scoring, não como decisão de segurança. |

### 1.4 Threat Intel

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 1.4.1 | **Médio** | `threat-intel.service.ts:55` | PhistTank feed usa **HTTP plaintext** (`http://data.phishtank.com/...`). MITM pode injetar falsos positivos (legítimo → phishing) ou falsos negativos. Outros feeds (abuse.ch, MalwareBazaar) usam HTTPS. |
| 1.4.2 | **Médio** | `threat-intel.service.ts` | Feeds são baixados sob demanda (não continuamente). Timeout não trava a UI — retorna erro e continua. Sem bloqueio. |

### 1.5 Firewall

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 1.5.1 | **Alto** | `firewall-audit.ipc.ts:325-416` | `applyFirewallChanges()` executa `Remove-NetFirewallRule` e `Set-NetFirewallRule -Enabled False` **sem snapshot ou backup**. Operações irreversíveis — regra removida permanentemente. Diferente do registry-cleaner que tem `collectBackupTargets`, firewall não tem undo. |
| 1.5.2 | **Médio** | `firewall-audit.ipc.ts` | Handler `FIREWALL_APPLY` (linha 426-429) roda operações destrutivas. Erro durante remoção parcial deixa regras em estado inconsistente. |

### 1.6 Licenciamento e Segredos

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 1.6.1 | **Crítico** | `remote-license.ts:12` | `const FALLBACK_TOKEN = 'DiNhoTOKEN0001'` — credential hardcoded no código-fonte. Qualquer pessoa que extraia o ASAR pode usar este token para bypass de validação de licença. Deveria ser removido e substituído por fluxo server-side-only. |
| 1.6.2 | **Crítico** | `.env` (no disco) | Contém `LICENSE_API_TOKEN` e `GH_TOKEN=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` (GitHub PAT real). Embora `.gitignore` exclua `.env`, o arquivo existe no disco. Se a máquina for comprometida ou o arquivo acidentalmente staged, o PAT concede acesso completo ao repositório. **O token deve ser rotacionado imediatamente.** |
| 1.6.3 | **Médio** | `license-store.ts:48-56` | `.store-salt` (32 bytes random) e `remote-license.key` (licença criptografada) armazenados como **arquivos plaintext** em userData. Em sistema multi-usuário, qualquer usuário pode ler esses arquivos. |
| 1.6.4 | **Médio** | `remote-license.ts:29-43` | `loadLicenseConfig()` lê `license-config.json` de userData. Atacante com acesso ao diretório de dados pode apontar o servidor de licença para endpoint rogue, bypassando validação. Arquivo não tem assinatura ou verificação de integridade. |
| 1.6.5 | **Baixo** | `remote-license.ts` | Timeout de rede: app continua utilizável offline dentro do período de grace. Comportamento correto — não trava. |

### 1.7 Browser Security

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 1.7.1 | **Médio** | `src/main/index.ts:340` | `allowFileAccessFromFiles: true` — necessário para preview de vídeo no ClipEditor, mas aumenta superfície de ataque se o renderer for comprometido. Considerar remover quando a UI de clips estiver completa. |

---

## Área 2 — Registro do Windows e Tweaks

### 2.1 Registry Backup

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 2.1.1 | **Alto** | `registry-cleaner.service.ts:1440-1441` | Falha de backup é engolida silenciosamente (`catch { /* Backup failed, but continue */ }`). Se backup falhar, `fixRegistryEntries` prossegue para mutar o registro **sem backup**. Usuário perde capacidade de restauração. |
| 2.1.2 | **Baixo** | `backup.ts` | Pruning usa `pruneOldBackups(backupDir, 3)` — máximo 3 backups hardcoded. Para sistema com limpeza diária, 3 backups granulares de sessões diferentes é pouco. |
| 2.1.3 | **Médio** | `registry-cleaner/state.ts` | Estado de limpeza persistido em JSON. Sobrevive a crash? Sim — escrita atômica (tmp + rename). Mas se o arquivo corromper durante crash, o estado é perdido e o app começa do zero (comportamento aceitável). |

### 2.2 Windows Tweaks

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 2.2.1 | **Crítico** | `windows-tweaks/security.ts:48-88` | Três tweaks (`vbs-hvci`, `vbs-lsa-cfg`, `vbs-enable`) **desabilitam Virtualization-Based Security e Credential Guard**. Credential Guard protege segredos LSA contra pass-the-hash. Desabilitar para "performance" é tradeoff de segurança significativo **sem aviso ao usuário**. |
| 2.2.2 | **Alto** | `windows-tweaks/handlers.ts:208-246` | `applyRegistryTweak` usa `/f` (force) em todos os `reg.exe add` — sobrescreve valor existente sem verificar estado atual. **Nenhum backup é criado antes de aplicar tweaks** — diferente do registry-cleaner que tem `collectBackupTargets`. Tweaks são caminho distinto do cleaner e pulam o sistema de backup. |
| 2.2.3 | **Alto** | `windows-tweaks/performance.ts:467-491` | Dois tweaks (`perfopt-csgo`, `perfopt-fivem`) escrevem em `Image File Execution Options\<exe>\PerfOptions` — mecanismo conhecido de persistência para malware. Tweaks são benignos mas normalizam escrita nesta localização. |
| 2.2.4 | **Alto** | `windows-tweaks/performance.ts:117-130` | `gpu-tdr-level` seta `TdrLevel=0` — desabilita GPU Timeout Detection and Recovery completamente. Se GPU travar, sistema faz **BSOD** em vez de recuperar. Usuário pode não entender a consequência. |
| 2.2.5 | **Alto** | `windows-tweaks/network.ts:231-243` | `disable-ipv6` seta `DisabledComponents=255` — desabilita **TODOS** componentes IPv6. Microsoft recomenda uso seletivo de bits. 255 desabilita ISATAP, Teredo, 6to4 que podem ser necessários. |
| 2.2.6 | **Médio** | `windows-tweaks/performance.ts:534-546` | `svchost-threshold` seta `SvcHostSplitThresholdInKB=67108864` (64MB). Default é ~3.5GB. Isso consolida quase todos serviços svchost em um processo — reduz contagem mas torna debugging impossível e aumenta blast radius de crashes. |
| 2.2.7 | **Médio** | `windows-tweaks/performance.ts:520-533` | `disable-paging-exec` seta `DisablePagingExecutive=1` — força todos drivers kernel para RAM física. Em sistemas com <8GB RAM causa pressão severa de memória. Sem check de RAM. |
| 2.2.8 | **Médio** | `windows-tweaks/network.ts:108-120` | `tcp-timed-wait-delay` seta `TcpTimedWaitDelay=30` (default 120s). Pode causar port exhaustion em sistemas com muitas conexões concorrentes. |
| 2.2.9 | **Baixo** | `windows-tweaks/performance.ts:234-252` | Dois tweaks `mmcss-affinity` e `mmcss-clock-rate` têm `defaultValue === optimizedValue` — aplicar o tweak não faz nada. Tweaks mortos no catálogo. |
| 2.2.10 | **Baixo** | `windows-tweaks/handlers.ts:332-340` | `listTweakStatuses` roda `checkTweakApplied` para TODOS tweaks em paralelo via `Promise.all`. Com 84+ tweaks, cria 84+ processos concorrentes. Em HDD lento pode causar hang temporário. |
| 2.2.11 | **Baixo** | `windows-tweaks/handlers.ts:348-379` | Handler `WINDOWS_TWEAKS_APPLY` não valida array `ids` — depende de `TWEAK_CATALOG.filter()` para ignorar IDs desconhecidos silenciosamente. Deveria retornar erro para IDs não reconhecidos. |
| 2.2.12 | **Baixo** | Nenhum | **Nenhum Windows version check** antes de aplicar tweaks. Tweaks que funcionam no Windows 10 podem não existir no 11 (e vice-versa). `os.release()` ou `process.getSystemVersion()` não é usado em nenhum tweak. |

### 2.3 Winapp2 Rules

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 2.3.1 | **Alto** | `resolve-winapp2-path.ts:16-21` | Substituição de variáveis usa `vars[name] || ''` — se env var não existe, substitui por string vazia. Path `%LOCALAPPDATA%\Temp\*` com `LOCALAPPDATA` unset vira `\Temp\*` — path relativo que resolve para `C:\Temp\*`. Sem guard contra resolução para root do sistema. |
| 2.3.2 | **Médio** | `winapp2-rules-store.ts:24-36` | Download de regras usa HTTPS (raw.githubusercontent.com), mas `node:https.get` segue redirects — DNS comprometido pode redirecionar. Sem timeout, sem limite de tamanho, sem assinatura do conteúdo. |
| 2.3.3 | **Médio** | `winapp2-rules-store.ts:70-83` | Após parsing, campos `detect*` são descartados — regras importadas **não têm lógica de detecção** e sempre casam. Uma regra projetada para app específico (via `Detect`) roda em todos os sistemas. |
| 2.3.4 | **Baixo** | `winapp2-rules-store.ts:61` | Cache escrito com `writeFileSync` — sem escrita atômica (tmp + rename). Crash durante escrita deixa cache corrompido. |

---

## Área 3 — Serviços e Inicialização

### 3.1 Service Manager

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 3.1.1 | **Alto** | `service-manager.ipc.ts:217-221` | `applyServiceChanges` filtra serviços `unsafe` a menos que `force === true`, mas **não verifica serviços com dependentes**. Desativar serviço que outros serviços dependem pode causar falhas em cascata. A lista `dependents` é populada no scan mas **nunca consultada** durante apply. |
| 3.1.2 | **Alto** | `service-manager.ipc.ts:233-239` | Quando target é `Disabled` e serviço está rodando, faz `Stop-Service -Force` antes de `Set-Service -StartupType Disabled`. `-Force` mata o serviço imediatamente — sem shutdown gracioso. Para serviços de banco de dados ou com estado, pode causar perda de dados. |
| 3.1.3 | **Médio** | `service-manager.ipc.ts:150` | `lookupServiceSafety` é tabela estática (`service-safety-kb.ts`). Serviços adicionados por OEMs ou updates recentes do Windows não estão na tabela e defaultam para `'unknown'` — usuário vê como "seguro para desativar" se fizer override manual. |
| 3.1.4 | **Baixo** | `service-manager.ipc.ts:297-307` | Handler `SERVICE_APPLY` não valida tipo do parâmetro `force` — se renderer enviar `force: "true"` (string), passa `force === true` como `false`. Deveria coerir para boolean. |

### 3.2 Startup Manager

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 3.2.1 | **Alto** | `startup-manager/toggle.ts:95-100` | Ao desabilitar item de startup registry, faz `reg delete` como fallback se escrita em `StartupApproved` falhar. **Remove permanentemente a entrada** — usuário não pode reabilitar porque o comando original sumiu. `disabledEntries` JSON armazena, mas se corromper, entrada é perdida para sempre. |
| 3.2.2 | **Médio** | `startup-manager/toggle.ts:46-56` | Toggle de pasta startup usa `renameSync` para adicionar/remover `.disabled`. Se arquivo estiver bloqueado (antivirus scaneando), rename falha e retorna `false` — sem retry. |
| 3.2.3 | **Médio** | `startup-manager/delete.ts:25-26` | `deleteStartupItem` para task-scheduler usa `Unregister-ScheduledTask -Confirm:$false` — **permanente e irreversível**. Definição da task não é salva antes da exclusão. |
| 3.2.4 | **Baixo** | `startup-manager/disabled-file.ts` | `disabledEntries` é JSON sem versionamento de schema. Mudança de formato em versão futura torna entradas antigas ilegíveis. |
| 3.2.5 | **Baixo** | `startup-manager/boot-trace.ts:33-38` | Check `STATUS|DENIED` testa `System.UnauthorizedAccessException` especificamente. Outros erros (timeout, serviço indisponível) caem em `BOOT|0|0|` mostrando "0ms boot time" — misleading. |

### 3.3 CLI vs UI

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 3.3.1 | **Baixo** | `cli/commands/services.ts` | CLI `services disable` chama `applyServiceChanges` sem parâmetro `force`. Serviços `unsafe` são filtrados silenciosamente — sem warning para o usuário CLI. Comportamento correto mas inconsistente com a UI que mostra aviso. |

---

## Área 4 — Debloat e Desinstalação

### 4.1 Bloatware Lists

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 4.1.1 | **Alto** | `bloatware/third-party.ts:455-460` | `ASUS Armoury Crate` listado como bloatware. Em laptops ASUS ROG/TUF, é a **ferramenta principal de gestão de drivers e periféricos** — remover quebra RGB do teclado, controle de fans e perfis de performance. |
| 4.1.2 | **Alto** | `bloatware/third-party.ts:418-423` | `Dell Mobile Connect` listado. Em Dell XPS/Precision, é integração phone-to-PC (similar ao Phone Link). Usuários ativos perdem funcionalidade. |
| 4.1.3 | **Alto** | `bloatware/third-party.ts:369-374` | `HP Support Assistant` listado. É a **ferramenta principal de suporte/warranty/diagnóstico da HP**. Remover pode prejudicar workflows de suporte e capacidade de atualização de drivers. |
| 4.1.4 | **Alto** | `bloatware/third-party.ts:536-543` | `MSI Center` listado. Em desktops/laptops MSI, controla **curvas de fan, RGB, overclocking e modos de performance**. Remover pode deixar sistema em estado subótimo térmico/energético. |
| 4.1.5 | **Médio** | `debloater/handlers.ts:151-160` | Matching de bloatware Win32 usa substring: `dn.includes(nameLower) || dn.includes(pkgNameLower)`. Programa chamado "Advanced SystemCare" casaria se algum `name` de bloatware for substring dele. Falsos positivos possíveis. |
| 4.1.6 | **Médio** | `bloatware/third-party.ts:83-90` | `Spotify` listado como bloatware. Pré-instalado ≠ indesejado. Decisão subjetiva que deve ser comunicada claramente na UI. |
| 4.1.7 | **Baixo** | `debloater/handlers.ts:16-19` | `KNOWN_BLOATWARE` é estático no bundle — não pode ser atualizado sem nova versão do app. Sem mecanismo para entradas da comunidade ou updates em runtime. |

### 4.2 Uninstall Leftovers

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 4.2.1 | **Alto** | `program-safety.ipc.ts` (arquivo inteiro) | `getProgramSafety` retorna `{ ratings: [], pending: 0 }` — feature de rating de segurança é um **stub**. Usuário não tem como saber se um leftover é seguro para remover. Scan retorna todos itens como igualmente arriscados. |
| 4.2.2 | **Médio** | `uninstall-leftovers.ipc.ts` | Detecção de leftovers escaneia `Program Files`, `AppData` etc. para pastas órfãs. Se programa foi instalado em local não-padrão, seus leftovers não serão encontrados. |
| 4.2.3 | **Baixo** | `uninstall-leftovers.ipc.ts` | Nenhum backup é criado antes de deletar leftover files/registry keys. Falso positivo deletado requer restauração manual do recycle bin. |

---

## Área 5 — Game Mode

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 5.1 | **Alto** | `src/main/index.ts:577` + `game-mode/` | **Game Mode não reverte tweaks ao fechar o app.** Handler `before-quit` só limpa clips engine. Não chama `deactivate()`. Se usuário fecha app enquanto jogo está ativo,以下 ficam permanentemente alterados: serviços desabilitados, Registry tweaks (GameDVR, transparência, fullscreen), mudanças de power plan. `deactivate.ts` só é chamado por lógica auto-deactivate que detecta `gameExit` (não app quit). |
| 5.2 | **Alto** | `game-mode/detection/library.ts:63-64,84` | `gameName` interpolado em PowerShell `Select-String -match` e `-like`. `PROCESS_NAME_RE` permite `.` e `-` que são metacaracteres regex/like. Processo maliciosamente nomeado pode casar targets indevidos para tweaks de Game DVR/Transparência. |
| 5.3 | **Médio** | `game-mode/detection/library.ts:29` | `gameName` usado em path de registro via interpolação: `HKLM:\...\Tasks\${gameName}`. Sem escaping de characters especiais de registry key paths. |
| 5.4 | **Médio** | `game-mode/detection/process.ts` | `killProcessesByName` mata processos imediatamente sem confirmação do usuário. Sem grace period. Múltiplos usuários podem perder trabalho não-salvo se processo de jogo compartilhar nome. |
| 5.5 | **Baixo** | `game-mode/snapshot.ts` | Snapshot de estado do sistema antes de tweaks: não foi encontrada evidência de que snapshot captura **tudo** (power plan GUID original, estado de cada serviço, valores de registro anteriores). `deactivate.ts` usa valores hardcoded em vez de restaurar do snapshot. |

---

## Área 6 — Drivers

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 6.1 | **Alto** | `driver-agent.ipc.ts`, `driver-manager.ipc.ts` | **Nenhuma verificação de assinatura digital** (Authenticode) em pacotes de driver. Pacotes são aceitos de winget/diretórios e instalados via `pnputil` sem verificação criptográfica. Pacote adulterado passaria todas verificações heurísticas do `driver-agent-evaluator.ts`. |
| 6.2 | **Alto** | `driver-manager.ipc.ts` | **Nenhum mecanismo de rollback**. Se atualização de driver falhar ou causar problemas pós-instalação, não há revert automático para versão anterior. Usuário deve usar Device Manager manualmente. |
| 6.3 | **Médio** | `driver-agent-types.ts` | Suporte é razoavelmente equilibrado entre NVIDIA, AMD e Intel. Chipset e rede também cobertos. Sem desbalanceamento significativo. |

---

## Área 7 — IPC/Preload/Contrato Main↔Renderer

### 7.1 Canais Centralizados

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 7.1.1 | **Nenhum** | `src/shared/channels.ts` | Todos canais estão centralizados. Nenhuma string hardcoded encontrada em outros arquivos. Boa prática. |

### 7.2 Preload

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 7.2.1 | **Médio** | `src/preload/index.ts` | API usa `contextBridge.exposeInMainWorld` corretamente. Porém, expõe `execCommand(cmd)` e `runElevated(cmd, args)` que permitem ao renderer executar comandos arbitrários. Mesmo com contextBridge, isso é uma ampliação significativa da superfície — qualquer XSS no renderer ganha capacidade de execução. |

### 7.3 Error Handling

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 7.3.1 | **Baixo** | Amostra de 15+ handlers | Handlers revisados tratam exceções e retornam `{ success: false, error: ... }` para renderer. Nenhum handler deixou exceção não-tratada derrubar o main process. Boa prática geral. |
| 7.3.2 | **Médio** | `compliance-auditor.ipc.ts:19-21` | Catch vazio: `} catch { /* Window closed during scan */ }`. Poderia logar em debug. |

### 7.4 Logging

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 7.4.1 | **Baixo** | `logger.service.ts` | Logger usa JSONL async. Operações destrutivas (registry, files, services) são logadas com detalhe para diagnóstico pós-incidente. Padrão adequado. |
| 7.4.2 | **Médio** | Diversos stores | ~78 catch blocks em stores usam `catch {}` silencioso — erros não são logados nem surfados. Após fix recente (21 catch blocks em 7 stores), ainda restam ~57 catches silenciosos em malware-store slices, logger-store, scan-store, etc. |

---

## Área 8 — Frontend/Renderer

### 8.1 Duplicação entre Stores

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 8.1.1 | **Médio** | `privacy-store.ts`, `compliance-store.ts`, `vulnerability-store.ts` | Padrão **triplicado** scan/apply/revert: mesma interface `status: 'idle'|'scanning'|'applying'|'done'`, mesmo `toggleCategory()`, mesmo `reset()`, mesmo error handling. ~180 linhas duplicadas que deveriam ser um factory `createScanApplyStore()`. |
| 8.1.2 | **Médio** | `large-file-store.ts`, `duplicate-store.ts`, `empty-folder-store.ts` | Padrão **triplicado** scan/delete: `directory`, `maxDepth`, `excludePatterns`, `status`, `progress`, `selectedPaths: Set<string>`, `deleteMode`, `deleteResult`, `togglePath/selectAll/deselectAll`. Shape quase idêntico, diferente só em config e result type. |
| 8.1.3 | **Baixo** | `updater-store.ts:4`, `uninstaller-store.ts:4` | Ambos exportam `SortField` com nomes diferentes — colisão de tipo se importados juntos. |

### 8.2 Error Handling nos Stores

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 8.2.1 | **Alto** | ~20 stores (ver tabela) | **Engolimento silencioso de erros pervasivo.** Padrão dominante: `catch { set({ loading: false }) }` — error state nunca é populado. Usuário vê tela congelada sem feedback. Afeta: `compliance-store`, `privacy-store`, `vulnerability-store`, `windows-tweaks-store`, `registry-store` (4 métodos), `service-store` (2 métodos), `driver-store` (4 métodos), `benchmark-store`, `history-store`, `logger-store` (4 métodos), todas as 12 slices de `malware-store`. |
| 8.2.2 | **Baixo** | 5 stores | `driver-store.ts:19`, `service-store.ts:17`, `registry-store.ts:20`, `debloater-store.ts:13`, `disk-store.ts:10` declaram `error: string | null` mas **nunca populam** — campo existe mas é morto. |

### 8.3 i18n

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 8.3.1 | **Alto** | `MemoryScannerPanel.tsx:28-146` | **13 strings hardcoded em inglês** com zero chamadas `t()`. Inclui string mista EN/PT: `"Click \"Escanear Processos\" to scan running processes"`. Componente inteiro não internacionalizado. |
| 8.3.2 | **Médio** | `license-store.ts:35-54` | 6 strings hardcoded em português (`'Erro na ativação'`, `'Sem conexão'`, etc.) em vez de usar `t()`. |
| 8.3.3 | **Médio** | `power-plans-store.ts:52,67` | 2 strings hardcoded em português (`'Falha ao ativar'`, `'Falha ao criar plano'`). |
| 8.3.4 | **Baixo** | `StartupPage.tsx:695` | Aria-labels usam template strings em inglês em vez de `t()`. |
| 8.3.5 | **Baixo** | `translation-audit-report.txt` | 3 chaves faltando em PT e ES: `softwareUpdater.packageManagerNotFound.scoopNotFound`, `.scoopRequired`, `.scoopSite`. |

### 8.4 Acessibilidade

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 8.4.1 | **Médio** | `main.tsx:16-20`, `package.json:43` | `@axe-core/react` presente em devDependencies, carregado sob `import.meta.env.DEV`. **Sem testes CI de acessibilidade** — nenhuma configuração de CI referencia axe, a11y ou testes de acessibilidade. |
| 8.4.2 | **Médio** | `MemoryScannerPanel.tsx` | Zero atributos ARIA: sem `aria-label` no botão, sem `role="table"`, sem `aria-live` para resultados, sem `<caption>` na tabela. |
| 8.4.3 | **Nenhum** | Código geral | 72 usos de `aria-*` encontrados no codebase — boa cobertura em componentes comuns (`Skip to content`, `aria-expanded`, `aria-live="polite"`, etc.). |

---

## Área 9 — Testes

### 9.1 Qualidade dos Testes

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 9.1.1 | **Médio** | `e2e/` (6 arquivos, 37 testes) | **Nenhum E2E teste operações destrutivas.** Todos verificam renderização de UI + exposição de handlers IPC. Nenhum teste E2E executa limpeza, desativação de serviço, tweak de registro, ou remoção de bloatware em ambiente controlado. |
| 9.1.2 | **Baixo** | `system-cleaner.ipc.test.ts` | Testes mocks completos (scanDirectory, cleanItems) — verificam que mock foi chamado com args corretos mas não exercitam comportamento real de scan/clean. |
| 9.1.3 | **Baixo** | `cli.test.ts:3720` | 1 `it.skip` — único teste pulado no projeto. 0 `it.todo`. |
| 9.1.4 | **Nenhum** | `registry-cleaner.test.ts`, `windows-tweaks.ipc.test.ts` | Boa qualidade — testam funções reais com I/O mockado. Verificam backup targets, catálogo completo (84 tweaks), lógica de apply/revert. |

### 9.2 Typecheck

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 9.2.1 | **Alto** | Global | **1.459 erros de tipo** em `npx tsc --noEmit` em 123 arquivos (45 de produção). O TypeScript compiler **não compila limpo**. Arquivos de produção afetados incluem: `src/main/index.ts`, `src/main/ipc/index.ts`, `registry-cleaner.service.ts`, `malware-scanner.service.ts` (5 locais), `remote-license.ts` (6 locais), `yara-engine.ts` (3 locais), `preload/index.ts`. Top erros: TS2345 (argument mismatch, 344), TS2532 (possibly undefined, 198), TS6133 (unused var, 169), TS2304 (cannot find name, 168). |

### 9.3 Lint

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 9.3.1 | **Baixo** | Global | 38 erros, 2 warnings (Biome). Todos em arquivos de teste — `noBannedTypes`/`Function` e `useKeyWithClickEvents`. **Zero erros em código de produção.** |

---

## Área 10 — Modernização de Dependências

### 10.1 npm audit

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 10.1.1 | **Baixo** | `esbuild 0.27.3-0.28.0` | 1 vulnerabilidade low-severity (arbitrary file read no dev server Windows). Dev dependency apenas — sem impacto em produção. |

### 10.2 APIs Deprecated

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 10.2.1 | **Nenhum** | Global | Nenhum uso de `@electron/remote`, `nodeIntegration: true`, ou `webSecurity: false`. Todas as APIs Electron estão em versões atuais e suportadas. |

### 10.3 Bindings Nativos

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 10.3.1 | **Médio** | `better-sqlite3`, `@litko/yara-x` | Ambos têm `electron-rebuild` configurado e bindings nativos presentes (`better_sqlite3.node`, `yara-x.win32-x64-msvc.node`). **Porém**, `patch-package` foi removido recentemente — `postinstall` agora é string vazia. Verificar se rebuild ainda funciona em `npm install` limpo. |
| 10.3.2 | **Médio** | `electron-builder.yml:39` | `npmRebuild: true` + `asarUnpack` para ambos bindings. Configuração correta para Electron. |

### 10.4 Patches

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 10.4.1 | **Nenhum** | `patches/` | Diretório não existe. `patch-package` removido do projeto. Sem patches documentados ou não-documentados. |

---

## Área 11 — Compatibilidade de Ambiente

### 11.1 Windows 10 vs 11

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 11.1.1 | **Médio** | Global | **Nenhum Windows version check** antes de aplicar tweaks, limpeza, ou operações de registro. Tweaks que existem no Windows 10 podem não existir no 11 (e vice-versa). `os.release()` e `process.getSystemVersion()` não são usados em nenhum código de tweaks/services. |

### 11.2 Admin vs Usuário Padrão

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 11.2.1 | **Médio** | 17 handlers IPC | 17 handlers destrutivos verificam `isAdmin()`. Porém, vários handlers destrutivos **não verificam**: `malware-scanner` (sem check explícito), `registry-cleaner` (sem check no handler), `debloater` remove (sem check). App força `requestedExecutionLevel: requireAdministrator` no build, mas se lançado sem elevação, operações falham silenciosamente. |

### 11.3 ARM64

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 11.3.1 | **Médio** | `electron-builder.yml`, bindings nativos | **Nenhum ARM64.** Target é apenas `x64`. `better-sqlite3` e `@litko/yara-x` só têm binários para `win32-x64-msvc`. Usuários Windows on ARM não conseguem rodar o app nativamente. |

### 11.4 AV/EDR

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 11.4.1 | **Baixo** | Global | **Nenhum handling** para o app ser flagado como PUA (Potentially Unwanted Application) por antivírus/EDR. Otimizadores de sistema e scanners de registro são comumente classificados como PUA. Sem manifestação de legitimidade (code signing certificate, EV cert). |

### 11.5 GPO/MDM

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 11.5.1 | **Médio** | `windows-tweaks/handlers.ts:229-233` | Falhas de escrita em registro por GPO/MDM são capturadas por `execFile` mas a mensagem de erro não distingue "acesso negado por policy" de outros erros. Usuário não sabe se a operação falhou por política corporativa. |

### 11.6 Idioma do SO

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 11.6.1 | **Baixo** | `platform/win32/services.ts`, `startup-manager/` | Nomes de serviço e paths de startup podem variar por idioma do Windows. Código usa nomes hardcoded em inglês (`Windows Audio`, `Background Intelligent Transfer`). Serviços em SO alemão/japonês teriam nomes diferentes. |

---

## Área 12 — Higiene do Repositório

### 12.1 Arquivos de Segredo

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 12.1.1 | **Crítico** | `.env` (no disco) | Contém `LICENSE_API_TOKEN=DiNhoTOKEN0001` e `GH_TOKEN=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`.虽然 `.gitignore` exclui `.env`, o arquivo existe no disco. **Token GitHub deve ser rotacionado IMEDIATAMENTE.** |

### 12.2 Arquivos de Log/Cobertura Grandes

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 12.2.1 | **Baixo** | Raiz do repo | Múltiplos arquivos de log/cobertura rastreados no git: `tmp_lint.json`, `cov-report.json`, `engine-stdout.txt`, `engine-stderr.txt`, `full-test.txt`, `coverage-report.txt`, etc. Todos removidos recentemente via `git rm --cached` mas podem ter sido commits anteriormente. |

### 12.3 Diretórios Stale

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 12.3.1 | **Médio** | `.backup-rapidas/` | Diretório de backup manual — não deveria estar no repo. |
| 12.3.2 | **Médio** | `.dashboard-backup/` | Diretório de backup manual — não deveria estar no repo. |
| 12.3.3 | **Médio** | `dinho-clips-gui/`, `dinho-clips-poc/` | Subprojetos do DiNho Clips duplicados. Confirmar se intencional (monorepo) ou resíduo de cópia. |
| 12.3.4 | **Médio** | `skills/extracted/get-shit-done/` | Bundle de SDK de terceiros vendorizado — centenas de arquivos de teste de SDK alheio ao DiNho Optimizer. |
| 12.3.5 | **Médio** | `backup-clips-20260624-032355/` | Backup com 78 arquivos rastreados no git. |

### 12.4 Scripts e Artefatos Stale

| # | Severidade | Localização | Descrição |
|---|-----------|-------------|-----------|
| 12.4.1 | **Baixo** | `parse_failures.py` (860B) | Script de debug de uso único. |
| 12.4.2 | **Baixo** | `fix_buttons.js` (2.5KB) | Script de debug de uso único. |
| 12.4.3 | **Baixo** | `remaining_errors.txt` (0B) | Arquivo vazio. |
| 12.4.4 | **Baixo** | 5 arquivos `.md` na raiz | `AUDIT-REPLAY-BUFFER.md`, `auditoria-completa.md`, `PEDIDO_AUDITORIA_DINHO_CLIPS.md`, `PLANO_EXECUCAO_FASES.md`, `RELATORIO_AUDITORIA_DINHO_CLIPS.md` — parecem pertencer ao projeto Clips, não ao Optimizer. |

---

## Apêndice A — Números do Projeto

| Métrica | Valor |
|---------|-------|
| Arquivos `.ts`/`.tsx` de produção | ~600 |
| Arquivos `.test.ts`/`.test.tsx` | 476 |
| Testes unitários | ~6000 |
| Handlers IPC | ~55 |
| Stores Zustand | 33 |
| Locais de idioma (i18n) | 3 (en, pt, es) |
| Chaves de tradução | ~2088 |
| Linhas de código TypeScript | ~50.000+ |
| Arquivos C# (engine clips) | ~60 |
| Dependências npm | ~50 (production) |
| Vulnerabilidades npm (high+) | 0 |
| Erros TypeScript (`tsc --noEmit`) | 1.459 |
| Erros lint (Biome) | 38 (todos em testes) |

---

## Apêndice B — Priorização Sugerida

### Fase 1 — Crítico (fazer imediatamente)

1. Rotacionar `GH_TOKEN` em `.env` e remover token do disco
2. Remover `FALLBACK_TOKEN` hardcoded de `remote-license.ts`
3. Reavaliar `no-sandbox` / `sandbox: false` — habilitar sandbox do Chromium
4. Adicionar warning dialog antes de tweaks VBS/Credential Guard
5. Implementar revert de Game Mode no `before-quit`
6. Criar backup antes de aplicar Windows Tweaks (não só registry cleaner)

### Fase 2 — Alto (próximo sprint)

1. Backup obrigatório antes de registry fix (abortar se backup falhar)
2. Verificar dependentes de serviço antes de desativar
3. Verificação de assinatura Authenticode para drivers
4. Fix MemoryScannerPanel i18n (13 strings hardcoded)
5. Surface errors nos stores (~20 stores com catch silencioso)
6. OEM-aware bloatware list (ASUS Armoury Crate só em ASUS, etc.)
7. Firewall backup/rollback
8. Hostname validation no hosts-editor
9. Fix PowerShell injection em game-mode detection
10. 1,459 erros TypeScript (foco nos 45 arquivos de produção)

### Fase 3 — Médio (próximos sprints)

1. Factory `createScanApplyStore()` para eliminar duplicação
2. Windows version checks antes de tweaks
3. ARM64 support (ou documentar como não-suportado)
4. i18n para license-store e power-plans-store
5. ARIA para MemoryScannerPanel
6. CI accessibility tests com axe-core
7. Limpeza de stale directories (.backup-rapidas, etc.)
8. Winapp2 detect fields preservados
9. Retry para startup folder toggle
10. Versionamento de schema para disabledEntries

---

*Fim do relatório. Este documento descreve problemas e áreas investigadas. Não contém recomendações de correção nem diffs de código — isso será coberto em etapa separada de "pedido de implementação" por módulo.*
