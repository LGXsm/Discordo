import { avatarCropLayout, paintAvatarCrop, type AvatarCrop } from './avatar';
import { dismissOnBackdrop } from './dialog-dismiss';
import { icon } from './icons';

export function editAvatar(host: HTMLDialogElement, bitmap: ImageBitmap): Promise<AvatarCrop | undefined> {
  const initial: AvatarCrop = { width: bitmap.width, height: bitmap.height, zoom: 1, x: 0, y: 0, turns: 0 };
  let crop = { ...initial };
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog avatar-editor';
  dialog.setAttribute('aria-labelledby', 'avatar-editor-title');
  dialog.innerHTML = `
    <header class="settings-header">
      <h2 id="avatar-editor-title">Editar foto de perfil</h2>
      <button class="icon-button" type="button" data-cancel aria-label="Fechar editor">${icon('close')}</button>
    </header>
    <div class="avatar-editor-body">
      <div class="avatar-editor-stage">
        <canvas width="384" height="384" tabindex="0" aria-label="Arraste a foto ou use as setas para ajustar o recorte"></canvas>
      </div>
      <div class="avatar-editor-tools">
        <label for="avatar-zoom">Zoom</label>
        <input id="avatar-zoom" class="volume-slider" type="range" min="1" max="3" step="0.01" value="1">
        <output for="avatar-zoom">100%</output>
        <button class="settings-button" type="button" data-rotate>Girar 90°</button>
      </div>
      <p class="settings-hint">Arraste a foto para ajustar o que fica dentro do círculo.</p>
      <div class="avatar-editor-actions">
        <button class="settings-button" type="button" data-reset>Redefinir</button>
        <button class="settings-button" type="button" data-cancel>Cancelar</button>
        <button class="primary-button" type="button" data-apply>Aplicar</button>
      </div>
    </div>`;
  const canvas = dialog.querySelector('canvas')!;
  const zoom = dialog.querySelector('input')!;
  const output = dialog.querySelector('output')!;
  let drag: { id: number; x: number; y: number } | undefined;

  function draw() {
    paintAvatarCrop(canvas, bitmap, crop);
    zoom.value = String(crop.zoom);
    output.value = `${Math.round(crop.zoom * 100)}%`;
    zoom.setAttribute('aria-valuetext', output.value);
    zoom.style.setProperty('--volume-fraction', String((crop.zoom - 1) / 2));
  }

  function move(dx: number, dy: number) {
    const size = canvas.getBoundingClientRect().width;
    if (!size) return;
    const { maxX, maxY } = avatarCropLayout(crop, size);
    const clamp = (value: number) => Math.max(-1, Math.min(1, value));
    if (maxX) crop.x = clamp(crop.x + dx / maxX);
    if (maxY) crop.y = clamp(crop.y + dy / maxY);
    draw();
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    move(event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
  });
  canvas.addEventListener('lostpointercapture', () => { drag = undefined; });
  canvas.addEventListener('keydown', event => {
    const movement = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key];
    if (!movement) return;
    event.preventDefault();
    move(movement[0], movement[1]);
  });
  zoom.addEventListener('input', () => { crop.zoom = zoom.valueAsNumber; draw(); });
  dialog.querySelector('[data-rotate]')!.addEventListener('click', () => {
    crop = { ...crop, turns: (crop.turns + 1) % 4, x: -crop.y, y: crop.x };
    draw();
  });
  dialog.querySelector('[data-reset]')!.addEventListener('click', () => { crop = { ...initial }; draw(); });
  dialog.querySelector('[data-apply]')!.addEventListener('click', () => dialog.close('apply'));
  for (const button of dialog.querySelectorAll('[data-cancel]')) button.addEventListener('click', () => dialog.close());
  dismissOnBackdrop(dialog);
  draw();
  host.append(dialog);
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const applied = dialog.returnValue === 'apply';
      dialog.remove();
      resolve(applied ? crop : undefined);
    }, { once: true });
    dialog.showModal();
  });
}
