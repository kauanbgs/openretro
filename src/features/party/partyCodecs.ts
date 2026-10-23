// Phone play and Party prefer H.264, which the PC encodes in hardware and
// receivers decode in hardware: VP9 squeezed more quality from each bit but
// encoded in software, which queued frames and added delay. The browser's
// complete codec list is kept, including retransmission/FEC codecs, so a
// receiver without H.264 still negotiates its normal codec.
function codecKey(codec: RTCRtpCodec) {
  return [
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
}

function fmtp(codec: RTCRtpCodec, name: string) {
  return new RegExp(`(?:^|;)\\s*${name}=([0-9a-f]+)`, "i").exec(
    codec.sdpFmtpLine ?? "",
  )?.[1];
}

/** H.264 that every decoder accepts first: constrained baseline in
 * packetization mode 1, then other profiles, then everything else. Only
 * profiles the PC can encode are moved; SDP parameters are never changed. */
export function h264VideoCodecs(
  sending: RTCRtpCodec[],
  receiving: RTCRtpCodec[],
): RTCRtpCodec[] {
  const encoders = new Set(sending.map(codecKey));
  const h264 = receiving.filter(
    (codec) =>
      codec.mimeType.toLowerCase() === "video/h264" &&
      encoders.has(codecKey(codec)),
  );
  if (!h264.length) return [];
  const rank = (codec: RTCRtpCodec) => {
    const profile = (fmtp(codec, "profile-level-id") ?? "42e01f").toLowerCase();
    const baseline = profile.startsWith("42e0") || profile.startsWith("4200");
    return (
      (fmtp(codec, "packetization-mode") === "1" ? 0 : 2) + (baseline ? 0 : 1)
    );
  };
  h264.sort((a, b) => rank(a) - rank(b));
  const preferred = new Set(h264);
  return [...h264, ...receiving.filter((codec) => !preferred.has(codec))];
}

export function preferH264VideoCodec(
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
  const codecs = h264VideoCodecs(sending.codecs, receiving.codecs);
  if (!codecs.length) return false;
  try {
    transceiver.setCodecPreferences(codecs);
    return true;
  } catch {
    // Some WebView versions expose preferences but reject a capability list.
    // Keep the default negotiation instead of failing the connection.
    return false;
  }
}
