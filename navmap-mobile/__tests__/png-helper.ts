import { deflateSync } from 'node:zlib';

/** Minimal transparent RGBA PNG of w×h, base64-encoded (test helper). */
export function createDeflateRaw(w: number, h: number): string {
  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[i] = c >>> 0;
  }
  const crc = (buf: Buffer): number => {
    let v = 0xffffffff;
    for (let i = 0; i < buf.length; i++) v = crcTable[(v ^ buf[i]!) & 0xff]! ^ (v >>> 8);
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const tb = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const cc = Buffer.alloc(4);
    cc.writeUInt32BE(crc(Buffer.concat([tb, data])), 0);
    return Buffer.concat([len, tb, data, cc]);
  };
  const row = Buffer.alloc(1 + w * 4, 0);
  const raw = Buffer.alloc(h * row.length, 0);
  for (let y = 0; y < h; y++) raw.set(row, y * row.length);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return png.toString('base64');
}
