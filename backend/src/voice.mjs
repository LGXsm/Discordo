import { randomUUID } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import channels from '../../shared/voice-channels.json' with { type: 'json' };

export function attachVoiceServer(server, iceConfig = process.env.DISCORDO_ICE_SERVERS) {
  const iceServers = iceConfig
    ? JSON.parse(iceConfig)
    : [{ urls: 'stun:stun.l.google.com:19302' }];
  const rooms = new Map(channels.map(channel => [channel.id, new Map()]));
  const ws = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  const alive = new WeakSet();

  function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function broadcast(room, message, excluded) {
    for (const [id, { socket }] of room) {
      if (id !== excluded) send(socket, message);
    }
  }

  function upgrade(request, socket, head) {
    if (request.url !== '/voice') return;
    try {
      const origin = new URL(request.headers.origin);
      if (origin.host !== request.headers.host || !['http:', 'https:'].includes(origin.protocol)) {
        socket.destroy();
        return;
      }
    } catch {
      socket.destroy();
      return;
    }
    ws.handleUpgrade(request, socket, head, connection => ws.emit('connection', connection));
  }
  server.on('upgrade', upgrade);

  ws.on('connection', socket => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    socket.on('error', () => socket.terminate());
    let room;
    let member;
    const joinTimeout = setTimeout(() => socket.close(1008, 'join required'), 10_000);
    socket.on('close', () => {
      clearTimeout(joinTimeout);
      if (!member) return;
      room.delete(member.id);
      broadcast(room, { type: 'left', id: member.id });
    });

    socket.on('message', (data, binary) => {
      if (binary) return;
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;

      if (!member) {
        if (message.type !== 'join') return;
        const requested = rooms.get(message.room);
        const name = typeof message.name === 'string' ? message.name.trim().slice(0, 40) : '';
        if (!requested || !name) {
          send(socket, { type: 'rejected', reason: 'invalid' });
          socket.close(1008, 'join rejected');
          return;
        }
        room = requested;
        clearTimeout(joinTimeout);
        member = { id: randomUUID(), name, muted: true, sharing: false, deafened: false,
          screenAudioCapable: message.screenAudioCapable === true, cameraCapable: message.cameraCapable === true, cameraOn: false };
        send(socket, {
          type: 'welcome', self: member, iceServers,
          members: [...room.values()].map(entry => entry.member),
        });
        room.set(member.id, { socket, member });
        broadcast(room, { type: 'joined', member }, member.id);
        return;
      }

      if (message.type === 'state' && typeof message.muted === 'boolean' && typeof message.sharing === 'boolean') {
        member.muted = message.muted;
        member.sharing = message.sharing;
        member.sharingAudio = message.sharing && message.sharingAudio === true;
        member.cameraOn = member.cameraCapable && message.cameraOn === true;
        member.deafened = message.deafened === true;
        broadcast(room, { type: 'state', member }, member.id);
      }
      if (message.to === member.id) return;
      const target = room.get(message.to);
      if (!target) return;
      if (message.type === 'screen-subscription' && typeof message.watching === 'boolean') {
        send(target.socket, { type: 'screen-subscription', from: member.id, watching: message.watching });
        return;
      }
      if (message.type !== 'signal') return;
      if (message.description && ['offer', 'answer'].includes(message.description.type) &&
          typeof message.description.sdp === 'string') {
        send(target.socket, { type: 'signal', from: member.id, description: message.description });
      } else if (message.candidate && typeof message.candidate.candidate === 'string') {
        send(target.socket, { type: 'signal', from: member.id, candidate: message.candidate });
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of ws.clients) {
      if (!alive.delete(socket)) socket.terminate();
      else if (socket.readyState === WebSocket.OPEN) socket.ping();
    }
  }, 25_000);
  heartbeat.unref();

  function close() {
    clearInterval(heartbeat);
    server.off('upgrade', upgrade);
    for (const socket of ws.clients) socket.terminate();
    ws.close();
  }

  function presence(_request, response) {
    const members = Object.fromEntries([...rooms].map(([id, room]) =>
      [id, [...room.values()].map(entry => entry.member)]));
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ rooms: members }));
  }

  return { close, presence };
}
