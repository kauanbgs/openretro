# Tarefa: contas com login por código de e-mail e um "social" no OpenRetro

Você já conhece o repositório OpenRetro (Tauri 2 + React/TypeScript + Rust +
SQLite, com o Party num Worker da Cloudflare em `party-server/`). Implemente
contas, amigos, "jogando agora" e entrar no Party de um amigo. Leia o código
antes de decidir; quando este texto e o código divergirem, siga o código e
diga o que encontrou.

## Regras do projeto (obrigatórias)

- **Não faça commit, push, tag, release nem deploy.** Deixe tudo no working
  tree e me diga o que mudou. Nunca adicione `Co-Authored-By` nem qualquer
  atribuição de IA.
- Nunca peça, gere ou grave segredos reais no repositório. Segredos entram
  só por `wrangler secret put` (feito por mim) ou `.dev.vars` (ignorado pelo git).
- Siga o estilo de cada arquivo: comentários em inglês explicando o porquê,
  textos da interface em **português como texto-fonte** com a tradução em
  `src/i18n/en.ts`, Prettier no frontend, `rustfmt` nos arquivos Rust que você
  criar.
- Rust chama processos com argumentos separados, nunca shell. Valide toda
  entrada que vem da rede ou do frontend.
- O app tem que continuar 100% funcional **sem conta e offline**. O social é
  opcional e nunca bloqueia jogar, o celular ou o Party anônimo.
- Teste só o que mudou e rode: `npm test`, `npx tsc -b`, `npm run build`,
  `npm test --prefix party-server` e `cargo test --manifest-path src-tauri/Cargo.toml`.

## Contexto que você vai reaproveitar

- **Worker do Party:** `party-server/cloudflare/worker.mjs` e
  `party-server/cloudflare/wrangler.jsonc`, com Durable Objects SQLite
  (`PartyDirectory`, `PartyRoom`, WebSocket Hibernation) e os testes em
  `party-server/cloudflare.test.mjs` (Miniflare). A página do convidado é
  `party-server/public/guest.js`; o host está em
  `src/features/party/partySession.ts` (`startParty`, `acceptGuest`, `roster`).
- **Início e fim de jogo:** `src-tauri/src/launcher/mod.rs` emite
  `game-started`/`game-finished` e chama `crate::discord::game_started`/`game_finished`.
  O `src-tauri/src/discord.rs` é o modelo de como montar "jogando agora"
  (título, console por extenso, capa https do IGDB, início em unix).
- **Configurações:** `src/types/index.ts` (`AppSettings`, `defaultSettings`),
  `src/features/settings/SettingsPage.tsx` (padrão `setting-row` + `Switch`),
  persistidas em JSON por `commands::get_settings`/`save_settings`.
- **Ponte e transporte:** `src/services/bridge.ts` e `src/services/transport.ts`
  (`isTauri`, `isRemote`). A CSP em `src-tauri/tauri.conf.json` já permite
  `https:` e `wss:` em `connect-src`.
- O app também roda no **Big Picture** (`src/features/big-picture/`), navegável
  por controle, e no **celular** (`isRemote`). O social precisa funcionar no
  desktop e no Big Picture; no celular, só leitura ou nada, mas não pode quebrar.

## Arquitetura

### Servidor: no mesmo Worker do Party

Mesmo Worker e mesmo domínio, em módulos novos (por exemplo
`party-server/cloudflare/social/*.mjs`), sem quebrar nenhuma rota atual.

- **D1** (binding `SOCIAL_DB`) com migrações SQL versionadas em
  `party-server/cloudflare/migrations/`: `users`, `login_codes`, `sessions`,
  `friend_requests`, `friendships`, `blocks`. Use índices nas buscas.
- **Durable Object `SocialHub`**, um por usuário online, com WebSocket
  Hibernation. Guarda a presença atual e repassa para os hubs dos amigos online.
  Declare a classe numa nova migração do `wrangler.jsonc` (nova tag; não altere a `v1`).
