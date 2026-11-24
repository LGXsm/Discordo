import { accountSettingsMarkup, mountAccountSettings } from './account-settings';
import { deleteAccount, updateProfile, type Account, type Profile } from './accounts';
import { prepareAvatar, prepareProfileBanner, profileImageAccept, renderAvatar, renderImage } from './avatar';
import { editAvatar } from './avatar-editor';
import { icon } from './icons';
import { readVoicePreferences, type VoicePreferences } from './voice-preferences';
import { mountVoiceSettings, voiceSettingsMarkup } from './voice-settings';
import { mountProfileSounds, profileSoundsMarkup } from './profile-sounds';
import { dismissOnBackdrop } from './dialog-dismiss';
import { mountShortcutSettings, shortcutSettingsMarkup } from './shortcuts';
import { desktopUpdateSettingsMarkup, mountDesktopUpdateSettings } from './desktop-updates';
import { mountProfileAppearance, profileAppearanceMarkup, profileDecorationsMarkup, stopProfileEffect } from './profile-appearance';
import { confirmSettingsExit } from './settings-confirm';
import { profileCardDetailsMarkup, renderProfileCardDetails, type ProfileCardDetails } from './profile-card-details';

const settingsSections = [
  { key: 'profile', glyph: 'profile', label: 'Meu perfil', links: [['profile-basic', 'Identidade'], ['profile-appearance-title', 'Aparência do cartão'], ['profile-audio', 'Áudios personalizados']] },
  { key: 'account', glyph: 'lock', label: 'Minha conta', links: [['account-identity', 'Informações da conta'], ['account-security', 'Senha e segurança'], ['account-actions', 'Sessão e conta']] },
  { key: 'voice', glyph: 'mic', label: 'Voz', links: [['voice-input-section', 'Microfone'], ['voice-output-section', 'Saída de áudio'], ['voice-sounds-section', 'Sons da sala']] },
  { key: 'shortcuts', glyph: 'keyboard', label: 'Atalhos', links: [['shortcut-bindings', 'Teclas de atalho'], ['shortcut-extension', 'Extensão do Chrome']] },
] as const;

