// Game frames from the local server as WebRTC video tracks, for phone play
// and Party. Each frame becomes a VideoFrame written to a track generator:
// a raw frame is cropped in place, and only small frames and regions that
// grow by whole pixels are copied. Nothing passes through a canvas.
import { rawPartyFrame } from "../features/party/partyFrames";

export type ScreenLayout = "full" | "sideBySide" | "stacked" | "grid";
export interface ScreenView {
  layout: ScreenLayout;
  region: number;
}
export const FULL_VIEW: ScreenView = { layout: "full", region: 0 };

/** The server's JPEG crop (video.rs): half-open bounds that partition odd
 * sizes without dropping a row or column. */
export function viewBounds(
  view: ScreenView,
  width: number,
  height: number,
): [number, number, number, number] {
  const grid = {
    full: [1, 1],
    sideBySide: [2, 1],
    stacked: [1, 2],
    grid: [2, 2],
  }[view.layout];
  const [columns, rows] = grid ?? [1, 1];
  const count = columns * rows;
  if (
    count === 1 ||
    view.region < 1 ||
    view.region > count ||
    width < columns ||
    height < rows
  )
    return [0, 0, width, height];
  const index = view.region - 1;
  const column = index % columns,
    row = Math.floor(index / columns);
  return [
    Math.floor((column * width) / columns),
    Math.floor((row * height) / rows),
    Math.floor(((column + 1) * width) / columns),
    Math.floor(((row + 1) * height) / rows),
  ];
}

/** Small retro frames grow by whole pixels up to 720p, never stretched, so
 * the receiver's scaling keeps them sharp. H.264 needs even dimensions. */
export function encodedSize(width: number, height: number): [number, number] {
  const scale = Math.max(1, Math.floor(Math.min(1280 / width, 720 / height)));
  const even = (value: number) => Math.max(2, value - (value % 2));
  return [even(width * scale), even(height * scale)];
}

export const viewKey = (view: ScreenView) =>
  view.layout === "full" || !view.region
    ? "full"
    : `${view.layout}:${view.region}`;

// Chromium's breakout-box generator: VideoFrames in, a track out. Not in the
// DOM typings, and WebView2 always has it.
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
  constructor(init: { kind: "video" });
  readonly writable: WritableStream<VideoFrame>;
}
export const frameTracksSupported =
  typeof RTCPeerConnection !== "undefined" &&
  typeof VideoFrame !== "undefined" &&
  "MediaStreamTrackGenerator" in globalThis;

/** One game frame, shared by every track until each has used it. */
export interface Source {
  image: VideoFrame | ImageBitmap;
  /** A raw frame can be cropped in place; a decoded PNG is redrawn. */
  raw: boolean;
  width: number;
  height: number;
  timestamp: number;
  users: number;
  stale: boolean;
}

function source(image: VideoFrame | ImageBitmap, raw: boolean): Source {
  const width = "displayWidth" in image ? image.displayWidth : image.width;
  const height = "displayHeight" in image ? image.displayHeight : image.height;
  const timestamp = Math.round(performance.now() * 1000);
  return { image, raw, width, height, timestamp, users: 0, stale: false };
}

/** A frame drawn on a canvas, such as a waiting screen. */
export function canvasSource(canvas: HTMLCanvasElement): Source {
  const timestamp = Math.round(performance.now() * 1000);
  return source(new VideoFrame(canvas, { timestamp }), true);
}

/** Closes a replaced frame once no track still crops it. */
export function retire(old: Source) {
  old.stale = true;
  if (!old.users) old.image.close();
}

/** Turns local server packets into frames: tag 4 is raw RGBA, tag 3 a
 * lossless PNG of a small frame, skipped while the previous one decodes. */
export function packetDecoder() {
  let decoding = false;
  return async (packet: ArrayBuffer): Promise<Source | undefined> => {
    const tag = new DataView(packet).getUint8(0);
    if (tag === 4) {
      const raw = rawPartyFrame(packet);
      if (!raw) return;
      const timestamp = Math.round(performance.now() * 1000);
      return source(
        new VideoFrame(raw.pixels, {
          format: "RGBX",
          codedWidth: raw.width,
          codedHeight: raw.height,
          timestamp,
        }),
        true,
      );
    }
    if (tag !== 3 || decoding) return;
    decoding = true;
    try {
      return source(
        await createImageBitmap(
          new Blob([new Uint8Array(packet, 1)], { type: "image/png" }),
        ),
        false,
      );
    } catch {
      return;
    } finally {
      decoding = false;
    }
  };
}

/** One view's frame: the raw frame's own pixels when no growth is needed,
 * otherwise a pixelated copy of the region at its encoded size. */
async function viewFrame(from: Source, view: ScreenView) {
  const [x0, y0, x1, y1] = viewBounds(view, from.width, from.height);
  const [width, height] = encodedSize(x1 - x0, y1 - y0);
  if (from.raw && width <= x1 - x0 && height <= y1 - y0)
    return new VideoFrame(from.image as VideoFrame, {
      visibleRect: { x: x0, y: y0, width, height },
      timestamp: from.timestamp,
    });
  const image = await createImageBitmap(from.image, x0, y0, x1 - x0, y1 - y0, {
    resizeWidth: width,
    resizeHeight: height,
    resizeQuality: "pixelated",
  });
  try {
    return new VideoFrame(image, { timestamp: from.timestamp });
  } finally {
    image.close();
  }
}

export interface FrameTrack {
  view: ScreenView;
  track: MediaStreamTrack;
  stream: MediaStream;
  /** Sends this view of a frame, or skips it while the encoder is behind. */
  show(from: Source): Promise<void>;
  close(): void;
}

/** A video track showing one view of each frame. Nothing is written before
 * a real frame: a placeholder would decode and hide the receiver's picture. */
export function frameTrack(view: ScreenView): FrameTrack {
  const track = new MediaStreamTrackGenerator({ kind: "video" });
  track.contentHint = "motion";
  const writer = track.writable.getWriter();
  let writing = false;
  return {
    view,
    track,
    stream: new MediaStream([track]),
    async show(from) {
      // The encoder still has the previous frame: skip, never queue.
      if (writing || from.stale) return;
      writing = true;
      from.users++;
      try {
        await writer.write(await viewFrame(from, view));
      } catch {
        // A closed track or a frame replaced mid-crop: the next one follows.
      } finally {
        writing = false;
        from.users--;
        if (from.stale && !from.users) from.image.close();
      }
    },
    close() {
      void writer.close().catch(() => {});
      track.stop();
    },
  };
}
