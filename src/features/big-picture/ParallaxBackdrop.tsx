import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { t } from "../../i18n";
import { motionEnabled } from "./ConsoleFx";
import { Layer, Particles } from "./ThemeScenes";

export type ConsoleTheme =
  | "waves"
  | "aurora"
  | "teton"
  | "sunset"
  | "autumn"
  | "orbit"
  | "city-lights"
  | "cyberpunk"
  | "forest"
  | "dusk"
  | "pixel-space"
  | "cemetery"
  | "pixel"
  | "art"
  | "custom";
/** The default: the focused game's art, as on a PlayStation 5. */
export const DEFAULT_CONSOLE_THEME: ConsoleTheme = "art";

const asset = (path: string) => `${import.meta.env.BASE_URL}themes/${path}`;

/** A public-domain photo, with what drifts in front of it. */
interface PhotoScene {
  kind: "photo";
  src: string;
  /** Which part stays in view when the screen crops it. */
  position?: string;
  particles?: "snow" | "leaves" | "embers";
}
/** Pixel-art parallax layers from CC0 game art, back to front. */
interface LayeredScene {
  kind: "layers";
  base: string;
  layers: {
    src: string;
    depth: number;
    /** CSS background size and position, for layers that are one sprite. */
    size?: string;
    position?: string;
    repeat?: boolean;
  }[];
}
type ThemeGroup = "scene" | "photo" | "game";
/** The built-in themes; "custom" shows one of the player's pictures. */
export const consoleThemes: {
  id: Exclude<ConsoleTheme, "custom">;
  group: ThemeGroup;
  name: string;
  description: string;
  /** Who made the image; every one is public domain or CC0. */
  credit?: string;
  scene?: PhotoScene | LayeredScene;
}[] = [
  {
    id: "art",
    group: "scene",
    name: t("Arte do jogo"),
    description: t("O fundo mostra a arte do jogo em destaque."),
  },
  {
    id: "waves",
    group: "scene",
    name: t("Ondas"),
    description: t("Ondas de luz azuis, como nos consoles clássicos."),
  },
  {
    id: "pixel",
    group: "scene",
    name: t("Vale OpenRetro"),
    description: t("A paisagem em pixel art do OpenRetro."),
  },
  {
    id: "aurora",
    group: "photo",
    name: t("Aurora boreal"),
    description: t("Aurora sobre o lago Bear, no Alasca."),
    credit: "U.S. Air Force / Joshua Strang",
    scene: {
      kind: "photo",
      src: asset("photos/aurora.jpg"),
      position: "50% 40%",
      particles: "snow",
    },
  },
  {
    id: "teton",
    group: "photo",
    name: t("Grand Teton"),
    description: t("Picos nevados ao amanhecer, no Wyoming."),
    credit: "Grand Teton National Park (NPS)",
    scene: {
      kind: "photo",
      src: asset("photos/grand-teton.jpg"),
      position: "50% 22%",
    },
  },
  {
    id: "sunset",
    group: "photo",
    name: t("Pôr do sol na montanha"),
    description: t("Raios de sol atrás da cordilheira Teton."),
    credit: "Grand Teton National Park (NPS)",
    scene: {
      kind: "photo",
      src: asset("photos/mountain-sunset.jpg"),
      position: "50% 55%",
      particles: "embers",
    },
  },
  {
    id: "autumn",
    group: "photo",
    name: t("Outono nas montanhas"),
    description: t("Folhas de outono nas Great Smoky Mountains."),
    credit: "U.S. National Park Service",
    scene: {
      kind: "photo",
      src: asset("photos/autumn.jpg"),
      position: "50% 60%",
      particles: "leaves",
    },
  },
  {
    id: "orbit",
    group: "photo",
    name: t("Pôr do sol em órbita"),
    description: t("O horizonte da Terra visto da Estação Espacial."),
    credit: "NASA / ISS Expedition 23",
    scene: {
      kind: "photo",
      src: asset("photos/orbit-sunset.jpg"),
      position: "50% 60%",
    },
  },
  {
    id: "city-lights",
    group: "photo",
    name: t("Cidade vista do espaço"),
    description: t("Nova York à noite, fotografada da Estação Espacial."),
    credit: "NASA",
    scene: { kind: "photo", src: asset("photos/city-from-space.jpg") },
  },
  {
    id: "cyberpunk",
    group: "game",
    name: t("Cidade cyberpunk"),
    description: t("Prédios neon de Warped City 2."),
    credit: "ansimuz · CC0",
    scene: {
      kind: "layers",
      base: "#2c1e4a",
      layers: [
        { src: asset("cyberpunk-city/back.png"), depth: 0.04 },
        { src: asset("cyberpunk-city/middle.png"), depth: 0.3 },
        { src: asset("cyberpunk-city/front.png"), depth: 0.65 },
      ],
    },
  },
  {
    id: "forest",
    group: "game",
    name: t("Floresta dourada"),
    description: t("Árvores e raios de luz em camadas."),
    credit: "ansimuz · CC0",
    scene: {
      kind: "layers",
      base: "#e9c27a",
      layers: [
        { src: asset("forest/back-trees.png"), depth: 0.06 },
        { src: asset("forest/lights.png"), depth: 0.15 },
        { src: asset("forest/middle-trees.png"), depth: 0.35 },
        { src: asset("forest/front-trees.png"), depth: 0.7 },
      ],
    },
  },
  {
    id: "dusk",
    group: "game",
    name: t("Montanhas ao anoitecer"),
    description: t("Cordilheiras e pinheiros sob o céu do fim de tarde."),
    credit: "ansimuz · CC0",
    scene: {
      kind: "layers",
      base: "#2d2a4b",
      layers: [
        { src: asset("mountain-dusk/bg.png"), depth: 0.02 },
        { src: asset("mountain-dusk/far.png"), depth: 0.12 },
        { src: asset("mountain-dusk/mountains.png"), depth: 0.25 },
        { src: asset("mountain-dusk/trees.png"), depth: 0.45 },
        { src: asset("mountain-dusk/foreground-trees.png"), depth: 0.8 },
      ],
    },
  },
  {
    id: "pixel-space",
    group: "game",
    name: t("Planetas em pixel"),
    description: t("Planetas e estrelas em pixel art."),
    credit: "ansimuz · CC0",
    scene: {
      kind: "layers",
      base: "#0b0a1c",
      layers: [
        { src: asset("space/background.png"), depth: 0.02 },
        { src: asset("space/stars.png"), depth: 0.1 },
        { src: asset("space/far-planets.png"), depth: 0.25 },
        {
          src: asset("space/ring-planet.png"),
          depth: 0.45,
          size: "auto 30%",
          position: "18% 22%",
          repeat: false,
        },
        {
          src: asset("space/big-planet.png"),
          depth: 0.75,
          size: "auto 46%",
          position: "86% 70%",
          repeat: false,
        },
      ],
    },
  },
  {
    id: "cemetery",
    group: "game",
    name: t("Cemitério gótico"),
    description: t("Lua cheia e lápides de Gothicvania."),
    credit: "ansimuz · CC0",
    scene: {
      kind: "layers",
      base: "#1b0f2b",
      layers: [
        { src: asset("cemetery/background.png"), depth: 0.03 },
        {
          src: asset("cemetery/mountains.png"),
          depth: 0.3,
          size: "auto 78%",
          position: "50% 100%",
        },
        {
          src: asset("cemetery/graveyard.png"),
          depth: 0.7,
          size: "auto 52%",
          position: "50% 100%",
        },
      ],
    },
  },
];
export const isConsoleTheme = (value: unknown): value is ConsoleTheme =>
  value === "custom" || consoleThemes.some((theme) => theme.id === value);

