# Contas e social do OpenRetro

**Estado: fases 1 e 2 implementadas localmente. Nada foi publicado.**

O login é opcional e compartilha o Worker do Party. A seção Conta está em
Configurações no desktop e no Big Picture. Amigos, presença, SocialHub e ingressos de amigos pertencem às próximas
fases. Jogar offline, o celular e o Party anônimo continuam sem depender de conta.

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

A conta nasce com `displayName: null`, `needsProfile: true` e código de amigo
único gerado pelo servidor, no formato `jogador#` mais 12 caracteres hexadecimais.
Mostrar o jogo começa ligado; aparecer offline começa desligado. Não há
publicação de presença nesta fase. O nome é preenchido no primeiro acesso pela seção Conta.

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

O segredo de ingressos só será necessário na fase 4. O nome reservado é
`PARTY_TICKET_SECRET`; **não precisa configurá-lo nesta fase**. Quando o recurso
estiver implementado, use outro segredo independente e execute:

```powershell
npx wrangler secret put PARTY_TICKET_SECRET --config cloudflare/wrangler.jsonc
```

`SocialHub` será adicionado na fase 3, com nova tag de migração Durable Object.
Não criamos um stub nem alteramos `v1` agora. Consulte [migrações D1](https://developers.cloudflare.com/d1/reference/migrations/).

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