- **Envio de e-mail pelo Resend**, via `fetch` para a API, com
  `RESEND_API_KEY` (segredo) e `EMAIL_FROM` (var). Em dev e nos testes, sem
  chave, o código é registrado no log local e nada é enviado. Isole o envio
  numa função fácil de trocar por outro provedor.

### Login por código de e-mail (sem senha)

1. `POST /api/auth/start {email}` gera um código de 6 dígitos, guarda **só o
   hash** (HMAC-SHA-256 com o segredo `AUTH_PEPPER`), válido por 10 minutos,
   e envia o e-mail. Responde igual exista ou não a conta, para não revelar
   e-mails cadastrados.
2. `POST /api/auth/verify {email, code}`: no máximo 5 tentativas por código,
   comparação em tempo constante. Cria a conta na primeira vez e devolve um
   token de sessão aleatório de 256 bits. No D1 fica só o hash do token.
3. A sessão dura 90 dias e é renovada com o uso. Inclua `POST /api/auth/logout`
   e "sair de todos os aparelhos".
4. **Limites:** códigos por e-mail (ex.: 3 a cada 15 min) e por IP, tentativas
   por IP, e respostas 429 com mensagem clara. Normalize o e-mail (trim + minúsculas).
5. O e-mail tem assunto e texto simples em português: o código, a validade e
   "se não foi você, ignore". Sem rastreamento nem imagens remotas.

### Perfil e amigos

- **Perfil:** nome de exibição (3 a 24 caracteres, validado, sem caracteres de
  controle) e um **código de amigo** único gerado pelo servidor (ex.: `kauan#4821`).
  Sem foto de perfil nesta versão; use as iniciais, como o `PlayerAvatar` atual.
- **Pedidos de amizade:** por código de amigo; enviar, aceitar, recusar,
  cancelar, desfazer amizade e **bloquear**. Bloquear corta amizade, pedidos e
  presença nos dois sentidos. Limite de pedidos por dia.
- **Privacidade** (no servidor e no app): "Mostrar o que estou jogando para
  amigos" (padrão ligado) e "Aparecer offline" (padrão desligado).

### Presença ("jogando agora")

- O app abre `wss://…/social` com o token e envia apenas: `online`,
  `playing {title, console, cover, startedAt}`, `idle`, e
  `party {code, joinable}` / `party null`. O servidor valida tamanho e formato
  e só repassa para amigos, respeitando bloqueio e privacidade.
- A **capa** só é repassada se for uma URL https de `images.igdb.com` ou
  `images.launchbox-app.com` (os domínios que o app já usa).
- O hub detecta a queda da conexão (heartbeat) e marca offline. O app reconecta
  com backoff e reenvia o estado atual.
- No app, o cliente social pode ficar em TypeScript (ex.: `src/services/social.ts`).
  Ele ouve `game-started`/`game-finished` e o `partyStore`, para cobrir
  desktop e Big Picture. Se achar melhor reaproveitar a montagem do
  `discord.rs` para título, console e capa, exponha isso por um comando Tauri
  em vez de duplicar a tabela de consoles.

### Entrar no Party de um amigo

- Quando o anfitrião está logado e abre um Party, aparece no diálogo do Party
  a opção **"Amigos podem entrar"** (padrão ligado). Ela publica `party {code, joinable: true}`.
- Na lista de amigos, um amigo com Party aberto mostra o botão **Entrar**. O
  servidor emite um **ingresso curto** (assinado com segredo, válido por
  ~2 minutos, preso ao código da sala e ao id do amigo) e o app abre a página
  normal do Party com o ingresso no fragmento da URL (`/party/ABC234#t=...`),
  que não vai para logs de servidor.
- O `PartyRoom` valida o ingresso e, se o anfitrião permitiu amigos, **aprova
  sozinho**, sem o anfitrião clicar em aceitar, usando o nome de exibição do
  perfil. Sem ingresso ou com ingresso inválido, o fluxo atual (aprovação
  manual) continua igual. Não enfraqueça nenhuma checagem que já existe no Party.

### Interface no app

