# OpenRetro v1.2.0

O Nintendo Switch chega à biblioteca, e a Party fica mais nítida. Para os jogos de Switch você usa o seu próprio emulador (yuzu, Eden, Citron, Suyu, Ryujinx).

- Jogos de Switch: importe uma pasta (ou um arquivo) e o OpenRetro reconhece `.nsp`, `.xci`, `.nsz` e `.xcz` pelo conteúdo, mesmo com outra extensão. O título vem do nome da pasta ou do cache do emulador, e o catálogo do LaunchBox passa a ter o Switch. Um yuzu portátil com o jogo instalado no próprio NAND é reconhecido, e o `yuzu.exe` da pasta vira o emulador do jogo. Jogos baixados também entram, com a atualização e o DLC juntos ao jogo base.
- Escolha o arquivo: ao apertar Jogar, o OpenRetro pergunta qual arquivo executar (o jogo, uma atualização, um DLC). Dá para adicionar e remover arquivos da lista.
- Dentro do OpenRetro: o emulador abre na janela do OpenRetro, em tela cheia, sem a barra de menu e a de status. Encoste o mouse na borda de cima ou de baixo para vê-las. O yuzu e seus derivados iniciam o jogo direto (`-g`), e o erro 740 (administrador) ganhou uma explicação.
- Celular e Party como controle: no Switch, o celular e os convidados viram controles Xbox 360 virtuais pelo ViGEmBus. O OpenRetro instala o driver quando precisa (o Windows pede permissão uma vez); depois escolha o controle em cada jogador do emulador.
- Party em 1080p: em Configurações, escolha entre 720p e 1080p. O teto de bitrate subiu de 8 para 16 Mbps, e a Party continua reduzindo sozinha quando a conexão não aguenta.
- Correções: os emuladores adicionados à mão não são mais removidos a cada abertura do OpenRetro; o celular passa a usar a versão atual do app; o aviso de "sem emulador" ficou claro para o Switch.

Instale por cima da versão atual; biblioteca, configurações, saves e a sua conta continuam.
