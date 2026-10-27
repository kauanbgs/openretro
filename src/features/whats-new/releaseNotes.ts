type Text = { pt: string; en: string };

/** One half of the picture at the top of the news. */
export interface BannerPanel {
  /** The OpenRetro logo, the pixel scenery, or a picture's address. */
  art: "logo" | "landscape" | string;
  /** The caption: `lead` in regular weight, then `strong` in bold. */
  lead: Text;
  strong: Text;
  text: Text;
}

/** What a version shows once after it is installed. */
export interface ReleaseNote {
  /** When it came out, as YYYY-MM-DD. */
  date: string;
  title: Text;
  banner: BannerPanel[];
  /** Paragraphs before the list. The first one is the greeting. */
  body: Text[];
  /** The list of changes: a bold lead, then what it means. */
  highlights: { title: Text; text: Text }[];
  /** A last paragraph after the list. */
  closing?: Text;
}

/**
 * One entry per version that should greet the player after updating, keyed
 * by package.json's version. A version without an entry shows nothing.
 */
export const releaseNotes: Record<string, ReleaseNote> = {
  "1.0.0": {
    date: "2026-10-27",
    title: {
      pt: "OpenRetro 1.0 - Lançamento oficial, e obrigado por tudo!",
      en: "OpenRetro 1.0 - The official launch, and thank you for everything!",
    },
    banner: [
      {
        art: "logo",
        lead: { pt: "Lançamento", en: "The official" },
        strong: { pt: "oficial", en: "launch" },
        text: {
          pt: "O OpenRetro chega à 1.0, sua primeira versão oficial.",
          en: "OpenRetro reaches 1.0, its first official release.",
        },
      },
      {
        art: "landscape",
        lead: { pt: "Feito com", en: "Made with" },
        strong: { pt: "vocês", en: "you" },
        text: {
          pt: "Cada teste, Party e problema relatado ajudou a chegar aqui.",
          en: "Every test, Party and reported problem helped get here.",
        },
      },
    ],
    body: [
      { pt: "Olá, pessoal! 😄", en: "Hi everyone! 😄" },
      {
        pt: "Hoje o OpenRetro sai oficialmente da fase de testes. Obrigado a cada um que baixou, testou, abriu uma Party com os amigos e contou o que não estava funcionando. Essa versão também é de vocês.",
        en: "Today OpenRetro officially leaves the test phase. Thank you to everyone who downloaded it, tested it, opened a Party with friends and told us what wasn't working. This version is yours too.",
      },
      {
        pt: "O que você encontra na 1.0:",
        en: "What you'll find in 1.0:",
      },
    ],
    highlights: [
      {
        title: { pt: "Sua biblioteca", en: "Your library" },
        text: {
          pt: "jogos de vários consoles num só lugar, com capas e downloads dentro do app.",
          en: "games from many consoles in one place, with artwork and downloads in the app.",
        },
      },
      {
        title: { pt: "Big Picture", en: "Big Picture" },
        text: {
          pt: "navegue pela TV com o controle, como num console.",
          en: "browse from the couch with a controller, like a console.",
        },
      },
      {
        title: { pt: "Jogar no celular", en: "Play on your phone" },
        text: {
          pt: "o celular vira tela e controle, direto do navegador.",
          en: "your phone becomes the screen and the controller, right in the browser.",
        },
      },
      {
        title: { pt: "Party com amigos", en: "Party with friends" },
        text: {
          pt: "até 4 jogadores, cada um de onde estiver, com chat durante o jogo.",
          en: "up to 4 players, each from wherever they are, with chat during the game.",
        },
      },
    ],
    closing: { pt: "Bom jogo!", en: "Have fun!" },
  },
};
