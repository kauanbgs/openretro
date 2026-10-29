/**
 * Party voice rides the connection every guest already has. The host's offer
 * carries a second audio line after the game's sound: it plays the other
 * people's voices to the guest and carries the guest's microphone back. The
 * signalling server relays the offer and answer untouched, so it needs no
 * voice support, and a host without voice simply offers one audio line.
 */

/** The voice line of a Party connection: the second audio line, if any. */
export function voiceTransceiver(
  pc: Pick<RTCPeerConnection, "getTransceivers">,
): RTCRtpTransceiver | undefined {
  const lines = (pc.getTransceivers?.() ?? []).filter(
    (transceiver) =>
      (transceiver.receiver?.track ?? transceiver.sender?.track)?.kind ===
      "audio",
  );
  return lines.length >= 2 ? lines[1] : undefined;
}

/** Why a microphone could not be opened, in words for the person. */
export function microphoneFailure(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "O microfone está bloqueado. Libere o acesso nas permissões e tente de novo.";
  if (name === "NotFoundError" || name === "OverconstrainedError")
    return "Nenhum microfone foi encontrado neste aparelho.";
  return "Não foi possível abrir o microfone.";
}

/** A voice-quality microphone: echo and noise are handled by the browser. */
export async function openMicrophone(): Promise<MediaStreamTrack> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new DOMException("No microphone API", "NotFoundError");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });
  return stream.getAudioTracks()[0];
}

/**
 * Plays a received voice track. Chromium only delivers a remote track to Web
 * Audio while a media element holds it, so the host's element stays muted.
 */
export function playVoice(track: MediaStreamTrack): HTMLAudioElement {
  const element = new Audio();
  element.autoplay = true;
  element.srcObject = new MediaStream([track]);
  void element.play().catch(() => {});
  return element;
}
