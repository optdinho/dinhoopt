# Site — página de download

Página pública de download do DiNho Optimizer, no mesmo visual do site
(`dinhooptimizer.netlify.app`), mas **sem versão escrita à mão**: ela lê a
release mais recente do GitHub em runtime, então nunca precisa ser editada
quando uma versão nova é publicada.

```
site/
├── download/
│   └── index.html      # a página (autocontida: CSS, logo e JS inline)
├── build-deploy.js     # monta o pacote site/deploy/
└── preview.js          # servidor local que imita o Netlify
```

## Deploy (Netlify)

Há um script que monta o pacote completo, já com o link para a página de
download no site atual:

```powershell
node site/build-deploy.js --landing "C:\caminho\index.html"
```

Ele escreve `site/deploy/` (ignorado pelo git) com:

```
site/deploy/
├── index.html            # site atual + link "Download" no menu + CTA + favicon
├── download/index.html   # esta página
└── favicon.png           # extraído do logo (elimina o 404 de /favicon.ico)
```

Depois é arrastar essa pasta para o Netlify (ou `netlify deploy --dir site/deploy`).
O script é **idempotente**: se o site já tiver o link, não duplica.

Se preferir fazer à mão, a página precisa ficar **ao lado** do `index.html` do
site, dentro de `download/`:

```
<raiz do deploy>/
├── index.html              # o site atual (não é alterado)
└── download/
    └── index.html          # esta página
```

O URL final fica `https://dinhooptimizer.netlify.app/download/`. O `/download`
sem barra redireciona sozinho para `/download/` — não é preciso `_redirects`.

> Se o site já for publicado por Git/CI, basta copiar `site/download/` para a
> raiz do repositório do site. Não há passo de build.

## Ver localmente

**Não abra o `index.html` com duplo-clique.** Os links do site são absolutos
(`/download/`, `/#planos`) — é o que o Netlify precisa — e por `file://` eles
apontam para a raiz do disco (`C:\download\`), que não existe. Por isso o menu
"Download" parece quebrado.

Use o servidor de pré-visualização, que reproduz o Netlify:

```powershell
node site/preview.js            # http://127.0.0.1:8080/ (abre o browser)
node site/preview.js --port 3000
node site/preview.js --no-open
```

Ele faz o que o Netlify faz e o `file://` não faz:

| Pedido | Resposta |
|---|---|
| `/` | `index.html` |
| `/download` | `301` → `/download/` |
| `/download/` | `download/index.html` |
| `/favicon.png` | a imagem, com `image/png` |

Se quiser ver **só** a página de download, sem servidor, pode abrir direto
`site/deploy/download/index.html` — ela funciona por `file://` (preenche a
versão). Só os links de volta ao site (`/`, `/#planos`) é que precisam do
servidor.

## Como funciona

1. A página chama `https://api.github.com/repos/optdinho/dinhoopt/releases/latest`.
2. Escolhe os assets pelo padrão do nome (funciona com nome versionado **ou** fixo):
   - instalador: `DiNho-Optimizer-Setup*.exe`
   - portable: `DiNho-Optimizer-<qualquer>.exe` (exclui `Setup`)
3. Preenche versão, data, tamanho (em MB, como o Explorer do Windows mostra) e
   o link direto de cada botão.

Nada é gerado no build, nada depende de variável de ambiente e não há token.

### Fallback (importante)

Os botões já nascem com `href` para
`https://github.com/optdinho/dinhoopt/releases/latest`. Se a API falhar
(rate limit, offline, bloqueio), a página:

- mostra um aviso laranja;
- mantém os botões funcionais, apontando para a página de releases.

Ou seja: **o download nunca fica indisponível por causa da API.**

### Cache e rate limit

A API do GitHub sem token permite **60 pedidos/hora por IP**. Para não gastar
isso, a resposta fica em `sessionStorage` por **5 minutos** (por aba). Com 5 min,
mesmo um visitante que recarregue a página várias vezes faz 1 pedido a cada 5 min.

Se o tráfego crescer muito, o próximo passo é pôr um proxy com cache à frente
(Cloudflare Worker ou Netlify Function com `Cache-Control: max-age=300`).

## Adicionar o link no site

O `index.html` do site hoje **não tem nenhum link de download** — só os planos
da Cakto. Para os visitantes chegarem em `/download/`, adicione uma entrada no
menu do topo. No ficheiro do site, procure:

```html
    <a href="#faq" class="h-nav-links">FAQ</a>
```

e coloque a linha nova **antes** dela:

```html
    <a href="/download/" class="h-nav-links">Download</a>
```

O resultado no menu fica: Benefícios · Planos · ⚡ Software · Download · FAQ.

Opcional — um botão no hero (o CTA atual só leva para a Cakto):

```html
        <a href="/download/" class="btn-s"><span>Baixar grátis</span></a>
```

dentro de `<div class="hero-ctas">`, ao lado de "COMPRAR OTIMIZAÇÃO COMPLETA".

## Verificação feita

Testado em Edge (Playwright) contra a API real:

| Item | Resultado |
|---|---|
| Versão preenchida | `v2.1.9` (release real) |
| Data | `atualizado em 04/11/2026` |
| Instalador | `DiNho-Optimizer-Setup-2.1.9.exe` · 230 MB · HTTP 200 |
| Portable | `DiNho-Optimizer-2.1.9.exe` · 209 MB · HTTP 200 |
| Larguras 320/390/768/1024/1440 | 0 overflow horizontal, cards com altura igual |
| API bloqueada | aviso visível + botões caem para `releases/latest` |
| Cache | 2.ª carga = 0 pedidos à API; expira aos 5 min |
| Erros de JS | nenhum |

## Manutenção

- **Versão nova publicada** → nada a fazer. A página actualiza sozinha.
- **Nome do asset mudar** (ex.: adoptar nome fixo sem versão) → os padrões
  `DiNho-Optimizer-Setup*.exe` e `DiNho-Optimizer-*.exe` continuam a casar.
- **Repositório mudar** → editar `OWNER`/`REPO` no `<script>` no fim da página.
- **Domínio próprio** → ligar `dinhoopt.com.br` ao mesmo projeto Netlify; o
  caminho `/download/` mantém-se e nada na página precisa mudar (só o
  `<link rel="canonical">` e o `og:url`, se quiser ser rigoroso).
