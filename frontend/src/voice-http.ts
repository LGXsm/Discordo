import { HttpVoiceClient } from './voice-http-client';

export class HttpVoiceTransport extends EventTarget {
  readyState = 0;
  private worker?: Worker;
  private fallback?: HttpVoiceClient;
  private lifetime = new AbortController();

  constructor(endpoint = new URL('voice.php', document.baseURI).href) {
    super();
    try {
      const worker = new Worker(new URL('./voice-worker.ts', import.meta.url), { type: 'module', name: 'discordo-voice' });
      this.worker = worker;
      worker.onmessage = ({ data }) => this.receive(data.type, data.data);
      worker.onerror = () => {
        this.dispatchEvent(new Event('error'));
        this.receive('close');
        worker.terminate();
      };
      worker.postMessage({ type: 'init', endpoint });
    } catch {
      this.fallback = new HttpVoiceClient(endpoint);
      for (const type of ['open', 'close', 'error', 'message', 'status', 'disposed']) {
        this.fallback.addEventListener(type, event => this.receive(type, (event as MessageEvent).data));
      }
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.pollNow();
    }, { signal: this.lifetime.signal });
    window.addEventListener('online', () => this.pollNow(), { signal: this.lifetime.signal });
    window.addEventListener('pagehide', () => this.close(), { signal: this.lifetime.signal });
  }

  send(data: string) {
    if (this.readyState !== 1) return;
    if (this.worker) this.worker.postMessage({ type: 'send', data });
    else this.fallback?.send(data);
  }

  close(transferred = false) {
    if (this.readyState === 3) return;
    if (this.worker) this.worker.postMessage({ type: 'close', transferred });
    else this.fallback?.close(transferred);
    this.receive('close');
  }

  private pollNow() {
    if (this.readyState !== 1) return;
    if (this.worker) this.worker.postMessage({ type: 'poll' });
    else this.fallback?.pollNow();
  }

  private receive(type: string, data?: unknown) {
    if (type === 'disposed') {
      this.worker?.terminate();
      this.worker = undefined;
      this.fallback = undefined;
      return;
    }
    if (this.readyState === 3) return;
    if (type === 'open') this.readyState = 1;
    if (type === 'close') {
      this.readyState = 3;
      this.lifetime.abort();
    }
    this.dispatchEvent(type === 'message' || type === 'status' ? new MessageEvent(type, { data }) : new Event(type));
  }
}
