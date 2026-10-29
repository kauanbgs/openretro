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

const MIC_KEY = "openretro-party-microphone";
const SPEAKER_KEY = "openretro-party-speaker";
/** The device the host chose for voice, or "" for the system's default. */
export function chosenDevice(kind: "microphone" | "speaker"): string {
  try {
    return (
      localStorage.getItem(kind === "microphone" ? MIC_KEY : SPEAKER_KEY) ?? ""
    );
  } catch {
    return "";
  }
}
export function chooseDevice(kind: "microphone" | "speaker", id: string) {
  try {
    const key = kind === "microphone" ? MIC_KEY : SPEAKER_KEY;
    if (id) localStorage.setItem(key, id);
    else localStorage.removeItem(key);
  } catch {
    /* The choice only lasts until the app closes. */
  }
}
export interface AudioDevices {
  microphones: { id: string; label: string }[];
  speakers: { id: string; label: string }[];
}
/** The sound devices the system offers. Names appear once a microphone was allowed. */
export async function listAudioDevices(): Promise<AudioDevices> {
  const devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  const pick = (kind: MediaDeviceKind) =>
    devices
      .filter((device) => device.kind === kind && device.deviceId !== "default")
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label || `${index + 1}`,
      }));
  return { microphones: pick("audioinput"), speakers: pick("audiooutput") };
}

/** A voice-quality microphone: echo and noise are handled by the browser. */
export async function openMicrophone(): Promise<MediaStreamTrack> {
  if (!navigator.mediaDevices?.getUserMedia)
    throw new DOMException("No microphone API", "NotFoundError");
  const audio: MediaTrackConstraints = {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  };
  const device = chosenDevice("microphone");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: device ? { ...audio, deviceId: { exact: device } } : audio,
    });
    return stream.getAudioTracks()[0];
  } catch (cause) {
    // A headset that was unplugged since it was chosen: use the default.
    if (!device || (cause as DOMException)?.name !== "OverconstrainedError")
      throw cause;
    chooseDevice("microphone", "");
    const stream = await navigator.mediaDevices.getUserMedia({ audio });
    return stream.getAudioTracks()[0];
  }
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
