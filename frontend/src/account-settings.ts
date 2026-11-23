import { accountRequest, type Account } from './accounts';

const row = (label: string, value: string, action = '') => `
  <div class="account-setting-row">
    <dt>${label}</dt><dd>${value}</dd>${action || '<span></span>'}
  </div>`;
const edit = (key: string, label: string, text = 'Editar') =>
  `<button class="settings-button" type="button" data-account-edit="${key}" aria-label="${label}">${text}</button>`;
const reveal = (key: string) => `<button class="account-reveal" type="button" data-account-reveal="${key}" aria-pressed="false">Mostrar</button>`;

export const accountSettingsMarkup = `
  <section class="account-setting-group" aria-labelledby="account-identity">
    <h4 id="account-identity" tabindex="-1">Informações da conta</h4>
    <dl>
      ${row('Nome de exibição', '<span data-account-value="name"></span>', edit('name', 'Editar nome de exibição'))}
      ${row('E-mail', '<span data-account-value="email"></span>' + reveal('email'), edit('email', 'Editar e-mail'))}
      ${row('Telefone', '<span data-account-value="phone">Carregando…</span>' + reveal('phone'), edit('phone', 'Editar telefone'))}
      ${row('Data de nascimento', '<span data-account-value="birth"></span>')}
    </dl>
    <div data-account-contact-editor></div>
  </section>
  <section class="account-setting-group" aria-labelledby="account-security">
    <h4 id="account-security" tabindex="-1">Senha e segurança</h4>
    <dl>
      ${row('Senha', '<span aria-hidden="true">••••••••</span>', edit('password', 'Editar senha'))}
      ${row('Autenticação multifatorial', '<span class="account-security-state">Código por e-mail</span>', edit('verification', 'Ver autenticação multifatorial', 'Ver detalhes'))}
      ${row('Dispositivos conectados', '<span data-account-session-count>Carregando…</span>', edit('sessions', 'Ver sessões conectadas', 'Gerenciar'))}
    </dl>
    <div data-account-security-editor></div>
  </section>`;

