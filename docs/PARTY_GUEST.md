# Convidado do Party dentro do OpenRetro

O botão **Entrar** em Amigos abre uma tela React local, no desktop ou na rota
`party-guest` do workspace Big Picture. O Rust obtém o ingresso autenticado e
entrega apenas `{ code, invite, signal }`. O token da conta continua no Rust.
O comando antigo `social_join` continua disponível para a reserva no navegador.

## Arquivos

- `src-tauri/src/account/social.rs`: valida código, ingresso e origem; monta o
  WebSocket; verifica jogos locais, incluindo emuladores externos.
- `src-tauri/src/lib.rs`: registra `social_join_room` e `social_game_busy`.
- `src/services/social.ts`: serviços de entrada e verificação de jogo aberto.
- `src/services/social.test.ts`: verifica os comandos e o aviso de jogo aberto.
- `src/features/social/SocialPanel.tsx`: encaminha o amigo para a tela do app.
- `src/App.tsx`: abre o convidado no desktop e bloqueia o atalho de busca.
- `src/features/big-picture/ConsoleWorkspace.tsx`: rota `party-guest` e bloqueio
  da navegação de teclado enquanto a tela possui os controles.
- `src/features/big-picture/BigPicture.tsx`: bloqueia atalhos durante a sessão.
- `src/features/big-picture/controllerInput.ts`: consome os botões durante a
  sessão, mantendo a leitura para não repetir o B segurado quando ela fechar.
- `src/features/party/partyGuest.ts`: sinalização validada e serializada, WebRTC,
  vídeo/áudio com atraso de buffer zero, heartbeat, timeout e encerramento.
- `src/features/party/partyInput.ts`: mapeamento puro igual ao convidado web,
  gesto de saída e envio imediato/repetição com limite de buffer.
- `src/features/party/PartyGuestScreen.tsx`: vídeo, avatar, lugar, estado,
  fullscreen, menu e reserva; controla teclado/gamepad e limpa entradas.
- `src/features/party/PartyGuestScreen.css`: layout e foco do convidado/menu.
- `src/features/party/partyGuest.test.ts`: ciclo da sessão, validação de rede,
  controles, temporização, gesto de saída e exclusividade de entrada.
- `src/i18n/en.ts`: traduções dos novos textos-fonte em português.
- `tests/party-guest-preview.mjs` e `tests/fixtures/party-guest.html`,
  `partyGuestPreview.tsx`, `partyGuestSocial.ts`: servidor isolado de conferência,
  com conta/sinalização falsas e transmissão WebRTC real de um canvas animado.
- `docs/PARTY_GUEST.md`: este roteiro.

## Teste local com duas contas

1. Na raiz do repositório, prepare o Worker sem sobrescrever configurações:

   ```powershell
   Push-Location party-server
   if (!(Test-Path cloudflare/.dev.vars)) {
     Copy-Item cloudflare/.dev.vars.example cloudflare/.dev.vars
   }
   npx wrangler d1 migrations apply openretro-social --local --config cloudflare/wrangler.jsonc
   npm start
   ```

   Confira no `.dev.vars` os exemplos `SOCIAL_DEV_MODE=true`,
   `ALLOW_LOCAL_TEST=true` e `PARTY_TICKET_SECRET` com ao menos 32 caracteres.
   Preserve os demais valores do exemplo. Sem `RESEND_API_KEY`, o código de login
   aparece no terminal do Worker, sem enviar e-mails. Use apenas dados de teste.

2. Em outro PowerShell, na raiz, inicie o app:

   ```powershell
   $env:OPENRETRO_SOCIAL_URL = 'http://127.0.0.1:8787'
   $env:OPENRETRO_PARTY_URL = 'http://127.0.0.1:8787'
   npm run tauri -- dev
   ```

3. São necessárias duas instâncias com cofres de credenciais separados.
   No mesmo PC, use **dois usuários Windows distintos**, executando a segunda
   instância em um PowerShell desse segundo usuário. Defina nele as mesmas duas
   variáveis e execute `src-tauri/target/debug/openretro.exe`, com o Vite da
   primeira instância ainda rodando. Não inicie outro Vite na mesma porta.
   Duas instâncias no mesmo usuário/origem compartilham a credencial da conta.
   O segundo usuário precisa de acesso de leitura/execução ao checkout/binário.

