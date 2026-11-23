import { dismissOnBackdrop } from './dialog-dismiss';
import { icon } from './icons';
import { safeText, type ServerMember } from './servers';

const responseStyles = {
  CONFIRMADO: { icon: 'check', label: 'Confirmado' },
  RECUSADO: { icon: 'close', label: 'Recusado' },
  INTERESSADO: { icon: 'clock', label: 'Aguardando aprovação' },
} as const;

export type GameplayPoll = {
  id: number; message: number; game: string; comment?: string; start: string; owner: boolean;
  status: 'CONVIDADO' | 'CONFIRMADO' | 'RECUSADO' | 'INTERESSADO' | null;
  confirmed: string[]; declined: number; interested: number;
  participants?: { member: number; name: string; status: keyof typeof responseStyles }[];
};

const schedule = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const dayLabel = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const endpoint = new URL(`${import.meta.env.BASE_URL}chat.php`, document.baseURI);

export async function sendGameplay(channel: number, data: object) {
  const url = new URL(endpoint);
  url.searchParams.set('channel', String(channel));
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Discordo-Request': 'chat' },
    body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Não foi possível atualizar o Gameplay.');
  return result as { id: number; message?: number; emailFailures?: number };
}

export function renderGameplay(card: HTMLElement, poll: GameplayPoll) {
  const closed = new Date(poll.start).getTime() <= Date.now();
  const signature = JSON.stringify([poll, closed]);
  if (card.dataset.rendered === signature) return;
  card.dataset.rendered = signature;
  card.dataset.gameplay = String(poll.id);
  const focused = card.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.gameplayAction : undefined;
  const tally = (count: number, singular: string, plural: string) => `${count} ${count === 1 ? singular : plural}`;
  const vote = (choice: string, label: string) => `<button class="settings-button" type="button" data-gameplay-action="${choice}"
    aria-pressed="${poll.status === choice}">${label}</button>`;
  const participants = poll.participants ?? poll.confirmed.map(name => ({ name, status: 'CONFIRMADO' as const, member: 0 }));
  card.innerHTML = `
    <p class="gameplay-label">Gameplay</p>
    <h3>${safeText(poll.game)}</h3>
    <time datetime="${safeText(poll.start)}">${schedule.format(new Date(poll.start))} · horário local</time>
    ${poll.comment ? `<p class="gameplay-comment">${safeText(poll.comment)}</p>` : ''}
    <p class="gameplay-tally">${tally(poll.confirmed.length, 'confirmado', 'confirmados')} · ${tally(poll.declined, 'recusa', 'recusas')} · ${tally(poll.interested, 'interessado', 'interessados')}</p>
    ${participants.length ? `<ul class="gameplay-responses" aria-label="Respostas ao Gameplay">${participants.map(participant => {
      const style = responseStyles[participant.status];
      return `<li class="gameplay-response" data-response="${participant.status}">
        <span class="gameplay-response-icon" role="img" aria-label="${style.label}" title="${style.label}">${icon(style.icon)}</span>
        <span>${safeText(participant.name)}</span>
        ${!closed && poll.owner && participant.status === 'INTERESSADO'
          ? `<button class="settings-button" type="button" data-gameplay-action="approve" data-gameplay-member="${participant.member}"
            aria-label="Aceitar interesse de ${safeText(participant.name)}">Aceitar interesse</button>` : ''}
      </li>`;
    }).join('')}</ul>` : ''}
    ${closed ? '<p>Horário encerrado</p>' : poll.owner ? ''
      : poll.status === 'INTERESSADO' ? '<p>Interesse enviado ao organizador</p>'
        : `<div class="gameplay-actions">${poll.status ? vote('CONFIRMADO', 'Vou jogar') + vote('RECUSADO', 'Não vou') : vote('INTERESSADO', 'Tenho interesse')}</div>`}`;
  if (focused === 'CONFIRMADO' || focused === 'RECUSADO') {
    card.querySelector<HTMLButtonElement>(`[data-gameplay-action="${focused}"]`)?.focus({ preventScroll: true });
  }
}

function gameplayFieldsMarkup(channelOptions: string, example = false) {
  return `
      <label>Nome do jogo<input name="game" maxlength="80" required ${example ? 'value="VALORANT"' : 'autofocus'} placeholder="Ex.: VALORANT"></label>
      <div class="gameplay-fields">
        <div class="gameplay-schedule">
          <label>Dia<select name="day" required>${example ? '<option>Hoje</option>' : ''}</select></label>
          <label>Horário<input name="time" type="time" ${example ? 'value="20:00"' : ''} required></label>
        </div>
        <label>Canal da enquete<select name="channel" required>${channelOptions}</select></label>
      </div>
      ${example ? '' : `<label><span>Comentário <span class="gameplay-optional">(opcional)</span></span>
        <textarea name="comment" maxlength="500" rows="2" placeholder="Ex.: Leva o fone que hoje tem ranked."></textarea></label>`}`;
}

export const tutorialGameplayMarkup = `<div class="server-form-panel gameplay-form tutorial-gameplay-preview">
  ${gameplayFieldsMarkup('<option># geral</option>', true)}
  <fieldset><legend>Convidados</legend><label class="server-check"><input type="checkbox" checked> Lua</label></fieldset>
  <button type="button" class="primary-button">Publicar e enviar convites</button>
</div>`;

