type Identity = { room: string; id: string; token: string };
type Outgoing = { type: string; [key: string]: unknown };
type VoiceResponse = {
  type?: string;
  token?: string;
  self?: { id: string };
  members?: object[];
  iceServers?: object[];
  events?: { type: string }[];
  pollId?: string;
  code?: string;
  error?: string;
};

function joinKeys() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return { joinId: crypto.randomUUID(), joinToken: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') };
}

export class VoiceRequestError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

// Runs without a DOM so the same signaling loop can also live in a worker.
export class HttpVoiceClient extends EventTarget {
  readyState = 0;
  private endpoint: string;
  private identity?: Identity;
  private joinMessage?: Outgoing;
  private queue: Outgoing[] = [];
  private batch?: { pollId: string; messages: Outgoing[] };
  private timer?: ReturnType<typeof setTimeout>;
  private busy = false;
  private fastUntil = 0;
  private failureSince?: number;
  private failures = 0;
  private recovering = false;
  private recoveryAttempts = 0;
  private controller = new AbortController();

  constructor(endpoint: string) {
    super();
    this.endpoint = endpoint;
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.dispatchEvent(new Event('open'));
    });
  }

  send(data: string) {
    if (this.readyState !== 1) return;
    const message = JSON.parse(data) as Outgoing;
    if (message.type === 'join') {
      this.joinMessage = { ...message, ...joinKeys() };
    } else {
      if (message.type === 'state' && this.joinMessage) Object.assign(this.joinMessage, message, { type: 'join' });
      if (message.type === 'demo' && this.joinMessage?.demoBots !== undefined) this.joinMessage.demoBots = message.bots;
      if (this.identity) this.queue.push(message);
    }
    this.fastUntil = Date.now() + 6000;
    if (this.failureSince === undefined) this.schedule(0);
  }

  pollNow() { this.schedule(0); }

  close(transferred = false) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    clearTimeout(this.timer);
    this.controller.abort();
    this.queue = [];
    const leaving = this.identity ? this.leave(this.identity, transferred) : Promise.resolve();
    this.dispatchEvent(new Event('close'));
    void leaving.finally(() => this.dispatchEvent(new Event('disposed')));
  }

  private async request(body: object, keepalive = false): Promise<VoiceResponse> {
    const remaining = this.failureSince === undefined ? 8000 : Math.max(1, 20000 - (Date.now() - this.failureSince));
    const response = await fetch(this.endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store', keepalive, credentials: 'same-origin',
      signal: keepalive ? AbortSignal.timeout(8000)
        : AbortSignal.any([this.controller.signal, AbortSignal.timeout(Math.min(8000, remaining))]),
    });
    const result = await response.json().catch(() => null) as VoiceResponse | null;
    if (!response.ok) throw new VoiceRequestError(response.status, result?.code ?? result?.error ?? 'network');
    if (!result || typeof result !== 'object') throw new Error('Invalid signaling response');
    return result;
  }

  private emit(message: object) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }

  private status(reconnecting: boolean) {
    this.dispatchEvent(new MessageEvent('status', { data: { reconnecting } }));
  }

  private leave(identity: Identity, transferred = false) {
    return this.request({ type: 'leave', ...identity, transferred }, true).then(() => {}, () => {});
  }

  private schedule(delay: number) {
    if (this.busy || this.readyState !== 1 || !this.joinMessage) return;
    clearTimeout(this.timer);
    if (this.failureSince !== undefined) delay = Math.min(delay, Math.max(0, 20000 - (Date.now() - this.failureSince)));
    this.timer = setTimeout(() => void this.poll(), delay);
  }

  private async poll() {
    if (this.busy || this.readyState !== 1 || !this.joinMessage) return;
    if (this.failureSince !== undefined && Date.now() - this.failureSince >= 20000) {
      this.fail();
      return;
    }
    this.busy = true;
    const started = Date.now();
    let delay = 0;
    try {
      if (!this.identity) {
        if (this.recovering && ++this.recoveryAttempts > 3) { this.fail(); return; }
        const result = await this.request(this.joinMessage);
        if (!['welcome', 'rejected', 'disconnect', 'punished'].includes(result.type ?? '')) throw new Error('Invalid join response');
        if (result.type === 'welcome') {
          if (typeof result.token !== 'string' || typeof result.self?.id !== 'string'
            || !Array.isArray(result.members) || !Array.isArray(result.iceServers)) throw new Error('Invalid welcome response');
          const identity = { room: String(this.joinMessage.room), id: result.self.id, token: result.token };
          if (this.readyState !== 1) { this.leave(identity); return; }
          this.identity = identity;
          delete this.joinMessage.transferred;
          delete result.token;
        }
        if (this.readyState !== 1) return;
        this.emit(result);
      } else {
        this.batch ??= { pollId: crypto.randomUUID(), messages: this.queue.slice(0, 12) };
        const batch = this.batch;
        const result = await this.request({ type: 'poll', ...this.identity, ...batch });
        if (!Array.isArray(result.events) || result.events.some(event => typeof event?.type !== 'string')
          || (result.pollId !== undefined && result.pollId !== batch.pollId)) {
          throw new Error('Invalid poll response');
        }
        if (this.readyState !== 1) return;
        // Retain the exact batch across failures. Acknowledged messages alone leave the queue.
        this.queue = this.queue.slice(batch.messages.length);
        this.batch = undefined;
        for (const event of result.events) {
          this.fastUntil = Date.now() + 6000;
          this.emit(event);
          if (this.readyState !== 1) return;
        }
        this.recovering = false;
        this.recoveryAttempts = 0;
      }
      if (!this.recovering) {
        this.failureSince = undefined;
        if (this.failures) this.status(false);
        this.failures = 0;
      }
      delay = this.queue.length ? 0 : Date.now() < this.fastUntil ? 300 : 2000;
    } catch (error) {
      if (this.readyState !== 1) return;
      if (this.identity && error instanceof VoiceRequestError && [401, 403, 409].includes(error.status)
        && ['expired', 'not_in_room', 'session'].includes(error.code)) {
        if (this.recoveryAttempts >= 3) { this.fail(); return; }
        this.recovering = true;
        this.failureSince ??= started;
        this.failures++;
        this.status(true);
        this.joinMessage = { ...this.joinMessage!, ...joinKeys(), previousId: this.identity.id, previousToken: this.identity.token };
        this.identity = undefined;
        // SDP and ICE candidates addressed to the old identity cannot be reused.
        this.queue = [];
        this.batch = undefined;
        delay = 500;
        return;
      }
      if (error instanceof VoiceRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
        this.fail();
        return;
      }
      this.failureSince ??= started;
      this.failures++;
      this.status(true);
      if (Date.now() - this.failureSince >= 20000) this.fail();
      delay = Math.min(500 * 2 ** Math.min(this.failures - 1, 4), 5000);
    } finally {
      this.busy = false;
      this.schedule(delay);
    }
  }

  private fail() {
    if (this.readyState === 3) return;
    this.dispatchEvent(new Event('error'));
    this.close();
  }
}