const cardSelector =
  ".tv-game-grid > button, .tv-catalog-grid > button, .ps-tile[data-art]";

/**
 * The console background. Each theme is a stack of layers that shift by
 * their depth as the pointer moves and as focus travels along the screen;
 * with the art theme, the art of the focused game fills it.
 */
export function ParallaxBackdrop({
  theme,
  picture,
  root,
  art,
  focus,
  watch,
}: {
  theme: ConsoleTheme;
  /** The player's picture, for the custom theme. */
  picture?: string;
  root: React.RefObject<HTMLElement | null>;
  /** Art for the current screen when no card has focus. */
  art?: string;
  /** Horizontal position of the focus, from 0 to 1. */
  focus?: number;
  /** Changing it (e.g. the section) re-reads the art from the page. */
  watch?: string;
}) {
  const scene = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const [layers, setLayers] = useState<{ url: string; id: number }[]>(() =>
    art ? [{ url: art, id: 0 }] : [],
  );
  const current = useRef(art);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = (url?: string) => {
    if (!url || url === current.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      current.current = url;
      setLayers((value) => [...value.slice(-1), { url, id: Date.now() }]);
    }, 140);
  };
  useEffect(() => show(art), [art]);
  useEffect(() => {
    const read = window.setTimeout(() => {
      const card = root.current?.querySelector<HTMLElement>(
        ".tv-game-grid > button.focused, .tv-catalog-grid > button.focused",
      );
      show(card?.querySelector("img")?.currentSrc || undefined);
    }, 900);
    return () => window.clearTimeout(read);
  }, [watch, root]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const pick = (event: Event) => {
      const card = (event.target as Element | null)?.closest?.(cardSelector);
      if (!card) return;
      show(
        card.getAttribute("data-art") ||
          card.querySelector("img")?.currentSrc ||
          undefined,
      );
    };
    element.addEventListener("focusin", pick);
    element.addEventListener("mouseover", pick);
    return () => {
      clearTimeout(timer.current);
      element.removeEventListener("focusin", pick);
      element.removeEventListener("mouseover", pick);
    };
  }, [root]);
  // Focus moves the scene sideways; the pointer adds a little on both axes.
  useEffect(() => {
    if (focus !== undefined) target.current.x = (focus - 0.5) * 2;
  }, [focus]);
  useEffect(() => {
    if (!motionEnabled()) return;
    let frame = 0;
    const position = { x: 0, y: 0 };
    const pointer = { x: 0, y: 0 };
    const move = (event: PointerEvent) => {
      pointer.x = (event.clientX / window.innerWidth - 0.5) * 2;
      pointer.y = (event.clientY / window.innerHeight - 0.5) * 2;
    };
    const step = () => {
      const x = Math.max(-1, Math.min(1, target.current.x + pointer.x * 0.5));
      const y = Math.max(-1, Math.min(1, pointer.y * 0.6));
      position.x += (x - position.x) * 0.06;
      position.y += (y - position.y) * 0.06;
      scene.current?.style.setProperty("--px", position.x.toFixed(4));
      scene.current?.style.setProperty("--py", position.y.toFixed(4));
      frame = requestAnimationFrame(step);
    };
    window.addEventListener("pointermove", move);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
    };
  }, []);
  return (
    <div
      ref={scene}
      className={`ps-backdrop ps-theme-${theme}`}
      aria-hidden="true"
    >
      {theme === "art" ? (
        <ArtScene layers={layers} />
      ) : theme === "custom" ? (
        <PictureScene url={picture} />
      ) : (
        <BuiltInScene theme={theme} />
      )}
      <div className="ps-shade" />
    </div>
  );
}

