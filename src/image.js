export const formats = ['png', 'jpg', 'gif', 'webp', 'avif'];

export function detectImage(b) {
  if (b.length >= 33 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && b.toString('ascii', 12, 16) === 'IHDR' && b.readUInt32BE(16) > 0 && b.readUInt32BE(20) > 0) return { ext: 'png', mime: 'image/png' };
  if (b.length >= 12 && b[0] === 255 && b[1] === 216 && b[2] === 255 && b[b.length - 2] === 255 && b[b.length - 1] === 217) return { ext: 'jpg', mime: 'image/jpeg' };
  if (b.length >= 14 && ['GIF87a', 'GIF89a'].includes(b.toString('ascii', 0, 6)) && b.readUInt16LE(6) && b.readUInt16LE(8) && b[b.length - 1] === 59) return { ext: 'gif', mime: 'image/gif' };
  if (b.length >= 20 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' && b.readUInt32LE(4) + 8 === b.length && ['VP8 ', 'VP8L', 'VP8X'].includes(b.toString('ascii', 12, 16))) return { ext: 'webp', mime: 'image/webp' };
  if (b.length >= 24 && b.toString('ascii', 4, 8) === 'ftyp') {
    const size = b.readUInt32BE(0);
    if (size >= 20 && size <= b.length) {
      const brands = [b.toString('ascii', 8, 12)];
      for (let i = 16; i + 4 <= size; i += 4) brands.push(b.toString('ascii', i, i + 4));
      if (brands.some(x => ['avif', 'avis'].includes(x))) return { ext: 'avif', mime: 'image/avif' };
    }
  }
  return null;
}
