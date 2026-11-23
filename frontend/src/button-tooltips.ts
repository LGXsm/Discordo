export function mountButtonTooltips(workspace: HTMLElement, signal: AbortSignal) {
  const selector = '[data-voice-settings], [data-dock-mic], [data-dock-headphones], .server-invite-trigger, .profile-add-role, .friends-trigger, [data-profile-friend]';
  const tooltip = document.createElement('div');
  tooltip.id = 'button-tooltip';
  tooltip.className = 'button-tooltip';
  tooltip.popover = 'manual';
  tooltip.setAttribute('role', 'tooltip');
  workspace.append(tooltip);
  let active: HTMLButtonElement | undefined;

  const labelChanges = new MutationObserver(() => {
    if (active?.getClientRects().length) show(active);
    else hide();
  });
  const options = { signal };

  function hide() {
    labelChanges.disconnect();
    if (active?.hasAttribute('data-tooltip-label')) active.removeAttribute('aria-describedby');
    active = undefined;
    if (tooltip.matches(':popover-open')) tooltip.hidePopover();
  }

  function show(button: HTMLButtonElement) {
    const label = button.dataset.tooltipLabel ?? button.getAttribute('aria-label');
    if (!label || !button.getClientRects().length) return;
    if (active !== button) {
      hide();
      active = button;
      if (button.hasAttribute('data-tooltip-label')) button.setAttribute('aria-describedby', tooltip.id);
      labelChanges.observe(button, { attributes: true, attributeFilter: ['aria-label', 'hidden'] });
    }
    if (tooltip.textContent === label && tooltip.matches(':popover-open')) return;
    tooltip.textContent = label;
    tooltip.showPopover();
    const { left, top, bottom, width } = button.getBoundingClientRect();
    const center = left + width / 2;
    const start = Math.max(8, Math.min(center - tooltip.offsetWidth / 2, innerWidth - tooltip.offsetWidth - 8));
    const above = top - tooltip.offsetHeight - 8;
    const below = button.classList.contains('server-invite-trigger') || above < 8;
    tooltip.toggleAttribute('data-below', below);
    tooltip.style.left = `${start}px`;
    tooltip.style.top = `${below ? bottom + 8 : above}px`;
    tooltip.style.setProperty('--tooltip-arrow', `${center - start}px`);
  }

  for (const button of workspace.querySelectorAll<HTMLButtonElement>(selector)) {
    button.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') show(button); }, options);
    button.addEventListener('pointerleave', () => { if (active === button) hide(); }, options);
    button.addEventListener('focus', () => { if (button.matches(':focus-visible')) show(button); }, options);
    button.addEventListener('blur', () => { if (active === button) hide(); }, options);
  }
  workspace.addEventListener('click', hide, { capture: true, signal });
  workspace.addEventListener('scroll', hide, { capture: true, signal });
  workspace.querySelector('#member-profile')?.addEventListener('beforetoggle', event => {
    if ((event as ToggleEvent).newState === 'closed' && active?.closest('#member-profile')) hide();
  }, options);
  window.addEventListener('resize', hide, options);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); }, options);
  signal.addEventListener('abort', hide, { once: true });
}