function BuiltInScene({ theme }: { theme: ConsoleTheme }) {
  const scene = consoleThemes.find((item) => item.id === theme)?.scene;
  if (scene?.kind === "photo") return <PhotoScene scene={scene} />;
  if (scene?.kind === "layers") return <LayersScene scene={scene} />;
  return theme === "pixel" ? <PixelScene /> : <WaveScene />;
}

function PhotoScene({ scene }: { scene: PhotoScene }) {
  return (
    <>
      <Layer depth={0.2} className="ps-art-base" />
      <Layer depth={0.6} className="ps-photo">
        <img
          src={scene.src}
          alt=""
          draggable={false}
          style={{ objectPosition: scene.position }}
        />
      </Layer>
      {scene.particles && (
        <Layer depth={1.1} className="ps-scene">
          <Particles
            kind={scene.particles}
            count={scene.particles === "snow" ? 60 : 30}
            seed={7}
          />
        </Layer>
      )}
    </>
  );
}

function LayersScene({ scene }: { scene: LayeredScene }) {
  return (
    <>
      <Layer
        depth={0}
        className="ps-scene"
        style={{ background: scene.base }}
      />
      {scene.layers.map((layer) => (
        <Layer
          key={layer.src}
          depth={layer.depth}
          className="ps-pixel-layer"
          style={{
            backgroundImage: `url("${layer.src}")`,
            backgroundSize: layer.size,
            backgroundPosition: layer.position,
            backgroundRepeat: layer.repeat === false ? "no-repeat" : undefined,
          }}
        />
      ))}
    </>
  );
}