export function mountAccountSettings(section: HTMLElement, account: Account, rename: (name: string) => Promise<void>) {
  let phone: string | null | undefined;
  let sessions: { id: number; current: boolean }[] | undefined;
  const shown = new Set<string>();
  let emailToken: string | undefined;
  const contact = section.querySelector<HTMLElement>('[data-account-contact-editor]')!;
  const security = section.querySelector<HTMLElement>('[data-account-security-editor]')!;
  const status = section.querySelector<HTMLElement>('[data-account-status]')!;
  const value = (key: string) => section.querySelector<HTMLElement>(`[data-account-value="${key}"]`)!;
  value('birth').textContent = account.birthDate?.split('-').reverse().join('/') || 'Não informada';

  function paint() {
    value('name').textContent = account.name;
    value('email').textContent = shown.has('email') ? account.email : '••••••••' + account.email.slice(account.email.lastIndexOf('@'));
    value('phone').textContent = phone === undefined ? 'Indisponível' : phone
      ? shown.has('phone') ? phone : '•••••• ' + phone.slice(-4) : 'Não adicionado';
    for (const button of section.querySelectorAll<HTMLButtonElement>('[data-account-reveal]')) {
      const key = button.dataset.accountReveal!;
      button.hidden = key === 'phone' && !phone;
      button.setAttribute('aria-pressed', String(shown.has(key)));
      button.textContent = shown.has(key) ? 'Ocultar' : 'Mostrar';
      button.setAttribute('aria-label', `${button.textContent} ${key === 'email' ? 'e-mail' : 'telefone'}`);
    }
    section.querySelector('[data-account-session-count]')!.textContent = sessions
      ? `${sessions.length} ${sessions.length === 1 ? 'sessão' : 'sessões'}` : 'Indisponível';
  }

  async function refresh() {
    try {
      const details = await accountRequest({ action: 'accountDetails' });
      if (!Array.isArray(details.sessions)) throw new Error('Não foi possível carregar os dados da conta.');
      phone = details.phone ?? null;
      sessions = details.sessions;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Não foi possível carregar os dados da conta.';
    }
    paint();
  }

  function closeEditor() {
    contact.replaceChildren();
    security.replaceChildren();
    emailToken = undefined;
    if (activeButton) activeButton.setAttribute('aria-expanded', 'false');
    activeButton = undefined;
  }
  let activeButton: HTMLButtonElement | undefined;
  const currentPassword = '<label>Senha atual<input type="password" name="password" autocomplete="current-password" required maxlength="128"></label>';
  const fields: Record<string, string> = {
    name: '<label>Nome de exibição<input name="name" maxlength="40" required autocomplete="nickname"></label>',
    email: '<label>Novo e-mail<input type="email" name="email" maxlength="254" required autocomplete="email"></label>' + currentPassword,
    phone: '<label>Telefone<input type="tel" name="phone" maxlength="24" autocomplete="tel"></label><p class="settings-hint">Deixe em branco para remover. O número é salvo como contato.</p>' + currentPassword,
    password: currentPassword + '<label>Nova senha<input type="password" name="newPassword" autocomplete="new-password" minlength="8" maxlength="128" required></label>'
      + '<label>Confirmar nova senha<input type="password" name="confirm" autocomplete="new-password" minlength="8" maxlength="128" required></label>'
      + '<p class="settings-hint">Ao trocar a senha, as outras sessões serão encerradas.</p>',
  };
  section.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const visibility = target.closest<HTMLButtonElement>('[data-account-reveal]');
    if (visibility) {
      const key = visibility.dataset.accountReveal!;
      if (shown.has(key)) shown.delete(key); else shown.add(key);
      paint();
    }
    const button = target.closest<HTMLButtonElement>('[data-account-edit]');
    if (!button || section.querySelector('[data-account-busy]')) return;
    const wasOpen = button === activeButton;
    closeEditor();
    if (wasOpen) return;
    activeButton = button;
    button.setAttribute('aria-expanded', 'true');
    const key = button.dataset.accountEdit!;
    const host = ['password', 'verification', 'sessions'].includes(key) ? security : contact;
    const cancel = () => { closeEditor(); button.focus(); };
    status.textContent = '';
    if (key === 'verification') {
      host.innerHTML = '<div class="account-inline-editor"><p>O Discordo envia um código de uso único ao criar a conta ou ao entrar em um navegador que ainda não reconhece. O código expira em 10 minutos.</p><button type="button" class="settings-button">Fechar detalhes</button></div>';
      host.querySelector('button')!.onclick = cancel;
      host.querySelector('button')!.focus();
      return;
    }
    if (key === 'sessions') {
      host.innerHTML = '<div class="account-inline-editor"><p>Gerencie as sessões abertas na sua conta.</p><ul class="account-session-list"></ul><p class="settings-status" role="status"></p></div>';
      const list = host.querySelector('ul')!;
      const feedback = host.querySelector<HTMLElement>('[role=status]')!;
      const draw = () => {
        list.replaceChildren();
        for (const [index, session] of (sessions ?? []).entries()) {
          const item = document.createElement('li');
          item.textContent = session.current ? 'Sessão atual' : `Outra sessão ${index}`;
          if (!session.current) {
            const end = document.createElement('button');
            end.type = 'button';
            end.className = 'settings-button';
            end.textContent = 'Encerrar';
            end.onclick = async () => {
              end.disabled = true;
              try {
                const result = await accountRequest({ action: 'revokeAccountSession', sessionId: session.id });
                if (!result.saved) throw new Error('Não foi possível encerrar a sessão.');
                await refresh();
                if (host.contains(list)) { draw(); feedback.textContent = 'Sessão encerrada.'; }
              } catch (error) {
                feedback.textContent = error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.';
                end.disabled = false;
              }
            };
            item.append(end);
          }
          list.append(item);
        }
      };
      draw();
      void refresh().then(() => { if (host.contains(list)) draw(); });
      return;
    }
    host.innerHTML = `<form class="account-inline-editor">${fields[key]}
      <p class="settings-status" role="status"></p>
      <div class="profile-photo-actions"><button type="submit" class="primary-button">${key === 'email' ? 'Enviar código' : 'Salvar'}</button>
      <button type="button" class="settings-button" data-cancel>Cancelar</button></div></form>`;
    const form = host.querySelector('form')!;
    const input = form.querySelector('input')!;
    if (key === 'name') input.value = account.name;
    if (key === 'phone') input.value = phone ?? '';
    input.focus();
    form.addEventListener('click', event => { if ((event.target as HTMLElement).closest('[data-cancel]')) cancel(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      event.stopPropagation();
      if (form.hasAttribute('data-account-busy')) return;
      const values = Object.fromEntries(new FormData(form));
      const feedback = form.querySelector<HTMLElement>('[role=status]')!;
      const controls = [...form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button')];
      form.setAttribute('data-account-busy', '');
      controls.forEach(control => control.disabled = true);
      feedback.textContent = '';
      try {
        if (key === 'name') await rename(String(values.name));
        else if (key === 'password') {
          if (values.newPassword !== values.confirm) throw new Error('As novas senhas precisam ser iguais.');
          const result = await accountRequest({ action: 'changeAccountPassword', password: values.password, newPassword: values.newPassword });
          if (!result.saved) throw new Error('Não foi possível salvar a senha.');
          await refresh();
        } else if (key === 'phone') {
          const result = await accountRequest({ action: 'changeAccountPhone', ...values });
          if (!result.saved) throw new Error('Não foi possível salvar o telefone.');
          await refresh();
        } else if (!emailToken) {
          const result = await accountRequest({ action: 'requestAccountEmail', ...values });
          if (!result.verification) throw new Error('Não foi possível enviar o código.');
          emailToken = result.verification.token;
          form.innerHTML = `<p>Digite o código enviado ao novo endereço. As outras sessões serão encerradas após a confirmação.</p>
            <label>Código de verificação<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
            <p class="settings-status" role="status"></p><div class="profile-photo-actions"><button type="submit" class="primary-button">Confirmar e-mail</button>
            <button type="button" class="settings-button" data-cancel>Cancelar</button></div>`;
          form.querySelector('input')!.focus();
          return;
        } else {
          const result = await accountRequest({ action: 'confirmAccountEmail', token: emailToken, code: values.code });
          if (!result.email) throw new Error('Não foi possível confirmar o e-mail.');
          migrateLocalAccountKeys(account.email, result.email);
          location.reload();
          return;
        }
        paint();
        cancel();
        status.textContent = key === 'password' ? 'Senha alterada. As outras sessões foram encerradas.' : 'Alteração salva.';
      } catch (error) {
        feedback.textContent = error instanceof Error ? error.message : 'Não foi possível salvar a alteração.';
      } finally {
        controls.forEach(control => control.disabled = false);
        form.removeAttribute('data-account-busy');
      }
    });
  });
  paint();
  return { refresh, busy: () => Boolean(section.querySelector('[data-account-busy]')), reset() {
    closeEditor();
    shown.clear();
    paint();
  } };
}

function migrateLocalAccountKeys(previous: string, next: string) {
  try {
    const families = ['profile-media', 'voice', 'shortcuts', 'participant-audio', 'categories', 'tutorial'];
    for (const key of Object.keys(localStorage)) {
      const prefix = families.map(family => `discordo:${family}:${previous}`).find(prefix => key === prefix || key.startsWith(prefix + ':'));
      const value = prefix && localStorage.getItem(key);
      if (!prefix || value === null || value === undefined) continue;
      const target = prefix.slice(0, -previous.length) + next + key.slice(prefix.length);
      if (localStorage.getItem(target) === null) localStorage.setItem(target, value);
      localStorage.removeItem(key);
    }
  } catch { /* Account changes also work with storage disabled. */ }
}
