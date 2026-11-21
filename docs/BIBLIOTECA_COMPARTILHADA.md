# Biblioteca compartilhada: jogar no outro PC

Deixe os jogos num PC e baixe no outro, em casa ou de qualquer lugar. Um PC
vira o **servidor** (onde estão os jogos) e o outro é o **cliente** (onde você
quer jogar). Os dois precisam do OpenRetro, na versão com este recurso.

```
PC servidor (jogos)  <──────────────>  PC cliente (onde você joga)
  OpenRetro ligado                       baixa o jogo e adiciona
                                         à biblioteca
```

O servidor **não** transmite o jogo: o cliente baixa o arquivo e roda no
próprio PC, com o próprio emulador.

## O que você precisa

- O OpenRetro aberto no PC servidor, com os jogos já na biblioteca dele.
- O OpenRetro instalado no PC cliente.
- Uma conta gratuita no Tailscale, só se for usar fora de casa. O OpenRetro
  instala o programa sozinho. Em casa, na mesma rede, dá pra usar sem conta
  (veja [Só em casa](#só-em-casa-sem-instalar-nada)).

## Passo 1: no PC servidor

1. Abra **Configurações → Servidor**.
2. Ligue **Compartilhar minha biblioteca**.
3. Na primeira vez, o OpenRetro prepara o acesso de fora de casa:
   - ele baixa o Tailscale, programa gratuito que cria uma conexão privada e
     segura entre os seus PCs;
   - o Windows mostra uma janela de permissão: aceite;
   - uma página abre no navegador: entre ou crie uma conta grátis. **Anote qual
     conta usou**, o outro PC precisa da mesma.
4. Quando terminar, aparece o **link de pareamento** (e um QR code). Clique em
   **Copiar**.

Deixe o OpenRetro aberto no servidor enquanto quiser baixar. Se você fechar o
app, o servidor sai do ar, e volta sozinho na próxima vez que abrir.

## Passo 2: no PC cliente

1. Abra **Configurações → Servidor**, no grupo **Biblioteca de outro PC**.
2. Cole o link de pareamento e clique em **Conectar**.
3. Na primeira vez, o OpenRetro configura o acesso remoto neste PC também (as
   mesmas janelas do passo anterior). Entre com **a mesma conta** do servidor.
   Quando terminar, clique em **Conectar** de novo.
4. Aparece o aviso de que a biblioteca foi conectada.

O servidor passa a ser uma **fonte** de downloads. Você pode vê-lo em
**Fontes**, junto com as outras que tiver.

## Passo 3: baixar um jogo

1. Abra o **Catálogo** e entre na página do jogo que está no outro PC.
2. Clique no botão de baixar. A lista mostra as fontes que têm o jogo, e a do
   outro PC aparece com o nome `OpenRetro · NOME-DO-PC`.
3. Escolha e confirme. O progresso aparece em **Downloads**.
4. Quando terminar, o jogo entra na sua **Biblioteca**, pronto pra jogar.

O download continua de onde parou se a conexão cair.

## Só em casa, sem instalar nada

Se os dois PCs estão na mesma casa, dá pra pular o Tailscale:

1. No PC servidor, em **Configurações → Servidor**, ligue **Também pela rede
   local**.
2. Use o **Link para a rede local**, que aparece separado do outro.
3. No cliente, cole esse link normalmente. Nenhuma instalação é pedida.

A rede local **não é criptografada**. Ligue só em uma rede em que você
confia, como o Wi-Fi da sua casa, e não em Wi-Fi público. Desligue a opção
quando não precisar: o servidor deixa de aceitar a rede local na hora.

## Quando o servidor tem jogos novos

A lista que o cliente vê é uma cópia do momento em que você conectou. Para
atualizar, abra **Fontes** no cliente e clique em **Sincronizar**.

## Problemas comuns

**"Link inválido"**
Cole o link inteiro, do `http://` até o final. Ele só funciona se vier do
OpenRetro do servidor.

**"Use o endereço do outro PC…"**
O link tem um endereço que o app não aceita. Os aceitos são os do acesso remoto
(começam com `100.`) e os da rede local (`192.168.…`, `10.…`, `172.16` a
`172.31`). Use o link que o servidor mostra.

**Conecta, mas o download não começa**
- Confira se o OpenRetro está aberto no servidor e com **Compartilhar minha
  biblioteca** ligado.
- Confira se os dois PCs entraram com a **mesma conta** do Tailscale.
- Se o Windows perguntar sobre o firewall no servidor, permita o acesso.
- Se mudou de rede, aguarde alguns segundos.

**O jogo não aparece na lista**
- Só aparecem jogos instalados que são **um único arquivo**. Jogos que são
  pastas, como os de PS3, ficam de fora por enquanto.
- O jogo precisa estar no Catálogo do cliente com o mesmo nome.
- Jogos cujo nome indica só versão japonesa são escondidos pelo filtro de
  região das fontes.
- Clique em **Sincronizar** em Fontes.

**"A porta 47821 já está em uso"**
Outro programa usa essa porta no servidor. Feche-o e ligue de novo.

**A instalação do Tailscale foi cancelada**
Aceite a janela de permissão do Windows e clique em **Tentar de novo**. Ele só
instala com a sua permissão, e só pelo instalador oficial com a assinatura
digital conferida.

## Segurança

- O link de pareamento **é uma senha**. Quem o tiver baixa seus jogos. Não
  poste em chats públicos.
- Se ele vazar, ou se quiser desconectar os PCs pareados, vá em
  **Configurações → Servidor → Novo link de pareamento**. O link antigo para de
  funcionar na hora e cada cliente precisa conectar de novo.
- O servidor só atende o próprio PC, a rede do Tailscale e, se você ligar, a
  rede local. Nunca a internet aberta.
- Só os jogos da sua biblioteca podem ser baixados, e só pelo link com o
  token. Nenhuma outra pasta do PC é acessível.

## Em resumo

| Quero | Faça |
| --- | --- |
| Baixar de fora de casa | Servidor: ligar o compartilhamento. Cliente: colar o link. Mesma conta Tailscale nos dois. |
| Baixar em casa, sem instalar | Servidor: ligar também **pela rede local**. Cliente: colar o link da rede local. |
| Ver jogos novos | Cliente: **Fontes → Sincronizar**. |
| Desconectar todos | Servidor: **Novo link de pareamento**. |
| Parar de compartilhar | Servidor: desligar **Compartilhar minha biblioteca**. |
