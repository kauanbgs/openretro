import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  Sequence,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { copy, type Copy, type Lang } from "./copy";
import { PixelLandscape } from "./PixelLandscape";

export type PromoProps = { lang: Lang };

const C = {
  ink: "#0c1422",
  deep: "#070d16",
  panel: "#162739",
  edge: "#4b6b6b",
  paper: "#f4eddc",
  mint: "#8be0c2",
  peach: "#ffbc91",
  lilac: "#b6a2f6",
  muted: "#a4b2be",
};
const PIXEL = "Pixel, monospace";
const BODY = "Body, 'Segoe UI', sans-serif";

// Scene boundaries in frames (30 fps, 15 s total).
const CUTS = [0, 60, 135, 210, 285, 360, 450];

const out = Easing.bezier(0.2, 0.8, 0.2, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const step = (v: number, s: number) => Math.round(v / s) * s;
const ramp = (f: number, a: number, b: number) =>
  interpolate(f, [a, b], [0, 1], { ...clamp, easing: out });
/** Types text on while reserving its final layout, so lines never reflow. */
const typed = (text: string, f: number, start: number, perChar = 1) => {
  const n = Math.max(0, Math.floor((f - start) / perChar));
  return (
    <>
      {text.slice(0, n)}
      <span style={{ visibility: "hidden" }}>{text.slice(n)}</span>
    </>
  );
};
/** Splits a tagline half before its last word: "em boa" / "companhia." */
const splitLast = (text: string) => {
  const i = text.lastIndexOf(" ");
  return [text.slice(0, i), text.slice(i + 1)];
};
/** 9:16 renders stack text over visuals; 16:9 puts them side by side. */
const useVertical = () => {
  const { width, height } = useVideoConfig();
  return height > width;
};
// Horizontal center for vertical content, nudged left of TikTok's action icons.
const SAFE_CX = 500;

/** Positions a visual: absolute on the right in 16:9, centered and scaled in 9:16. */
function Place({
  h,
  top,
  width,
  scale,
  children,
}: {
  h: CSSProperties;
  top: number;
  width: number;
  scale: number;
  children: ReactNode;
}) {
  const v = useVertical();
  const style: CSSProperties = v
    ? { position: "absolute", left: SAFE_CX - (width * scale) / 2, top, width, transform: `scale(${scale})`, transformOrigin: "top left" }
    : { position: "absolute", ...h };
  return <div style={style}>{children}</div>;
}

const rand = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ---------- Logo, as individual pixels so it can assemble ---------- */

const LOGO_PATHS = [
  {
    fill: "#2e2866",
    d: "M8 1h1v1h-1zM7 2h1v1h-1zM9 2h1v1h-1zM6 3h1v2h-1zM10 3h1v2h-1zM2 5h4v1h-4zM11 5h4v1h-4zM1 6h1v1h-1zM15 6h1v1h-1zM2 7h1v1h-1zM14 7h1v1h-1zM3 8h1v1h-1zM13 8h1v1h-1zM4 9h1v2h-1zM12 9h1v2h-1zM8 11h1v1h-1zM7 12h1v1h-1zM9 12h1v1h-1zM6 13h1v1h-1zM10 13h1v1h-1zM3 11h1v4h-1zM13 11h1v4h-1zM5 14h1v1h-1zM11 14h1v1h-1zM4 15h1v1h-1zM12 15h1v1h-1z",
  },
  {
    fill: "#12ace2",
    d: "M8 2h1v1h-1zM7 3h3v2h-3zM6 5h5v1h-5zM2 6h13v1h-13zM3 7h11v1h-11zM4 8h9v1h-9zM5 9h7v2h-7zM4 11h4v1h-4zM9 11h4v1h-4zM4 12h3v1h-3zM10 12h3v1h-3zM4 13h2v1h-2zM11 13h2v1h-2zM4 14h1v1h-1zM12 14h1v1h-1z",
  },
];
const LOGO_CELLS = LOGO_PATHS.flatMap(({ fill, d }) =>
  [...d.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)/g)].flatMap(([, x, y, w, h]) =>
    Array.from({ length: +w * +h }, (_, i) => ({
      x: +x - 1 + (i % +w),
      y: +y - 1 + Math.floor(i / +w),
      fill,
    })),
  ),
);