export function openSettings(
  host: HTMLElement,
  account: Account,
  onSave: (account: Account) => void,
  exitAccount: (action: 'switch' | 'logout') => Promise<boolean>,
  onVoiceSave: (preferences: VoicePreferences) => void,
  onMicrophoneAllowed: () => void,
  initial: 'profile' | 'voice' = 'profile',
  canHear = () => true,
  details: ProfileCardDetails = { roles: [], editProfile: true, editRoles: false },
  onAccountDeleted?: () => void,
  onTutorial?: () => void,
) {
  const dialog = document.createElement('dialog');
  const desktopUpdates = window.discordoDesktop?.updates;
  const navigationSections = desktopUpdates
    ? [...settingsSections, { key: 'updates', glyph: 'clock', label: 'Atualizações', links: [] } as const]
    : settingsSections;
  dialog.className = 'settings-dialog user-settings';
  dialog.setAttribute('aria-labelledby', 'settings-title');
  dialog.innerHTML = `
    <header class="settings-header">
      <h2 id="settings-title">Configurações de usuário</h2>
      <button class="icon-button" type="button" data-close aria-label="Fechar configurações">${icon('close')}</button>
    </header>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="Seções das configurações">
        ${navigationSections.map(({ key, glyph, label, links }) => `
          <button type="button" aria-pressed="${initial === key}" ${links.length ? `aria-expanded="${initial === key}"` : ''} aria-controls="settings-${key}" ${initial === key ? 'autofocus' : ''}>${icon(glyph)} ${label}</button>
          ${links.length ? `<div class="settings-subnav" data-parent-tab="settings-${key}" ${initial === key ? 'data-expanded' : 'inert'}>
            <div class="settings-subnav-items">
              ${links.map(([target, text]) => `<button type="button" data-settings-jump="${target}">${text}</button>`).join('')}
            </div>
          </div>` : ''}`).join('')}
      </nav>
      <div class="settings-content">
      <section class="settings-section" id="settings-profile" aria-labelledby="settings-profile-title" ${initial === 'voice' ? 'hidden' : ''}>
        <h3 id="settings-profile-title">Meu perfil</h3>
        <p class="settings-description">Personalize como você aparece no Discordo.</p>
        <div class="profile-editor">
        <div class="profile-fields">
        <form class="profile-form" id="profile-basic" aria-labelledby="profile-basic-title">
          <h4 class="settings-group-title" id="profile-basic-title">Identidade</h4>
          <label for="profile-name">Nome de exibição</label>
          <input id="profile-name" class="profile-name" autocomplete="nickname" maxlength="40" required>
          <div class="profile-image-actions">
            ${([['avatar', 'foto'], ['banner', 'banner']] as const).map(([kind, label]) => `
              <div class="profile-image-pair">
                <input type="file" accept="${profileImageAccept}" data-media-file="${kind}" hidden>
                <button type="button" class="settings-button" data-photo="${kind}">Alterar ${label}</button>
                <button type="button" class="settings-button profile-image-remove" data-remove-photo="${kind}"
                  aria-label="Remover ${label}" title="Remover ${label}">${icon('trash')}</button>
              </div>`).join('')}
          </div>
          <small class="settings-hint">JPG, PNG ou WebP até 8 MB. GIF até 1 MB.</small>
        </form>
        ${profileAppearanceMarkup}
        <h4 class="settings-group-title" id="profile-audio">Áudios personalizados</h4>
        <p class="settings-hint">Grave ou envie um áudio de até 2 segundos e 200 KB.</p>
        ${profileSoundsMarkup}
        </div>
        <aside class="profile-preview-panel" aria-labelledby="profile-preview-title">
        <h4 id="profile-preview-title">Prévia do perfil</h4>
        <div class="profile-preview">
          <div class="profile-banner" data-preview-banner aria-hidden="true"></div>
          <div class="profile-identity">
            <span class="avatar personal" aria-hidden="true" data-preview-avatar></span>
            <h2 data-preview-name></h2>
            <p class="profile-bio" data-profile-bio hidden></p>
            ${profileCardDetailsMarkup}
          </div>
          ${profileDecorationsMarkup}
        </div>
        <button type="button" class="settings-button profile-replay" data-preview-effect>Reproduzir efeito</button>
        </aside>
        </div>
      </section>
      <section class="settings-section" id="settings-account" aria-labelledby="settings-account-title" hidden>
        <h3 id="settings-account-title">Minha conta</h3>
        ${accountSettingsMarkup}
        <h4 class="settings-group-title account-actions-title" id="account-actions">Sessão e conta</h4>
        <div class="profile-photo-actions">
          ${onTutorial ? '<button class="settings-button" type="button" data-reopen-tutorial>Tutorial</button>' : ''}
          <button class="settings-button" type="button" data-account-action="switch">${icon('swap')} Trocar de conta</button>
          <button class="settings-button" type="button" data-account-action="logout">${icon('logout')} Sair</button>
          <button class="settings-button danger-button" type="button" data-delete-account>${icon('trash')} Excluir conta</button>
        </div>
        <p class="settings-status" data-account-status role="status"></p>
      </section>
      ${voiceSettingsMarkup}
      ${shortcutSettingsMarkup}
      ${desktopUpdates ? desktopUpdateSettingsMarkup : ''}
      </div>
    </div>
    <div class="settings-footer user-settings-footer">
      <p class="settings-status" data-save-status role="status"></p>
      <button class="primary-button" type="button" data-save-settings>Salvar alterações</button>
    </div>`;

  const form = dialog.querySelector<HTMLFormElement>('.profile-form')!;
  const name = form.querySelector<HTMLInputElement>('#profile-name')!;
  const save = dialog.querySelector<HTMLButtonElement>('[data-save-settings]')!;
  const status = dialog.querySelector<HTMLElement>('[data-save-status]')!;
  const layout = dialog.querySelector<HTMLElement>('.settings-layout')!;
  const content = dialog.querySelector<HTMLElement>('.settings-content')!;
  const preview = dialog.querySelector<HTMLElement>('.profile-preview')!;
  renderProfileCardDetails(preview, details);
  const previewAvatar = preview.querySelector('[data-preview-avatar]')!;
  const previewBanner = preview.querySelector('[data-preview-banner]')!;
  const previewName = preview.querySelector('[data-preview-name]')!;
  const draft: Profile = {
    name: account.name, avatarUrl: account.avatarUrl,
    avatarStillUrl: account.avatarStillUrl, avatarCrop: account.avatarCrop, bannerUrl: account.bannerUrl,
  };
  const mediaControls = (['avatar', 'banner'] as const).map(kind => ({
    kind,
    key: kind === 'avatar' ? 'avatarUrl' as const : 'bannerUrl' as const,
    file: form.querySelector<HTMLInputElement>(`[data-media-file="${kind}"]`)!,
    pick: form.querySelector<HTMLButtonElement>(`[data-photo="${kind}"]`)!,
    remove: form.querySelector<HTMLButtonElement>(`[data-remove-photo="${kind}"]`)!,
  }));
  let saved = { ...account };
  let loadingPhoto = false;
  let saving = false;
  let leaving = false;
  const appearance = mountProfileAppearance(dialog.querySelector<HTMLFormElement>('.profile-appearance-form')!, preview,
    dialog.querySelector<HTMLButtonElement>('[data-preview-effect]')!, account.email, account.appearance, appearance => {
      saved.appearance = appearance;
      onSave(saved);
    }, changed);
  const sounds = mountProfileSounds(dialog, account, sounds => {
    Object.assign(saved, sounds);
    onSave(saved);
  }, canHear, refreshSave);
  const shortcuts = mountShortcutSettings(dialog.querySelector<HTMLElement>('#settings-shortcuts')!, account.email, changed);
  const voice = dialog.querySelector<HTMLElement>('#settings-voice')!;
  const voiceEditor = mountVoiceSettings(voice, account.email, readVoicePreferences(account.email), onVoiceSave, onMicrophoneAllowed, canHear, changed);
  const editors = [appearance, sounds, voiceEditor, shortcuts];
  name.value = saved.name;

  const accountSection = dialog.querySelector<HTMLElement>('#settings-account')!;
  const accountEditor = mountAccountSettings(accountSection, account, async displayName => {
    const cleaned = displayName.trim();
    if (!cleaned) throw new Error('Digite um nome de exibição.');
    saved = await updateProfile(saved, { ...saved, name: cleaned });
    account.name = saved.name;
    resetProfile();
    refreshPreview();
    onSave(saved);
  });

  function refreshPreview() {
    const preview = { ...draft, name: name.value.trim() || saved.name };
    renderAvatar(previewAvatar, preview, true);
    renderImage(previewBanner, draft.bannerUrl);
    previewName.textContent = preview.name;
    for (const { key, pick, remove } of mediaControls) {
      pick.disabled = loadingPhoto || saving;
      remove.disabled = loadingPhoto || saving || !draft[key];
    }
    refreshSave();
  }

  const profileDirty = () => name.value.trim() !== saved.name || draft.avatarUrl !== saved.avatarUrl
    || draft.avatarCrop !== saved.avatarCrop || draft.bannerUrl !== saved.bannerUrl;
  const dirty = () => profileDirty() || editors.some(editor => editor.dirty());
  function refreshSave() { save.disabled = saving || loadingPhoto || sounds.busy() || !dirty(); }
  function changed() { setStatus(''); refreshSave(); }

  function setStatus(message: string, state: 'error' | 'success' | 'neutral' = 'neutral') {
    status.textContent = message;
    status.dataset.state = state;
  }

  name.addEventListener('input', () => {
    if (!loadingPhoto) setStatus('');
    refreshPreview();
  });
  for (const { kind, key, file, pick, remove } of mediaControls) {
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const image = file.files?.[0];
      file.value = '';
      if (!image) return;
      loadingPhoto = true;
      refreshPreview();
      setStatus('Preparando imagem…');
      try {
        if (kind === 'avatar') {
          const result = await prepareAvatar(image, bitmap => editAvatar(dialog, bitmap));
          if (result) Object.assign(draft, { avatarUrl: result.url, avatarStillUrl: result.still, avatarCrop: result.crop });
        } else {
          draft.bannerUrl = (await prepareProfileBanner(image)).url;
        }
        setStatus('');
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Não foi possível carregar a imagem.', 'error');
      } finally {
        loadingPhoto = false;
        refreshPreview();
      }
    });
    remove.addEventListener('click', () => {
      draft[key] = undefined;
      if (kind === 'avatar') {
        draft.avatarStillUrl = undefined;
        draft.avatarCrop = undefined;
      }
      setStatus('');
      refreshPreview();
      pick.focus();
    });
  }
  async function saveAll() {
    if (saving || loadingPhoto || sounds.busy()) {
      setStatus('Aguarde a preparação dos arquivos para salvar.');
      return false;
    }
    if (!dirty()) return true;
    const displayName = name.value.trim();
    if (!displayName) {
      setStatus('Digite um nome de exibição.', 'error');
      name.focus();
      return false;
    }
    saving = true;
    layout.inert = true;
    setStatus('Salvando…');
    refreshPreview();
    try {
      if (profileDirty()) {
        saved = await updateProfile(saved, { ...draft, name: displayName });
        resetProfile();
        onSave(saved);
      }
      for (const editor of editors) await editor.save();
      setStatus('Alterações salvas.', 'success');
      return true;
    } catch (error) {
      setStatus(error instanceof Error && error.constructor === Error
        ? error.message : 'Não foi possível salvar o perfil. Confira sua conexão.', 'error');
      return false;
    } finally {
      saving = false;
      layout.inert = false;
      refreshPreview();
    }
  }

  function resetProfile() {
    name.value = saved.name;
    Object.assign(draft, { avatarUrl: saved.avatarUrl, avatarStillUrl: saved.avatarStillUrl,
      avatarCrop: saved.avatarCrop, bannerUrl: saved.bannerUrl });
  }

  async function leaveSettings(proceed: () => void | Promise<void>) {
    if (leaving || saving || loadingPhoto || accountEditor.busy()) return;
    leaving = true;
    try {
      if (dirty() || sounds.busy()) {
        const choice = await confirmSettingsExit();
        if (choice === 'stay' || (choice === 'save' && !await saveAll())) return;
        if (choice === 'discard') {
          resetProfile();
          for (const editor of editors) editor.reset();
          setStatus('');
          refreshPreview();
        }
      }
      await proceed();
    } finally { leaving = false; }
  }

  save.addEventListener('click', () => void saveAll());
  dialog.addEventListener('submit', event => { event.preventDefault(); void saveAll(); });

  dialog.querySelector('[data-reopen-tutorial]')?.addEventListener('click', () => {
    void leaveSettings(() => {
      dialog.close();
      onTutorial?.();
    });
  });
  const sections = dialog.querySelectorAll<HTMLElement>('.settings-section');
  const navigation = dialog.querySelectorAll<HTMLButtonElement>('.settings-nav button[aria-controls]');
  voice.hidden = initial !== 'voice';
  for (const button of navigation) {
    button.addEventListener('click', () => {
      if (button.getAttribute('aria-pressed') === 'true') return;
      void leaveSettings(() => {
        for (const item of navigation) {
          item.setAttribute('aria-pressed', String(item === button));
          if (item.hasAttribute('aria-expanded')) item.setAttribute('aria-expanded', String(item === button));
        }
        for (const section of sections) section.hidden = section.id !== button.getAttribute('aria-controls');
        const targetSection = button.getAttribute('aria-controls');
        for (const group of submenus) {
          const expanded = group.dataset.parentTab === targetSection;
          group.inert = !expanded;
          group.toggleAttribute('data-expanded', expanded);
        }
        if (targetSection === 'settings-account') void accountEditor.refresh();
        else accountEditor.reset();
        if (targetSection !== 'settings-profile') stopProfileEffect(preview);
        if (!voice.hidden) void voiceEditor.refresh();
        content.scrollTop = 0;
        jumpPosition = undefined;
        followSection();
        button.focus();
      });
    });
  }
  const submenus = dialog.querySelectorAll<HTMLElement>('.settings-subnav');
  const sectionLinks = [...dialog.querySelectorAll<HTMLButtonElement>('[data-settings-jump]')].flatMap(button => {
    const target = dialog.querySelector<HTMLElement>('#' + button.dataset.settingsJump);
    if (target) return [{ button, target }];
    button.remove();
    return [];
  });
  let jumpPosition: number | undefined;
  function selectLink(active?: HTMLButtonElement) {
    for (const { button } of sectionLinks) {
      if (button === active) button.setAttribute('aria-current', 'location');
      else button.removeAttribute('aria-current');
    }
  }
  function sectionPositions() {
    const top = content.getBoundingClientRect().top + 24;
    const visible = sectionLinks.filter(({ target }) => !target.closest('[hidden]')).map(link => ({
      ...link,
      position: Math.max(0, content.scrollTop + link.target.getBoundingClientRect().top - top),
    }));
    const limit = Math.max(0, content.scrollHeight - content.clientHeight);
    const lastPosition = visible.at(-1)?.position ?? 0;
    // Fit the section boundaries into the available scroll range when the final heading cannot reach the top.
    if (lastPosition > limit) {
      for (const link of visible) link.position *= limit / lastPosition;
    }
    return { visible, limit };
  }
  function followSection() {
    const { visible, limit } = sectionPositions();
    let active = visible[0];
    if (limit > 0 && content.scrollTop > 0) {
      if (limit - content.scrollTop <= 1) active = visible.at(-1) ?? active;
      else for (const link of visible) {
        if (link.position <= content.scrollTop) active = link;
      }
    }
    selectLink(active?.button);
  }
  content.addEventListener('scroll', () => {
    if (jumpPosition !== undefined && Math.abs(content.scrollTop - jumpPosition) < 1) return;
    jumpPosition = undefined;
    followSection();
  }, { passive: true });
  for (const { button, target } of sectionLinks) button.addEventListener('click', () => {
    if (button.closest('[inert]') || target.closest('[hidden]')) return;
    selectLink(button);
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    const destination = sectionPositions().visible.find(link => link.button === button);
    if (destination) content.scrollTop = destination.position;
    jumpPosition = content.scrollTop;
  });
  for (const button of dialog.querySelectorAll<HTMLButtonElement>('[data-account-action]')) {
    button.addEventListener('click', () => void leaveSettings(async () => {
      const action = button.dataset.accountAction === 'switch' ? 'switch' : 'logout';
      button.disabled = true;
      if (!await exitAccount(action)) {
        button.disabled = false;
        dialog.querySelector('[data-account-status]')!.textContent = 'Não foi possível encerrar a sessão.';
      }
    }));
  }
  dialog.querySelector('[data-delete-account]')!.addEventListener('click', () => void leaveSettings(() => {
    const confirm = document.createElement('dialog');
    confirm.className = 'settings-dialog settings-confirm account-delete-confirm';
    confirm.setAttribute('aria-labelledby', 'delete-account-title');
    confirm.setAttribute('aria-describedby', 'delete-account-description');
    confirm.innerHTML = `
      <form>
        <div class="account-delete-body">
          <div>
            <h2 id="delete-account-title">Excluir sua conta?</h2>
            <p id="delete-account-description">Seu perfil, mensagens, arquivos e servidores sem outros membros serão apagados permanentemente. Você perderá a propriedade dos servidores compartilhados.</p>
          </div>
          <div class="account-delete-field">
            <label for="delete-account-password">Senha da conta</label>
            <input type="password" id="delete-account-password" name="password" autocomplete="current-password" required maxlength="128" autofocus>
            <p class="settings-status" role="status"></p>
          </div>
        </div>
        <div class="account-delete-actions">
          <button type="button" class="settings-button" data-cancel>Cancelar</button>
          <button type="submit" class="settings-button danger-button">Excluir conta</button>
        </div>
      </form>`;
    const form = confirm.querySelector('form')!;
    const password = form.querySelector('input')!;
    const cancel = form.querySelector<HTMLButtonElement>('[data-cancel]')!;
    const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
    const feedback = form.querySelector('[role=status]')!;
    cancel.addEventListener('click', () => confirm.close());
    confirm.addEventListener('cancel', event => { if (submit.disabled) event.preventDefault(); });
    dismissOnBackdrop(confirm, () => !submit.disabled);
    confirm.addEventListener('close', () => confirm.remove(), { once: true });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (submit.disabled) return;
      password.readOnly = cancel.disabled = submit.disabled = true;
      feedback.textContent = 'Excluindo conta…';
      try {
        await deleteAccount(account.email, password.value);
        password.value = '';
        confirm.close();
        dialog.close();
        onAccountDeleted?.();
      } catch (error) {
        feedback.textContent = (error as Error).message;
        password.readOnly = cancel.disabled = submit.disabled = false;
        password.select();
        password.focus();
      }
    });
    document.body.append(confirm);
    confirm.showModal();
  }));
  const close = () => void leaveSettings(() => dialog.close());
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dismissOnBackdrop(dialog, undefined, close);
  const updateSection = dialog.querySelector<HTMLElement>('#settings-updates');
  const unmountUpdates = desktopUpdates && updateSection && mountDesktopUpdateSettings(updateSection, desktopUpdates);
  dialog.addEventListener('close', () => {
    if (unmountUpdates) unmountUpdates();
    dialog.remove();
  });
  refreshPreview();
  host.append(dialog);
  dialog.showModal();
  followSection();
  if (!voice.hidden) void voiceEditor.refresh();
}
