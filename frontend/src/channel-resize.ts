const storageKey = 'discordo:channel-panel-width';

export function mountChannelResize(workspace: HTMLElement) {
  const panel = workspace.querySelector<HTMLElement>('.channel-panel')!;
  const rail = workspace.querySelector<HTMLElement>('.server-rail')!;
  const members = workspace.querySelector<HTMLElement>('.members-panel');
  const lifetime = new AbortController();
  const mobile = matchMedia('(max-width: 720px)');
  let preferred: number | undefined;
  try {
    const saved = Number(localStorage.getItem(storageKey));
    if (saved >= 200 && saved <= 480) preferred = saved;
  } catch { /* Resizing still works when browser storage is unavailable. */ }
  const handle = document.createElement('div');
  handle.className = 'channel-resize-handle';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', 'Largura da aba de canais');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-controls', panel.id);
  handle.title = 'Arraste para ajustar a largura · clique duas vezes para restaurar';
  panel.append(handle);
  let drag: { id: number; x: number; width: number } | undefined;

  function maximum() {
    // Use the same limit in Friends even while the member list is hidden there.
    const memberStyle = members && workspace.classList.contains('with-members') ? getComputedStyle(members) : null;
    const memberWidth = memberStyle && memberStyle.position !== 'absolute' ? parseFloat(memberStyle.width) : 0;
    return Math.max(200, Math.min(480, workspace.clientWidth - rail.getBoundingClientRect().width - memberWidth - 300));
  }
  function apply() {
    if (mobile.matches) return;
    const max = maximum();
    const defaultWidth = innerWidth <= 1050 ? 206 : 230;
    const width = Math.round(Math.max(200, Math.min(max, preferred ?? defaultWidth)));
    workspace.style.setProperty('--channel-panel-width', `${width}px`);
    handle.setAttribute('aria-valuemin', '200');
    handle.setAttribute('aria-valuemax', String(Math.floor(max)));
    handle.setAttribute('aria-valuenow', String(width));
    handle.setAttribute('aria-valuetext', `${width} pixels`);
  }
  function persist() {
    try {
      if (preferred === undefined) localStorage.removeItem(storageKey);
      else localStorage.setItem(storageKey, String(preferred));
    } catch { /* Keep the current width for this session. */ }
  }
  function finish() {
    if (!drag) return;
    drag = undefined;
    workspace.classList.remove('resizing-channels');
    persist();
  }
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || mobile.matches) return;
    event.preventDefault();
    drag = { id: event.pointerId, x: event.clientX, width: panel.getBoundingClientRect().width };
    handle.setPointerCapture(event.pointerId);
    handle.focus({ preventScroll: true });
    workspace.classList.add('resizing-channels');
  }, { signal: lifetime.signal });
  handle.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    preferred = Math.round(Math.max(200, Math.min(maximum(), drag.width + event.clientX - drag.x)));
    apply();
  }, { signal: lifetime.signal });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    handle.addEventListener(name, finish, { signal: lifetime.signal });
  }
  handle.addEventListener('dblclick', () => { preferred = undefined; apply(); persist(); }, { signal: lifetime.signal });
  handle.addEventListener('keydown', event => {
    if (mobile.matches || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 30 : 10;
    preferred = event.key === 'Home' ? undefined : event.key === 'End' ? maximum()
      : Math.max(200, Math.min(maximum(), panel.getBoundingClientRect().width + (event.key === 'ArrowLeft' ? -step : step)));
    apply();
    persist();
  }, { signal: lifetime.signal });
  const observer = new ResizeObserver(apply);
  observer.observe(workspace);
  if (members) observer.observe(members);
  mobile.addEventListener('change', apply, { signal: lifetime.signal });
  apply();
  return () => { finish(); lifetime.abort(); observer.disconnect(); handle.remove(); };
}