function ArtScene({ layers }: { layers: { url: string; id: number }[] }) {
  return (
    <>
      <Layer depth={0.2} className="ps-art-base" />
      <Layer depth={0.5} className="ps-art">
        {layers.map((layer, index) => (
          <img
            key={layer.id}
            className={index === layers.length - 1 ? "current" : "previous"}
            src={layer.url}
            alt=""
            referrerPolicy="no-referrer"
            draggable={false}
          />
        ))}
      </Layer>
      <Layer depth={1} className="ps-motes" />
    </>
  );
}

function PictureScene({ url }: { url?: string }) {
  return (
    <>
      <Layer depth={0.2} className="ps-art-base" />
      <Layer depth={0.6} className="ps-picture">
        {url && <img key={url} src={url} alt="" draggable={false} />}
      </Layer>
      <Layer depth={1.1} className="ps-motes" />
    </>
  );
}

const wavePath = (amplitude: number, offset: number) => {
  // Two periods across a 2400-wide tile, so sliding by half repeats it.
  let d = `M0 ${300 + offset}`;
  for (let x = 0; x <= 2400; x += 300)
    d += ` Q${x + 150} ${300 + offset + (x % 600 ? amplitude : -amplitude)} ${x + 300} ${300 + offset}`;
  return `${d} V600 H0 Z`;
};

function WaveScene() {
  const waves = useMemo(
    () => [
      { depth: 0.15, d: wavePath(70, -40), speed: 46 },
      { depth: 0.35, d: wavePath(54, 20), speed: 34 },
      { depth: 0.6, d: wavePath(40, 70), speed: 24 },
      { depth: 0.9, d: wavePath(30, 120), speed: 17 },
    ],
    [],
  );
  return (
    <>
      <Layer depth={0.05} className="ps-waves-sky" />
      {waves.map((wave, index) => (
        <Layer key={index} depth={wave.depth} className="ps-wave">
          <svg
            viewBox="0 0 2400 600"
            preserveAspectRatio="none"
            style={{ "--speed": `${wave.speed}s` } as CSSProperties}
          >
            <path d={wave.d} />
          </svg>
        </Layer>
      ))}
      <Layer depth={1.2} className="ps-motes" />
    </>
  );
}

