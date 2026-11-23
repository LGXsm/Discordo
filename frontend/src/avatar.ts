import type { Profile } from './accounts';

export type AvatarCrop = { width: number; height: number; zoom: number; x: number; y: number; turns: number };

export function avatarCropLayout(crop: AvatarCrop, size: number) {
  const rotated = crop.turns % 2 !== 0;
  const scale = size * crop.zoom / Math.min(crop.width, crop.height);
  const width = crop.width * scale;
  const height = crop.height * scale;
  const maxX = Math.max(0, ((rotated ? height : width) - size) / 2);
  const maxY = Math.max(0, ((rotated ? width : height) - size) / 2);
  return { width, height, maxX, maxY, left: size / 2 + crop.x * maxX, top: size / 2 + crop.y * maxY };
}

export function renderAvatar(element: Element, profile: Profile, animated = false) {
  const source = animated ? profile.avatarUrl : profile.avatarStillUrl ?? profile.avatarUrl;
  const crop = animated ? profile.avatarCrop : undefined;
  element.classList.toggle('avatar-cropped', Boolean(source && crop));
  if (source) {
    renderImage(element, source);
    const image = element.firstElementChild as HTMLImageElement;
    if (crop) {
      const { width, height, left, top } = avatarCropLayout(crop, 100);
      Object.assign(image.style, { width: `${width}%`, height: `${height}%`, left: `${left}%`, top: `${top}%`,
        transform: `translate(-50%, -50%) rotate(${crop.turns * 90}deg)` });
    } else if (image.style.transform) image.removeAttribute('style');
  } else {
    element.textContent = profile.name.trim().split(/\s+/u).slice(0, 2)
      .map(part => Array.from(part)[0]).join('').toLocaleUpperCase('pt-BR');
  }
}

export function renderImage(element: Element, source?: string) {
  if (!source) {
    element.replaceChildren();
    return;
  }
  if (element.firstElementChild?.getAttribute('src') === source) return;
  const image = document.createElement('img');
  image.alt = '';
  image.src = source;
  element.replaceChildren(image);
}

const gifLoopExtension = Uint8Array.of(0x21, 0xff, 11, ...new TextEncoder().encode('NETSCAPE2.0'), 3, 1, 0, 0, 0);

export const profileImageAccept = 'image/*,.jpg,.jpeg,.png,.webp,.gif';

export async function profileImageType(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const header = new TextDecoder().decode(bytes);
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && header.slice(1, 4) === 'PNG') return 'image/png';
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) return 'image/gif';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

async function loopGif(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const decoder = new TextDecoder();
  if (!['GIF87a', 'GIF89a'].includes(decoder.decode(bytes.subarray(0, 6)))) {
    throw new Error('O arquivo escolhido não é um GIF válido.');
  }
  bytes[4] = 0x39; // The application extension uses GIF89a.
  const paletteSize = (flags: number) => flags & 0x80 ? 3 * (2 ** ((flags & 7) + 1)) : 0;
  const start = 13 + paletteSize(bytes[10]);
  // GIF data is split into extension blocks and image blocks, each with length-prefixed chunks.
  let offset = start;
  while (offset < bytes.length) {
    const kind = bytes[offset++];
    if (kind === 0x21) {
      const label = bytes[offset++];
      if (label === 0xff && bytes[offset] === 11) {
        const identifier = decoder.decode(bytes.subarray(offset + 1, offset + 12));
        if (['NETSCAPE2.0', 'ANIMEXTS1.0'].includes(identifier) && bytes[offset + 12] === 3 && bytes[offset + 13] === 1) {
          bytes[offset + 14] = bytes[offset + 15] = 0;
        }
      }
    } else if (kind === 0x2c) {
      offset += 10 + paletteSize(bytes[offset + 8]);
    } else {
      break;
    }
    while (bytes[offset]) offset += 1 + bytes[offset];
    offset++;
  }
  const blob = new Blob([bytes.subarray(0, start), gifLoopExtension, bytes.subarray(start)], { type: 'image/gif' });
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Não foi possível ler o GIF.'));
    reader.readAsDataURL(blob);
  });
}

async function profileBitmap(file: File) {
  const type = await profileImageType(file);
  const gif = type === 'image/gif';
  if (!type || file.size > (gif ? 1 : 8) * 1024 * 1024) {
    throw new Error('Escolha um JPG, PNG ou WebP de até 8 MB, ou um GIF de até 1 MB.');
  }
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Não foi possível abrir a imagem. Escolha outro arquivo.');
  });
  if (gif && (bitmap.width > 4096 || bitmap.height > 4096)) {
    bitmap.close();
    throw new Error('Escolha um GIF com até 4096 pixels de largura e de altura.');
  }
  return { bitmap, gif };
}

export function paintAvatarCrop(canvas: HTMLCanvasElement, bitmap: ImageBitmap, crop: AvatarCrop) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Não foi possível preparar a foto neste navegador.');
  const { width, height, left, top } = avatarCropLayout(crop, canvas.width);
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.translate(left, top);
  context.rotate(crop.turns * Math.PI / 2);
  context.drawImage(bitmap, -width / 2, -height / 2, width, height);
  context.restore();
}

export async function prepareAvatar(file: File, edit: (bitmap: ImageBitmap) => Promise<AvatarCrop | undefined>) {
  const { bitmap, gif } = await profileBitmap(file);
  try {
    const crop = await edit(bitmap);
    if (!crop) return;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 192;
    paintAvatarCrop(canvas, bitmap, crop);
    return gif ? { url: await loopGif(file), still: canvas.toDataURL('image/png'), crop }
      : { url: canvas.toDataURL('image/webp', .86), still: undefined, crop: undefined };
  } finally {
    bitmap.close();
  }
}

export async function prepareProfileBanner(file: File) {
  const { bitmap, gif } = await profileBitmap(file);
  try {
    if (gif) return { url: await loopGif(file) };
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 224;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Não foi possível preparar a foto neste navegador.');
    const ratio = canvas.width / canvas.height;
    const width = Math.min(bitmap.width, bitmap.height * ratio);
    const height = width / ratio;
    context.drawImage(bitmap, (bitmap.width - width) / 2, (bitmap.height - height) / 2,
      width, height, 0, 0, canvas.width, canvas.height);
    return { url: canvas.toDataURL('image/webp', .86) };
  } finally {
    bitmap.close();
  }
}
