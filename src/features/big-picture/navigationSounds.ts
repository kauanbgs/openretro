/** Short synthesized cues for console navigation; no audio files to ship. */
export type UiSound = "move" | "select" | "back";

const cues: Record<
  UiSound,
  { from: number; to: number; length: number; gain: number }
> = {
  move: { from: 1320, to: 1180, length: 0.035, gain: 0.035 },
  select: { from: 660, to: 990, length: 0.09, gain: 0.06 },
  back: { from: 560, to: 360, length: 0.09, gain: 0.05 },
};

let context: AudioContext | undefined;
let enabled = true;
let lastPlayed = -Infinity;

export const setNavigationSounds = (on: boolean) => {
  enabled = on;
};

/** Which cue a console input plays, if any. */
export const soundFor = (key: string): UiSound | undefined =>
  ["left", "right", "up", "down", "lb", "rb"].includes(key)
    ? "move"
    : key === "a"
      ? "select"
      : key === "b"
        ? "back"
        : undefined;

export function playUiSound(sound: UiSound | undefined) {
  if (!enabled || !sound || typeof AudioContext === "undefined") return;
  const now = performance.now();
  // A button press can arrive both as input and as the click it causes.
  if (now - lastPlayed < 60) return;
  lastPlayed = now;
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const cue = cues[sound];
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = sound === "move" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(cue.from, start);
    oscillator.frequency.exponentialRampToValueAtTime(
      cue.to,
      start + cue.length,
    );
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(cue.gain, start + 0.006);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + cue.length);
    oscillator.connect(volume).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + cue.length + 0.02);
  } catch {
    // No audio device: navigation stays silent.
  }
}
