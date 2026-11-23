import { icon } from './icons';
import { voiceMemberMenuActions } from './voice-member-menu';

const prefix = (email: string) => `discordo:tutorial:${email}:`;
const session = new Map<string, string>();
const progress = ['welcome', 'sounds', 'absence', 'gameplay'] as const;

function read(key: string) {
  try { return localStorage.getItem(key) ?? session.get(key); }
  catch { return session.get(key); }
}

function write(key: string, value: string) {
  session.set(key, value);
  try { localStorage.setItem(key, value); } catch { /* The tour still works for this session. */ }
}

export function forgetTutorial(email: string) {
  for (const item of ['tour', 'gameplay', 'appearance']) {
    const key = prefix(email) + item;
    session.delete(key);
    try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
  }
}

export function startNewAccountTutorial(email: string) {
  const key = prefix(email) + 'tour';
  if (!read(key)) write(key, 'welcome');
}

export function mountTutorial(host: HTMLElement, email: string, previews: { sounds: string; gameplay: string },
  findTarget: (feature?: 'sounds' | 'absence' | 'gameplay') => HTMLElement | null) {
  const key = prefix(email) + 'tour';
  const steps = [
    { title: 'Bem-vindo ao Discordo', text: 'Personalize os sons das suas calls, chame alguém que está no mudo e combine a próxima jogatina.' },
    { title: 'Áudios personalizados', text: 'Em Configurações → Meu perfil, grave ou envie sons de até 2 segundos. Quando você entra ou sai de uma call, os outros participantes da chamada ouvem o som que você escolheu.' },
    { title: 'Verificar ausência', text: 'Na mesma call, clique com o botão direito no nome de quem está com o microfone ou o áudio desativado e escolha Verificar ausência. A opção fica abaixo de Editar cargos quando ele aparece. Só essa pessoa recebe o aviso e ouve o som que você configurou em Meu perfil.' },
    { title: 'Gameplay', text: 'Abra Gameplay no topo do chat para escolher um jogo, horário e convidados. O Discordo envia os convites por e-mail e publica uma enquete no canal escolhido.' },
  ];
  let dialog: HTMLDialogElement | undefined;
  let cleanup: (() => void) | undefined;

  function open(fromSettings = false) {
    const saved = read(key);
    if (dialog || (!fromSettings && (!saved || saved === 'done'))) return;
    const mandatory = !fromSettings;
    let step = mandatory ? Math.max(0, progress.findIndex(item => item === saved)) : 0;
    const modal = document.createElement('dialog');
    dialog = modal;
    modal.className = 'settings-dialog tutorial-card';
    const content = document.createElement('div');
    content.className = 'tutorial-content';
    modal.append(content);
    const spotlight = document.createElement('div');
    spotlight.className = 'tutorial-spotlight';
    spotlight.hidden = true;
    spotlight.setAttribute('aria-hidden', 'true');
    host.append(spotlight);
    const lifetime = new AbortController();
    let target: HTMLElement | null = null;
    let transitioning = false;
    modal.setAttribute('aria-labelledby', 'tutorial-title');
    modal.setAttribute('aria-describedby', 'tutorial-description');
    modal.addEventListener('cancel', event => {
      if (mandatory) event.preventDefault();
    });
    function dispose() {
      lifetime.abort();
      spotlight.remove();
      modal.remove();
      findTarget();
      if (dialog === modal) dialog = undefined;
      cleanup = undefined;
    }
    cleanup = dispose;
    modal.addEventListener('close', dispose, { once: true });
    function updateTarget() {
      const feature = progress[step];
      target = findTarget(feature === 'welcome' ? undefined : feature);
      position();
    }
    window.addEventListener('resize', updateTarget, { signal: lifetime.signal });

    function position() {
      const bounds = target?.getBoundingClientRect();
      const anchored = Boolean(bounds?.width && bounds.height);
      spotlight.hidden = !anchored;
      modal.toggleAttribute('data-anchored', anchored);
      if (!anchored || !bounds) return;

      const { left, top, right, bottom, width, height } = bounds;
      Object.assign(spotlight.style, {
        left: `${left - 3}px`, top: `${top - 3}px`, width: `${width + 6}px`, height: `${height + 6}px`,
      });
      const edge = 12;
      const gap = 16;
      const rightSpace = innerWidth - right - gap - edge;
      const leftSpace = left - gap - edge;
      if (Math.max(rightSpace, leftSpace) >= 365 && innerWidth > 720) {
        const toRight = rightSpace >= leftSpace;
        const cardWidth = Math.min(450, toRight ? rightSpace : leftSpace);
        modal.style.setProperty('--tutorial-width', `${cardWidth}px`);
        modal.style.setProperty('--tutorial-height', `${innerHeight - edge * 2}px`);
        modal.style.left = `${toRight ? right + gap : left - gap - cardWidth}px`;
        modal.style.top = `${Math.max(edge, Math.min(top, innerHeight - modal.offsetHeight - edge))}px`;
        return;
      }

      const above = top - gap - edge;
      const below = innerHeight - bottom - gap - edge;
      const fromTop = above >= below;
      modal.style.setProperty('--tutorial-width', `${Math.min(450, innerWidth - edge * 2)}px`);
      modal.style.setProperty('--tutorial-height', `${Math.max(120, fromTop ? above : below)}px`);
      modal.style.left = `${Math.max(edge, Math.min(left, innerWidth - modal.offsetWidth - edge))}px`;
      modal.style.top = `${fromTop ? Math.max(edge, top - gap - modal.offsetHeight) : bottom + gap}px`;
    }

    async function move(next: number) {
      if (transitioning) return;
      transitioning = true;
      const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (motion) {
        await content.animate([{ opacity: 1 }, { opacity: 0, translate: '0 -5px' }], {
          duration: 100, easing: 'ease-in', fill: 'forwards',
        }).finished.catch(() => {});
      }
      if (!modal.open || lifetime.signal.aborted) return;
      if (next === steps.length) {
        if (mandatory) write(key, 'done');
        modal.close();
        return;
      }
      for (const animation of content.getAnimations()) animation.cancel();
      step = next;
      render();
      if (motion) content.animate([{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], {
        duration: 185, easing: 'cubic-bezier(.2,.7,.2,1)',
      });
      transitioning = false;
    }

    function render() {
      if (mandatory) write(key, progress[step]);
      const { title, text } = steps[step];
      modal.dataset.step = String(step);
      const feature = progress[step];
      const preview = feature === 'absence' ? `<div class="tutorial-absence-preview">
        <div class="tutorial-voice-roster">
          <strong>Canais de voz</strong>
          <span class="tutorial-voice-channel">${icon('voice')} Resenha</span>
          <span class="tutorial-voice-person">
            <span class="avatar personal" aria-hidden="true">D</span> Discordo
            <span class="tutorial-voice-muted" role="img" aria-label="Microfone e fone silenciados">${icon('micOff')}${icon('headphonesOff')}</span>
            ${icon('more')}
          </span>
        </div>
        <div class="voice-member-menu tutorial-voice-menu">
          ${voiceMemberMenuActions(true, true)}
          <div class="voice-menu-section">
            <label class="voice-menu-volume">Volume do usuário <output>100%</output>
              <input class="volume-slider" type="range" min="0" max="100" value="100" style="--volume-fraction:1">
            </label>
            <label>Silenciar para mim <input type="checkbox"></label>
          </div>
        </div>
      </div>` : feature === 'welcome' ? '' : previews[feature];
      content.innerHTML = `
        <div class="tutorial-body">
        ${step === 0 ? `<img class="tutorial-welcome-art" src="${import.meta.env.BASE_URL}art/logo-principal.webp" alt="Logo do Discordo" width="2172" height="724">` : `<p class="tutorial-progress">Etapa ${step} de ${steps.length - 1}</p>`}
        <h2 id="tutorial-title" tabindex="-1" autofocus>${title}</h2>
        <p id="tutorial-description">${text}</p>
        ${preview ? `<fieldset class="tutorial-feature-preview" disabled aria-label="Exemplo de ${title}">${preview}</fieldset>` : ''}
        </div>
        <div class="tutorial-actions">
          ${!mandatory ? '<button class="settings-button" type="button" data-tutorial-skip>Fechar tutorial</button>' : ''}
          ${step ? '<button class="settings-button" type="button" data-tutorial-back>Voltar</button>' : ''}
          <button class="primary-button" type="button" data-tutorial-next>${step === 0 ? 'Começar' : step === steps.length - 1 ? 'Concluir' : 'Próximo'}</button>
        </div>`;
      modal.querySelector('[data-tutorial-skip]')?.addEventListener('click', () => modal.close());
      modal.querySelector('[data-tutorial-back]')?.addEventListener('click', () => void move(step - 1));
      modal.querySelector('[data-tutorial-next]')!.addEventListener('click', () => void move(step + 1));
      updateTarget();
      if (modal.open) modal.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    }

    render();
    host.append(modal);
    modal.showModal();
    position();
  }

  return { open, dispose() { cleanup?.(); } };
}
