export function clipboardImage(event: ClipboardEvent): File | undefined {
  const clipboard = event.clipboardData;
  if (!clipboard) return;
  for (const item of clipboard.items) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const image = item.getAsFile();
      if (image) return image;
    }
  }
  return Array.from(clipboard.files).find(file => file.type.startsWith('image/'));
}
