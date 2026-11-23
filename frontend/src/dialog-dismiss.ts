export function dismissOnBackdrop(dialog: HTMLDialogElement, canClose = () => true, close = () => dialog.close()) {
  const outside = (event: MouseEvent) => {
    if (event.target !== dialog) return false;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    return event.clientX < left || event.clientX >= right || event.clientY < top || event.clientY >= bottom;
  };
  let startedOutside = false;
  dialog.addEventListener('pointerdown', event => {
    startedOutside = event.button === 0 && outside(event);
  });
  dialog.addEventListener('pointercancel', () => { startedOutside = false; });
  dialog.addEventListener('click', event => {
    if (startedOutside && outside(event) && canClose()) close();
    startedOutside = false;
  });
}
