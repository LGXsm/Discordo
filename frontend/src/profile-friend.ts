import { friendsRequest, type FriendshipStatus } from './friends';
import { icon } from './icons';

export function mountProfileFriend(card: HTMLElement, signal: AbortSignal, position: () => void) {
  const button = card.querySelector<HTMLButtonElement>('[data-profile-friend]')!;
  const feedback = card.querySelector<HTMLElement>('[data-profile-friend-feedback]')!;
  let user: number | undefined;
  let revision = 0;
  let status: FriendshipStatus = null;
  let busy = false;

  function render() {
    const [label, glyph] = status === 'friend' ? ['Já são amigos', 'check'] as const
      : status === 'sent' ? ['Pedido enviado', 'clock'] as const
        : status === 'received' ? ['Aceitar pedido de amizade', 'check'] as const
          : ['Adicionar amigo', 'userPlus'] as const;
    button.hidden = user === undefined;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-disabled', String(busy || status === 'sent' || status === 'friend'));
    button.innerHTML = icon(glyph);
  }

  function announce(message: string) {
    feedback.hidden = !message;
    feedback.textContent = message;
  }

  function select(next?: number) {
    if (user === next) return;
    const ticket = ++revision;
    user = next;
    status = null;
    busy = next !== undefined;
    announce('');
    render();
    if (next === undefined) return;
    void friendsRequest<{ status: FriendshipStatus }>(signal, { relationship: String(next) })
      .then(result => { if (ticket === revision) status = result.status; })
      .catch(() => { /* O envio também verifica o vínculo atual no servidor. */ })
      .finally(() => {
        if (ticket !== revision || signal.aborted) return;
        busy = false;
        render();
      });
  }

  button.addEventListener('click', async () => {
    if (user === undefined || busy || status === 'sent' || status === 'friend') return;
    const ticket = revision;
    const action = status === 'received' ? 'accept' : 'request';
    busy = true;
    announce('');
    render();
    try {
      const result = await friendsRequest<{ status?: FriendshipStatus }>(signal, {}, { user, action });
      if (ticket !== revision || signal.aborted) return;
      status = result.status ?? (action === 'accept' ? 'friend' : 'sent');
      announce(status === 'friend' ? 'Vocês já são amigos.' : status === 'received' ? 'Essa pessoa enviou um pedido para você.' : 'Pedido de amizade enviado.');
    } catch (error) {
      if (ticket === revision && !signal.aborted) announce(error instanceof Error ? error.message : 'Não foi possível enviar o pedido.');
    } finally {
      if (ticket === revision && !signal.aborted) {
        busy = false;
        render();
        if (card.matches(':popover-open')) position();
      }
    }
  }, { signal });
  return select;
}
