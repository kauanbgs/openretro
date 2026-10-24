/** Original scenery for OpenRetro, drawn on an integer grid. */
export function PixelLandscape() {
  return (
    <svg
      className="pixel-landscape"
      viewBox="0 0 640 400"
      fill="none"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
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
        <path key={`${x}-${y}`} fill="#9cb7c5" d={`M${x} ${y}h4v4h-4z`} />
      ))}
      <path fill="#f2dfb0" d="M472 46h32v8h8v32h-8v8h-32v-8h-8V54h8z" />
      <path fill="#17263f" d="M490 42h18v8h8v26h-8v8h-18v-8h-8V50h8z" />
      <path
        fill="#3e5671"
        d="M0 228v-40h28v-20h24v-20h32v-24h32v24h24v28h32v20h36v32h44v-20h32v-32h24v-24h24v-22h32v22h24v24h28v32h32v-16h28v-24h24v-22h32v-18h24v18h28v24h24v24h40v18h32v-24h24v-20h28v-20h28v104H0z"
      />
      <path
        fill="#78909b"
        d="M52 148h32v-24h32v24h24v12h-32v-12H84v12H52zM308 176v-24h24v-22h32v22h24v12h-32v-12h-12v24zM496 172v-22h32v-18h24v18h28v12h-28v-12h-12v22z"
      />
      <path
        fill="#243b47"
        d="M0 256v-24h32v-16h36v16h40v20h40v-12h32v-20h36v20h36v28h40v-16h36v-20h40v20h40v-12h40v-20h48v20h48v-16h36v-20h40v20h32v20h40v-12h36v168H0z"
      />
      <path
        fill="#0e2633"
        d="M0 300v-16h40v-24h32v20h36v16h52v-28h32v-16h40v16h32v40h36v-12h36v-24h36v-16h40v16h36v28h40v-16h44v-16h40v24h36v12h40v-24h40v-16h32v156H0z"
      />
      <path fill="#7a7f85" d="M370 162h18v-14h12v14h18v-14h12v14h18v94h-78z" />
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
          <path fill="#163732" d="M16 0h8v12h8v12h8v12h8v12H0V36h8V24h8z" />
          <path fill="#497c68" d="M16 0h8v12h-8zM8 24h24v6H8zM0 42h40v6H0z" />
          <path fill="#584333" d="M20 48h8v20h-8z" />
        </g>
      ))}
      <path
        fill="#b0c989"
        d="M228 278h4v12h-4zM222 282h16v4h-16zM470 248h4v16h-4zM464 256h16v4h-16z"
      />
      <path fill="#edc984" d="M206 286h6v6h-6zM488 260h6v6h-6z" />
      <g transform="translate(300 248)">
        <path fill="#e9ad8c" d="M4 4h12v12H4z" />
        <path fill="#365b58" d="M0 0h16v8H0z" />
        <path fill="#8be0c2" d="M4 16h12v16H4zM0 20h4v8H0zM16 20h4v8h-4z" />
        <path fill="#142535" d="M4 32h4v8H4zM12 32h4v8h-4zM12 8h4v4h-4z" />
        <path fill="#f4eddc" d="M16 16h4v4h-4z" />
      </g>
      <g transform="translate(332 248)">
        <path fill="#ce946c" d="M4 4h12v12H4z" />
        <path fill="#463c53" d="M0 0h16v8H0z" />
        <path fill="#eead8a" d="M4 16h12v16H4zM0 20h4v8H0zM16 20h4v8h-4z" />
        <path fill="#142535" d="M4 32h4v8H4zM12 32h4v8h-4zM12 8h4v4h-4z" />
      </g>
      <path
        fill="#2b5547"
        d="M0 384h48v-12h32v12h24v16H0zM552 388h24v-16h40v12h24v16h-88z"
      />
      <path
        fill="#9bbc93"
        d="M34 348h8v4h-8zM176 322h12v4h-12zM450 302h8v4h-8zM568 346h8v4h-8z"
      />
    </svg>
  );
}
