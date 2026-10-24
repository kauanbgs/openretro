# OpenRetro v0.6.0

## Perfis e novas amizades

- Veja seu perfil e o de seus amigos, com nome, avatar, status e código de amigo.
- Conheça novas pessoas lista os jogadores do OpenRetro. Abra um perfil para
  enviar, aceitar, recusar ou cancelar um pedido de amizade.
- A página do perfil mostra os últimos dez jogos distintos e a duração da última
  sessão, com capas grandes. O histórico começa nas próximas partidas locais.
- Por padrão, somente você e seus amigos veem seu histórico. Você pode ocultá-lo
  e também escolher não aparecer na descoberta de pessoas.

## Jogar junto

- Entre no Party de um amigo dentro do próprio OpenRetro, no desktop e no Big
  Picture, com vídeo, áudio, teclado e controle.
- O botão Entrar no Party fica na barra de ações do perfil quando há uma sala
  disponível. O próprio perfil também permite gerenciar seu Party.
- Esc ou segurar Start + Select abre o menu para sair. Se a conexão não puder
  iniciar no aplicativo, a opção de abrir no navegador continua disponível.
- Jogo local aberto impede a entrada no Party para evitar disputa dos controles.
- A tela inicial e a barra lateral dão mais destaque a jogar no celular e com
  amigos. O botão Big Picture ganhou uma borda em degradê.

## Atividade social

- Receba avisos dentro do app quando um amigo iniciar um jogo ou abrir um Party.
- Consulte atividades recentes e ajuste os tipos de aviso na aba Atividade.
- Veja os avatares dos participantes da sala. Presença e ingressos continuam
  restritos a amigos autenticados, respeitando bloqueios e privacidade.

## Publicação

Esta versão requer o Worker atualizado e as migrações D1
`0004_people_discovery.sql` e `0005_profile_history.sql`. As migrações adicionam
preferências, um índice de descoberta e a tabela limitada de jogos recentes;
não removem contas, amizades ou sessões existentes.

O GitHub Actions gera os instaladores Windows assinados para o atualizador,
`latest.json`, o runtime e o arquivo de código-fonte correspondente. Detalhes
de implementação e testes locais estão em `PARTY_GUEST.md`, `SOCIAL_ACTIVITY.md`,
`PEOPLE_DISCOVERY.md` e `USER_PROFILES.md`.

A interface foi conferida com dados simulados. Testes entre dois PCs em redes
diferentes e controles físicos não fazem parte da validação automatizada.
