export function mountServerTooltips(workspace: HTMLElement) {
  const rail = workspace.querySelector<HTMLElement>('.server-rail')!;
  const lifetime = new AbortController();
  const tooltip = document.createElement('div');
  tooltip.id = 'server-name-tooltip';
  tooltip.className = 'server-name-tooltip';
  tooltip.popover = 'manual';
  tooltip.setAttribute('role', 'tooltip');
  workspace.append(tooltip);
  let active: HTMLElement | undefined;
  function hide() {
    if (active) {
      const descriptions = (active.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id && id !== tooltip.id);
      if (descriptions.length) active.setAttribute('aria-describedby', descriptions.join(' '));
      else active.removeAttribute('aria-describedby');
    }
    active = undefined;
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
  }
  function show(button: HTMLElement) {
    const name = button.getAttribute('aria-label');
    if (!name || !button.getClientRects().length || workspace.querySelector('.server-context-menu:popover-open')) return;
    hide();
    active = button;
    button.removeAttribute('title');
    tooltip.textContent = name;
    button.setAttribute('aria-describedby', [...(button.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean), tooltip.id].join(' '));
    tooltip.showPopover();
    const bounds = button.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, Math.min(bounds.right + 10, innerWidth - tooltip.offsetWidth - 8))}px`;
    tooltip.style.top = `${Math.max(8, Math.min(bounds.top + (bounds.height - tooltip.offsetHeight) / 2, innerHeight - tooltip.offsetHeight - 8))}px`;
  }
  function serverButton(target: EventTarget | null) {
    return target instanceof Element ? target.closest<HTMLElement>('[data-server], [data-lobby], [data-download-app]') : null;
  }
  rail.addEventListener('pointerover', event => {
    if (event.pointerType === 'touch') return;
    const button = serverButton(event.target);
    if (button && button !== active) show(button);
  }, { signal: lifetime.signal });
  rail.addEventListener('pointerout', event => {
    const button = serverButton(event.target);
    if (button === active && (!event.relatedTarget || !(event.relatedTarget instanceof Node) || !button.contains(event.relatedTarget))) hide();
  }, { signal: lifetime.signal });
  rail.addEventListener('focusin', event => { const button = serverButton(event.target); if (button) show(button); }, { signal: lifetime.signal });
  rail.addEventListener('focusout', hide, { signal: lifetime.signal });
  rail.addEventListener('click', hide, { signal: lifetime.signal });
  rail.addEventListener('scroll', hide, { signal: lifetime.signal, capture: true });
  window.addEventListener('resize', hide, { signal: lifetime.signal });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, { signal: lifetime.signal });
  return () => { hide(); lifetime.abort(); tooltip.remove(); };
}