/** The pixel valley of OpenRetro's promo art, split into depth layers. */
function PixelScene() {
  const svg = (children: ReactNode) => (
    <svg
      viewBox="0 0 640 400"
      preserveAspectRatio="xMidYMax slice"
      shapeRendering="crispEdges"
    >
      {children}
    </svg>
  );
  return (
    <>
      <Layer depth={0.04} className="ps-pixel">
        {svg(
          <>
            <path fill="#17263f" d="M0 0h640v400H0z" />
            <path fill="#203252" d="M0 112h640v288H0z" />
            <path fill="#2b4160" d="M0 194h640v206H0z" />
            {[
              [36, 38],
              [104, 74],
              [166, 30],
              [230, 96],
              [310, 48],
              [382, 24],
              [554, 40],
              [598, 102],
              [450, 126],
              [80, 132],
              [346, 110],
            ].map(([x, y]) => (
              <path
                key={`${x}-${y}`}
                className="ps-twinkle"
                fill="#9cb7c5"
                d={`M${x} ${y}h4v4h-4z`}
              />
            ))}
            <path fill="#f2dfb0" d="M472 46h32v8h8v32h-8v8h-32v-8h-8V54h8z" />
            <path fill="#17263f" d="M490 42h18v8h8v26h-8v8h-18v-8h-8V50h8z" />
          </>,
        )}
      </Layer>
      <Layer depth={0.18} className="ps-pixel">
        {svg(
          <>
            <path
              fill="#3e5671"
              d="M0 228v-40h28v-20h24v-20h32v-24h32v24h24v28h32v20h36v32h44v-20h32v-32h24v-24h24v-22h32v22h24v24h28v32h32v-16h28v-24h24v-22h32v-18h24v18h28v24h24v24h40v18h32v-24h24v-20h28v-20h28v104H0z"
            />
            <path
              fill="#78909b"
              d="M52 148h32v-24h32v24h24v12h-32v-12H84v12H52zM308 176v-24h24v-22h32v22h24v12h-32v-12h-12v24zM496 172v-22h32v-18h24v18h28v12h-28v-12h-12v22z"
            />
          </>,
        )}
      </Layer>
      <Layer depth={0.36} className="ps-pixel">
        {svg(
          <>
            <path
              fill="#243b47"
              d="M0 256v-24h32v-16h36v16h40v20h40v-12h32v-20h36v20h36v28h40v-16h36v-20h40v20h40v-12h40v-20h48v20h48v-16h36v-20h40v20h32v20h40v-12h36v168H0z"
            />
            <path
              fill="#7a7f85"
              d="M370 162h18v-14h12v14h18v-14h12v14h18v94h-78z"
            />
            <path
              fill="#a7a79a"
              d="M370 174h78v8h-78zM378 196h12v6h-12zM408 184h12v6h-12zM430 210h12v6h-12zM386 226h12v6h-12z"
            />
            <path
              fill="#33434e"
              d="M394 210h22v46h-22zM386 184h8v14h-8zM426 184h8v14h-8z"
            />
            <path fill="#f2bc79" d="M400 220h10v36h-10z" />
            <path fill="#87c8bc" d="M410 134h4v-30h-4z" />
            <path fill="#e5a68c" d="M414 104h28v8h-8v8h-20z" />
          </>,
        )}
      </Layer>
      <Layer depth={0.55} className="ps-pixel">
        {svg(
          <path
            fill="#0e2633"
            d="M0 300v-16h40v-24h32v20h36v16h52v-28h32v-16h40v16h32v40h36v-12h36v-24h36v-16h40v16h36v28h40v-16h44v-16h40v24h36v12h40v-24h40v-16h32v156H0z"
          />,
        )}
      </Layer>
      <Layer depth={0.8} className="ps-pixel">
        {svg(
          <>
            <path
              fill="#425849"
              d="M0 330h104v-16h96v-16h104v-14h152v-12h88v16h96v112H0z"
            />
            <path
              fill="#78aa85"
              d="M0 322h104v-16h96v-16h104v-14h152v-12h88v16h96v12h-96v-16h-88v12H304v14H200v16h-96v16H0z"
            />
            <path
              fill="#6b513f"
              d="M0 338h104v-16h96v-16h104v-14h152v-12h88v16h96v104H0z"
            />
            <path
              fill="#453d37"
              d="M0 364h64v-12h64v-14h80v-12h88v-14h64v88H0zM504 312h64v16h72v72H472v-72h32z"
            />
            <path
              fill="#4f96a4"
              d="M380 292h36v20h-12v24h24v24h-28v20h-24v20h-90v-16h48v-24h24v-24h-12v-24h34z"
            />
            <path
              fill="#94d7cf"
              d="M380 292h12v24h-12v20h-22v-12h22zM370 344h22v8h-22zM334 374h30v6h-30zM292 394h38v6h-38z"
            />
            {[
              [42, 268, 1],
              [128, 246, 0.8],
              [550, 230, 1.2],
              [600, 252, 0.85],
            ].map(([x, y, scale]) => (
              <g key={x} transform={`translate(${x} ${y}) scale(${scale})`}>
                <path
                  fill="#163732"
                  d="M16 0h8v12h8v12h8v12h8v12H0V36h8V24h8z"
                />
                <path
                  fill="#497c68"
                  d="M16 0h8v12h-8zM8 24h24v6H8zM0 42h40v6H0z"
                />
                <path fill="#584333" d="M20 48h8v20h-8z" />
              </g>
            ))}
            <path
              fill="#2b5547"
              d="M0 384h48v-12h32v12h24v16H0zM552 388h24v-16h40v12h24v16h-88z"
            />
          </>,
        )}
      </Layer>
    </>
  );
}

/** A small picture of each theme for the theme picker: the scene itself. */
export function ThemePreview({
  theme,
  picture,
}: {
  theme: ConsoleTheme;
  picture?: string;
}) {
  return (
    <span className={`ps-theme-preview ps-theme-${theme}`} aria-hidden="true">
      {picture ? (
        <img src={picture} alt="" draggable={false} />
      ) : theme === "art" ? (
        <i />
      ) : (
        <BuiltInScene theme={theme} />
      )}
    </span>
  );
}
