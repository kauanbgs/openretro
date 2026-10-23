// Local-only wire format: tag 4, width/height LE32, tightly packed RGBA8.
// Pixels are encoded by WebRTC afterwards; this packet never reaches TURN.
export function rawPartyFrame(packet: ArrayBuffer) {
  if (packet.byteLength < 9) return null;
  const header = new DataView(packet);
  if (header.getUint8(0) !== 4) return null;
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
  return { width, height, pixels: new Uint8ClampedArray(packet, 9) };
}
