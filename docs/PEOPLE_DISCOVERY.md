# Conheça novas pessoas

Decisões: todos os usuários aparecem por padrão, com opção de se ocultar. Não há
filtro por jogo ou status online. O diretório abre a página completa do perfil. As ações de amizade e o Party
ficam no perfil; a entrada no Party continua restrita a amigos. Não inclui chat.

## Uso

- No Início, clique **Conheça novas pessoas**, ou abra **Amigos → Conhecer**.
  O mesmo acesso existe no Big Picture.
- A lista mostra nome, avatar e código de amigo. **Ver mais pessoas** percorre
  todos os perfis visíveis, em páginas de 24, sem repetir perfis.
- Abra um perfil para enviar pedido. Os estados de amizade, pedido enviado e
  pedido recebido impedem novos pedidos duplicados. Aceitar, recusar e cancelar
  pedidos também estão disponíveis no perfil.
- Para se ocultar, desligue **Mostrar meu perfil aqui** na própria listagem,
  ou **Sua conta → Aparecer em Conheça novas pessoas**. As amizades e os pedidos
  existentes continuam preservados.
- **Aparecer offline** controla a presença entre amigos. Ocultar o perfil do
  diretório é uma preferência separada. Nenhuma presença, jogo atual, e-mail,
  sessão ou token aparece na resposta pública de descoberta.
- A descoberta requer conta conectada. Bloqueios excluem perfis nos dois
  sentidos. O próprio usuário não aparece em sua lista.

## Banco e Worker

A mudança inclui `0004_people_discovery.sql`, com a coluna `discoverable`
(padrão 1) e um índice para paginação. Para testar localmente:

```powershell
Push-Location party-server
npx wrangler d1 migrations apply openretro-social --local --config cloudflare/wrangler.jsonc
npm start
```

Na raiz do app, em outro PowerShell:

```powershell
$env:OPENRETRO_SOCIAL_URL = 'http://127.0.0.1:8787'
$env:OPENRETRO_PARTY_URL = 'http://127.0.0.1:8787'
npm run tauri -- dev
```

Use duas contas de teste com cofres Windows separados, como descrito em
`PARTY_GUEST.md`. Veja a segunda conta em Conhecer, envie um pedido, aceite-o
na segunda e atualize o perfil. Desative a descoberta na segunda conta e
atualize a lista na primeira: ela deve desaparecer. O endpoint de perfil
deve negar acesso a desconhecidos, mesmo se o ID já era conhecido; amigos
continuam podendo abrir o perfil. Teste bloqueios
em ambos os sentidos.

Uma lista já carregada pode conter um perfil até ser atualizada. Abrir o
perfil e enviar um pedido reconsulta a visibilidade. O código de amigo
continua funcionando fora do diretório: ocultar-se não apaga amizades nem
torna desconhecido um código previamente compartilhado.

Antes de distribuir, a migração e o Worker atualizado precisam acompanhar o
app. A publicação da versão está descrita em `RELEASE_0.6.0.md`.

## Conferência visual

```powershell
node tests/people-preview.mjs
```

Abra `http://127.0.0.1:1423/tests/fixtures/people-preview.html`. São 30 perfis
fictícios, com paginação, perfil, pedido simulado e opção de ocultar. Use
`?error=1` para testar erro de carregamento. Este servidor substitui apenas
o transporte IPC, fora do build do produto, sem acessar contas reais.

## Implementação e testes

- Worker: `social/people.mjs` implementa lista e perfil autenticados, com
  whitelist de campos, paginação por ID e cota de consultas. `auth.mjs` grava
  a preferência e inclui a nova cota na exportação/exclusão de conta.
- Rust: `account/people.rs` valida entradas e respostas antes de entregar
  os campos públicos ao JavaScript. O perfil completo inclui presença autorizada
  e até dez jogos recentes validados. A sessão fica no cofre nativo.
- Frontend: `PeopleDirectory.tsx` oferece lista e preferência; `UserProfile.tsx`
  implementa o perfil completo, suas ações e a edição da própria conta;
  os pontos de entrada ficam no Início e no painel de amigos.
- Servidor: testes verificam autenticação, campos permitidos, paginação,
  relacionamentos, ocultação, bloqueio e preservação das amizades.
- Rust: testes verificam campos públicos, perfis inválidos, páginas,
  cursores e a preferência booleana. Vitest verifica o encaminhamento IPC.

Validação: `npm test`, `npx tsc -b`, `npm run build`,
`npm test --prefix party-server`, `cargo test --manifest-path src-tauri/Cargo.toml`.
