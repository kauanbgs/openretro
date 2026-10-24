# Perfis e jogos recentes

O nome e o avatar no painel de amigos abrem a página do jogador. **Ver meu
perfil** abre a própria página. Clicar em alguém em **Conheça novas pessoas**
abre a mesma página. Os acessos também funcionam no Big Picture, com navegação
por controle e volta à área social.

O perfil reúne nome, avatar, código copiável, data de entrada, presença e jogos
recentes. Permite enviar, aceitar, recusar e cancelar pedidos, desfazer amizade
e bloquear, com confirmação para remover e bloquear. Desbloquear continua no
grupo de bloqueados do painel de amigos. **Entrar no Party** aparece para amigos
com sala disponível e usa o fluxo autenticado existente. **Meu Party** abre o
gerenciamento da própria sala. **Editar perfil** abre nome, avatar e privacidade.

## Histórico e privacidade

- Até dez jogos distintos por conta, identificados por título e console.
- Somente metadados: título, console, URL pública da capa, início da última
  sessão e duração dessa sessão. Nenhuma ROM, caminho local ou imagem é enviada.
- O Rust envia no início e no fim do jogo local, sem heartbeat de histórico.
  Uma sessão antiga que termine depois não substitui uma sessão nova.
- O histórico começa com as próximas partidas; não importa registros antigos.
  Jogos transmitidos de outro PC como convidado não entram no histórico local.
- Gravação de melhor esforço: sem conexão, uma gravação pode se perder; não há
  fila persistente ou importação retroativa. A partida local não depende da rede.
- O token capturado no início permanece apenas no Rust; trocar de conta durante
  um jogo não atribui a sessão à nova conta. Sair revoga a sessão normalmente.
- Por padrão, só o dono e amigos veem o histórico. **Compartilhar histórico com
  amigos** pode ser desligado na página ou nas preferências da conta. O dono
  continua vendo seus jogos. A visibilidade do jogo atual é uma opção separada.
- Ocultar a descoberta remove o perfil da lista e do acesso por desconhecidos;
  amigos e o próprio dono ainda podem abri-lo. Bloqueios negam acesso nos dois
  sentidos. Desconhecidos não recebem jogo atual, Party ou histórico.
- Exportar a conta inclui o histórico; excluir a conta remove as linhas em
  cascata. Nunca há sessão ou e-mail na resposta de perfil de outro jogador.

## Arquivos

- `src/features/social/UserProfile.tsx` e `.css`: página e ações.
- `SocialPanel.tsx`, `PeopleDirectory.tsx`, `App.tsx` e `ConsoleWorkspace.tsx`:
  pontos de entrada e navegação desktop/Big Picture.
- `src/services/social.ts`, `account.ts` e `AccountSettings.tsx`: contratos e
  preferência, com traduções em `src/i18n/en.ts`.
- `src-tauri/src/account/history.rs`, `social.rs`, `people.rs` e `mod.rs`:
  gravação nativa, validação e resposta IPC sem credenciais.
- `party-server/cloudflare/social/history.mjs`, `people.mjs`, `hub.mjs`,
  `friends.mjs` e `auth.mjs`: persistência limitada, autorização e exportação.
- `party-server/cloudflare/migrations/0005_profile_history.sql`: tabela e opção
  de privacidade. A migração e o Worker devem acompanhar a versão do app.

## Testar localmente

Siga a configuração de duas contas em `PEOPLE_DISCOVERY.md` e `PARTY_GUEST.md`.
Aplique as migrações locais antes de iniciar o Worker:

```powershell
cd party-server
npx wrangler d1 migrations apply openretro-social --local --config cloudflare/wrangler.jsonc
npm start
```

Em outro terminal, na raiz do projeto:

```powershell
$env:OPENRETRO_SOCIAL_URL = 'http://127.0.0.1:8787'
$env:OPENRETRO_PARTY_URL = 'http://127.0.0.1:8787'
npm run tauri -- dev
```

1. Abra seu perfil pelo nome/avatar e edite uma preferência.
2. Jogue e encerre um jogo local. Atualize o perfil: ele deve aparecer uma vez,
   com a duração da última sessão. Rejogar move o mesmo jogo para o início.
3. Na outra conta, encontre a pessoa, abra o perfil e envie um pedido. Antes da
   amizade, presença e histórico não estão disponíveis. Aceite pelo perfil.
4. Após a amizade, confira o histórico e entre no Party disponível do amigo.
5. Oculte o histórico: somente o dono continua vendo os jogos. Oculte a descoberta:
   o amigo ainda abre o perfil, mas um desconhecido recebe perfil indisponível.
6. Repita a navegação no Big Picture; verifique volta e navegação por controle.

Prévia isolada: `node tests/people-preview.mjs`, em
`http://127.0.0.1:1423/tests/fixtures/people-preview.html`. Usa contas e jogos
fictícios, sem conectar a contas reais. O botão Party dessa prévia apenas simula
a ação. A publicação da versão está descrita em `RELEASE_0.6.0.md`.
