import { HttpVoiceClient } from './voice-http-client';

let client: HttpVoiceClient | undefined;
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'init' && !client) {
    client = new HttpVoiceClient(message.endpoint);
    for (const type of ['open', 'close', 'error', 'message', 'status']) {
      client.addEventListener(type, event => {
        self.postMessage({ type, data: (event as MessageEvent).data });
      });
    }
    client.addEventListener('disposed', () => {
      self.postMessage({ type: 'disposed' });
      self.close();
    });
  } else if (message.type === 'send') client?.send(message.data);
  else if (message.type === 'poll') client?.pollNow();
  else if (message.type === 'close') client?.close(message.transferred === true);
};
