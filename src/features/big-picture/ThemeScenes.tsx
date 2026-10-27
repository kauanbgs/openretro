import { useMemo, type CSSProperties, type ReactNode } from "react";

/** One layer of a scene; `depth` sets how far it moves with the parallax. */
export function Layer({
  depth,
  className,
  style,
  children,
}: {
  depth: number;
  className: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <div
      className={`ps-layer ${className}`}
      style={{ ...style, "--depth": depth } as CSSProperties}
    >
      {children}
    </div>
  );
}

/** The same pseudo-random sequence on every render, so scenes never jump. */
function sequence(seed: number) {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
}

/** Falling or drifting bits: snow, leaves or embers. */
export function Particles({
  kind,
  count,
  seed,
}: {
  kind: "snow" | "leaves" | "embers";
  count: number;
  seed: number;
}) {
  const items = useMemo(() => {
    const random = sequence(seed);
    return Array.from({ length: count }, () => ({
      "--x": `${(random() * 100).toFixed(1)}%`,
      "--size": `${(kind === "leaves" ? 8 : 2) + random() * (kind === "leaves" ? 8 : 4)}px`,
      "--duration": `${(kind === "snow" ? 9 : kind === "leaves" ? 11 : 14) + random() * 10}s`,
      "--delay": `${-(random() * 20).toFixed(1)}s`,
      "--sway": `${((random() - 0.5) * 160).toFixed(0)}px`,
      "--spin": `${(360 + random() * 720).toFixed(0)}deg`,
      "--hue": `${(random() * 40).toFixed(0)}deg`,
    }));
  }, [count, seed, kind]);
  return (
    <div className={`ps-particles ps-particles-${kind}`}>
      {items.map((style, index) => (
        <i key={index} style={style as CSSProperties} />
      ))}
    </div>
  );
}
