// Local-only wire format: tag 4 (RGBX) or 5 (BGRX), width/height LE32, then
// 4 bytes a pixel. The tag keeps the producer's own byte order, so a core's
// XRGB8888 rows cross unchanged. Pixels are encoded by WebRTC afterwards;
// this packet never reaches TURN.
const formats: Record<number, VideoPixelFormat> = { 4: "RGBX", 5: "BGRX" };

export function rawPartyFrame(packet: ArrayBuffer) {
  if (packet.byteLength < 9) return null;
  const header = new DataView(packet);
  const format = formats[header.getUint8(0)];
  if (!format) return null;
  const width = header.getUint32(1, true);
  const height = header.getUint32(5, true);
  const count = width * height;
  if (
    !width ||
    !height ||
    count > 4_194_304 ||
    packet.byteLength !== 9 + count * 4
  )
    return null;
  return { width, height, format, pixels: new Uint8ClampedArray(packet, 9) };
}

/** Whether a local packet carries raw pixels (`rawPartyFrame`). */
export const isRawPartyFrame = (tag: number) => tag in formats;
