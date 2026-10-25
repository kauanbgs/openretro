# OpenRetro v0.6.3

- Party com captura de até 60 fps, antes limitada a 30 fps.
- Teto de vídeo ampliado de 5 para 8 Mbps por convidado, com adaptação à conexão e equilíbrio entre nitidez e movimento.
- Parâmetros de vídeo aplicados após a criação da codificação negociada, com compatibilidade para WebViews que rejeitam ajustes opcionais.
- Buffer curto de reprodução para absorver variações da rede: alvo de 20 ms para vídeo e 40 ms para áudio.
- WebView configurada para evitar redução de prioridade e limitação de temporizadores enquanto o jogo do anfitrião está aberto.

A qualidade efetiva depende do jogo, da capacidade dos PCs e da conexão. A reprodução continua usando WebView2; esta versão não inclui um player nativo.

Esta atualização não exige migrações do banco nem publicação do Worker. Atualize e reinicie os aplicativos do anfitrião e dos convidados e crie uma nova sala para usar todos os ajustes.