- **Entrar/sair:** em Configurações → nova seção "Conta": e-mail → código de
  6 dígitos (com "reenviar" após 60 s) → nome de exibição na primeira vez.
  Mostrar o código de amigo com botão de copiar, "Sair", "Sair de todos os
  aparelhos" e **"Excluir minha conta"** (com confirmação).
- **Token:** guarde-o no **Gerenciador de Credenciais do Windows**, por
  comandos Tauri (ex.: crate `keyring`), nunca em `localStorage` nem no SQLite
  de configurações. Fora do Windows, use o equivalente do sistema ou desative o login.
- **Painel "Amigos":** acesso pelo cabeçalho do desktop e pela barra do Big
  Picture. Mostra online e jogando primeiro (com capa, console e há quanto
  tempo), depois offline. Também tem "Adicionar amigo" pelo código, pedidos
  recebidos e enviados, e o menu de cada amigo (desfazer amizade, bloquear).
  Precisa ser navegável por controle no Big Picture.
- **Notificações dentro do app** (o toast que já existe): pedido recebido,
  pedido aceito, "Fulano abriu um Party". Sem notificação do sistema nesta versão.
- Todos os textos em português, com a tradução em `en.ts`.

### LGPD e operação

- `GET /api/account/export` devolve os dados da conta em JSON, e
  `DELETE /api/account` apaga a conta, sessões, códigos, amizades, pedidos e
  bloqueios (apagar de verdade, não só marcar).
- Uma página **`/privacidade`** servida pelo Worker, com um rascunho claro do
  que é coletado (e-mail, nome, código de amigo, amizades, presença enquanto
  online), para que serve, por quanto tempo fica e como excluir. Marque no
  topo que é rascunho para revisão. Link para ela na tela de login do app.
- Não registre e-mails, códigos, tokens nem ingressos em logs.

## Fases (pare e me reporte ao fim de cada uma)

1. **Servidor de login:** migrações D1, `/api/auth/*`, sessões, limites, envio
   de e-mail com o modo dev, exportar/excluir conta, `/privacidade`, e testes
   Miniflare de todo o fluxo, incluindo expiração, tentativas e limites.
2. **Login no app:** seção "Conta", token no Gerenciador de Credenciais,
   perfil e código de amigo, testes (vitest e cargo).
3. **Amigos e presença:** pedidos, bloqueio, `SocialHub`, cliente de
   presença, painel "Amigos" no desktop e no Big Picture, e testes do repasse
   de presença respeitando bloqueio e privacidade.
4. **Entrar no Party:** "Amigos podem entrar", ingresso assinado, aprovação
   automática no `PartyRoom`, botão Entrar, e testes de ingresso válido,
   vencido, de outra sala e de usuário bloqueado. O fluxo manual continua igual.
5. **Acabamento:** README e um `docs/SOCIAL.md` no estilo de `docs/PARTY.md`.

## Ao terminar: instruções para mim

Escreva no `docs/SOCIAL.md` e me mande no final, passo a passo e em português,
tudo o que **eu** preciso fazer, com os comandos exatos:

1. Domínio: o que comprar e os registros DNS de SPF, DKIM e DMARC que o Resend pedir.
2. Resend: criar a conta, verificar o domínio, criar a chave e o `EMAIL_FROM` a usar.
3. Cloudflare: `wrangler d1 create`, onde colocar o id no `wrangler.jsonc`,
   como aplicar as migrações em produção e os `wrangler secret put` de cada segredo
   (`RESEND_API_KEY`, `AUTH_PEPPER`, segredo dos ingressos).
4. Como rodar tudo localmente (`.dev.vars` de exemplo sem valores reais) e
   como testar o login com o código aparecendo no log.
5. A ordem segura de deploy (Worker antes do app) e o que acontece com quem
   está numa versão antiga do app.
6. O que conferir manualmente depois do deploy, numa lista curta.

Também diga claramente o que ficou de fora, o que não conseguiu testar e
qualquer decisão em que você se afastou deste texto.
