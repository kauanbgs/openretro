import { useId } from "react";
const themes: Record<string, string[]> = {
  astral: ["#17152e", "#59529b", "#c987ac", "#eeaa8d", "#29263e"],
  verdant: ["#172f33", "#547d6a", "#bfba81", "#e3cf94", "#1d3b3c"],
  velocity: ["#221a3d", "#785070", "#f69580", "#f9c4a4", "#2a2546"],
  moonfall: ["#121f3a", "#365481", "#8aaac1", "#e3d9bd", "#1a2946"],
  pocket: ["#27352b", "#64764b", "#b1bc75", "#d9dba7", "#34432e"],
  solar: ["#2e203d", "#86516c", "#e99d75", "#f6d49e", "#362943"],
  drift: ["#163638", "#4c8b92", "#a4ced0", "#f5e0b9", "#25494c"],
};
export function Artwork({
  kind = "astral",
  className = "",
  title = false,
}: {
  kind?: string;
  className?: string;
  title?: boolean;
}) {
  const id = useId().replaceAll(":", "");
  const t = themes[kind] ?? themes.astral;
  const city = kind === "velocity" || kind === "drift";
  const forest = kind === "verdant" || kind === "pocket";
  return (
    <div className={`artwork art-${kind} ${className}`} aria-hidden="true">
      <svg viewBox="0 0 1000 650" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id={`${id}-sky`} x2="0" y2="1">
            <stop stopColor={t[0]} />
            <stop offset=".65" stopColor={t[1]} />
            <stop offset="1" stopColor={t[2]} />
          </linearGradient>
          <radialGradient id={`${id}-glow`}>
            <stop stopColor={t[3]} stopOpacity=".5" />
            <stop offset="1" stopColor={t[2]} stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`${id}-land`} x2="0" y2="1">
            <stop stopColor={t[2]} />
            <stop offset="1" stopColor={t[4]} />
          </linearGradient>
        </defs>
        <rect width="1000" height="650" fill={`url(#${id}-sky)`} />
        <ellipse
          cx="660"
          cy="360"
          rx="510"
          ry="300"
          fill={`url(#${id}-glow)`}
        />
        {Array.from({ length: 53 }, (_, i) => (
          <circle
            key={i}
            cx={(i * 179 + 37) % 1000}
            cy={(i * 97 + 19) % 360}
            r={i % 5 === 0 ? 1.7 : 0.8}
            fill="#f5e7da"
            opacity={0.25 + (i % 4) * 0.17}
          />
        ))}
        <circle
          cx="715"
          cy="206"
          r={forest ? 68 : 97}
          fill={t[3]}
          opacity=".85"
        />
        <circle
          cx="684"
          cy="180"
          r="96"
          fill={t[1]}
          opacity={forest ? 0 : 0.78}
        />
        {!forest && !city && (
          <g stroke={t[3]} fill="none" opacity=".32">
            <ellipse
              cx="720"
              cy="210"
              rx="178"
              ry="21"
              transform="rotate(-25 720 210)"
            />
            <path d="M875 75L956 44M904 89L931 78" />
          </g>
        )}
        <path
          d="M0 443L113 337L177 386L289 290L383 398L475 315L582 405L688 299L782 371L876 270L1000 366V650H0Z"
          fill={t[1]}
        />
        <path
          d="M0 474L110 421L197 469L309 370L370 404L414 390L521 463L644 364L737 442L827 384L1000 449V650H0Z"
          fill={`url(#${id}-land)`}
        />
        <path
          d="M0 534L169 465L261 512L397 445L503 533L602 480L737 532L833 469L1000 519V650H0Z"
          fill={t[4]}
          opacity=".78"
        />
        {forest && (
          <g fill={t[4]}>
            {[20, 90, 160, 830, 900, 980].map((x, i) => (
              <path
                key={x}
                d={`M${x} 210 l${-30 - i * 3} 180 h22 l-46 90 h49 v110 h12 V480 h44 l-39-90 h20Z`}
              />
            ))}
          </g>
        )}
        {city && (
          <g fill={t[4]}>
            {[30, 90, 160, 230, 740, 810, 885, 950].map((x, i) => (
              <g key={x}>
                <rect x={x} y={310 + (i % 3) * 34} width="42" height="230" />
                <path
                  d={`M${x + 12} ${310 + (i % 3) * 34}v-35`}
                  stroke={t[4]}
                  strokeWidth="4"
                />
                {[0, 1, 2, 3].map((n) => (
                  <rect
                    key={n}
                    x={x + 9}
                    y={335 + (i % 3) * 34 + n * 28}
                    width="6"
                    height="9"
                    fill={t[2]}
                    opacity=".6"
                  />
                ))}
              </g>
            ))}
            <path
              d="M422 650L555 460H587L703 650"
              fill="#c88a87"
              opacity=".65"
            />
            <path
              d="M560 650L576 473"
              stroke={t[3]}
              strokeWidth="3"
              strokeDasharray="35 30"
            />
          </g>
        )}
        <path
          d="M0 597L140 555L261 583L355 555L452 598L588 573L716 605L850 560L1000 586V650H0Z"
          fill={t[0]}
        />
        {!city && (
          <g transform="translate(695 472)">
            <ellipse
              cx="11"
              cy="99"
              rx="39"
              ry="8"
              fill="#0b111d"
              opacity=".4"
            />
            <path
              d="M-2 29L-13 68L-9 104H0L7 68L15 104H25L28 63L20 29Z"
              fill="#ded2c6"
            />
            <rect x="-14" y="29" width="16" height="35" rx="4" fill={t[2]} />
            <circle cx="11" cy="15" r="18" fill="#e2d9d0" />
            <path d="M-1 6Q24-1 26 15Q22 29 3 24Z" fill={t[0]} />
            <path
              d="M19 34L37 60"
              stroke="#ded2c6"
              strokeWidth="10"
              strokeLinecap="round"
            />
            <path
              d="M-7 36L-22 60"
              stroke="#ded2c6"
              strokeWidth="9"
              strokeLinecap="round"
            />
            <path d="M-3 30L17 35" stroke={t[2]} strokeWidth="4" />
          </g>
        )}
      </svg>
      {title && (
        <div className="cover-lettering">
          <span>OPENRETRO ORIGINALS</span>
          <strong>
            {kind === "astral" ? (
              <>
                ASTRAL
                <br />
                HORIZON
              </>
            ) : kind === "verdant" ? (
              <>
                THE VERDANT
                <br />
                QUEST
              </>
            ) : kind === "velocity" ? (
              <>
                VELOCITY<span className="big-number">98</span>
              </>
            ) : kind === "moonfall" ? (
              "MOONFALL"
            ) : kind === "pocket" ? (
              <>
                POCKET
                <br />
                ODYSSEY
              </>
            ) : kind === "solar" ? (
              <>
                SOLAR
                <br />
                STRIKE
              </>
            ) : (
              <>
                DRIFT
                <br />
                COAST
              </>
            )}
          </strong>
          <small>FICTIONAL GAME · DEVELOPMENT ART</small>
        </div>
      )}
    </div>
  );
}
