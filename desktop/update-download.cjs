const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const { createServer } = require('node:http');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const packageName = /^Discordo-[\d.A-Za-z-]+-full\.nupkg$/i;

async function measureDownload({ fetch, feed, assets, onProgress }) {
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  const files = new Map(assets.filter(asset => packageName.test(asset.name)).map(asset => [asset.name, asset.size]));
  const lifetime = new AbortController();
  const server = createServer(async (request, response) => {
    const route = request.url?.split('?')[0];
    const name = route?.startsWith(prefix) && route.slice(prefix.length);
    if (request.method !== 'GET' || (name !== 'RELEASES' && !files.has(name))) {
      response.writeHead(404).end();
      return;
    }
    const connection = new AbortController();
    response.on('close', () => connection.abort());
    try {
      const source = await fetch(`${feed}/${name}`, {
        headers: { 'Accept-Encoding': 'identity' },
        signal: AbortSignal.any([lifetime.signal, connection.signal]),
      });
      if (!source.ok || !source.body) {
        await source.body?.cancel();
        response.writeHead(502).end();
        return;
      }
      const length = Number(source.headers.get('content-length'));
      const total = Number.isSafeInteger(length) && length > 0 && !source.headers.get('content-encoding')
        ? length : files.get(name);
      const track = name !== 'RELEASES' && Number.isSafeInteger(total) && total > 0;
      let bytes = 0;
      let percent = 0;
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          if (track) {
            bytes += chunk.length;
            const next = Math.min(99, Math.floor(bytes * 100 / total));
            if (next !== percent) onProgress(percent = next);
          }
          callback(null, chunk);
        },
      });
      if (track) onProgress(0);
      const headers = { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' };
      if (Number.isSafeInteger(total) && total > 0) headers['Content-Length'] = total;
      response.writeHead(200, headers);
      await pipeline(Readable.fromWeb(source.body), meter, response);
      if (track && bytes === total) onProgress(100);
    } catch {
      if (!response.headersSent) response.writeHead(502).end();
      else response.destroy();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    url: `http://127.0.0.1:${server.address().port}${prefix}`,
    close() {
      lifetime.abort();
      server.close();
      server.closeAllConnections();
    },
  };
}

module.exports = { measureDownload, packageName };
