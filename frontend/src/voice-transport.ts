import { HttpVoiceTransport } from './voice-http';
import { isDemoRoom } from './voice-demo';
// Shared hosting uses HTTPS polling for signaling. WebRTC still carries the media.
import type { VoiceMember } from './voice-session';

const useHttp = import.meta.env.VITE_DISCORDO_VOICE_TRANSPORT === 'http';

export async function readVoicePresence(signal: AbortSignal, server?: number): Promise<Record<string, VoiceMember[]>> {
  const url = useHttp || server ? new URL('voice.php?presence=1', document.baseURI) : '/voice-presence';
  if (server && url instanceof URL) url.searchParams.set('server', String(server));
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('Falha ao consultar salas de voz');
  return (await response.json()).rooms;
}

export async function moveVoiceMember(room: string, id: string, destination: string) {
  const response = await fetch(new URL('voice.php', document.baseURI), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'move', room, id, destination }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error === 'full' ? 'O canal de destino está cheio.'
      : result?.error === 'member_access' ? 'A pessoa saiu da chamada ou não tem acesso ao canal de destino.'
        : 'Não foi possível mover essa pessoa.');
  }
}

export async function checkVoiceAbsence(room: string, sender: string, id: string) {
  const response = await fetch(new URL('voice.php', document.baseURI), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'check-absence', room, sender, id }),
  });
  if (response.ok) return;
  const { error } = await response.json().catch(() => ({}));
  throw new Error(error === 'absence_cooldown' ? 'Essa pessoa recebeu um aviso há pouco. Aguarde para enviar outro.'
    : error === 'not_muted' ? 'Essa pessoa já está com o microfone ativo.'
    : 'Não foi possível enviar o aviso. Confirme se vocês estão na mesma chamada.');
}

export type VoiceModeration = 'serverMuted' | 'serverDeafened' | 'disconnect';
export const voicePunishmentDurations = [10, 30, 60] as const;
export type VoicePunishmentDuration = typeof voicePunishmentDurations[number];

export function moderateVoiceMember(room: string, id: string, action: VoiceModeration, enabled = true) {
  return sendModeration(room, id, { action, enabled });
}

export function punishVoiceMember(room: string, id: string, duration: VoicePunishmentDuration) {
  return sendModeration(room, id, { action: 'punish', duration });
}

async function sendModeration(room: string, id: string, operation: { action: VoiceModeration; enabled: boolean }
  | { action: 'punish'; duration: VoicePunishmentDuration }) {
  const response = await fetch(new URL('voice.php', document.baseURI), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'moderate', room, id, ...operation }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.error === 'moderated_by_other' ? 'Outra pessoa aplicou essa moderação. Peça a ela para retirá-la.'
      : response.status === 403 ? 'Você não pode moderar esse participante.'
        : 'Não foi possível moderar esse participante. Confira se ele ainda está na chamada.');
  }
}

export function createVoiceTransport(room: string): WebSocket | HttpVoiceTransport {
  if (useHttp || isDemoRoom(room) || room.startsWith('channel-') || room.startsWith('friend-')) return new HttpVoiceTransport();
  const url = new URL('/voice', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return new WebSocket(url);
}
