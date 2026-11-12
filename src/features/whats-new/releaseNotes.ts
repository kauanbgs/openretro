type Text = { pt: string; en: string; es: string };

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
      es: "OpenRetro 1.0 - ¡El lanzamiento oficial y gracias por todo!",
    },
    banner: [
      {
        art: "logo",
        lead: { pt: "Lançamento", en: "The official", es: "El lanzamiento" },
        strong: { pt: "oficial", en: "launch", es: "oficial" },
        text: {
          pt: "O OpenRetro chega à 1.0, sua primeira versão oficial.",
          en: "OpenRetro reaches 1.0, its first official release.",
          es: "OpenRetro llega a 1.0, su primera versión oficial.",
        },
      },
      {
        art: "landscape",
        lead: { pt: "Feito com", en: "Made with", es: "Hecho con" },
        strong: { pt: "vocês", en: "you", es: "vosotros" },
        text: {
          pt: "Cada teste, Party e problema relatado ajudou a chegar aqui.",
          en: "Every test, Party and reported problem helped get here.",
          es: "Cada prueba, Party y problema comunicado nos ayudó a llegar hasta aquí.",
        },
      },
    ],
    body: [
      {
        pt: "Olá, pessoal! 😄",
        en: "Hi everyone! 😄",
        es: "¡Hola a todos! 😄",
      },
      {
        pt: "Hoje o OpenRetro sai oficialmente da fase de testes. Obrigado a cada um que baixou, testou, abriu uma Party com os amigos e contou o que não estava funcionando. Essa versão também é de vocês.",
        en: "Today OpenRetro officially leaves the test phase. Thank you to everyone who downloaded it, tested it, opened a Party with friends and told us what wasn't working. This version is yours too.",
        es: "Hoy OpenRetro sale oficialmente de la fase de pruebas. Gracias a quienes lo descargaron, probaron, abrieron una Party con amigos y nos contaron qué no funcionaba. Esta versión también es vuestra.",
      },
      {
        pt: "O que você encontra na 1.0:",
        en: "What you'll find in 1.0:",
        es: "Lo que encontrarás en 1.0:",
      },
    ],
    highlights: [
      {
        title: {
          pt: "Sua biblioteca",
          en: "Your library",
          es: "Tu biblioteca",
        },
        text: {
          pt: "jogos de vários consoles num só lugar, com capas e downloads dentro do app.",
          en: "games from many consoles in one place, with artwork and downloads in the app.",
          es: "juegos de muchas consolas en un solo lugar, con imágenes y descargas en la aplicación.",
        },
      },
      {
        title: { pt: "Big Picture", en: "Big Picture", es: "Big Picture" },
        text: {
          pt: "navegue pela TV com o controle, como num console.",
          en: "browse from the couch with a controller, like a console.",
          es: "navega desde el sofá con un mando, como en una consola.",
        },
      },
      {
        title: {
          pt: "Jogar no celular",
          en: "Play on your phone",
          es: "Juega en tu móvil",
        },
        text: {
          pt: "o celular vira tela e controle, direto do navegador.",
          en: "your phone becomes the screen and the controller, right in the browser.",
          es: "tu móvil se convierte en pantalla y mando, directamente en el navegador.",
        },
      },
      {
        title: {
          pt: "Party com amigos",
          en: "Party with friends",
          es: "Party con amigos",
        },
        text: {
          pt: "até 4 jogadores, cada um de onde estiver, com chat durante o jogo.",
          en: "up to 4 players, each from wherever they are, with chat during the game.",
          es: "hasta 4 jugadores, cada uno desde donde esté, con chat durante el juego.",
        },
      },
    ],
    closing: { pt: "Bom jogo!", en: "Have fun!", es: "¡Que te diviertas!" },
  },
  "1.1.0": {
    date: "2026-10-29",
    title: {
      pt: "OpenRetro 1.1 - Voz e reações no Party",
      en: "OpenRetro 1.1 - Voice and reactions in Party",
      es: "OpenRetro 1.1 - Voz y reacciones en Party",
    },
    banner: [
      {
        art: "logo",
        lead: { pt: "Converse no", en: "Talk in", es: "Habla en" },
        strong: { pt: "Party", en: "Party", es: "Party" },
        text: {
          pt: "Fale com os amigos durante o jogo, sem sair do OpenRetro.",
          en: "Talk to your friends during the game, without leaving OpenRetro.",
          es: "Habla con tus amigos durante el juego sin salir de OpenRetro.",
        },
      },
      {
        art: "landscape",
        lead: { pt: "Reaja com", en: "React with", es: "Reacciona con" },
        strong: { pt: "um toque", en: "one tap", es: "un toque" },
        text: {
          pt: "Palmas, risadas e fogo sobem pela tela de todo mundo.",
          en: "Applause, laughs and fire float up everyone's screen.",
          es: "Aplausos, risas y fuego aparecen en las pantallas de todos.",
        },
      },
    ],
    body: [
      {
        pt: "Olá, pessoal! 🎮",
        en: "Hi everyone! 🎮",
        es: "¡Hola a todos! 🎮",
      },
      {
        pt: "O Party ficou mais vivo: agora dá para conversar e reagir enquanto vocês jogam. Para usar, o anfitrião e os amigos precisam estar na 1.1.",
        en: "Party got livelier: now you can talk and react while you play. To use it, the host and friends all need to be on 1.1.",
        es: "Party tiene más vida: ahora puedes hablar y reaccionar mientras juegas. Para usarlo, el anfitrión y sus amigos deben tener la versión 1.1.",
      },
      {
        pt: "O que chegou na 1.1:",
        en: "What's new in 1.1:",
        es: "Novedades de 1.1:",
      },
    ],
    highlights: [
      {
        title: { pt: "Voz no Party", en: "Voice in Party", es: "Voz en Party" },
        text: {
          pt: "ligue o microfone no painel do Party ou na barra do jogo, no app ou no navegador. Cada pessoa ouve as outras, nunca a própria voz. Use fones.",
          en: "turn on your microphone in the Party panel or the game bar, in the app or the browser. Everyone hears the others, never their own voice. Use headphones.",
          es: "activa el micrófono en el panel de Party o la barra del juego, en la aplicación o el navegador. Todos oyen a los demás, nunca su propia voz. Usa auriculares.",
        },
      },
      {
        title: {
          pt: "Quem está falando",
          en: "Who is talking",
          es: "Quién está hablando",
        },
        text: {
          pt: "um anel verde no avatar de quem fala e uma marca com o lugar e o nome no canto da tela.",
          en: "a green ring on the avatar of whoever speaks, and a mark with their seat and name in the corner of the screen.",
          es: "un anillo verde rodea el avatar de quien habla y aparece un indicador con su plaza y nombre en una esquina de la pantalla.",
        },
      },
      {
        title: {
          pt: "Reações rápidas",
          en: "Quick reactions",
          es: "Reacciones rápidas",
        },
        text: {
          pt: "👏 😂 🔥 ❤️ 😮 👍 pelo botão Reagir ou pelas teclas 1 a 6. Sobem pela tela de todos com o nome de quem mandou.",
          en: "👏 😂 🔥 ❤️ 😮 👍 with the React button or the 1 to 6 keys. They float up everyone's screen with the sender's name.",
          es: "👏 😂 🔥 ❤️ 😮 👍 con el botón Reaccionar o las teclas del 1 al 6. Aparecen en las pantallas de todos con el nombre del remitente.",
        },
      },
      {
        title: {
          pt: "Trocar o controle",
          en: "Swap controllers",
          es: "Intercambiar mandos",
        },
        text: {
          pt: "o anfitrião muda quem joga como J2, J3 e J4 pelas setas do painel, sem ninguém sair da sala.",
          en: "the host changes who plays as P2, P3 and P4 with the arrows in the panel, without anyone leaving the room.",
          es: "el anfitrión cambia quién juega como J2, J3 y J4 con las flechas del panel, sin que nadie salga de la sala.",
        },
      },
    ],
    closing: {
      pt: "Bom jogo, e boas conversas!",
      en: "Have fun, and happy chatting!",
      es: "¡Que os divirtáis y disfrutéis de la charla!",
    },
  },
  "1.2.0": {
    date: "2026-10-31",
    title: {
      pt: "OpenRetro 1.2 - Nintendo Switch",
      en: "OpenRetro 1.2 - Nintendo Switch",
      es: "OpenRetro 1.2 - Nintendo Switch",
    },
    banner: [
      {
        art: "logo",
        lead: { pt: "Chegou o", en: "Here comes the", es: "Llega la" },
        strong: {
          pt: "Nintendo Switch",
          en: "Nintendo Switch",
          es: "Nintendo Switch",
        },
        text: {
          pt: "Adicione seus jogos de Switch e jogue com o seu yuzu, dentro do OpenRetro.",
          en: "Add your Switch games and play them with your yuzu, inside OpenRetro.",
          es: "Añade tus juegos de Switch y juega con tu yuzu dentro de OpenRetro.",
        },
      },
      {
        art: "landscape",
        lead: { pt: "Party em", en: "Party in", es: "Party en" },
        strong: { pt: "1080p", en: "1080p", es: "1080p" },
        text: {
          pt: "Imagem mais nítida para os amigos, e o celular vira controle do Switch.",
          en: "A sharper picture for your friends, and your phone becomes a Switch controller.",
          es: "Una imagen más nítida para tus amigos y tu móvil como mando de Switch.",
        },
      },
    ],
    body: [
      {
        pt: "Olá, pessoal! 🎮",
        en: "Hi everyone! 🎮",
        es: "¡Hola a todos! 🎮",
      },
      {
        pt: "A 1.2 traz o Nintendo Switch para a sua biblioteca e deixa a Party mais nítida. Para jogar com o Switch você usa o seu próprio emulador (yuzu, Eden, Citron e outros).",
        en: "1.2 brings the Nintendo Switch to your library and makes Party sharper. To play Switch games you use your own emulator (yuzu, Eden, Citron and others).",
        es: "La versión 1.2 añade Nintendo Switch a tu biblioteca y mejora la nitidez de Party. Para jugar a Switch, usa tu propio emulador (yuzu, Eden, Citron y otros).",
      },
      {
        pt: "O que chegou na 1.2:",
        en: "What's new in 1.2:",
        es: "Novedades de 1.2:",
      },
    ],
    highlights: [
      {
        title: {
          pt: "Jogos de Switch",
          en: "Switch games",
          es: "Juegos de Switch",
        },
        text: {
          pt: "importe uma pasta e o OpenRetro acha o jogo, o nome e o emulador sozinho, inclusive em um yuzu portátil com o jogo instalado. O jogo abre dentro do OpenRetro.",
          en: "import a folder and OpenRetro finds the game, its name and the emulator by itself, even in a portable yuzu with the game installed. The game opens inside OpenRetro.",
          es: "importa una carpeta y OpenRetro encuentra el juego, su nombre y el emulador automáticamente, incluso en un yuzu portátil con el juego instalado. El juego se abre dentro de OpenRetro.",
        },
      },
      {
        title: {
          pt: "Escolha o arquivo",
          en: "Pick the file",
          es: "Elige el archivo",
        },
        text: {
          pt: "ao apertar Jogar, escolha qual arquivo executar: o jogo, uma atualização ou um DLC. Adicione outros arquivos quando quiser.",
          en: "when you press Play, choose which file to run: the game, an update or DLC. Add more files whenever you want.",
          es: "al pulsar Jugar, elige qué archivo ejecutar: el juego, una actualización o un DLC. Añade más archivos cuando quieras.",
        },
      },
      {
        title: {
          pt: "Menu sob demanda",
          en: "Menu on demand",
          es: "Menú cuando lo necesites",
        },
        text: {
          pt: "as barras do emulador ficam escondidas e a imagem ocupa a tela toda. Leve o mouse à borda de cima ou de baixo para vê-las.",
          en: "the emulator's bars stay hidden and the picture fills the screen. Move the mouse to the top or bottom edge to see them.",
          es: "las barras del emulador permanecen ocultas y la imagen llena la pantalla. Mueve el ratón al borde superior o inferior para verlas.",
        },
      },
      {
        title: {
          pt: "Celular e Party como controle",
          en: "Phone and Party controllers",
          es: "Mandos del móvil y de Party",
        },
        text: {
          pt: "no Switch, o celular e os convidados viram controles Xbox 360 virtuais. O OpenRetro instala o driver ViGEmBus quando precisar (o Windows pede permissão uma vez); depois é só escolher o controle no seu emulador.",
          en: "in Switch games, your phone and your guests become virtual Xbox 360 controllers. OpenRetro installs the ViGEmBus driver when it needs it (Windows asks permission once); then pick the controller in your emulator.",
          es: "en los juegos de Switch, tu móvil y los invitados se convierten en mandos virtuales de Xbox 360. OpenRetro instala el controlador ViGEmBus cuando lo necesita (Windows pide permiso una vez); después elige el mando en tu emulador.",
        },
      },
      {
        title: {
          pt: "Party em 1080p",
          en: "Party in 1080p",
          es: "Party en 1080p",
        },
        text: {
          pt: "em Configurações, escolha 1080p para uma imagem mais nítida. O teto de qualidade subiu para 16 Mbps, e a Party reduz sozinha se a conexão não aguentar.",
          en: "choose 1080p in Settings for a sharper picture. The quality ceiling is now 16 Mbps, and Party lowers it by itself if the connection can't keep up.",
          es: "elige 1080p en Configuración para una imagen más nítida. El límite de calidad ahora es de 16 Mbps y Party lo reduce automáticamente si la conexión no es suficiente.",
        },
      },
      {
        title: { pt: "Correções", en: "Fixes", es: "Correcciones" },
        text: {
          pt: "os emuladores que você adiciona não somem mais ao reabrir o OpenRetro; o celular passa a ver a versão atual do app; e o catálogo mostra os jogos de Switch.",
          en: "emulators you add no longer disappear when you reopen OpenRetro; your phone now sees the current version of the app; and the catalog shows Switch games.",
          es: "los emuladores que añades ya no desaparecen al volver a abrir OpenRetro; tu móvil ve la versión actual de la aplicación y el catálogo muestra juegos de Switch.",
        },
      },
    ],
    closing: { pt: "Bom jogo!", en: "Have fun!", es: "¡Que te diviertas!" },
  },
  "1.3.0": {
    date: "2026-11-01",
    title: {
      pt: "OpenRetro 1.3 - Deixe do seu jeito",
      en: "OpenRetro 1.3 - Make it yours",
      es: "OpenRetro 1.3 - A tu gusto",
    },
    banner: [
      {
        art: "logo",
        lead: { pt: "Aparência", en: "Make it", es: "Hazlo" },
        strong: { pt: "do seu jeito", en: "yours", es: "tuyo" },
        text: {
          pt: "Cores, cantos, fonte e um vídeo ou imagem de fundo, em Configurações.",
          en: "Colors, corners, font and a video or picture behind everything, in Settings.",
          es: "Colores, esquinas, fuente y un vídeo o imagen de fondo, en Configuración.",
        },
      },
      {
        art: "landscape",
        lead: { pt: "Um visual", en: "A new", es: "Un nuevo" },
        strong: { pt: "novo", en: "look", es: "aspecto" },
        text: {
          pt: "Menu, cartões e Home redesenhados, com setas no lugar da rolagem lateral.",
          en: "A redesigned menu, cards and Home, with arrows instead of side scrolling.",
          es: "Menú, tarjetas e Inicio rediseñados, con flechas en lugar de desplazamiento lateral.",
        },
      },
    ],
    body: [
      {
        pt: "Olá, pessoal! 🎨",
        en: "Hi everyone! 🎨",
        es: "¡Hola a todos! 🎨",
      },
      {
        pt: "A 1.3 deixa o OpenRetro com a sua cara. Em Configurações, Aparência, você muda quase tudo no visual e vê o resultado na hora.",
        en: "1.3 lets you make OpenRetro look like you. In Settings, Appearance, you change almost everything about the look and see it at once.",
        es: "La versión 1.3 te permite poner OpenRetro a tu gusto. En Configuración, Apariencia, cambia casi todo el aspecto y ve el resultado al instante.",
      },
      {
        pt: "O que chegou na 1.3:",
        en: "What's new in 1.3:",
        es: "Novedades de 1.3:",
      },
    ],
    highlights: [
      {
        title: {
          pt: "Aparência completa",
          en: "Full appearance",
          es: "Apariencia completa",
        },
        text: {
          pt: "escolha as cores de fundo, painéis, texto e destaque, o arredondamento dos cantos, a fonte e a transparência dos painéis. Dá para usar um degradê, uma imagem ou um vídeo atrás de tudo, e o vídeo para sozinho enquanto você joga.",
          en: "pick the background, panel, text and accent colors, how round the corners are, the font and how see-through the panels are. Use a gradient, a picture or a video behind everything; the video stops by itself while you play.",
          es: "elige los colores de fondo, paneles, texto y acento, el redondeo de las esquinas, la fuente y la transparencia de los paneles. Usa un degradado, una imagen o un vídeo de fondo; el vídeo se detiene automáticamente mientras juegas.",
        },
      },
      {
        title: { pt: "Temas", en: "Themes", es: "Temas" },
        text: {
          pt: "sete temas prontos, incluindo o Vidro. Salve o seu visual com um nome, copie-o como texto para mandar a um amigo ou cole o de outra pessoa. Quem quer ir além pode escrever o próprio CSS.",
          en: "seven ready-made themes, including Glass. Save your look under a name, copy it as text to send a friend, or paste someone else's. If you want to go further, write your own CSS.",
          es: "siete temas preparados, incluido Cristal. Guarda tu aspecto con un nombre, cópialo como texto para enviárselo a un amigo o pega el de otra persona. Si quieres ir más allá, escribe tu propio CSS.",
        },
      },
      {
        title: {
          pt: "Home e biblioteca",
          en: "Home and library",
          es: "Inicio y biblioteca",
        },
        text: {
          pt: "a Biblioteca ganhou lugar no menu e uma fileira na Home com o que você jogou por último. Os catálogos agora têm setas para avançar e voltar, e os cartões de celular e Party foram redesenhados.",
          en: "the Library has its own place in the menu and a row on Home with what you played last. Catalogs now have arrows to move forward and back, and the phone and Party cards were redesigned.",
          es: "la Biblioteca tiene su propio lugar en el menú y una fila en Inicio con lo último que jugaste. Los catálogos tienen flechas para avanzar y retroceder, y las tarjetas del móvil y de Party se han rediseñado.",
        },
      },
      {
        title: {
          pt: "Iniciar com o Windows",
          en: "Start with Windows",
          es: "Iniciar con Windows",
        },
        text: {
          pt: "em Configurações, faça o OpenRetro abrir sozinho quando você entra no Windows. Vem desligado.",
          en: "in Settings, have OpenRetro open by itself when you sign in to Windows. It is off by default.",
          es: "en Configuración, haz que OpenRetro se abra al iniciar sesión en Windows. Viene desactivado.",
        },
      },
      {
        title: {
          pt: "Novidades de cada versão",
          en: "News from every version",
          es: "Novedades de cada versión",
        },
        text: {
          pt: "clique na versão, no canto de baixo, para ler as novidades de todas as versões.",
          en: "click the version in the bottom corner to read the news from every version.",
          es: "haz clic en la versión de la esquina inferior para leer las novedades de todas las versiones.",
        },
      },
      {
        title: {
          pt: "Jogos de Switch e PS3",
          en: "Switch and PS3 games",
          es: "Juegos de Switch y PS3",
        },
        text: {
          pt: "aperte Ctrl+Alt+Q para fechar um jogo que não tem o nosso menu, e o OpenRetro conecta sozinho os jogadores do controle virtual nos controles do yuzu.",
          en: "press Ctrl+Alt+Q to close a game that has no menu of ours, and OpenRetro connects the virtual-pad players in yuzu's controls by itself.",
          es: "pulsa Ctrl+Alt+Q para cerrar un juego que no tenga nuestro menú y OpenRetro conecta automáticamente los jugadores del mando virtual en los controles de yuzu.",
        },
      },
    ],
    closing: { pt: "Bom jogo!", en: "Have fun!", es: "¡Que te diviertas!" },
  },
};

const parts = (version: string) => version.split(".").map(Number);
const compare = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** The news a version shows: its own entry, or else the newest earlier entry
 * of the same major version, so 1.0's stays through every 1.x release until
 * 2.0 has its own. `version` is the entry's key, for the window's subtitle. */
export function releaseNoteFor(
  installed: string,
): { version: string; note: ReleaseNote } | null {
  const newest = Object.keys(releaseNotes)
    .filter(
      (key) =>
        parts(key)[0] === parts(installed)[0] && compare(key, installed) <= 0,
    )
    .sort(compare)
    .pop();
  return newest ? { version: newest, note: releaseNotes[newest] } : null;
}

/** Every version's entry, newest first, up to the installed one. */
export function releaseHistory(
  installed: string,
): { version: string; note: ReleaseNote }[] {
  return Object.keys(releaseNotes)
    .filter((key) => compare(key, installed) <= 0)
    .sort((a, b) => compare(b, a))
    .map((version) => ({ version, note: releaseNotes[version] }));
}
