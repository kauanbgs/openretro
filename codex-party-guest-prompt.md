npm run tauri de3v# Tarefa: entrar no Party de um amigo dentro do próprio OpenRetro

Você conhece o repositório OpenRetro (Tauri 2 + React/TypeScript + Rust, Party
num Worker da Cloudflare em `party-server/`). Hoje, o botão **Entrar** do
painel de amigos abre o **navegador do sistema** na página do Party. Faça o
próprio app ser o convidado: a partida do amigo abre numa tela do OpenRetro,
no desktop e no Big Picture, sem navegador. Leia o código antes de decidir; se
este texto e o código divergirem, siga o código e diga o que encontrou.

## Regras do projeto (obrigatórias)

- **Não faça commit, push, tag, release nem deploy.** Nunca adicione
  `Co-Authored-By` nem atribuição de IA. Ao terminar, me diga o que mudou.
- Siga o estilo de cada arquivo: comentários em inglês explicando o porquê,
  textos da interface em **português como texto-fonte** com a tradução em
  `src/i18n/en.ts`, Prettier no frontend e `rustfmt` nos arquivos Rust que você
  criar ou mudar (só nos trechos seus).
- Valide toda entrada que vem da rede ou do frontend. O token de sessão da
  conta **nunca** chega ao JavaScript: só o Rust o tem (`src-tauri/src/account/`).
- O Party continua **não anônimo**: só amigos com ingresso entram. Não mude
  nenhuma regra do Worker que permita entrar sem ingresso.
- Rode e deixe passando: `npm test`, `npx tsc -b`, `npm run build`,
  `npm test --prefix party-server` e
  `cargo test --manifest-path src-tauri/Cargo.toml`.

## Como funciona hoje (leia estes pontos)

- **Painel de amigos:** `src/features/social/SocialPanel.tsx` chama
  `joinFriendParty(friend.id)` em `src/services/social.ts`, que invoca o comando
  Rust `social_join`.
- **Rust:** `social_join` em `src-tauri/src/account/social.rs` pede ao Worker
  `POST /api/friends/party/join` (autenticado), recebe `{ code, invite }`, monta
  `/party/CODE#t=INVITE` com `join_url` e abre no navegador com `open_external`.
- **Ingresso:** HMAC, uso único, válido por ~2 minutos, preso à sala, ao
  anfitrião e à conta/sessão do convidado; não contém e-mail nem token de sessão
  (`party-server/cloudflare/social/invite-crypto.mjs` e `invites.mjs`).
- **Convidado web:** `party-server/public/guest.js`. Ele abre o WebSocket
  `/signal?room=CODE`, envia `{ type: "join", room, invite }`, recebe
  `accepted { player, iceServers, policy }`, faz o WebRTC (offer do anfitrião,
  answer do convidado e candidatos), recebe vídeo e áudio e envia o controle por
  um DataChannel `pad` não ordenado, com `{ seq, buttons, axes }`. O envio
  acontece na hora, quando muda, e também é repetido a cada 33 ms. O áudio e o
  vídeo tocam com `jitterBufferTarget = 0`. Tem também o tratamento de
  `ended`, `disconnected` e o heartbeat `ping`/`pong`.
- **Sala:** o `PartyRoom` em `party-server/cloudflare/worker.mjs` aprova
  sozinho quem chega com ingresso válido e dá o primeiro lugar livre entre J2 e J4.
- **Anfitrião:** `src/features/party/partySession.ts`, que não precisa mudar.
- **Big Picture:** `src/features/big-picture/` tem a navegação por controle
  (`controllerInput.ts`, `ConsoleWorkspace.tsx`, `workspaceNavigation.ts`) e
  rotas de workspace como `friends`.

## O que construir

1. **Rust:** um comando novo (por exemplo `social_join_room`) que faz o mesmo
   pedido do `social_join`, mas **devolve** ao JavaScript, já validados,
   `{ code, invite, signal }`. O `signal` é a URL `wss://…/signal?room=CODE` do
   serviço configurado, montada no Rust a partir da origem fixa (`ws://` só
   para loopback, como o resto do serviço). O ingresso pode ir ao JavaScript:
   ele é de uso único, curto e não é a sessão. Mantenha o `social_join` antigo
   como reserva, para abrir no navegador.
