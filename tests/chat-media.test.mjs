import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

test('Chat media accepts real images, serves original GIF bytes and rejects disguised uploads', { timeout: 20000 }, async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'discordo-media-'));
  let php;
  try {
    const source = fileURLToPath(new URL('../backend/src/chat-media.php', import.meta.url)).replaceAll('\\', '/');
    const voice = fileURLToPath(new URL('../backend/src/voice.php', import.meta.url)).replaceAll('\\', '/');
    const router = path.join(temp, 'router.php');
    for (const name of ['chat.php', 'chat-media.php', 'gameplay.php']) {
      await copyFile(new URL('../backend/src/' + name, import.meta.url), path.join(temp, name));
    }
    await writeFile(path.join(temp, 'server-access.php'), `<?php
function databaseConfig(): array { return []; }
function signedInUser(PDO $db): ?int { return ($_SERVER['HTTP_X_TEST_SESSION'] ?? '') === 'member' ? 7 : null; }
function visibleChannels(PDO $db, int $user, ?int $server, string $type, int $channel): array {
    return $type === 'TEXTO' && in_array($channel, [12, 292], true) && ($server === null || $server === ($channel === 12 ? 1 : 29))
        ? [['server' => $channel === 12 ? 1 : 29]] : [];
}
function isCreator(PDO $db, int $user): bool { return false; }
class ChatFixtureDb extends PDO {
    private bool $transaction = false;
    public function __construct() {}
    public function beginTransaction(): bool { return $this->transaction = true; }
    public function inTransaction(): bool { return $this->transaction; }
    public function commit(): bool { $this->transaction = false; return true; }
    public function rollBack(): bool { return $this->commit(); }
}
function database(): PDO { return new ChatFixtureDb(); }
function query(PDO $db, string $sql, array $params): PDOStatement {
    return new class($sql, $params) extends PDOStatement {
        public function __construct(private string $sql, private array $params) {
            if (!str_starts_with($sql, 'INSERT INTO Mensagem')) return;
            [$member, $channel, $text, $media] = $params;
            if ($member !== ($channel === 12 ? 107 : 2907)) throw new RuntimeException('Wrong server membership');
            $path = __DIR__ . '/messages-' . $channel . '.json';
            $rows = is_file($path) ? json_decode(file_get_contents($path), true) : [];
            $rows[] = ['id' => count($rows) + 1, 'text' => $text, 'sent' => '2026-11-15 12:00:00', 'mediaName' => $media,
                'author' => 'Player', 'userId' => 7];
            file_put_contents($path, json_encode($rows, JSON_THROW_ON_ERROR));
        }
        public function fetchColumn(int $column = 0): mixed {
            return str_starts_with($this->sql, 'SELECT mbs_id') ? ($this->params[0] === 1 ? 107 : 2907) : false;
        }
        public function fetch(int $mode = PDO::FETCH_DEFAULT, int $cursorOrientation = PDO::FETCH_ORI_NEXT, int $cursorOffset = 0): mixed {
            return false;
        }
        public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array {
            if (!str_starts_with($this->sql, 'SELECT msg.msg_id AS id')) return [];
            $path = __DIR__ . '/messages-' . $this->params[0] . '.json';
            return is_file($path) ? array_map(static fn ($row) => $row + ['replyId' => null, 'forwarded' => 0],
                array_reverse(json_decode(file_get_contents($path), true))) : [];
        }
    };
}
`);

    await writeFile(router, `<?php
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/chat.php') require __DIR__ . '/chat.php';
if (parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) === '/voice.php') require ${JSON.stringify(voice)};
require ${JSON.stringify(source)};
header('X-Content-Type-Options: nosniff');
try {
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $name = saveChatMedia($_FILES['media']);
        http_response_code(201);
        echo json_encode(['name' => $name, 'kind' => chatMediaKind($name)]);
    } else {
        $file = chatMediaPath($_GET['name'] ?? null);
        if (!$file) throw new DomainException('Invalid name', 404);
        sendChatMedia($file, $_SERVER['REQUEST_METHOD']);
    }
} catch (DomainException $error) {
    http_response_code($error->getCode());
    echo $error->getMessage();
}
`);
    const listener = net.createServer();
    await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
    const port = listener.address().port;
    await new Promise(resolve => listener.close(resolve));
    const url = new URL(`http://127.0.0.1:${port}/`);
    const flags = process.env.PHP_FILEINFO_DIR ? ['-d', `extension_dir="${process.env.PHP_FILEINFO_DIR}"`, '-d', 'extension=fileinfo'] : [];
    php = spawn(process.env.PHP_PATH ?? 'php', [...flags, '-d', 'display_errors=1', '-d', 'upload_max_filesize=20M', '-d', 'post_max_size=21M',
      '-S', url.host, router], {
      env: { ...process.env, DISCORDO_DB_CONFIG: path.join(temp, 'db.php') }, stdio: 'ignore', windowsHide: true,
    });
    let startupError;
    php.on('error', error => { startupError = error; });
    const deadline = Date.now() + 5000;
    while (true) {
      if (startupError) throw startupError;
      if (await fetch(url).catch(() => null)) break;
      if (Date.now() > deadline || php.exitCode !== null) throw new Error('PHP test server did not start');
      await delay(30);
    }
    const image = name => readFile(new URL(`../${name}`, import.meta.url));
    const upload = (name, type, bytes) => {
      const body = new FormData();
      body.set('media', new Blob([bytes], { type }), name);
      return fetch(url, { method: 'POST', body });
    };
    const fixtures = [
      ['foto.jpg', 'image/jpeg', await image('Imagens/background.jpg')],
      ['foto.png', 'image/png', await image('Imagens/logo-pequena.png')],
      ['foto.webp', 'image/webp', await image('frontend/public/art/logo-pequena.webp')],
      ['animacao.gif', 'image/gif', Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgAAACwAAAAAAQABAAACAkQBADs=', 'base64')],
    ];
    for (const [name, type, bytes] of fixtures) {
      const response = await upload(name, type, bytes);
      assert.equal(response.status, 201, `${name}: ${response.status === 201 ? '' : await response.text()}`);
      const saved = await response.json();
      assert.equal(saved.kind, 'image');
      const media = await fetch(new URL(`?name=${saved.name}`, url));
      assert.equal(media.status, 200);
      assert.equal(media.headers.get('content-type'), type);
      assert.deepEqual(Buffer.from(await media.arrayBuffer()), bytes);
    }
    const disguised = await upload('fake.gif', 'image/gif', '<script>alert(1)</script>');
    assert.equal(disguised.status, 422);
    const presence = await fetch(new URL('/voice.php?presence=1', url));
    assert.equal(presence.status, 400, 'Legacy voice presence must not be exposed');
    const legacyJoin = await fetch(new URL('/voice.php', url), {
      method: 'POST', headers: { Origin: url.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'join', room: 'resenha', name: 'Fixture' }),
    });
    assert.deepEqual(await legacyJoin.json(), { type: 'rejected', reason: 'invalid', code: 'bad_request' });
    const youtube = 'https://www.youtube.com/watch?v=d6mELw0-LPE';
    const markdown = '[' + youtube + '](' + youtube + ')';
    const chatHeaders = { 'X-Discordo-Request': 'chat', 'X-Test-Session': 'member' };
    const guild = new URL('/chat.php?channel=292', url);
    const sendJson = body => fetch(guild, {
      method: 'POST', headers: { ...chatHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    for (const text of [youtube, markdown]) {
      const sent = await sendJson({ action: 'sendMessage', text });
      assert.equal(sent.status, 201, await sent.text());
    }
    assert.equal((await sendJson({ action: 'sendMessage', text: [] })).status, 422);
    assert.equal((await sendJson({ action: 'respondGameplay', id: 1 })).status, 404, 'Gameplay requests use their original handler');
    const withCaption = new FormData();
    withCaption.set('message', JSON.stringify({ text: youtube }));
    withCaption.set('media', new Blob([fixtures[3][2]], { type: 'image/gif' }), 'caption.gif');
    const sentCaption = await fetch(guild, { method: 'POST', headers: chatHeaders, body: withCaption });
    assert.equal(sentCaption.status, 201, await sentCaption.text());

    const lobby = new URL('/chat.php?channel=12', url);
    const plainForm = new FormData();
    plainForm.set('text', 'Mensagem de uma versão anterior');
    assert.equal((await fetch(lobby, { method: 'POST', headers: chatHeaders, body: plainForm })).status, 201);
    const read = async endpoint => (await (await fetch(endpoint, { headers: chatHeaders })).json()).messages;
    assert.deepEqual((await read(guild)).map(({ text, media }) => [text, media]), [[youtube, null], [markdown, null], [youtube, 'image']]);
    assert.deepEqual((await read(lobby)).map(({ text }) => text), ['Mensagem de uma versão anterior']);

  } finally {
    if (php?.pid && php.exitCode === null && php.signalCode === null) {
      const done = new Promise(resolve => php.once('exit', resolve));
      php.kill();
      await done;
    }
    assert.equal(path.dirname(temp), os.tmpdir());
    await rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
