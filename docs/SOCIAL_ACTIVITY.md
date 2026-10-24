# Atividade social e participantes do Party

- O app avisa quando um amigo inicia uma nova sessão de jogo ou abre um Party.
  Pedidos e aceitações de amizade também aparecem no histórico. Avisos de amigos
  ficando online são opcionais e começam desativados.
- Os avisos têm avatar, nome e acesso ao painel. A aba **Atividade** em Amigos
  guarda os últimos 40 eventos desta sessão, marca a leitura e permite limpar
  o histórico. Um indicador mostra atividades não lidas no desktop e Big Picture.
- Em **Atividade → Preferências de avisos**, escolha quais tipos receber. Só as
  preferências são salvas no dispositivo; o histórico não é gravado em disco.
  A sessão social limpa o histórico ao trocar/revalidar a conta ou desconectar
  o cliente. Uma reconexão de rede mantém o histórico e não repete eventos.
- Presenças offline não geram avisos. Amigos removidos/bloqueados são removidos
  também do histórico na atualização da lista. Eventos de desconhecidos são
  ignorados. O snapshot inicial não produz uma enxurrada de notificações.
- O Início mostra amigos online, com acesso ao painel e destaque para Partys
  disponíveis. A sala e o card do Party mostram avatares dos participantes.
  O Worker obtém o avatar do perfil autenticado, nunca do pedido de entrada.
- São avisos dentro do app, sem integração com notificações do Windows. A tela
  de convidado do Party suprime o aviso flutuante para não disputar controles.

## Conferência local

```powershell
node tests/social-preview.mjs
```

Abra `http://127.0.0.1:1422/tests/fixtures/social-preview.html`. Os botões
**Simular jogo** e **Simular Party** produzem eventos locais de Marina. Confira
aviso, contador, aba Atividade, preferências e **Ver sala**. Esta fixture usa
somente dados fictícios e substitui snapshots em memória; ela não integra o
build de produção nem acessa contas reais.

Com o Worker local e duas contas amigas, deixe uma no painel de amigos e inicie
um jogo na outra: deve surgir um único aviso. Repetir a mesma presença e
reconectar o observador não deve repeti-lo. Trocar de jogo ou iniciar outra
sessão deve avisar. Desativar o compartilhamento de jogo/aparecer offline deve
continuar respeitando a privacidade já aplicada pelo servidor. Ao entrar no
Party, confira o avatar da segunda conta no lugar J2.

Para distribuir os avatares reais dos convidados, a atualização do Worker deve
acompanhar a do app. Respostas antigas sem avatar continuam aceitas com o ícone
padrão. Não há mudança na autenticação, ingressos, migrações ou CSP.

## Verificação

`npm test`, `npx tsc -b`, `npm run build` e `npm test --prefix party-server`.
Os testes cobrem sessões novas, deduplicação, reconexão, privacidade offline,
preferências, histórico limitado, remoção de amigos e validação do roster.
O teste de integração do Worker confirma que o avatar vem do perfil da conta.
