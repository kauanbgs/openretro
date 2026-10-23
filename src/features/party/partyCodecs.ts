// Keep the browser's complete codec list, including retransmission/FEC codecs.
// Prefer VP9 profile 0 for efficient 8-bit game video; retain every fallback so
// guests without VP9 can still negotiate their normal video codec.
export function partyVideoCodecs(
  sending: RTCRtpCodec[],
  receiving: RTCRtpCodec[],
): RTCRtpCodec[] {
  const key = (codec: RTCRtpCodec) =>
    [
      codec.mimeType.toLowerCase(),
      codec.clockRate,
      codec.channels ?? 0,
      (codec.sdpFmtpLine ?? "")
        .toLowerCase()
        .split(";")
        .map((part) => part.trim())
        .sort()
        .join(";"),
    ].join("|");
  const encoders = new Set(sending.map(key));
  const isVp9 = (codec: RTCRtpCodec) =>
    codec.mimeType.toLowerCase() === "video/vp9";
  const efficient = receiving.filter(
    (codec) => isVp9(codec) && encoders.has(key(codec)),
  );
  if (!efficient.length) return [];
  // A missing profile-id means profile 0. Never invent or modify SDP parameters.
  const rank = (codec: RTCRtpCodec) => {
    const profile =
      /(?:^|;)\s*profile-id=(\d+)/i.exec(codec.sdpFmtpLine ?? "")?.[1] ?? "0";
    return profile === "0" ? 0 : 1;
  };
  efficient.sort((a, b) => rank(a) - rank(b));
  const preferred = new Set(efficient);
  return [...efficient, ...receiving.filter((codec) => !preferred.has(codec))];
}

export function preferPartyVideoCodec(
  transceiver: RTCRtpTransceiver,
  sending: Pick<RTCRtpCapabilities, "codecs"> | null,
  receiving: Pick<RTCRtpCapabilities, "codecs"> | null,
): boolean {
  if (
    typeof transceiver.setCodecPreferences !== "function" ||
    !sending ||
    !receiving
  )
    return false;
  const codecs = partyVideoCodecs(sending.codecs, receiving.codecs);
  if (!codecs.length) return false;
  try {
    transceiver.setCodecPreferences(codecs);
    return true;
  } catch {
    // Some WebView versions expose preferences but reject a capability list.
    // Keep the default negotiation instead of failing the Party connection.
    return false;
  }
}
