type UpdateStatus = 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'error' | 'unavailable';
type UpdateState = { version: string; status: UpdateStatus; availableVersion?: string };

export type DesktopUpdates = {
  getState: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  restart: () => Promise<void>;
  onStatus: (listener: (state: UpdateState) => void) => () => void;
};

export const desktopUpdateSettingsMarkup = `
  <section class="settings-section" id="settings-updates" aria-labelledby="settings-updates-title" hidden>
    <h3 id="settings-updates-title">Atualizações</h3>
    <p class="settings-description">Verifique se há uma nova versão do Discordo para Windows.</p>
    <div class="shortcut-row">
      <strong data-desktop-version>Versão instalada</strong>
      <button class="settings-button" type="button" data-check-updates disabled>Verificar atualizações</button>
      <button class="settings-button" type="button" data-restart-update hidden>Reiniciar agora</button>
    </div>
    <p class="settings-status" data-update-status role="status" data-state="neutral"></p>
  </section>`;

export function mountDesktopUpdateSettings(section: HTMLElement, updates: DesktopUpdates) {
  const version = section.querySelector('[data-desktop-version]')!;
  const status = section.querySelector<HTMLElement>('[data-update-status]')!;
  const check = section.querySelector<HTMLButtonElement>('[data-check-updates]')!;
  const restart = section.querySelector<HTMLButtonElement>('[data-restart-update]')!;
  let revision = 0;
  let closed = false;

  function paint(state: UpdateState) {
    if (closed) return;
    const next = state.availableVersion ? `A versão ${state.availableVersion}` : 'A atualização';
    const messages: Record<UpdateStatus, string> = {
      idle: '',
      checking: 'Verificando atualizações…',
      current: 'O Discordo está atualizado.',
      downloading: `Baixando ${state.availableVersion ? 'a versão ' + state.availableVersion : 'a atualização'}…`,
      ready: `${next} está pronta. Reinicie o Discordo para aplicar.`,
      error: 'Não foi possível verificar ou baixar a atualização. Tente novamente.',
      unavailable: 'A atualização automática está disponível na versão instalada do Discordo para Windows.',
    };
    version.textContent = `Versão instalada · ${state.version}`;
    status.textContent = messages[state.status];
    status.dataset.state = state.status === 'error' ? 'error'
      : (state.status === 'current' || state.status === 'ready') ? 'success' : 'neutral';
    check.disabled = ['checking', 'downloading', 'ready', 'unavailable'].includes(state.status);
    restart.hidden = state.status !== 'ready';
  }

  function showError() {
    if (closed) return;
    status.dataset.state = 'error';
    status.textContent = 'Não foi possível consultar o atualizador. Tente novamente.';
    check.disabled = false;
    restart.disabled = false;
  }

  const unsubscribe = updates.onStatus(state => {
    revision++;
    paint(state);
  });
  function refresh(request: () => Promise<UpdateState>) {
    const requested = revision;
    void request().then(state => { if (requested === revision) paint(state); }).catch(showError);
  }
  refresh(updates.getState);
  check.addEventListener('click', () => {
    check.disabled = true;
    refresh(updates.check);
  });
  restart.addEventListener('click', () => {
    restart.disabled = true;
    void updates.restart().catch(showError);
  });
  return () => { closed = true; unsubscribe(); };
}
