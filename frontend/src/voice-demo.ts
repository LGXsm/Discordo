import type { VoiceMember } from './voice-session';

export const demoRoom = 'local-video-demo';
export function demoRoomForServer(id: number, lobby: boolean) {
  return lobby ? demoRoom : `video-demo-${id}`;
}

export function isDemoRoom(id?: string) {
  return id === demoRoom || (id !== undefined && /^video-demo-[1-9][0-9]{0,9}$/.test(id));
}
export type DemoBot = { id: string; name: string; screen: boolean; camera: boolean };
type DemoFeed = { stream: MediaStream; stop(): void };
export type DemoPeer = { member: VoiceMember; video?: MediaStream; camera?: MediaStream; screenAudio?: MediaStream };

const colors = ['#bda0ff', '#58d5b0', '#ffaf78'];

function createFeed(bot: DemoBot, camera: boolean): DemoFeed {
  const canvas = document.createElement('canvas');
  canvas.width = camera ? 256 : 480;
  canvas.height = camera ? 160 : 270;
  const paint = canvas.getContext('2d')!;
  const tint = colors[(Number(bot.id.split('-').at(-1)) - 1) % colors.length];
  let tick = 0;
  const draw = () => {
    const { width, height } = canvas;
    paint.fillStyle = '#151121';
    paint.fillRect(0, 0, width, height);
    paint.fillStyle = '#29203a';
    if (camera) {
      paint.fillRect(0, 0, width, 115);
      const x = width / 2 + Math.sin(tick / 12) * 9;
      paint.fillStyle = tint;
      paint.beginPath();
      paint.arc(x, 62, 32, 0, Math.PI * 2);
      paint.fill();
      paint.beginPath();
      paint.ellipse(x, 122, 48, 31, 0, Math.PI, Math.PI * 2);
      paint.fill();
      paint.fillStyle = '#151121';
      paint.fillRect(x - 13, 57, 6, 5);
      paint.fillRect(x + 7, 57, 6, 5);
    } else {
      for (let x = 25; x < width; x += 25) paint.fillRect(x, 18, 1, 201);
      for (let y = 19; y < 220; y += 25) paint.fillRect(24, y, width - 48, 1);
      paint.strokeStyle = tint;
      paint.lineWidth = 4;
      paint.beginPath();
      for (let x = 24; x <= width - 24; x += 4) {
        const y = 124 + 38 * Math.sin(x / 43 + tick / 9) + 21 * Math.cos(x / 23 - tick / 7);
        if (x === 24) paint.moveTo(x, y);
        else paint.lineTo(x, y);
      }
      paint.stroke();
    }
    paint.fillStyle = tint;
    paint.font = 'bold 12px system-ui';
    paint.fillText(`${bot.name} / ${camera ? 'Câmera' : 'Tela'} simulada`, 12, height - 12);
    tick++;
  };
  draw();
  const stream = canvas.captureStream(10);
  const timer = setInterval(() => { if (!document.hidden) draw(); }, 100);
  return { stream, stop() {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
  } };
}

export function createDemoMedia() {
  const feeds = new Map<string, DemoFeed>();
  return {
    update(bots: readonly DemoBot[], pausedScreens: ReadonlySet<string>): DemoPeer[] {
      const active = new Set<string>();
      const peers = bots.map(bot => {
        const getFeed = (kind: 'screen' | 'camera') => {
          if (!bot[kind] || (kind === 'screen' && pausedScreens.has(bot.id))) return undefined;
          const key = `${bot.id}:${kind}`;
          active.add(key);
          let feed = feeds.get(key);
          if (!feed) {
            feed = createFeed(bot, kind === 'camera');
            feeds.set(key, feed);
          }
          return feed.stream;
        };
        return {
          member: { id: bot.id, name: bot.name, muted: true, sharing: bot.screen, cameraOn: bot.camera },
          video: getFeed('screen'),
          camera: getFeed('camera'),
        };
      });
      for (const [key, feed] of feeds) {
        if (active.has(key)) continue;
        feed.stop();
        feeds.delete(key);
      }
      return peers;
    },
    stop() {
      for (const feed of feeds.values()) feed.stop();
      feeds.clear();
    },
  };
}