function Logo({ cell, f, assemble = true }: { cell: number; f: number; assemble?: boolean }) {
  return (
    <div style={{ position: "relative", width: cell * 15, height: cell * 15 }}>
      {LOGO_CELLS.map((c, i) => {
        const delay = Math.hypot(c.x - 7, c.y - 7) * 1.3 + rand(i) * 4;
        const p = assemble ? ramp(f, delay, delay + 8) : 1;
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: c.x * cell,
              top: c.y * cell + step((1 - p) * -90, cell / 2),
              width: cell,
              height: cell,
              background: c.fill,
              opacity: p > 0 ? 1 : 0,
              transform: `scale(${0.4 + 0.6 * p})`,
            }}
          />
        );
      })}
    </div>
  );
}

/* ---------- Shared chrome ---------- */

function Backdrop() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: C.ink, overflow: "hidden" }}>
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${C.mint}2e 2px, transparent 2px)`,
          backgroundSize: "36px 36px",
          backgroundPosition: `${step(f * 0.6, 4)}px 0px`,
        }}
      />
      {Array.from({ length: 24 }, (_, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            left: `${(i * 37 + 7) % 100}%`,
            top: `${(((i * 19 + 11) % 100) + 100 - step(f * 0.08 * (1 + (i % 3)), 0.5)) % 100}%`,
            fontFamily: PIXEL,
            fontSize: 28,
            color: "#2b3b49",
          }}
        >
          {["+", "×", "□", "○"][i % 4]}
        </span>
      ))}
    </AbsoluteFill>
  );
}

function Scanlines() {
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        background:
          "repeating-linear-gradient(0deg, #00000000 0px, #00000000 3px, #0000001c 3px, #0000001c 4px), radial-gradient(ellipse at center, #00000000 60%, #00000066 100%)",
      }}
    />
  );
}

/*
 * Each cut has its own transition. All of them cover the whole frame exactly
 * on the cut, so the scene swap underneath is never visible. `t` runs from
 * -HALF (start covering) through 0 (the cut) to +HALF (fully revealed).
 */
const HALF = 10;
const COVER = "#1d3047";

type Wipe = (t: number, W: number, H: number) => ReactNode;

const block = (x: number, y: number, size: number, color: string, key: number) => (
  <div key={key} style={{ position: "absolute", left: x, top: y, width: size, height: size, background: color }} />
);

/** A grid of 60px cells, each on or off for a given cut-relative time. */
function cells(W: number, H: number, color: (col: number, row: number, i: number) => string | null) {
  const cols = W / 60;
  return Array.from({ length: cols * (H / 60) }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const c = color(col, row, i);
    return c ? block(col * 60, row * 60, 60, c, i) : null;
  });
}

/** Diamond iris closing on the center, then opening again. */
const iris: Wipe = (t, W, H) => {
  const r = t < 0 ? -t / HALF : t / HALF;
  const cx = W / 120;
  const cy = H / 120;
  return cells(W, H, (col, row) => {
    const d = (Math.abs(col + 0.5 - cx) / cx + Math.abs(row + 0.5 - cy) / cy) / 2;
    if (d < r * 1.05 - 0.05) return null;
    return d < r * 1.05 ? C.mint : COVER;
  });
};

/** Rows slide in from alternating sides and leave toward the far side. */
const blinds: Wipe = (t, W, H) =>
  Array.from({ length: H / 60 }, (_, row) => {
    const delay = (row * 4.25) / (H / 60 - 1);
    const grow = interpolate(t, [-HALF + delay, -HALF + delay + 5], [0, 1], clamp);
    const leave = interpolate(t, [delay, delay + 5], [0, 1], clamp);
    const from = step(leave * W, 60);
    const to = step(grow * W, 60);
    if (to <= from) return null;
    const left = row % 2 === 0 ? from : W - to;
    return (
      <div key={row} style={{ position: "absolute", top: row * 60, left, width: to - from, height: 60, background: row % 3 === 0 ? "#243b55" : COVER }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, width: 12, background: C.mint, [row % 2 === 0 ? "right" : "left"]: 0 }} />
      </div>
    );
  });

/** CRT switching channel: the picture collapses to a bright line, static, back on. */
const crt: Wipe = (t, W, H) => {
  const p = t < 0 ? ramp(t, -HALF, -2) : 1 - ramp(t, 3, HALF);
  const bar = step((H / 2) * p, 20);
  const line = step((W / 2) * (t < 0 ? 0 : ramp(t, 0, 3)), 20);
  const noise = t >= -2 && t < 4;
  return (
    <>
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: bar, background: C.deep }} />
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: bar, background: C.deep }} />
      {p > 0.6 && (
        <div
          style={{
            position: "absolute",
            top: H / 2 - 6,
            height: 12,
            left: line,
            right: line,
            background: C.paper,
            boxShadow: `0 0 40px ${C.mint}`,
          }}
        />
      )}
      {noise &&
        Array.from({ length: 140 }, (_, i) => {
          const v = rand(i * 13 + Math.floor(t + 20) * 977);
          const x = Math.floor(rand(i * 7 + Math.floor(t + 20) * 31) * (W / 30)) * 30;
          const y = Math.floor(v * (H / 30)) * 30;
          return block(x, y, 30, v > 0.7 ? "#3a4c5e" : "#17222f", i);
        })}
    </>
  );
};

/** Big blocks sweeping diagonally, with a mint leading edge. */
const diagonal: Wipe = (t, W, H) => {
  const cols = W / 120;
  const rows = H / 120;
  return Array.from({ length: cols * rows }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const o = ((col + row) / (cols + rows - 2)) * 8;
    const onAt = -HALF + o;
    const offAt = 1 + o;
    if (t < onAt || t >= offAt) return null;
    const edge = t < onAt + 0.6 || t >= offAt - 0.6;
    return block(col * 120, row * 120, 120, edge ? C.mint : COVER, i);
  });
};

/** Ordered dither dissolve: cells blink in at random and out at random. */
const dissolve: Wipe = (t, W, H) =>
  cells(W, H, (_, __, i) => {
    const inAt = -HALF + rand(i) * 8;
    const outAt = 1 + rand(i + 500) * 8;
    if (t < inAt || t >= outAt) return null;
    return rand(i + 900) > 0.96 ? C.peach : C.deep;
  });

const WIPES: Wipe[] = [iris, blinds, crt, diagonal, dissolve];

function Transitions() {
  const f = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const cuts = CUTS.slice(1, -1);
  const i = cuts.findIndex((b) => Math.abs(f - b) <= HALF);
  return (
    <AbsoluteFill style={{ pointerEvents: "none", overflow: "hidden" }}>
      {i >= 0 && WIPES[i](f - cuts[i], width, height)}
    </AbsoluteFill>
  );
}

function Frame({
  width,
  top,
  bottom,
  children,
  style,
}: {
  width: number;
  top?: ReactNode;
  bottom?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
}) {
  const bar: CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "14px 22px",
    fontFamily: PIXEL,
    fontSize: 22,
    color: "#b4cbc4",
  };
  return (
    <div
      style={{
        width,
        border: `4px solid ${C.edge}`,
        background: C.panel,
        boxShadow: `20px 20px 0 ${C.deep}`,
        ...style,
      }}
    >
      {top && <div style={{ ...bar, borderBottom: `4px solid ${C.edge}` }}>{top}</div>}
      <div style={{ position: "relative", overflow: "hidden" }}>{children}</div>
      {bottom && <div style={{ ...bar, borderTop: `4px solid ${C.edge}` }}>{bottom}</div>}
    </div>
  );
}

const Dot = ({ color = C.mint }: { color?: string }) => (
  <i
    style={{
      display: "inline-block",
      width: 14,
      height: 14,
      background: color,
      boxShadow: `0 0 14px ${color}88`,
      marginRight: 12,
    }}
  />
);

/* ---------- Scene 1: logo assembles ---------- */

function Intro({ t }: { t: Copy }) {
  const f = useCurrentFrame();
  const v = useVertical();
  const word = "OpenRetro";
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: 40, paddingBottom: v ? 200 : 0 }}>
      <div style={{ transform: `translateY(${step(Math.sin(f / 8) * 6, 3)}px)` }}>
        <Logo cell={22} f={f} />
      </div>
      <div style={{ fontFamily: PIXEL, fontSize: v ? 96 : 120, color: C.paper, height: 140 }}>
        {word.split("").map((ch, i) => {
          const p = ramp(f, 20 + i * 2, 26 + i * 2);
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                opacity: p > 0 ? 1 : 0,
                transform: `translateY(${step((1 - p) * 40, 8)}px)`,
                color: i >= 4 ? C.mint : C.paper,
              }}
            >
              {ch}
            </span>
          );
        })}
      </div>
      <div
        style={{
          fontFamily: PIXEL,
          fontSize: 26,
          color: C.muted,
          opacity: ramp(f, 40, 48),
          letterSpacing: 2,
        }}
      >
        {"> PRESS START_".slice(0, f % 16 < 10 ? 14 : 13)}
      </div>
    </AbsoluteFill>
  );
}

/* ---------- Scene 2: tagline + scenery ---------- */

function Hero({ t }: { t: Copy }) {
  const f = useCurrentFrame();
  const v = useVertical();
  const frameIn = ramp(f, 2, 22);
  return (
    <AbsoluteFill>
      <div style={v ? { position: "absolute", left: 70, top: 230, width: 880 } : { position: "absolute", left: 140, top: 200, width: 820 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            border: "2px solid #333045",
            color: "#b9adcf",
            fontFamily: BODY,
            fontSize: 24,
            padding: "8px 18px",
            opacity: ramp(f, 0, 6),
          }}
        >
          <Dot /> OpenRetro
        </div>
        <h1 style={{ fontFamily: PIXEL, fontWeight: 400, fontSize: v ? 88 : 80, lineHeight: 1.15, color: C.paper, margin: "36px 0", whiteSpace: "nowrap" }}>
          {[...splitLast(t.taglineA), ...splitLast(t.taglineB)].map((line, i, lines) => {
            const start = 4 + lines.slice(0, i).join("").length * 0.7;
            return (
              <div key={i} style={{ color: i >= lines.length / 2 ? C.mint : C.paper }}>
                {typed(line, f, start, 0.7)}
              </div>
            );
          })}
        </h1>
        <p
          style={{
            fontFamily: BODY,
            fontSize: v ? 36 : 32,
            lineHeight: 1.5,
            color: C.muted,
            margin: 0,
            opacity: ramp(f, 34, 44),
            transform: `translateY(${step((1 - ramp(f, 34, 44)) * 24, 6)}px)`,
          }}
        >
          {t.sub}
        </p>
      </div>
      <Place h={{ right: 130, top: 190 }} top={920} width={800} scale={0.95}>
      <div style={{ position: "relative", transform: `translateX(${step((1 - frameIn) * 1100, 20)}px)` }}>
        <Frame
          width={800}
          top={
            <>
              <span>
                <Dot /> {t.frameTop}
              </span>
              <span>J1 + J2</span>
            </>
          }
          bottom={<span style={{ fontFamily: BODY, fontSize: 24 }}>{t.frameBottom}</span>}
        >
          <div style={{ height: 500, transform: `scale(${1.08 - 0.08 * ramp(f, 0, 75)})` }}>
            <PixelLandscape />
          </div>
        </Frame>
        <div
          style={{
            position: "absolute",
            right: -40,
            bottom: -40,
            background: C.peach,
            border: "4px solid #e6ac88",
            color: "#3a302a",
            fontFamily: PIXEL,
            fontSize: 22,
            padding: "14px 20px",
            boxShadow: `8px 8px ${C.deep}`,
            transform: `rotate(-4deg) scale(${ramp(f, 30, 38)})`,
          }}
        >
          ♥ 2P
        </div>
      </div>
      </Place>
    </AbsoluteFill>
  );
}

/* ---------- Feature scenes ---------- */

function FeatureText({ t, index }: { t: Copy; index: number }) {
  const f = useCurrentFrame();
  const feat = t.features[index];
  const [a, b] = feat.title;
  const v = useVertical();
  return (
    <div style={v ? { position: "absolute", left: 70, top: 240, width: 880 } : { position: "absolute", left: 140, top: 300, width: 760 }}>
      <div style={{ fontFamily: PIXEL, fontSize: 26, color: C.mint, opacity: ramp(f, 0, 6) }}>
        0{index + 1} / 03 <span style={{ color: "#4b6b6b" }}>·</span>{" "}
        <span style={{ color: C.peach }}>{feat.kicker}</span>
      </div>
      <h2 style={{ fontFamily: PIXEL, fontWeight: 400, fontSize: 80, lineHeight: 1.2, color: C.paper, margin: "32px 0" }}>
        {typed(a, f, 3, 0.7)}
        <br />
        {typed(b, f, 3 + a.length * 0.7, 0.7)}
      </h2>
      <p
        style={{
          fontFamily: BODY,
          fontSize: v ? 36 : 32,
          lineHeight: 1.5,
          color: C.muted,
          margin: 0,
          opacity: ramp(f, 26, 36),
        }}
      >
        {feat.desc}
      </p>
    </div>
  );
}

const CARTS = [
  ["#2b4160", "#78aa85", "#f2dfb0"],
  ["#463c53", "#e5a68c", "#ffbc91"],
  ["#17263f", "#4f96a4", "#94d7cf"],
  ["#3e2b3a", "#b6a2f6", "#f4eddc"],
  ["#203252", "#f2bc79", "#ffdca8"],
  ["#243b47", "#8be0c2", "#f4eddc"],
  ["#4a2f2f", "#ce946c", "#edc984"],
  ["#1d3047", "#9cb7c5", "#cabaff"],
];

function LibraryVisual({ t }: { t: Copy }) {
  const f = useCurrentFrame();
  const cursor = f < 24 ? 0 : f < 34 ? 1 : f < 44 ? 2 : 6;
  const picked = f >= 52;
  return (
    <Place h={{ right: 130, top: 180 }} top={760} width={860} scale={0.98}>
    <div style={{ transform: `translateY(${step((1 - ramp(f, 0, 14)) * 700, 20)}px)` }}>
      <Frame
        width={860}
        top={
          <>
            <span>
              <Dot /> {t.library}
            </span>
            <span style={{ color: C.muted }}>08</span>
          </>
        }
        bottom={
          <span style={{ fontFamily: BODY, fontSize: 22 }}>
            <Kbd>←</Kbd> <Kbd>→</Kbd> {t.nav} &nbsp; <Kbd>Enter</Kbd> {t.play}
          </span>
        }
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 26, padding: 34 }}>
          {CARTS.map(([bg, hill, sun], i) => {
            const p = ramp(f, 4 + i * 1.5, 12 + i * 1.5);
            const on = i === cursor;
            return (
              <div
                key={i}
                style={{
                  height: 230,
                  background: bg,
                  position: "relative",
                  overflow: "hidden",
                  outline: on ? `6px solid ${C.mint}` : "none",
                  outlineOffset: 6,
                  boxShadow: on ? `0 0 30px ${C.mint}66` : `8px 8px 0 ${C.deep}`,
                  opacity: p > 0 ? 1 : 0,
                  transform: `translateY(${step((1 - p) * 60, 10)}px) scale(${on && picked ? 1.06 : 1})`,
                }}
              >
                <div style={{ position: "absolute", left: 24 + (i % 3) * 30, top: 30, width: 36, height: 36, background: sun }} />
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 56, height: 50, background: hill, clipPath: "polygon(0 100%,0 40%,25% 40%,25% 0,55% 0,55% 50%,80% 50%,80% 20%,100% 20%,100% 100%)" }} />
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 56, background: "#0a0b12cc" }} />
                <div style={{ position: "absolute", left: 16, bottom: 22, width: 70 + (i % 3) * 18, height: 10, background: "#f4eddc99" }} />
              </div>
            );
          })}
        </div>
        {picked && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 22,
              textAlign: "center",
              fontFamily: PIXEL,
              fontSize: 30,
              color: C.ink,
            }}
          >
            <span style={{ background: C.mint, padding: "10px 24px", boxShadow: `6px 6px 0 ${C.deep}` }}>▶ {t.play}</span>
          </div>
        )}
      </Frame>
    </div>
    </Place>
  );
}

const Kbd = ({ children }: { children: ReactNode }) => (
  <span style={{ display: "inline-block", border: "2px solid #4b6b6b", padding: "0 10px", margin: "0 4px", fontFamily: PIXEL, fontSize: 18 }}>
    {children}
  </span>
);

function QR({ size }: { size: number }) {
  const n = 21;
  const cell = size / n;
  const finder = (x: number, y: number) =>
    [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx, fy]) => {
      const dx = x - fx;
      const dy = y - fy;
      if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return false;
      return dx === 0 || dy === 0 || dx === 6 || dy === 6 || (dx > 1 && dx < 5 && dy > 1 && dy < 5);
    });
  const inFinderZone = (x: number, y: number) =>
    (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
  return (
    <div style={{ position: "relative", width: size, height: size, background: C.paper }}>
      {Array.from({ length: n * n }, (_, i) => {
        const x = i % n;
        const y = Math.floor(i / n);
        const on = inFinderZone(x, y) ? finder(x, y) : rand(i + 7) > 0.52;
        return on ? (
          <div key={i} style={{ position: "absolute", left: x * cell, top: y * cell, width: cell + 0.5, height: cell + 0.5, background: C.ink }} />
        ) : null;
      })}
    </div>
  );
}

function PhoneVisual({ t }: { t: Copy }) {
  const f = useCurrentFrame();
  const scanned = f >= 30;
  const beam = ramp(f, 12, 28);
  return (
    <Place h={{ right: 130, top: 170 }} top={800} width={900} scale={0.9}>
    <div style={{ position: "relative", width: 900, height: 760 }}>
      {/* PC screen showing the pairing code */}
      <div style={{ position: "absolute", left: 0, top: 120, transform: `translateX(${step((1 - ramp(f, 0, 12)) * -300, 20)}px)`, opacity: ramp(f, 0, 6) }}>
        <Frame width={420} top={<span><Dot /> PC</span>}>
          <div style={{ padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            <QR size={240} />
            <span style={{ fontFamily: BODY, fontSize: 22, color: C.muted }}>{t.scan}</span>
          </div>
        </Frame>
        <div style={{ width: 120, height: 40, background: C.edge, margin: "0 auto" }} />
        <div style={{ width: 240, height: 16, background: C.edge, margin: "0 auto" }} />
      </div>
      {/* Signal between devices */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            left: 436 + i * 26,
            top: 340,
            width: 24,
            height: 24,
            background: scanned ? C.mint : C.peach,
            opacity: beam > i / 4 ? (scanned ? 0.4 + 0.6 * (((f / 3 + i) % 4) < 1 ? 1 : 0.3) : 1) : 0,
          }}
        />
      ))}
      {/* Phone */}
      <div
        style={{
          position: "absolute",
          right: 20,
          top: 0,
          width: 340,
          height: 700,
          background: "#0a0b12",
          border: `6px solid ${C.edge}`,
          borderRadius: 40,
          boxShadow: `20px 20px 0 ${C.deep}`,
          padding: 18,
          transform: `translateY(${step((1 - ramp(f, 2, 16)) * 800, 20)}px) rotate(${scanned ? 0 : 3}deg)`,
          overflow: "hidden",
        }}
      >
        <div style={{ width: 80, height: 10, background: "#2b3b49", margin: "6px auto 16px", borderRadius: 5 }} />
        {!scanned ? (
          <div style={{ height: 600, background: "#111a26", borderRadius: 20, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <div style={{ width: 220, height: 220, border: `6px dashed ${C.peach}` }} />
            <div style={{ position: "absolute", left: 50, right: 50, top: 190 + beam * 200, height: 6, background: C.peach, boxShadow: `0 0 20px ${C.peach}` }} />
          </div>
        ) : (
          <div style={{ height: 600, borderRadius: 20, overflow: "hidden", background: C.panel }}>
            <div style={{ height: 260, overflow: "hidden" }}>
              <div style={{ width: 416, height: 260, marginLeft: -56, transform: `translateX(${-step((f - 30) * 1.5, 4)}px)` }}>
                <PixelLandscape />
              </div>
            </div>
            <div style={{ position: "relative", height: 340 }}>
              {/* d-pad */}
              <div style={{ position: "absolute", left: 50, top: 100, width: 120, height: 40, background: C.edge }} />
              <div style={{ position: "absolute", left: 90, top: 60, width: 40, height: 120, background: C.edge }} />
              {[
                [190, 70, C.mint, "A"],
                [214, 140, C.peach, "B"],
              ].map(([x, y, col, l], i) => {
                const pressed = Math.floor((f - 30) / 6) % 2 === i;
                return (
                  <div
                    key={l as string}
                    style={{
                      position: "absolute",
                      left: x as number,
                      top: y as number,
                      width: 60,
                      height: 60,
                      borderRadius: 30,
                      background: col as string,
                      color: C.ink,
                      fontFamily: PIXEL,
                      fontSize: 24,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transform: `scale(${pressed ? 0.88 : 1})`,
                    }}
                  >
                    {l}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
    </Place>
  );
}

function PartyVisual({ t, lang }: { t: Copy; lang: Lang }) {
  const f = useCurrentFrame();
  const P = lang === "pt" ? "J" : "P";
  const browserIn = ramp(f, 14, 26);
  const joined = f >= 30;
  const badge = (color: string, p: number): CSSProperties => ({
    position: "absolute",
    fontFamily: PIXEL,
    fontSize: 24,
    color: C.ink,
    background: color,
    padding: "10px 18px",
    boxShadow: `6px 6px 0 ${C.deep}`,
    transform: `scale(${p})`,
  });
  return (
    <Place h={{ right: 130, top: 170 }} top={820} width={820} scale={0.92}>
    <div style={{ position: "relative" }}>
      <div style={{ transform: `translateX(${step((1 - ramp(f, 0, 14)) * 1100, 20)}px)` }}>
        <Frame
          width={820}
          top={
            <>
              <span>
                <Dot /> {t.party}
              </span>
              <span>
                {P}1 {joined ? `+ ${P}2` : ""}
              </span>
            </>
          }
        >
          <div style={{ height: 512 }}>
            <PixelLandscape />
          </div>
          <div style={{ ...badge(C.mint, ramp(f, 8, 14)), left: 330, top: 190 }}>{P}1</div>
          <div style={{ ...badge(C.peach, ramp(f, 30, 36)), left: 420, top: 190 }}>{P}2</div>
        </Frame>
      </div>
      {/* Friend's browser window */}
      <div
        style={{
          position: "absolute",
          right: -60,
          bottom: -130,
          width: 380,
          border: `4px solid ${C.peach}`,
          background: "#0a0b12",
          boxShadow: `14px 14px 0 ${C.deep}`,
          transform: `translateY(${step((1 - browserIn) * 500, 20)}px)`,
        }}
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "10px 14px", borderBottom: `4px solid ${C.peach}` }}>
          {[C.peach, "#e6ac88", "#6b513f"].map((c) => (
            <i key={c} style={{ width: 12, height: 12, background: c, display: "inline-block" }} />
          ))}
          <span style={{ marginLeft: 10, fontFamily: BODY, fontSize: 18, color: C.muted, background: "#1b192b", padding: "2px 12px", flex: 1 }}>
            openretro · party
          </span>
        </div>
        <div style={{ height: 230, overflow: "hidden" }}>
          <PixelLandscape />
        </div>
      </div>
      {/* Join toast */}
      <div
        style={{
          position: "absolute",
          left: -40,
          bottom: -110,
          fontFamily: BODY,
          fontSize: 26,
          color: C.paper,
          background: "#1b192b",
          border: `3px solid ${C.mint}`,
          padding: "14px 22px",
          boxShadow: `8px 8px 0 ${C.deep}`,
          opacity: ramp(f, 32, 38),
          transform: `translateY(${step((1 - ramp(f, 32, 40)) * 30, 6)}px)`,
          display: "flex",
          alignItems: "center",
        }}
      >
        <Dot /> {t.joined}
      </div>
    </div>
    </Place>
  );
}

function Feature({ t, lang, index }: { t: Copy; lang: Lang; index: number }) {
  return (
    <AbsoluteFill>
      <FeatureText t={t} index={index} />
      {index === 0 && <LibraryVisual t={t} />}
      {index === 1 && <PhoneVisual t={t} />}
      {index === 2 && <PartyVisual t={t} lang={lang} />}
    </AbsoluteFill>
  );
}

/* ---------- Scene 6: call to action ---------- */

function Outro({ t }: { t: Copy }) {
  const f = useCurrentFrame();
  const v = useVertical();
  const pressed = f >= 48 && f < 54;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", paddingBottom: v ? 260 : 0 }}>
      <div style={{ display: "flex", flexDirection: v ? "column" : "row", alignItems: "center", gap: 40, transform: `scale(${0.9 + 0.1 * ramp(f, 0, 14)})` }}>
        <Logo cell={v ? 18 : 14} f={f + 6} />
        <div style={{ fontFamily: PIXEL, fontSize: v ? 104 : 130, color: C.paper }}>
          Open<span style={{ color: C.mint }}>Retro</span>
        </div>
      </div>
      <h2 style={{ fontFamily: PIXEL, fontWeight: 400, fontSize: 52, lineHeight: 1.3, textAlign: "center", color: C.paper, margin: "50px 0 18px", opacity: ramp(f, 8, 16) }}>
        {t.taglineA}
        {v ? <br /> : " "}
        <span style={{ color: C.mint }}>{t.taglineB}</span>
      </h2>
      <p style={{ fontFamily: BODY, fontSize: 32, color: C.muted, margin: "8px 0 0", opacity: ramp(f, 14, 22) }}>{t.footnote}</p>
      <div
        style={{
          marginTop: 56,
          fontFamily: PIXEL,
          fontSize: 34,
          color: "#122b27",
          background: pressed ? "#b3f0d8" : C.mint,
          border: "2px solid #b8f0db",
          padding: "24px 44px",
          boxShadow: pressed
            ? "none"
            : "6px 0 #5da18c, -6px 0 #5da18c, 0 6px #468976, 0 -6px #c9f7e7, 12px 12px 0 #030409",
          opacity: ramp(f, 20, 26),
          transform: `translate(${pressed ? 6 : 0}px, ${(pressed ? 6 : 0) + step((1 - ramp(f, 20, 30)) * 40, 8)}px)`,
        }}
      >
        ▼ {t.button}
      </div>
      <div style={{ marginTop: 40, fontFamily: BODY, fontSize: 28, color: C.mint, opacity: ramp(f, 30, 38), letterSpacing: 1 }}>
        github.com/kauanbgs/openretro
      </div>
    </AbsoluteFill>
  );
}

/* ---------- Composition ---------- */

function useFonts() {
  const [handle] = useState(() => delayRender("Loading fonts"));
  useEffect(() => {
    const faces = [
      new FontFace("Pixel", `url(${staticFile("fonts/pixel.ttf")})`),
      new FontFace("Body", `url(${staticFile("fonts/body.woff2")})`, { weight: "200 1000" }),
    ];
    Promise.all(faces.map((face) => face.load()))
      .then((loaded) => loaded.forEach((face) => document.fonts.add(face)))
      .finally(() => continueRender(handle));
  }, [handle]);
}

export function Promo({ lang }: PromoProps) {
  useFonts();
  const t = copy[lang];
  const scenes = [
    <Intro t={t} />,
    <Hero t={t} />,
    <Feature t={t} lang={lang} index={0} />,
    <Feature t={t} lang={lang} index={1} />,
    <Feature t={t} lang={lang} index={2} />,
    <Outro t={t} />,
  ];
  return (
    <AbsoluteFill style={{ fontFamily: BODY }}>
      <Backdrop />
      {scenes.map((scene, i) => (
        <Sequence key={i} from={CUTS[i]} durationInFrames={CUTS[i + 1] - CUTS[i]}>
          {scene}
        </Sequence>
      ))}
      <Transitions />
      <Scanlines />
    </AbsoluteFill>
  );
}
