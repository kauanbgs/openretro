# OpenRetro web

Landing page do OpenRetro, feita para levar o visitante ao download, no mesmo repositório do desktop. Este projeto tem seu próprio build e não carrega o backend Tauri, downloads do aplicativo ou arquivos do usuário.

## Desenvolvimento

Na raiz do repositório:

```sh
npm ci --prefix web
npm run dev:web
```

Abra `http://127.0.0.1:1421/`.

```sh
npm run build:web
npm run preview:web
```

O build estático fica em `web/dist/` e pode ser publicado independentemente do instalador Windows. Os caminhos relativos permitem hospedar também em subpastas.

## Publicação

O workflow `.github/workflows/web.yml` gera o site separadamente do desktop e publica no GitHub Pages.

1. No GitHub, abra **Settings → Pages** do repositório e, em **Build and deployment → Source**, escolha **GitHub Actions**. Isso é feito uma vez só.
2. Faça push para `main` com mudanças em `web/` ou no próprio workflow. O workflow também pode ser disparado à mão em **Actions → Publish OpenRetro web → Run workflow**.
3. Ao terminar, o endereço aparece no job `deploy` e em **Settings → Pages**. Para este repositório, fica em `https://kauanbgs.github.io/openretro/`.

Para usar domínio próprio, informe-o em **Settings → Pages → Custom domain** e crie o registro DNS indicado pelo GitHub. Os caminhos são relativos, então o mesmo build funciona na raiz do domínio ou em subpasta.

Em outro host estático (Cloudflare Pages, Netlify, Vercel), use a raiz do repositório, o comando `npm ci --prefix web && npm run build:web` e a pasta de saída `web/dist`.

A configuração `.openai/hosting.json` identifica uma publicação de prévia no Sites e não contém credenciais.

As capas foram otimizadas com `node web/scripts/optimize-art.mjs`. Fontes e créditos estão locais em `public/`; as fontes das ilustrações estão em `public/art/sources.json`. Não coloque jogos, BIOS, tokens ou dados locais em `public/`: seu conteúdo entra integralmente no build.
