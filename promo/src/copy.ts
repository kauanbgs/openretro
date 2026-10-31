export type Lang = "pt" | "en";

export const copy = {
  pt: {
    taglineA: "Seus clássicos,",
    taglineB: "em boa companhia.",
    sub: "Sua biblioteca no PC. Uma partida no celular. Um amigo no player 2.",
    frameTop: "Uma nova partida",
    frameBottom: "É bom estar de volta.",
    features: [
      {
        kicker: "No seu computador",
        title: ["Ligue. Escolha.", "Jogue."],
        desc: "Sua biblioteca em um só lugar, com cara de console.",
      },
      {
        kicker: "No seu celular",
        title: ["Mais uma tela.", "Mais um jogador."],
        desc: "Leia o QR code e jogue pela rede local.",
      },
      {
        kicker: "Com seus amigos",
        title: ["O player 2 pode", "estar longe."],
        desc: "Abra um Party. Seus amigos entram pelo navegador.",
      },
    ],
    library: "Biblioteca",
    nav: "Navegar",
    play: "Jogar",
    scan: "Aponte a câmera",
    party: "Party",
    you: "Você",
    friend: "Amigo",
    joined: "J2 entrou na partida",
    footnote: "Gratuito. Código aberto. Para Windows.",
    button: "Baixar OpenRetro",
  },
  en: {
    taglineA: "Your classics,",
    taglineB: "in good company.",
    sub: "Your library on PC. A match on your phone. A friend on player 2.",
    frameTop: "A new adventure",
    frameBottom: "Good to be back.",
    features: [
      {
        kicker: "On your computer",
        title: ["Turn on. Pick.", "Play."],
        desc: "Your whole library in one place, console-style.",
      },
      {
        kicker: "On your phone",
        title: ["One more screen.", "One more player."],
        desc: "Scan the QR code and play over your local network.",
      },
      {
        kicker: "With your friends",
        title: ["Player 2 can be", "far away."],
        desc: "Open a Party. Friends join from their browser.",
      },
    ],
    library: "Library",
    nav: "Browse",
    play: "Play",
    scan: "Point your camera",
    party: "Party",
    you: "You",
    friend: "Friend",
    joined: "P2 joined the match",
    footnote: "Free. Open source. For Windows.",
    button: "Download OpenRetro",
  },
} as const;

export type Copy = (typeof copy)[Lang];
