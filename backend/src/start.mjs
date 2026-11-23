import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as proxyRequest } from 'node:http';
import { extname } from 'node:path';
import { attachVoiceServer } from './voice.mjs';

const dist = new URL('../../dist/', import.meta.url);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.wasm': 'application/wasm', '.zip': 'application/zip' };

const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  if (['/account.php', '/servers.php', '/voice.php', '/chat.php', '/friends.php'].includes(path)) {
    const target = new URL(request.url, process.env.DISCORDO_ACCOUNT_SERVER || 'http://127.0.0.1:8081');
    const upstream = proxyRequest(target, { method: request.method, headers: request.headers }, result => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    upstream.on('error', () => {
      if (response.headersSent) return response.destroy();
      response.writeHead(503, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: 'O serviço de contas do Discordo está indisponível.' }));
    });
    request.once('aborted', () => upstream.destroy());
    request.pipe(upstream);
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }
  if (path === '/voice-presence') {
    voice.presence(request, response);
    return;
  }
  const asset = path === '/' ? 'index.html' : path.slice(1);
  if (!['index.html', 'discordo-atalhos.zip'].includes(asset) && !/^(art|assets)\/[\w-][\w.-]*$/.test(asset)) {
    response.writeHead(404).end();
    return;
  }
  const file = new URL(asset, dist);
  try {
    const entry = await stat(file);
    if (!entry.isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[extname(asset)] ?? 'application/octet-stream',
      'Content-Length': entry.size,
      'Cache-Control': asset.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end();
  }
});

const voice = attachVoiceServer(server);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    voice.close();
    server.close();
  });
}
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 5173);
server.listen(port, host, () => console.log(`Discordo em http://${host}:${server.address().port}`));
