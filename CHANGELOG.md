# Changelog

Todas as mudanças relevantes do **DiNho Optimizer**. O [README](README.md) mantém apenas
as duas versões mais recentes; o histórico completo vive aqui.

---

## 2.0.9

### 🔧 Release mais robusto

O `electron-builder` publica os dois alvos do instalador (**NSIS** + **portable**) em
paralelo, e cada publisher tentava **criar a release do GitHub ao mesmo tempo** — o primeiro
criava, o segundo recebia `422 already_exists` e o run abortava a meio (a release nascia só
com o `.blockmap`, sem o `.exe` nem o `latest.yml`). A release passa a ser criada **uma única
vez, de forma idempotente**, antes do `electron-builder` (`scripts/ensure-release.js`); os
publishers encontram-na e apenas fazem upload dos assets.

O **body da release** passa também a ser gerado automaticamente a partir deste `CHANGELOG.md`
(`scripts/gen-release-notes.js` + `releaseInfo` no `electron-builder.yml`), em vez de ser
corrigido à mão via API.

Sem alterações funcionais na aplicação.

---

## 2.0.8

### 🎬 A captura deixa de ser desligada pelas próprias otimizações

O DiNho aplicava quatro tweaks "gaming" que punham o **Game DVR a zero**
(`GameDVR_Enabled`, `AppCaptureEnabled` e `AllowGameDVR` em duas chaves de política). O
motor de Clips assenta no **Windows Graphics Capture**, e o serviço de captura do Windows
recusa arrancar enquanto essas chaves estão a 0 — o motor falhava com `0x80070422`
(`ERROR_SERVICE_DISABLED`) a cada arranque. As quatro tweaks foram removidas do catálogo.

Remover do catálogo não desfaz o que já foi aplicado. Por isso, uma **migração versionada**
corre uma única vez após a atualização e repõe as **5 chaves a `=1`** (o valor de origem do
Windows): `GameDVR_Enabled` e `AppCaptureEnabled` no `HKCU`, `AllowGameDVR` no `HKLM` e
`value` em `PolicyManager\default` e `PolicyManager\current`. É idempotente, só corre com o
app elevado, e **não marca como feito se falhar** — retenta no arranque seguinte. A partir
daí o utilizador decide: a migração nunca mais toca nas chaves.

O motor também passou a **avaliar a disponibilidade do WGC uma vez por sessão**: quando a
captura está mesmo desligada (serviço desativado ou sem consentimento), salta diretamente
para **DXGI Desktop Duplication** em vez de repetir o WGC três vezes por arranque.

### 📉 Teto de bitrate dos Clips mais baixo

Os presets de qualidade **"boa"** e **"leve-60"** tinham um teto de bitrate generoso demais
para o perfil a que se destinam:

| Preset | Resolução | Antes | Agora |
|---|---|---|---|
| boa | 720p60 | 40 Mbps | **24 Mbps** |
| leve-60 | 900p60 | 62,5 Mbps | **37,5 Mbps** |

O **CQ não muda** (16/18/20/22 — invariante do projeto); o teto VBV é um limite, não um
alvo, portanto os ficheiros deixam de inchar sem perda de qualidade visível.

### ✅ Qualidade

