export type VoiceModerationAlert = 'punished' | 'disconnect';

export function remainingPunishmentSeconds(until: number) {
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}

const signs = {
  punished: { label: 'Recua Fascista', path: 'art/voice-recua-fascista.webp' },
  disconnect: { label: 'Se Fudeu!', path: 'art/voice-se-fudeu.webp' },
} as const;

export function createVoiceModerationAlert() {
  let panel: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let countdownTimer: ReturnType<typeof setInterval> | undefined;
  let preloaded = false;

  function clear() {
    clearTimeout(timer);
    clearInterval(countdownTimer);
    panel?.remove();
    panel = undefined;
  }

  return {
    preload() {
      if (preloaded) return;
      preloaded = true;
      for (const sign of Object.values(signs)) {
        const image = new Image();
        image.src = import.meta.env.BASE_URL + sign.path;
      }
    },
    show(kind: VoiceModerationAlert, punishmentUntil?: number) {
      clear();
      const sign = signs[kind];
      const alert = document.createElement('div');
      alert.className = 'voice-moderation-alert';
      alert.popover = 'manual';
      // The voice panel already announces the reason through its live region.
      alert.setAttribute('aria-hidden', 'true');
      const fallback = document.createElement('strong');
      fallback.textContent = sign.label;
      const image = new Image();
      image.alt = sign.label;
      image.hidden = true;
      image.addEventListener('load', () => {
        fallback.hidden = true;
        image.hidden = false;
      }, { once: true });
      image.src = import.meta.env.BASE_URL + sign.path;
      alert.append(fallback, image);
      if (punishmentUntil !== undefined) {
        const countdown = document.createElement('p');
        countdown.className = 'voice-moderation-countdown';
        const update = () => {
          const seconds = remainingPunishmentSeconds(punishmentUntil);
          countdown.textContent = seconds ? `Você pode voltar em ${seconds} s` : 'Você já pode voltar';
        };
        update();
        countdownTimer = setInterval(update, 200);
        alert.append(countdown);
      }
      document.body.append(alert);
      alert.showPopover();
      panel = alert;
      timer = setTimeout(clear, 3000);
    },
    clear,
  };
}