2. **Cliente convidado no app:** um módulo TypeScript (por exemplo
   `src/features/party/partyGuest.ts`) com a mesma lógica do `guest.js`:
   sinalização, WebRTC, `jitterBufferTarget = 0` no áudio e no vídeo, DataChannel
   `pad`, envio na hora e repetição a cada 33 ms, heartbeat, e tratamento de
   `error`, `ended` e queda de conexão. Mensagens de erro do servidor aparecem
   como estão.
   - Não duplique sem necessidade: se fizer sentido, extraia a lógica de
     estado do controle (os bits dos botões e eixos, com o mesmo mapeamento do
     `guest.js`) para uma função pura testável, usada pelos dois lados.
   - O `guest.js` continua funcionando como está, para quem entra pelo navegador.
3. **Tela "Jogando no Party de {nome}":** vídeo em tela cheia na área do app,
   com uma barra discreta mostrando o seu lugar (J2/J3/J4), o nome e o ícone
   (`AccountAvatar`) do anfitrião, o estado da conexão e os botões **Tela cheia**
   e **Sair**. Ela abre a partir do **Entrar** do painel, no desktop e no Big
   Picture (no Big Picture, como uma rota de workspace).
4. **Controle e teclado:**
   - Enquanto a tela de convidado está aberta, o controle e o teclado vão para
     o Party. A navegação do Big Picture e os atalhos do app não podem reagir a
     esses botões, para um "B" do jogo não fechar a tela.
   - Defina uma forma clara de sair: segurar **Start + Select** por um segundo,
     ou a tecla **Esc**, abre um menu "Continuar / Sair do Party". Mostre isso
     na barra.
   - Ao sair ou perder a conexão, solte todos os botões (envie estado neutro)
     e feche o WebRTC.
5. **Reserva:** se o WebView não tiver WebRTC ou algo falhar antes de conectar,
   ofereça **Abrir no navegador**, que usa o `social_join` atual.
6. **Ocupado jogando:** se o próprio usuário estiver com um jogo aberto no PC,
   avise antes de entrar ("Feche o jogo para entrar no Party do Fulano") em vez
   de disputar o controle.

## Segurança

- Não carregue a página web do Party dentro do app nem crie janela com
  conteúdo remoto. A tela é React do próprio app.
- Valide no Rust o `code`, o `invite` e a origem (reaproveite `valid_room`,
  `join_url` e a validação do ingresso). No TypeScript, aceite da rede só o
  formato esperado de cada mensagem, como o `guest.js` faz.
- Confira a CSP de `src-tauri/tauri.conf.json` (`connect-src` já tem `wss:` e
  `https:`). Não abra a CSP além do necessário.

## Testes

- **Vitest:** a máquina de estados do convidado (entrar, aceito, recusado,
  `ended`, queda e saída), o mapeamento do controle e o envio na hora versus
  a repetição, e a regra de que, com a tela aberta, a navegação do Big Picture
  não recebe os botões.
- **Rust:** o comando novo valida a resposta do Worker (código, ingresso e
  origem) e nunca expõe o token.
- **party-server:** os testes atuais continuam passando. Se extrair código
  compartilhado do `guest.js`, mantenha os testes dele.
- **Conferência visual:** use o navegador do ambiente com um servidor simulado
  (sinalização falsa e uma faixa de vídeo sintética) para mostrar a tela de
  convidado funcionando, e descreva o que viu.

## Ao terminar

Me diga em português:
1. O que mudou, arquivo por arquivo, em poucas linhas.
2. Como testar com o Worker local (`npm start` em `party-server`, mais
   `OPENRETRO_SOCIAL_URL` e `OPENRETRO_PARTY_URL` apontando para
   `http://127.0.0.1:8787`), passo a passo, com duas contas.
3. O que não deu para testar (por exemplo, dois PCs em redes diferentes) e
   qualquer decisão em que se afastou deste texto.