| | Antes | Agora |
|---|---|---|
| Testes (TS) | 7.840 | **7.852** |
| Testes (C#, Release) | 2.528 | **2.539** |

---

## 2.0.7

### 🟢 As definições passam a ser mesmo guardadas

Três conjuntos de definições eram **rejeitados em silêncio**: o tipo de backup e a
auto-instalação de atualizações (`backupMode`, `autoInstallUpdates`, `autoInstallSchedule`),
a proteção da Lixeira (`protectRecycleBin`) e a configuração do Modo Jogo (com
`preconfigVersion`). A allow-list de validação não os conhecia, por isso o `SETTINGS_SET`
respondia `{success:false}` — e ninguém lia a resposta: a UI mostrava "salvo", mas ao
reiniciar tudo voltava ao valor antigo. Agora estas chaves são validadas com os valores
corretos e persistem: definir o backup como *Full* deixa de voltar a *targeted*, a
auto-instalação do atualizador já dispara, e o Modo Jogo guarda mesmo a pré-configuração.

Para nunca mais ninguém engolir um "ok" que não era: todos os chamadores de `settings:set`
(e dos pares de `registry`, favoritos dos clips e sync de configuração) leem agora o
resultado e **revertem o estado otimista** + avisam quando a gravação falha.

### 🔍 Os resultados deixam de mentir

Quatro caminhos mostravam sucesso quando a operação tinha falhado:

- **Reverts do Compliance e do Scanner de Vulnerabilidades** — as falhas eram descartadas e o
  estado apontava para "concluído". Agora o botão mostra um aviso com quantas correções falharam.
- **O Benchmark fabricava valores** — CPU a 50, RAM a 0, plano de energia "balanceado" quando
  a medição tinha falhado por completo. Agora cada métrica que falha sai marcada como
  `Falha na medição`, com um banner âmbar a dizer que o benchmark ficou incompleto.
- **Eliminar um ficheiro da Quarentena já falhado** era contado como sucesso (o `force` do
  apagamento engolia o erro). Agora um ficheiro ausente conta como falha e a página avisa.
- **A configuração de Clips não chegava ao motor** — quando o sync pelo pipe falhava, o
  `CLIPS_SET_CONFIG` respondia na mesma `{success:true}`. Agora falha de verdade e a UI avisa.

### ♻️ Restauro do Registo

A limpeza do registo criava sempre backups antes de corrigir — e nunca houve forma de os
**restaurar** dentro do app. Chega agora um botão *Restaurar* na página de Registo: lista os
backups existentes (classificados por tipo e data) e corre o `reg import` com o nome indicado.
Backups de *tasks* não são suportados (fora de âmbito, o aviso é claro).

### 🧹 Menos código, menos superfície de falha

Três auditorias internas no código morto e na "falsa prontidão" removeram **35 ficheiros e
~4.500 linhas** sem uso (o caminho antigo do scanner de vulnerabilidades, o handler de menu de
contexto órfão, 27 componentes React sem referência, a superfície IPC do `DRIVER_AGENT`, a lib
`D3DCompiler` nunca usada e o `patch-package` morto). O resultado é menos superfície para bugs
e para revisão de segurança. A licença deixou de confiar num cache falsificável: o ficheiro
`.license-cache.json` é agora assinado com `HMAC-SHA256` ligado ao hardware, e um `Admin` no
registo de auditoria passou a ser detetado de verdade.

### 🧪 Qualidade

A suíte C# subiu para **2.528 testes, 0 ignorados** — os testes de pipe multi-cliente passam
sem elevação (o atributo `RequiresAdminFact` era desnecessário). Testes vazios, *tauologias* e
*sleeps* fixos foram asseridos e removidos. O CI ganhou um job `dotnet` (a suíte C# passou a
correr no pipeline, antes não tinha nenhum passo de .NET) e um gate pós-publish que falha o
workflow se o feed `latest.yml` não servir a versão recém-construída.

| | Antes | Agora |
|---|---|---|
| Testes (TS) | 7.792 | **7.840** |
| Testes (C#, Release) | 2.212 | **2.528** |
| Vulnerabilidades `npm audit` (high) | 5 | **0** |

---

## 2.0.6

### 🎬 Clips a 60 fps sem judder

O gravador anunciava 60 fps e o ficheiro saía mesmo a 60 fps — mas a **timeline tinha
buracos**. Numa medição de um clip de 5 minutos: **542 saltos** na timeline e **+3,99 s de
excesso**, ou seja, 1,3% do vídeo era tempo que não existia. O sintoma é o judder: o leitor
avança, não há frame para mostrar, e a imagem dá um tranco.

A causa era a **âncora dos timestamps**. Cada frame recebia o instante a que foi capturado em
vez do instante a que *deveria* estar na grelha. Bastava a captura demorar dois milissegundos a
mais do que o habitual nesse instante, e o salto ficava permanentemente deslocado — não se
recuperava nunca.

A grelha passou a ser **absoluta**: o frame *n* tem sempre o tempo *n* × 16,667 ms, onde quer
que a captura o tenha entregue. Quando não há frame novo nesse instante, **o anterior é
repetido** em vez de se criar um buraco — com um limite de 2 repetições seguidas, para não
mascarar uma captura que parou. E o PTS é escrito ao nível do pacote, já no encoder, sem
re-encodificar no fim.

| 5 minutos de jogo | Antes | Agora (8 clips, 37 min) |
|---|---|---|
| Saltos na timeline | 542 | **14** |
| Excesso de tempo | +3,99 s (1,3%) | **+0,28 s (0,013%)** |
| FPS efectivo | 59,18 | **60,00** |

**289× menos saltos** e **103× menos deriva**, medido descodificando os ficheiros e contando os
deltas de PTS — não por confiança no contador interno.

**Bónus para máquinas lentas:** se o PC não consegue entregar 60 fps, o que antes produzia um
clip aos soluços passa a ser preenchido. Validado com ficheiros reais nos três regimes: PC que
entrega o alvo (sem repetições), PC ligeiramente abaixo (3-6%), e PC a meia taxa (~50% de
repetições). Nos três, o ficheiro sai a 60 fps exactos. Também validado que 37 "saltos" de
sequência, quando a captura pára de repente, **não abrem buracos** no ficheiro.

### 🎯 A resolução que escolhes é a que é gravada

O motor de Clips podia **degradar a resolução escolhida a meio de uma gravação**. Ao detetar
que o encoder "não acompanhava", o *capacity guard* baixava de 1080p para 720p e reiniciava o
ffmpeg — e esse reinício descartava o backlog de output e o estado de PTS, deixando o áudio
dessincronizado do vídeo (num clip real, ~9,5 s de desvio).

O sinal que disparava o guard estava errado: `speed` e `outLag` do ffmpeg medem o **feed** (a
taxa a que os frames chegam ao encoder), não o trabalho do encoder. Um jogo a renderizar abaixo
de 60 fps fazia parecer saturação onde não havia nenhuma — a fila estava vazia e não se perdia
um único frame.

A regra passou a ser explícita: o divisor de fallback e o *capacity guard* **só reduzem a
resolução quando não há alvo explícito** (modo nativo). Logo que escolhes uma resolução, é essa
que sai — e o guard deixa de reiniciar o ffmpeg a meio da sessão.

### 🪟 A app deixa de aparecer nas tuas próprias gravações

O motor tentava esconder a janela do DiNho da captura, e **nunca conseguia**. A
`SetWindowDisplayAffinity` só tem efeito em janelas do *próprio processo* — mas quem chamava a
API era o engine em C#, a partir de outro processo, e a chamada devolvia `ERROR_ACCESS_DENIED`.
A tentativa de repetir era inútil, e o resultado era silencioso: nos testes de 4 horas só
aparecia uma linha de aviso.

Agora quem esconde a janela é o próprio dono dela: o Electron aplica `setContentProtection`
quando a gravação começa e desfaz quando para. A janela do DiNho sai do enquadramento de clips
gravados com a app aberta, e **261 linhas de código de produção** de interoperabilidade Windows
desapareceram com o arranjo (mais 453 de testes que testavam o caminho morto).

### 🔧 Correções

- **O modo de captura passa a estar visível** (desktop / janela / jogo) na barra de estado.
- **Já não fica um segundo cliente do motor a expirar** — o motor passava a recusar qualquer
  segunda ligação ao pipe, e agora aceita várias em simultâneo.
- **Ficheiros temporários órfãos de exportação são limpos no arranque**, em vez de irem
  ocupando disco entre sessões.
- **O veredicto de memória após gravar** deixou de usar um contador acumulado que nunca voltava
  ao normal: o `.NET` chega a ~2 GB logo depois de exportar e o coletor de lixo recolhe ao fim
  de ~5 minutos. Agora o motor acompanha e reporta esse regresso em vez de dizer para sempre
  "em memória".

### 📦 Dependências em dia

Electron 44.5.1, Vite 8.3.2, Biome 2.5.15, Vitest 5.0.3, framer-motion 14 e `@types/node` 26
(tipos alinhados com o Node 24 embutido no Electron 44), CsWin32 0.3.346. A suíte cobre a
adaptação — `ExecException.cmd` passou a obrigatório e os mocks de `execFile` foram ajustados.
Os advisories de `npm audit` que restam são todos de ferramentas de build (dev), nenhum no
runtime embarcado.

---

## 2.0.5

### 🎮 Modo Jogo realmente automático

A **Detecção Automática** estava a meio caminho: quando um jogo era detectado, o app abria a
captura de Clips sem o motor de captura estar a correr. O `startClipCapture()` respondia
`Engine not running` e a gravação não começava — sem erro visível, porque o resultado era
engolido. Agora o Modo Jogo **sobe o motor de captura** quando precisa e só depois inicia a
gravação, com 3 tentativas separadas por 2 s para cobrir a subida do processo C#. Se ainda
assim falhar, o motivo fica no log em vez de desaparecer.

### ⏱️ 5 minutos de tolerância ao sair do jogo

Desligar o Modo Jogo no instante em que o processo sumia era frágil demais — o FiveM relança o
`GTAProcess.exe`, e uma janela que pisca podia derrubar a sessão a meio da partida. Agora o app
espera **5 minutos** sem jogo antes de reagir:

- O jogo voltou dentro do prazo → **nada acontece**, a sessão continua.
- Passou o prazo → restaura o sistema e **para a gravação**.

Quem liga a captura é quem a para. Mesmo que a restauração falhe, a gravação é encerrada na
mesma medida — não há cenário em que a captura fica a correr sozinha.

### 🎛️ Pré-configuração chega a toda a gente

As 16 otimizações do Modo Jogo passaram a ser a **pré-configuração do app**, definida num único
sítio e consumida pelo processo principal e pelos dois stores do renderer (antes havia três
listas, todas diferentes). O ponto que faltava: instalações **já existentes** nunca recebiam
novidades, porque a leitura da configuração só acrescenta chaves em falta — nunca atualiza
listas. Uma migração versionada resolve isso e corre **uma única vez**, carimbando a
configuração com a versão aplicada.

### 🐛 Correções

- O detector de jogos passa a arrancar no **boot do app**. Antes só começava ao abrir a página do
  Modo Jogo ou dos Clips — e pior, **sair** de uma dessas páginas desligava a detecção a meio.
- `svc-sysmain` saiu da lista padrão: desligar o Superfetch prejudica o carregamento inicial dos
  jogos, que é justamente quando se quer o sistema rápido.
- `svc-diagtrack` saiu da lista padrão: os serviços de diagnóstico são uma porta de entrada para
  rastreio, e não é um risco que valha a pena por omissão.

---

## 2.0.4

### ⚡ Instalação 96% mais rápida

O DiNho passa a ser empacotado em **asar** — um arquivo único — em vez de ~10.900 ficheiros
soltos no disco. Na prática, o que muda para quem instala:

- **10.939 → 449 ficheiros** copiados durante a instalação (−96%).
- O antivírus scanneia **cada ficheiro escrito**, portanto o custo de segurança cai na mesma
  proporção. A instalação deixou de arrastar o Defender durante vários minutos.
- Instalador ligeiramente **mais pequeno**: ~250 MB → **~243 MB**.

### 🧹 Porque estava desligado (e porque voltou)

Em agosto de 2026 o asar foi desligado por causa de um bug do Chromium: o `netstack` do renderer
devolvia `ERR_FILE_NOT_FOUND` e o app abria com ecrã preto. O `fs` do Node lia o mesmo asar sem
qualquer problema — a causa nunca foi isolada com precisão. Em 2026-09-30 voltámos a testar em
profundidade (Electron 44.4.5 + electron-vite 6.0.0) e **o problema já não se reproduz**. A
explicação provável: o Electron reescreveu a camada de leitura de asar para servir ficheiros
diretamente do arquivo, sem extrair uma cópia temporária.

### 🔐 Invariantes de segurança mantidos

Os módulos nativos (`better-sqlite3` e o motor de malware) continuam **fora** do asar, onde têm
de estar para o carregamento via `dlopen` funcionar. E nada foi afrouxado nas restantes fuses de
segurança do Electron.

---

## 2.0.3

### 🌐 Escolher e medir o DNS de verdade

A escolha de DNS deixou de ser uma caixa cega. O **teste de velocidade mede agora o resolvedor
por UDP** — o mesmo mecanismo que o Windows usa para resolver nomes — em vez de fazer `ping`,
que media o caminho até ao servidor e não a resposta do resolvedor. Todas as opções (Cloudflare,
Google, OpenDNS, Quad9) ficam sempre visíveis: **pode aplicar qualquer uma**, o teste apenas
ordena a lista por velocidade. O servidor mais rápido ganha o selo **Melhor**. O app passa a
**detetar o DNS que está em uso**, lendo o servidor da interface que tem a rota por omissão, e
mostra se veio por DHCP. Depois de aplicar, volta a ler o estado real.

### ⚡ Planos de Energia reconstruídos

A página foi reescrita: planos agrupados entre **Planos do sistema** e **Planos personalizados**,
com o tipo de cada plano identificado. O plano **Desempenho Máximo** desbloqueia com um clique
— o Windows oculta-o em quase todas as editions, e é o único que desliga a poupança de energia
ao nível do hardware. O botão avisa que consome mais energia e pode subir a temperatura.

### 🧰 Otimizações do Windows — Ferramentas Avançadas

Três tweaks que mexem no comportamento interno do Windows, com explicação do que fazem, o
respetivo link de documentação da Microsoft e os avisos correspondentes: ajustes da pilha
**TCP/IP** (chimney, timestamps, RTO) e do **timer** (HPET, TSC Sync, Dynamic Tick). Não são
necessários para o dia a dia — a secção diz isso explicitamente.

### 🔧 Correções no `powercfg`

O leitor de saída do `powercfg` dependia de texto em inglês e passava a falhar em Windows
português ou deutsch. Passou a ser **independente do idioma**. Corrigidos ainda os **GUIDs do
ASPM**, que não endereçavam o subgrupo correto, e o revert do `PROCTHROTTLEMIN`, que restaurava
o mínimo do processador em 100% em vez dos 5% originais.

### 🧹 Limpeza

A página passa a chamar-se **Limpeza**, com os resultados agrupados em **Sistema**, **Aplicações**
e **Manutenção**. A barra de ação inferior deixou de estar "solta": agora está alinhada à coluna
de conteúdo e acompanha a barra lateral quando a recolhemos.

### 🛠️ Reparo do Windows

Passa a chamar-se **Reparo do Windows** (as ferramentas são DISM e SFC, não de disco) e avisa
quando passa mais de 15 dias sem uma verificação.