export function openGameplay(host: HTMLElement, channels: { id?: number; name: string }[], members: ServerMember[],
  current: number | undefined, onCreated: (channel: number, failures: number) => void) {
  const dialog = document.createElement('dialog');
  dialog.className = 'settings-dialog gameplay-dialog';
  dialog.setAttribute('aria-labelledby', 'gameplay-title');
  const eligible = members.filter(member => !member.self && member.id > 0);
  dialog.innerHTML = `
    <header class="settings-header"><h2 id="gameplay-title">Convidar para jogar</h2>
      <button type="button" class="icon-button" data-close aria-label="Fechar">${icon('close')}</button></header>
    <form class="server-form-panel gameplay-form">
      ${gameplayFieldsMarkup(channels.filter(channel => channel.id).map(channel =>
          `<option value="${channel.id}"${channel.id === current ? ' selected' : ''}># ${safeText(channel.name)}</option>`).join(''))}
      <div class="gameplay-picker">
        <fieldset><legend>Convidados</legend>
          <label>Buscar por apelido<input type="search" data-guest-search placeholder="Buscar membro" autocomplete="off"></label>
          <div class="gameplay-guests">
            ${eligible.map(member => `<label class="server-check" data-guest><input type="checkbox" name="members" value="${member.id}"> <span>${safeText(member.name)}</span></label>`).join('')}
          </div>
          <p data-guest-empty hidden>Nenhum membro encontrado.</p>
        </fieldset>
        <fieldset><legend>Selecionados <span data-guest-count aria-live="polite">0/20</span></legend>
          <p data-selection-empty>Nenhum convidado selecionado.</p>
          <ul class="gameplay-selected" data-selected-guests></ul>
        </fieldset>
      </div>
      <p class="settings-status" role="status"></p>
      <button type="submit" class="primary-button"${eligible.length ? '' : ' disabled'}>Publicar e enviar convites</button>
    </form>`;
  const form = dialog.querySelector('form')!;
  const status = form.querySelector<HTMLElement>('[role=status]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type=submit]')!;
  const close = dialog.querySelector<HTMLButtonElement>('[data-close]')!;
  const dayInput = form.querySelector<HTMLSelectElement>('[name=day]')!;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  function availableDays(now = new Date()) {
    return Array.from({ length: 4 }, (_, offset) => {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 12);
      const value = [day.getFullYear(), day.getMonth() + 1, day.getDate()]
        .map(part => String(part).padStart(2, '0')).join('-');
      return { value, label: dayLabel.format(day) };
    });
  }
  function updateDays() {
    const days = availableDays();
    if (dayInput.options[0]?.value === days[0].value) return;
    const previous = dayInput.value;
    dayInput.replaceChildren(...days.map(day => new Option(day.label, day.value)));
    if (days.some(day => day.value === previous)) dayInput.value = previous;
  }
  updateDays();
  dayInput.addEventListener('focus', updateDays);
  const search = form.querySelector<HTMLInputElement>('[data-guest-search]')!;
  const guests = Array.from(form.querySelectorAll<HTMLLabelElement>('[data-guest]')).map((label, index) => ({
    label, input: label.querySelector<HTMLInputElement>('input')!, name: eligible[index].name,
  }));
  const selectedList = form.querySelector<HTMLElement>('[data-selected-guests]')!;
  const count = form.querySelector<HTMLElement>('[data-guest-count]')!;
  const selectionEmpty = form.querySelector<HTMLElement>('[data-selection-empty]')!;
  const searchEmpty = form.querySelector<HTMLElement>('[data-guest-empty]')!;
  const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').trim();
  function filterGuests() {
    const query = normalize(search.value);
    for (const guest of guests) guest.label.hidden = !normalize(guest.name).includes(query);
    searchEmpty.hidden = guests.some(guest => !guest.label.hidden);
    searchEmpty.textContent = guests.length ? 'Nenhum membro encontrado.' : 'Nenhum outro membro disponível.';
  }
  function showSelection() {
    const selected = guests.filter(guest => guest.input.checked);
    count.textContent = `${selected.length}/20`;
    selectionEmpty.hidden = selected.length > 0;
    for (const guest of guests) guest.input.disabled = selected.length >= 20 && !guest.input.checked;
    selectedList.innerHTML = selected.map(guest => `<li><span>${safeText(guest.name)}</span></li>`).join('');
  }
  search.addEventListener('input', filterGuests);
  for (const guest of guests) guest.input.addEventListener('change', showSelection);
  filterGuests();
  let busy = false;
  dismissOnBackdrop(dialog, () => !busy);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(form);
    const channel = Number(data.get('channel'));
    const day = String(data.get('day'));
    const start = new Date(`${day}T${data.get('time')}`);
    const selected = data.getAll('members').map(Number);
    if (!Number.isFinite(start.getTime()) || start.getTime() <= Date.now()) {
      status.textContent = 'Escolha uma data e um horário futuros.';
      return;
    }
    if (!availableDays().some(option => option.value === day)) {
      status.textContent = 'Marque o Gameplay até três dias depois de hoje.';
      return;
    }
    if (!selected.length || selected.length > 20) {
      status.textContent = 'Escolha de 1 a 20 convidados.';
      return;
    }
    busy = close.disabled = submit.disabled = true;
    status.textContent = 'Publicando Gameplay…';
    try {
      const result = await sendGameplay(channel, { action: 'createGameplay', game: String(data.get('game')).trim(),
        start: start.toISOString().replace('.000Z', 'Z'), timezone, members: selected, comment: String(data.get('comment') ?? '').trim() });
      if (dialog.isConnected) {
        dialog.close();
        onCreated(channel, result.emailFailures ?? 0);
      }
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'Não foi possível publicar o Gameplay.';
    } finally {
      busy = close.disabled = submit.disabled = false;
    }
  });
  host.append(dialog);
  dialog.showModal();
}
