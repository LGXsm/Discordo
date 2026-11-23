export function mountScreenPlayback(stage: HTMLElement, lifetime: AbortSignal) {
  const video = stage.querySelector('video')!;
  const status = stage.querySelector<HTMLElement>('[data-screen-status]')!;
  const message = status.querySelector('p')!;
  const retry = status.querySelector('button')!;
  let stream: MediaStream | null = null;
  let trackEvents: AbortController | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let playAttempt = 0;

  video.muted = video.defaultMuted = true;
  video.playsInline = true;

  function showMessage(text: string, canRetry = false) {
    message.textContent = text;
    status.hidden = !text;
    retry.hidden = !canRetry;
  }

  function checkVideo() {
    if (!stream || video.paused || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      || !video.videoWidth || stream.getVideoTracks()[0]?.muted) return false;
    clearTimeout(timeout);
    timeout = undefined;
    showMessage('');
    return true;
  }

  function waitForVideo() {
    if (timeout !== undefined || !stream || !retry.hidden) return;
    showMessage('Aguardando a imagem da transmissão…');
    timeout = setTimeout(() => {
      timeout = undefined;
      if (!checkVideo()) showMessage('A imagem ainda não chegou.', true);
    }, 6000);
  }

  function play() {
    if (!stream || lifetime.aborted || document.hidden) return;
    waitForVideo();
    const attempt = ++playAttempt;
    void video.play().then(() => {
      if (attempt === playAttempt) checkVideo();
    }, error => {
      if (attempt !== playAttempt || error.name === 'AbortError') return;
      clearTimeout(timeout);
      timeout = undefined;
      showMessage(error.name === 'NotAllowedError'
        ? 'Toque para iniciar a reprodução.'
        : 'Não foi possível reproduzir a imagem.', true);
    });
  }

  for (const event of ['playing', 'loadeddata', 'resize']) {
    video.addEventListener(event, checkVideo, { signal: lifetime });
  }
  video.addEventListener('waiting', waitForVideo, { signal: lifetime });
  video.addEventListener('error', () => {
    if (!stream) return;
    clearTimeout(timeout);
    timeout = undefined;
    showMessage('Não foi possível carregar a imagem.', true);
  }, { signal: lifetime });
  retry.addEventListener('click', () => {
    if (!stream) return;
    showMessage('Aguardando a imagem da transmissão…');
    if (!video.paused || video.error) {
      video.srcObject = null;
      video.srcObject = stream;
    }
    play();
  }, { signal: lifetime });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !checkVideo()) play();
  }, { signal: lifetime });
  lifetime.addEventListener('abort', () => {
    clearTimeout(timeout);
    trackEvents?.abort();
    stream = null;
    ++playAttempt;
    video.srcObject = null;
  }, { once: true });

  return (active: MediaStream | null, watching: boolean) => {
    if (lifetime.aborted) return;
    if (stream === active) {
      if (!active) showMessage(watching ? 'Aguardando a transmissão…' : '');
      return;
    }
    clearTimeout(timeout);
    timeout = undefined;
    ++playAttempt;
    trackEvents?.abort();
    stream = active;
    video.hidden = !active;
    video.srcObject = active;
    if (!active) {
      showMessage(watching ? 'Aguardando a transmissão…' : '');
      return;
    }
    trackEvents = new AbortController();
    const options = { signal: trackEvents.signal };
    const track = active.getVideoTracks()[0];
    track?.addEventListener('unmute', () => { if (!checkVideo()) play(); }, options);
    track?.addEventListener('mute', waitForVideo, options);
    waitForVideo();
    play();
  };
}
