# OpenRetro no navegador (versão web)

A versão web é o próprio aplicativo, com a mesma interface (barra lateral,
Início, Biblioteca, cards e página do jogo), compilado para o navegador. Os
jogos rodam no [EmulatorJS](https://emulatorjs.org) (cores do libretro em
WebAssembly, carregados da CDN do EmulatorJS), não no runtime do desktop.

```bash
npm run dev:play     # http://127.0.0.1:1422
npm run build:play   # gera dist-play/, que funciona em qualquer pasta de um site
```

Na versão web ficam Início, Biblioteca e a conta com amigos e mensagens.
Downloads, fontes, Party, celular, Big Picture e configurações dependem do PC e
ficam escondidos. O código
está em `src/features/web-play/`, e o modo é ligado por `isWebPlay`
(`src/services/webPlay.ts`, que vale `true` quando o build usa `--mode play`).

- Favoritos, última partida e tempo de jogo ficam salvos no navegador
  (localStorage).
- O botão + de "Minha biblioteca" abre uma ROM do computador (NES, SNES, N64,
  GB, GBC, GBA, DS, Master System, Mega Drive, Game Gear e PS1). O arquivo fica
  só no navegador (IndexedDB) e não é enviado a nenhum servidor.
- Sair do jogo recarrega a página e volta para a página do jogo, porque o
  EmulatorJS não pode ser desligado sem recarregar.

## Conta, amigos e mensagens

A versão web tem a mesma conta do app: criar conta e entrar por código de
e-mail, perfil, amigos (pedidos, presença em tempo real, bloqueio), Conhecer
pessoas e mensagens. Quem joga no navegador aparece para os amigos como
"Jogando …". O Party continua só no app para Windows.

No app, os comandos `account_*` e `social_*` rodam em Rust. Na versão web,
`src/features/web-play/webSocial.ts` responde aos mesmos comandos direto do
navegador, então as telas são as mesmas.

O login fica num cookie seguro, nunca no JavaScript:

- O servidor (`party-server/cloudflare/social/web-session.mjs`) entrega a
  sessão como cookie `__Host-openretro_session`, com `HttpOnly`, `Secure`,
  `SameSite=Strict` e sem `Domain`. Nenhum script da página consegue ler esse
  cookie, nem o do emulador, que vem de uma CDN de terceiros.
- O cookie só é aceito quando a requisição vem do site (`Origin` igual a
  `https://openretro.com.br`; o endereço de desenvolvimento só vale num
  servidor local). Admin e Party nunca aceitam o cookie.
- O app desktop continua igual: o token fica no Gerenciador de Credenciais do
  Windows e vai no cabeçalho `Authorization`.

Para isso funcionar em produção, publique o worker depois do merge:

```bash
npm --prefix party-server run deploy
```

Para testar com o servidor local (o código de login aparece no terminal do
servidor, sem enviar e-mail):

```bash
npm --prefix party-server start
```

Num arquivo `.env.play.local` na raiz (ignorado pelo Git), coloque
`VITE_SOCIAL_URL=http://127.0.0.1:8787` e rode `npm run dev:play`.

## Escolher os jogos

A biblioteca vem de uma lista em JSON, por padrão `public/play/games.json`.
Para hospedar a lista em outro lugar, defina a URL no build:

```bash
VITE_PLAY_CATALOG_URL=https://seu-servidor.com/games.json npm run build:play
```

Formato de cada jogo:

```json
{
  "id": "meu-jogo",
  "title": "Nome do jogo",
  "platform": "gba",
  "rom": "https://seu-servidor.com/roms/meu-jogo.gba",
  "cover": "https://seu-servidor.com/capas/meu-jogo.png",
  "screenshots": ["https://seu-servidor.com/capas/tela1.png"],
  "year": 2021,
  "developer": "Quem fez",
  "description": "Um parágrafo sobre o jogo.",
  "genre": "Puzzle",
  "license": "MIT",
  "source": "https://github.com/quem-fez/meu-jogo"
}
```

- `title`, `platform` e `rom` são obrigatórios. Uma entrada sem um deles é
  ignorada.
- Use um `id` fixo: ele identifica o jogo no tempo de jogo e nos favoritos.
- Valores de `platform`: `nes`, `snes`, `n64`, `gb`, `gbc`, `gba`, `nds`,
  `sms`, `genesis`, `gg` e `psx`.
- Os caminhos relativos são resolvidos a partir da URL da lista.
- A ordem da lista é a ordem dos jogos no Início e na Biblioteca.

## Os jogos que já vêm na lista

São 83 jogos homebrew de GB, GBC, GBA e NES, tirados do
[Homebrew Hub](https://hh.gbdev.io), o banco de dados das comunidades gbdev,
gbadev e nesdev. Entram só jogos cuja licença permite redistribuição: MIT, GPL,
Zlib, MPL, Apache, 0BSD, Unlicense, WTFPL, FSFAP e as variantes CC-BY.

As ROMs, capas e capturas de tela não ficam no nosso servidor. Elas são
carregadas direto dos repositórios de origem no GitHub
(`raw.githubusercontent.com`, que libera CORS). A página de cada jogo mostra o
autor, a licença e o link para o projeto original.

Para atualizar a lista (o script confere cada link antes de incluir o jogo):

```bash
npm run play:catalog
```

O script sobrescreve `public/play/games.json`. As listas `FEATURED` (jogos que
aparecem primeiro) e `SKIP` (jogos excluídos) ficam dentro de
`scripts/build-play-catalog.mjs`.

Outros lugares para achar jogos livres:
[itch.io](https://itch.io/games/free/tag-homebrew) (confira a licença de cada
jogo), [PDRoms](https://pdroms.de) e as competições GBA Jam e NESdev Compo.

## Onde hospedar ROMs próprias

Qualquer servidor serve, desde que libere o site via CORS
(`Access-Control-Allow-Origin`). Bons exemplos são o Cloudflare R2 ou um bucket
S3. Downloads de release do GitHub não funcionam, porque não enviam cabeçalho
de CORS.

As ROMs da lista são públicas: qualquer pessoa que abrir a página consegue
baixá-las. Coloque na lista apenas jogos que você tem direito de distribuir.
