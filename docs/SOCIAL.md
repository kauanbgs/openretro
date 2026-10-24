# Contas e social do OpenRetro

**Estado: fases 1 a 4 implementadas localmente. Nada foi publicado.**

O login é opcional e compartilha o Worker do Party. A seção Conta está em
Configurações no desktop e no Big Picture. O painel Amigos tem pedidos, bloqueios e
presença, ingressos e entrada automática no Party de amigos. Jogar offline,
o celular e o Party anônimo continuam sem depender de conta.

## O servidor nesta fase

- A migração `cloudflare/migrations/0001_social_auth.sql` cria contas, códigos,
  sessões, tabelas de pedidos/amizades/bloqueios e cotas, com índices.
- `POST /api/auth/start {email}` normaliza o e-mail e envia um código de seis
  dígitos, válido por dez minutos. Guarda apenas o HMAC-SHA-256 do código com
  `AUTH_PEPPER`. A resposta 202 é igual para contas novas e existentes.
- `POST /api/auth/verify {email, code}` permite cinco tentativas e usa verificação
  HMAC nativa em tempo constante. Consumo do código, criação da conta e emissão
  da sessão são uma transação D1: duas verificações concorrentes não emitem duas
  sessões. Códigos malformados também contam como tentativa.
- A sessão tem 256 bits aleatórios; apenas seu SHA-256 fica no D1. Expira após
  90 dias sem uso e é renovada por requisições autenticadas. Leituras de
  autenticação usam uma sessão D1 iniciada na primária para evitar réplicas antigas.
- `GET /api/auth/session`, `POST /api/auth/logout` e `POST /api/auth/logout-all`
  consultam a conta, revogam a sessão atual e revogam todos os aparelhos.
- `GET /api/account/export` exporta dados e metadados de login, sessões e relações,
  sem tokens nem hashes de credenciais. `DELETE /api/account` apaga a conta,
  sessões, códigos, cota por e-mail e relacionamentos nos dois sentidos.
- `GET /privacidade` é um rascunho público em português, disponível sem configurar
  o social. Precisa de revisão antes de ativar o login para usuários.
- Um cron horário remove códigos, sessões e cotas expiradas. Perfis ficam até a
  exclusão pelo usuário. Sem configuração social, suas rotas retornam 503 e as
  rotas existentes do Party continuam funcionando.

Limites: três códigos por e-mail por 15 minutos; 60 segundos entre reenvios;
dez solicitações por IP por 15 minutos; 30 verificações por IP por 15 minutos.
Respostas 429 incluem mensagem e `Retry-After`. Cotas usam HMACs com escopo, sem
armazenar IPs ou e-mails em claro; as chaves por IP também mudam diariamente.

A conta nasce com `displayName: null`, `needsProfile: true` e um código curto
provisório, no formato `jogador#ab12`. Ao criar o perfil, a pessoa escolhe o
nome e os quatro caracteres depois do `#`. **O código segue o nome:** o prefixo
é o nome sem acentos, espaços nem símbolos, em minúsculas e com até 16
caracteres ("Kauã Plaza" vira `kauaplaza#ab12`). Um nome sem letras nem
números mantém `jogador`. O sufixo são letras ASCII ou números, sem distinção
entre maiúsculas e minúsculas. A combinação completa precisa estar livre.
Trocar o nome troca o prefixo; as amizades continuam, porque são guardadas pelo
id da conta. Contas que já tinham nome com o prefixo `jogador` passam para o
nome na próxima consulta de sessão, se a combinação estiver livre; senão, ficam
como estão. A regra está em `friend-code.mjs` e é repetida em
`src/services/account.ts`, com um teste que compara as duas. Mostrar o jogo
começa ligado; aparecer offline começa desligado.

### Atualização para códigos de quatro caracteres

Se você já concluiu os passos 1 a 4 deste documento, não refaça domínio, e-mail,
segredos nem a criação do D1. Aplique apenas a nova migração
`0002_four_character_friend_codes.sql` antes de publicar o Worker atualizado.
Dentro de `party-server`, atualize o banco local e o banco de produção que você
já criou:

```powershell
npx wrangler d1 migrations apply openretro-social --local --config cloudflare/wrangler.jsonc
npx wrangler d1 migrations apply openretro-social --remote --config cloudflare/wrangler.jsonc
```

O Wrangler aplica só as migrações pendentes. A migração atribui códigos curtos
distintos às contas antigas e preserva escolhas que já tenham quatro caracteres.
Não muda IDs, e-mails, sessões, pedidos, amizades ou bloqueios. Os códigos antigos
longos deixam de funcionar para novos pedidos; amizades existentes continuam.
Em **Sua conta**, no painel social, escolha os quatro caracteres e clique
**Salvar perfil**. O prefixo vem do nome; só o sufixo é editável. O servidor recusa com
409 uma combinação ocupada, sem alterar o restante do perfil, inclusive quando
duas contas tentam escolher a mesma combinação ao mesmo tempo.

Depois da migração, use o Worker e o app atualizados: versões antigas do app
ainda esperam o código longo ao adicionar amigos. Nenhum segredo precisa mudar.

## 1. Domínio e DNS para e-mail

O Party pode continuar no endereço `workers.dev`. O Resend exige domínio próprio
verificado para envio de e-mail. Se ainda não tiver um, registre o domínio de sua
escolha; não compramos nem configuramos nenhum domínio neste trabalho.

Use, por exemplo, o subdomínio `login.seu-dominio.com.br`. Esse nome é um marcador,
não um domínio existente do projeto. Cadastre-o no Resend e copie os registros
que o painel apresentar: valores e seletores variam por domínio e região.

| Registro    | Configuração no DNS                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| DKIM        | TXT no seletor indicado pelo Resend, com o valor completo fornecido por ele.                                                         |
| SPF         | TXT no hostname indicado pelo Resend. Copie o valor exato; não crie dois SPF no mesmo hostname.                                      |
| Return-Path | MX fornecido pelo Resend, se solicitado. Não substitua o MX da sua caixa principal.                                                  |
| DMARC       | Pode começar com TXT em `_dmarc.login.seu-dominio.com.br`, valor `v=DMARC1; p=none`. Revise a política após validar seus remetentes. |

