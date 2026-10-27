import type { ReactionPicture } from './types';

// Serialized into the account page as well as used by the upload preview.
// All decoding and comparison stays local; never send the reference to a server.
export async function prepareReactionImage(
  blob: Blob,
  reference?: ReactionPicture,
): Promise<Omit<ReactionPicture, 'name'> & { matches: boolean }> {
  if (!blob || blob.size <= 0 || blob.size > 20 * 1024 * 1024)
    throw new Error('请选择不超过20MB的图片');
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 40_000_000)
      throw new Error('图片分辨率过大，请选择不超过4000万像素的图片');
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法读取图片画面');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 32, 32);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, 32, 32);
    const rgba = context.getImageData(0, 0, 32, 32).data;
    const pixels: number[] = [];
    const blocks = Array.from({ length: 16 }, () => 0);
    let squared = 0;
    for (let index = 0; index < 1024; index += 1) {
      const block =
        Math.floor(index / 32 / 8) * 4 + Math.floor((index % 32) / 8);
      for (let channel = 0; channel < 3; channel += 1) {
        const value = rgba[index * 4 + channel];
        pixels.push(value);
        if (reference) {
          const error = (value - reference.pixels[index * 3 + channel]) ** 2;
          squared += error;
          blocks[block] += error;
        }
      }
    }
    const sameShape =
      reference &&
      Math.abs(
        Math.log(
          bitmap.width / bitmap.height / (reference.width / reference.height),
        ),
      ) < 0.03;
    const matches = Boolean(
      sameShape &&
        squared / 3072 <= 81 &&
        blocks.every(value => value / 192 <= 324),
    );
    const scale = Math.min(1, 240 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingQuality = 'high';
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return {
      width: bitmap.width,
      height: bitmap.height,
      pixels,
      preview: canvas.toDataURL('image/jpeg', 0.8),
      matches,
    };
  } finally {
    bitmap.close();
  }
}
