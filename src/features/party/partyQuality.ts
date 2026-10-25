// A ceiling, not a forced bitrate: WebRTC still estimates each guest's link.
// Give 720p60 motion more room than the old 5 Mbps / 30 fps stream.
export const PARTY_MAX_BITRATE = 8_000_000;

export async function configurePartyVideo(sender: RTCRtpSender) {
  const parameters = sender.getParameters();
  if (!parameters.encodings.length) return;
  parameters.encodings[0].maxBitrate = PARTY_MAX_BITRATE;
  parameters.encodings[0].maxFramerate = 60;
  // Avoid aggressively turning retro graphics and HUD text into a low-res blur.
  // Still permit adaptation when the CPU or the guest's connection is limited.
  parameters.degradationPreference = "balanced";
  try {
    await sender.setParameters(parameters);
  } catch {
    // Some WebViews reject the optional degradation preference. Fetch a fresh
    // transaction and retry only the encoding limits; tuning must not prevent
    // the guest from joining on an older runtime.
    try {
      const fallback = sender.getParameters();
      if (!fallback.encodings.length) return;
      fallback.encodings[0].maxBitrate = PARTY_MAX_BITRATE;
      fallback.encodings[0].maxFramerate = 60;
      await sender.setParameters(fallback);
    } catch {
      // The runtime's default congestion control remains available.
    }
  }
}

export function tunePartyReceiver(receiver: RTCRtpReceiver) {
  // One or two frames of breathing room absorb packet jitter without the
  // long playback queue of a video player. Zero made every late packet urgent.
  const milliseconds = receiver.track.kind === "video" ? 20 : 40;
  const hints: {
    jitterBufferTarget?: number | null;
    playoutDelayHint?: number;
  } = receiver;
  try {
    if ("jitterBufferTarget" in hints) hints.jitterBufferTarget = milliseconds;
    else hints.playoutDelayHint = milliseconds / 1000;
  } catch {
    // Older WebViews may expose a read-only delay hint.
  }
}