No Cloudflare, registros de e-mail são DNS, sem proxy HTTP. Espere a verificação
de SPF e DKIM no painel. Consulte [domínios no Resend](https://resend.com/docs/dashboard/domains/introduction).

## 2. Resend

1. Crie sua conta, cadastre o domínio remetente e conclua a verificação DNS.
2. Mantenha rastreamento de aberturas e cliques desativado para esse domínio.
3. Crie uma chave de envio, restrita ao domínio quando possível.
4. Troque a var pública `EMAIL_FROM` em `party-server/cloudflare/wrangler.jsonc`
   por `OpenRetro <conta@login.seu-dominio.com.br>`.
5. Não coloque a chave no JSON, no chat ou em arquivo versionado. Use o prompt
   interativo de Workers Secrets abaixo.

O adaptador `cloudflare/social/email.mjs` envia texto simples em português por
`POST https://api.resend.com/emails`, com idempotência por desafio. Não envia
HTML, imagens ou links de rastreamento. Falhas invalidam o código não entregue;
o corpo da resposta do provedor nunca é registrado ou devolvido ao cliente.
Veja [a API de envio](https://resend.com/docs/api-reference/emails/send-email).

## 3. Cloudflare: banco, migrações e segredos

**Estes comandos são para você executar ao ativar o serviço. Não foram criados
recursos remotos nem executado deploy.** A partir da raiz do repositório:

```powershell
npm ci --prefix party-server
Push-Location party-server
npx wrangler login --config cloudflare/wrangler.jsonc
npx wrangler d1 create openretro-social --config cloudflare/wrangler.jsonc
```

Copie o `database_id` retornado para o binding `SOCIAL_DB` no
`cloudflare/wrangler.jsonc`, substituindo `00000000-0000-0000-0000-000000000000`.
Preserve `DIRECTORY`, `ROOMS` e a migração Durable Object `v1`.
Ainda dentro de `party-server`, aplique as migrações antes de publicar o Worker:

```powershell
npx wrangler d1 migrations apply openretro-social --remote --config cloudflare/wrangler.jsonc
npx wrangler secret put RESEND_API_KEY --config cloudflare/wrangler.jsonc
npx wrangler secret put AUTH_PEPPER --config cloudflare/wrangler.jsonc
```

No primeiro prompt, cole sua chave do Resend. Para `AUTH_PEPPER`, crie você mesmo
um segredo exclusivo com pelo menos 32 bytes aleatórios em um gerenciador de
senhas e mantenha a cópia fora do repositório. Nunca use o marcador local em
produção nem passe segredos como argumentos de comando. Preserve as chaves TURN
existentes; elas não precisam ser substituídas.

Para os ingressos de amigos, configure também `PARTY_TICKET_SECRET`, com pelo
menos 32 caracteres e independente do `AUTH_PEPPER`. Execute:

```powershell
npx wrangler secret put PARTY_TICKET_SECRET --config cloudflare/wrangler.jsonc
```

`SocialHub` está na tag `v2-social`; a tag `v1` não foi alterada. Não há nova
migração D1 na fase 4. Consulte [migrações D1](https://developers.cloudflare.com/d1/reference/migrations/).

## 4. Desenvolvimento local sem enviar e-mail

Dentro de `party-server`, preserve qualquer configuração local que já exista:

```powershell
if (!(Test-Path cloudflare/.dev.vars)) {
  Copy-Item cloudflare/.dev.vars.example cloudflare/.dev.vars
}
npx wrangler d1 migrations apply openretro-social --local --config cloudflare/wrangler.jsonc
npm start
```

O exemplo contém somente marcadores de teste, `SOCIAL_DEV_MODE=true` e um pepper
não secreto para localhost. `.dev.vars` é ignorado pelo Git. Omita/comente
`RESEND_API_KEY` nesse arquivo para não enviar e-mails reais. O D1 local fica em
`.wrangler`, também ignorado, separado do banco remoto.

A API local fica em `http://127.0.0.1:8787`. Em outro PowerShell:

```powershell
$socialEmail = 'teste@example.test'
$body = @{ email = $socialEmail } | ConvertTo-Json
Invoke-RestMethod http://127.0.0.1:8787/api/auth/start -Method Post -ContentType 'application/json' -Body $body
$socialCode = Read-Host 'Digite o código mostrado no terminal do Worker'
$body = @{ email = $socialEmail; code = $socialCode } | ConvertTo-Json
$socialLogin = Invoke-RestMethod http://127.0.0.1:8787/api/auth/verify -Method Post -ContentType 'application/json' -Body $body
$socialHeaders = @{ Authorization = "Bearer $($socialLogin.token)" }
Invoke-RestMethod http://127.0.0.1:8787/api/auth/session -Headers $socialHeaders
Invoke-RestMethod http://127.0.0.1:8787/api/account/export -Headers $socialHeaders
Invoke-RestMethod http://127.0.0.1:8787/api/auth/logout -Method Post -Headers $socialHeaders
```

O token desse teste de terminal fica apenas em memória. No aplicativo, o backend
Rust grava o token no Gerenciador de Credenciais do Windows, por usuário e origem
do serviço. Ele não passa para o JavaScript, localStorage ou banco de configurações.
No celular e fora do Windows o login fica desativado; os jogos continuam funcionando. Encerre com Ctrl+C e use `Pop-Location` para voltar à raiz.

O prompt permite código no log local e também proíbe logs de credenciais. A
interpretação aplicada é restrita: somente o código, sem e-mail nem token, pode
aparecer no terminal com `SOCIAL_DEV_MODE=true` e hostname loopback. Em domínio
público esse modo retorna 503; sem Resend em produção também retorna 503, sem log.

## 5. Ordem de publicação, quando autorizada

1. Revise `/privacidade`: responsável, contato e prazos do Resend e das cópias de
   recuperação. A API apaga dados ativos do D1; não promete apagar históricos de
   entrega do provedor ou backups da infraestrutura.
2. Crie D1, preencha o id real e `EMAIL_FROM`, aplique as migrações e os segredos.
   Nunca publique `SOCIAL_DEV_MODE=true` em produção.
3. Valide o empacotamento e só então publique o Worker:

   ```powershell
   npm run deploy:check --prefix party-server
   npm run deploy --prefix party-server
   ```

4. Confira login real e Party anônimo no Worker publicado.
5. Após as próximas fases, distribua o aplicativo com a tela de conta. Versões
   antigas continuam no mesmo protocolo de Party, sem conta obrigatória.

Nenhum plano pago foi ativado. Ativar D1, cron e Resend usará as franquias e
cobranças da sua conta; o código não implementa um limite financeiro rígido.

## 6. Checklist depois do deploy

- Receber códigos para conta nova e existente, com a mesma resposta pública de
  início, sem imagens ou rastreamento na mensagem.
- Entrar uma vez e confirmar que o código não pode ser reutilizado.
- Verificar 429 no reenvio antes de 60 segundos e após tentativas excessivas.
- Testar logout, logout em todos os aparelhos, exportação e exclusão de uma
  conta de teste, conferindo sessões e relacionamentos no banco ativo.
- Revisar `/privacidade` e confirmar ausência de credenciais nos logs de produção.
- Jogar offline e testar um Party anônimo entre redes diferentes, sem login.

## Validação e trabalho restante

Os testes Miniflare usam o D1 do runtime local e cobrem transporte HTTP,
concorrência, expiração, cotas, sessões, exportação/exclusão, CORS e independência
do Party. O envio Resend é simulado; nenhum e-mail real ou banco remoto foi usado.

Ficam para as fases 3 a 5: amigos/bloqueios e presença via SocialHub, painel de
amigos, notificações e ingressos para o Party. A documentação começa nesta fase para
permitir revisar e operar o servidor; o acabamento final pertence à fase 5.
Não fizemos commit, push, tag, release ou deploy.

## Fase 2: conta no aplicativo

Configurações → Conta permite solicitar/reenviar o código, entrar, escolher o
nome, copiar o código de amigo, editar a privacidade, sair, sair de todos os
aparelhos, exportar os dados e excluir a conta com confirmação digitada.
A mesma tela é usada pelo Big Picture, incluindo o teclado por controle.
Os perfis locais existentes permanecem separados da conta online.

O endpoint autenticado `PATCH /api/account/profile` aceita somente
`displayName`, `showPlaying` e `appearOffline`. Valida nomes por pontos de código
Unicode, de 3 a 24 caracteres, rejeitando controles e caracteres invisíveis.
E-mail, identificador e código de amigo não podem ser alterados por esse endpoint.
Mudanças concorrentes de nome e privacidade não sobrescrevem outros campos.

No Windows, usamos diretamente a API oficial de Credenciais com os bindings
`windows-sys`, sem precisar adicionar um segundo gerenciador de segredos. A
persistência fica no computador para o mesmo usuário Windows, sem roaming.
Os comandos Tauri mantêm o token no Rust e não são expostos na API do celular.
Não há tentativa de armazenamento alternativo se o cofre falhar; uma sessão
recém-criada recebe uma solicitação de revogação se não puder ser salva com segurança.

Sem conexão, a credencial é preservada. Nome e e-mail só podem continuar visíveis
se já estavam na memória da interface; nada é cacheado em disco pelo social.
É possível tentar conectar novamente ou esquecer apenas a sessão deste computador.
Essa última opção avisa que não revoga sessões no servidor. Logout em todos os
aparelhos e exclusão exigem uma resposta do servidor, sem simular sucesso offline.

### Testar enquanto o domínio é analisado

O domínio não é necessário para desenvolvimento. Depois de iniciar o Worker
local conforme a seção 4, abra outro terminal na raiz do projeto:

```powershell
$env:OPENRETRO_SOCIAL_URL = 'http://127.0.0.1:8787'
npm run tauri -- dev
```

O endereço é configuração do operador, não um campo nas telas do usuário.
O app aceita HTTP apenas para loopback; em produção exige HTTPS. As credenciais
locais e de produção usam entradas distintas no cofre, evitando reutilizar o
token em outro servidor. Redirecionamentos HTTP não recebem o token.

Solicite um código pela seção Conta e copie-o do terminal do Worker para o app.
Nesse modo explícito local, sem chave Resend, nenhum e-mail é enviado. Quando o
domínio estiver pronto, configure Resend/DNS e publique o Worker antes de
distribuir o app. Não é necessário refazer a interface ou esperar o domínio
para testar o fluxo local.

O teste de cofre real usa uma entrada exclusiva de teste e a remove ao terminar:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib windows_credential_roundtrip -- --ignored
```

Os testes automatizados também cobrem falha de armazenamento com revogação da
sessão nova, expiração, resposta 429, bloqueio de redirects, validação de perfil
e ausência de token na resposta enviada à interface. O fluxo visual foi conferido
com um serviço simulado local; o envio de e-mail real e a integração completa com
um Worker de produção ainda dependem da configuração do domínio.

## Fase 3: amigos e presença

O botão **Amigos** fica no cabeçalho do desktop e na barra de navegação do
Big Picture. O painel permite adicionar por código, aceitar ou recusar pedidos,
cancelar envios, desfazer amizade, bloquear e desbloquear. Bloquear remove os
pedidos e as duas direções da amizade numa transação; desbloquear não restaura
amizades. Os perfis públicos de amigos contêm somente id, nome e código, sem e-mail.

As rotas novas são `GET /api/friends`, `POST /api/friends/action {action,target}`
e `GET /social` com upgrade WebSocket. Todas exigem a sessão e a política de
origem já aplicada ao login. O alvo de `request` é o código; nas demais ações é o
id do jogador. Ações: `request`, `accept`, `decline`, `cancel`, `remove`, `block`
e `unblock`. Há 20 pedidos por dia por conta, 120 ações por 15 minutos, até 200
amigos, 100 pedidos pendentes por direção e 200 bloqueios. Cancelar um pedido
não devolve a cota diária. As cotas são HMACs, entram na exportação sem os hashes
e são removidas ao excluir a conta.

`SOCIAL_HUB` aponta para o novo Durable Object SQLite `SocialHub`, declarado
na tag **`v2-social`**. A tag original `v1` permanece igual. O Wrangler aplica a
migração do objeto no deploy; não existe outra migração D1 nesta fase. Continue
aplicando as migrações D1 antes do Worker, e publicando o Worker antes do app.
Não publique com o id D1 de exemplo. O serviço social é opcional para o Party.

Cada usuário tem um hub com até cinco conexões. A API de hibernação mantém as
conexões sem timer em memória; anexos dos sockets guardam apenas id da conta,
id da sessão, estado e prazos. Nunca guardam token ou e-mail. O app envia um
heartbeat a cada 30 segundos; conexões sem atividade por 90 segundos deixam de
contar como online. Um alarme detecta conexões abandonadas e para quando não há
mais sockets ativos. Cada heartbeat verifica revogação e renova a sessão válida.
Sair de todos os aparelhos encerra as sessões sociais existentes.

As presenças têm `status: online|idle`, `playing` opcional e `party` opcional.
O servidor valida formato, limites de tamanho, horários, códigos e URLs de capa.
Só aceita capas HTTPS de `images.igdb.com` e `images.launchbox-app.com`, sem
credenciais, porta alternativa, consulta ou fragmento. Mensagens têm no máximo
2 KiB e 30 mensagens por janela de dez segundos. A lista mostra jogando/online
primeiro e offline por último, com console e minutos transcorridos.

A sessão continua somente no Rust/cofre. Diferente do exemplo em TypeScript
do pedido original, **o próprio Rust abre o WebSocket** e envia o token no
cabeçalho Authorization, nunca na URL nem ao JavaScript. A interface recebe
eventos validados por IPC. O transporte reconecta com espera crescente de até
60 segundos e variação aleatória; reenvia o estado atual após reconectar.
Sem conta, não abre conexão. No celular, o painel não é exposto nem os comandos
da conta entram na API remota.

A montagem do jogo reaproveita diretamente a atividade do Discord: título,
nome completo do console, capa e início. Funciona mesmo com a integração do
Discord desligada. O Rust guarda o jogo atual em memória para reconectar ou
entrar na conta durante uma partida, cobrindo desktop e Big Picture sem copiar
a tabela de consoles. Fora de uma partida, cinco minutos sem interação colocam
o app como ausente. O jogo em andamento mantém o estado online.

`showPlaying=false` oculta só o jogo; `appearOffline=true` oculta a presença
inteira, inclusive Party. As preferências são consultadas no envio e no
recebimento. Cada repasse também confere amizade e bloqueio na base primária,
para descartar mensagens que estavam em trânsito quando uma relação foi cortada.
Alterações de perfil, amizade e sessão atualizam os painéis conectados. Há toasts
internos para pedido recebido, aceitação e anúncio de Party quando esse estado
é publicado ao abrir uma sala; não são notificações do sistema.

### Conferir a fase 3

Execute os testes descritos acima. Miniflare simula múltiplas contas/conexões,
incluindo cancelamento/recusa, aceitação por terceiros negada, bloqueio nas duas
direções, cotas diárias, privacidade, capa maliciosa, origem não permitida e
revogação de sessão. Os testes do cliente cobrem ordenação, deltas atrasados para
usuários removidos, reconexão e notificações. Rust valida ações, perfis e a
conversão da atividade do jogo sem expor o token.

No Big Picture, selecione Amigos na barra; A no campo Adicionar amigo abre o
teclado, Y alterna para símbolos para digitar `#`, B fecha o teclado. As ações
de cada linha e a confirmação de bloqueio usam a navegação do workspace.

A conferência visual usa dados fictícios locais. Ainda falta a conferência
com dois PCs e contas reais no Worker publicado, após configurar D1, domínio e
Resend. O Party anônimo mantém o fluxo atual.

## Fase 4: entrar no Party de um amigo

Quando uma conta conectada abre uma sala, **Amigos podem entrar** começa ligado.
A opção usa a sessão do Rust e a capacidade de anfitrião já emitida pelo Party
para vincular a sala à conta. Só o verdadeiro anfitrião pode fazer essa
vinculação; uma mensagem de presença não pode anunciar a sala de outra pessoa.
A configuração só é considerada confirmada após resposta do servidor. Se ela
falhar, aparece um erro e a sala continua disponível pelo fluxo manual.

No painel Amigos, **Entrar** aparece quando o amigo anuncia uma sala disponível.
O Rust pede o ingresso e abre o navegador do sistema em
`/party/ABC234#t=...`. A sessão da conta nunca é entregue ao navegador ou ao
JavaScript. A página remove imediatamente o fragmento do histórico e envia o
ingresso somente na mensagem `join` do WebSocket, sem colocá-lo na URL de rede.
O visitante entra com o nome do perfil, sem preencher o formulário de novo.

O ingresso usa HMAC-SHA-256 com `PARTY_TICKET_SECRET`, dura dois minutos e contém
versão, sala, conta do anfitrião, conta e sessão do convidado, identificador da
permissão atual, emissão, expiração e nonce aleatório. Não contém e-mail nem
token de sessão. O servidor valida a assinatura em tempo constante e confere
amizade, bloqueios, sessão válida, privacidade e permissão na emissão e no uso.
Desligar e religar a opção troca o identificador da permissão: ingressos antigos
continuam inválidos. Sair da conta, excluir a conta, aparecer offline ou cortar
a amizade também impede a aprovação automática.

O PartyRoom reserva o primeiro lugar livre entre J2, J3 e J4, usando o mesmo
caminho de aprovação manual. Um ingresso aprovado só pode ser usado uma vez;
o nonce consumido fica no estado durável da sala, com expiração, sem o ingresso.
Não há lugar extra nem reutilização de um lugar ocupado. Sem ingresso, com
ingresso inválido ou sem lugar livre, continua o pedido de aprovação manual.
Se um ingresso vencido foi aberto sem nome, a página solicita o nome para tentar
novamente no fluxo normal. Sem o novo segredo, a sala anônima continua funcionando.

Rotas novas: `POST /api/friends/party/host {code,ticket,joinable}` e
`POST /api/friends/party/join {friendId}`, ambas autenticadas. Há limite de 120
alterações da permissão e 60 emissões por 15 minutos por conta. Essas cotas
também entram na exportação e são apagadas na exclusão da conta. Nenhuma rota
interna de vínculo ou emissão do Durable Object é exposta pelo Worker público.

### Testar localmente e publicar depois

Adicione a variável de exemplo `PARTY_TICKET_SECRET` ao seu `.dev.vars` ignorado,
sem reutilizar o segredo de autenticação. Para testar conta e Party no mesmo
Worker local, use as duas variáveis no terminal do app:

```powershell
$env:OPENRETRO_SOCIAL_URL = 'http://127.0.0.1:8787'
$env:OPENRETRO_PARTY_URL = 'http://127.0.0.1:8787'
npm run tauri -- dev
```

O Worker local precisa do modo de teste TURN já descrito em `docs/PARTY.md`.
Em produção, configure o segredo com o comando da seção 3 e publique o Worker
antes de distribuir o app. Builds antigas continuam usando aprovação manual.
Não foi necessário alterar as migrações D1 ou os bindings nesta fase.

Miniflare cobre ingresso válido, assinatura adulterada, expiração, outra sala,
replay, lotação, troca de permissão, bloqueio após emissão, sessão revogada,
perfil offline, tentativa de anunciar sala alheia e ausência do novo segredo.
O teste da página confere remoção do fragmento e retorno ao formulário manual;
Rust confere a origem fixa e a URL com ingresso somente no fragmento. O teste
real com dois PCs e transmissão de áudio/vídeo pelo Worker publicado ainda falta.

## Painel social e ícones da conta

A conta saiu das Configurações. O botão de perfil no topo da barra lateral,
onde ficava o jogador local, mostra o ícone da conta e abre o painel social:
sua conta e status, Partys abertos, solicitações de amizade agrupadas, amigos
online e, recolhidos, offline e bloqueados. Sem conta, o mesmo painel faz o
login por código; logo depois, pede nome, código e ícone. O jogador local do PC
continua no rodapé do painel (**Trocar**). No Big Picture, o botão da conta
fica na barra superior e abre o painel em tela cheia; trocar o jogador local
continua em Sistema → Jogadores.

Cada conta tem um de 15 ícones predefinidos (`avatar`, de 0 a 14). Uma conta
nova recebe um aleatório, e o jogador pode trocar ao criar o perfil ou depois,
em **Sua conta**. `PATCH /api/account/profile` aceita `avatar` e recusa qualquer
valor fora dessa faixa; a lista de amigos devolve o ícone de cada um.

Antes de publicar o Worker com os ícones, aplique a nova migração:

```powershell
npx wrangler d1 migrations apply openretro-social --local --config cloudflare/wrangler.jsonc
npx wrangler d1 migrations apply openretro-social --remote --config cloudflare/wrangler.jsonc
```

`0003_preset_avatars.sql` adiciona a coluna e sorteia um ícone para as contas
que já existem. Versões antigas do app ignoram o campo e continuam funcionando.