4. Na primeira instância, entre com uma conta de teste, por exemplo
   `anfitriao@example.test`; na segunda, com `convidado@example.test`. Leia os
   códigos no terminal do Worker e complete nome, tag e ícone nas duas contas.
   Envie e aceite o pedido de amizade pelos códigos exibidos no painel.

5. Na conta anfitriã, abra um jogo compatível com multiplayer local, abra o
   Party e habilite **Amigos podem entrar**. Na conta convidada, sem jogo aberto,
   vá a **Amigos → Entrar**. A partida deve aparecer dentro do OpenRetro, com
   J2/J3/J4 conforme a primeira vaga disponível.

6. Confira teclado: setas; Z/X/A/S; Q/W; Enter; Shift direito. Confira também
   um controle padrão. O B do jogo deve chegar à partida sem fechar a tela.
   Pressione Esc, ou segure Start + Select por um segundo: o menu deve abrir
   com **Continuar / Sair do Party**, enviando controle neutro enquanto aberto.
   O menu aceita mouse, Tab/Enter e direcional/A/B do controle.

7. Repita a entrada no Big Picture, pela página Amigos. Confira **Tela cheia**,
   saída, perda de foco e encerramento pelo anfitrião. Com um jogo já aberto
   na conta convidada, Entrar deve avisar para fechá-lo antes de obter ingresso.
   Use controles distintos nas duas instâncias para evitar que o mesmo
   dispositivo físico também controle o jogo anfitrião neste teste no mesmo PC.

8. Sem WebRTC ou com falha antes da conexão, use **Abrir no navegador**.
   Isso solicita um ingresso novo pelo comando antigo: não reutiliza o ingresso
   consumido pela tentativa no app. O Worker mantém a autenticação obrigatória.

## Conferência visual reproduzível

```powershell
node tests/party-guest-preview.mjs
```

Abra `http://127.0.0.1:1421/tests/fixtures/party-guest.html`. O serviço simulado
aprova J2 no Party de Marina, negocia dois peers WebRTC reais e envia um canvas
1280 × 720 animado. Se o navegador bloquear autoplay, clique **Ativar imagem e
som**. Use `?big=1` para o estilo console e `?big=1&error=1` para a recusa
simulada, com mensagem original e reserva no navegador. A reserva é apenas
simulada neste servidor; o ingresso real é testado com duas contas pelo roteiro.

Essa substituição existe somente no servidor de conferência, fora do build
do produto. Não há rota de demonstração ou bypass de autenticação no app.

## Decisões e limites

- `guest.js`, o anfitrião e as regras de ingresso do Worker permanecem intactos.
  O mapeamento do app é puro e testável. Não foi extraído um módulo compartilhado
  com o JS público para evitar acoplar o empacotamento do Worker ao frontend.
- A origem da sinalização segue o serviço de conta configurado, como o fluxo
  antigo; configure as duas variáveis para o mesmo Worker.
- A CSP existente já permite os destinos necessários. Não foi ampliada e a
  mídia é ligada por `srcObject`, sem carregar página ou janela remota.
- Desconexões WebRTC recebem dez segundos para recuperar; setup tem limite de
  vinte segundos. No encerramento, o cliente tenta enviar estado neutro antes
  de fechar canal, peer e socket. Uma rede já interrompida pode perder esse envio.
- A conferência automatizada não substitui duas contas reais em WebView2,
  controle físico, áudio real, TURN e dois PCs em redes diferentes.

## Validação

```powershell
npm test
npx tsc -b
npm run build
npm test --prefix party-server
cargo test --manifest-path src-tauri/Cargo.toml
```

Se o terminal não reconhecer Cargo, adicione `$env:USERPROFILE\.cargo\bin` ao
PATH dessa sessão, como já faz `scripts/tauri.ps1`.
