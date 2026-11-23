import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpVoiceClient } from '../frontend/src/voice-http-client.ts';

const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

async function setup(t, poll, join) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const fetchBefore = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    if (body.type === 'join') return join ? join(body) : Response.json({ type: 'welcome', self: { id: 'self' }, token: 'secret', members: [], iceServers: [] });
    if (body.type === 'leave') return Response.json({ ok: true });
    return poll(body);
  };
  const client = new HttpVoiceClient('https://example.test/voice.php');
  t.after(() => { client.close(); globalThis.fetch = fetchBefore; });
  const statuses = [];
  const messages = [];
  client.addEventListener('status', event => statuses.push(event.data.reconnecting));
  client.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  await flush();
  client.send(JSON.stringify({ type: 'join', room: 'voice', name: 'Player' }));
  const advance = async milliseconds => { t.mock.timers.tick(milliseconds); await flush(); };
  await advance(0);
  return { client, requests, statuses, messages, advance };
}

test('A temporary failure keeps the exact batch and preserves newly queued signaling', async t => {
  let attempts = 0;
  const state = await setup(t, body => {
    if (++attempts === 1) throw new TypeError('offline');
    return Response.json({ events: [], pollId: body.pollId });
  });
  state.client.send(JSON.stringify({ type: 'signal', to: 'a', candidate: { candidate: 'one' } }));
  await state.advance(0);
  assert.equal(state.client.readyState, 1);
  assert.deepEqual(state.statuses, [true]);
  state.client.send(JSON.stringify({ type: 'signal', to: 'b', candidate: { candidate: 'two' } }));
  await state.advance(500);
  const polls = state.requests.filter(request => request.type === 'poll');
  assert.deepEqual(polls[0], polls[1]);
  assert.deepEqual(polls[0].messages.map(message => message.to), ['a']);
  await state.advance(0);
  assert.equal(state.requests.filter(request => request.type === 'poll')[2].messages[0].to, 'b');
  assert.equal(state.statuses.at(-1), false);
});

test('Slow hosting, rate limits and malformed JSON are temporary failures', async t => {
  let attempts = 0;
  const state = await setup(t, () => {
    attempts++;
    if (attempts === 1) return Response.json({ error: 'busy' }, { status: 503 });
    if (attempts === 2) return Response.json({ error: 'rate_limit' }, { status: 429 });
    if (attempts === 3) return new Response('<html>proxy error</html>');
    return Response.json({ events: [] });
  });
  await state.advance(300);
  await state.advance(500);
  await state.advance(1000);
  await state.advance(2000);
  assert.equal(state.client.readyState, 1);
  assert.equal(state.statuses.at(-1), false);
});

test('A sustained outage ends after the recovery budget instead of retrying indefinitely', async t => {
  const state = await setup(t, () => { throw new TypeError('offline'); });
  await state.advance(300);
  for (const delay of [500, 1000, 2000, 4000, 5000, 5000, 5000]) await state.advance(delay);
  assert.equal(state.client.readyState, 3);
});

test('Expired membership rejoins with the last mute and deafen state', async t => {
  let attempts = 0;
  const state = await setup(t, () => ++attempts === 1
    ? Response.json({ code: 'not_in_room' }, { status: 403 }) : Response.json({ events: [] }));
  state.client.send(JSON.stringify({ type: 'state', muted: true, deafened: true, sharing: false }));
  await state.advance(0);
  await state.advance(500);
  await state.advance(300);
  const joins = state.requests.filter(request => request.type === 'join');
  assert.equal(joins.length, 2);
  assert.equal(joins[1].muted, true);
  assert.equal(joins[1].deafened, true);
  assert.equal(joins[1].previousId, 'self');
  assert.notEqual(joins[1].joinId, joins[0].joinId);
  assert.equal(state.client.readyState, 1);
  assert.equal(state.statuses.at(-1), false);
});

test('Repeated room expiration stops after three automatic rejoins', async t => {
  const state = await setup(t, () => Response.json({ code: 'expired' }, { status: 403 }));
  for (let i = 0; i < 10; i++) await state.advance(500);
  assert.equal(state.requests.filter(request => request.type === 'join').length, 4);
  assert.equal(state.client.readyState, 3);
});

test('Administrative disconnect does not automatically rejoin', async t => {
  const state = await setup(t, () => Response.json({ events: [{ type: 'disconnect' }] }));
  state.client.addEventListener('message', event => {
    if (JSON.parse(event.data).type === 'disconnect') state.client.close();
  });
  await state.advance(300);
  await state.advance(5000);
  assert.equal(state.client.readyState, 3);
  assert.equal(state.requests.filter(request => request.type === 'join').length, 1);
});

test('Revoked channel access stops without automatic rejoin', async t => {
  const state = await setup(t, () => Response.json({ code: 'forbidden' }, { status: 403 }));
  await state.advance(300);
  assert.equal(state.client.readyState, 3);
  assert.equal(state.requests.filter(request => request.type === 'join').length, 1);
});

test('Rejoin requests also have a three-attempt limit when hosting is unavailable', async t => {
  let joins = 0;
  const state = await setup(t, () => Response.json({ code: 'expired' }, { status: 403 }), () => ++joins === 1
    ? Response.json({ type: 'welcome', self: { id: 'self' }, token: 'secret', members: [], iceServers: [] })
    : Response.json({ code: 'unavailable' }, { status: 503 }));
  await state.advance(300);
  for (const delay of [500, 1000, 2000, 4000]) await state.advance(delay);
  assert.equal(joins, 4);
  assert.equal(state.client.readyState, 3);
});

test('Idle signaling slows down and queued messages wake it immediately', async t => {
  const state = await setup(t, () => Response.json({ events: [] }));
  await state.advance(6000);
  const idle = state.requests.length;
  await state.advance(1999);
  assert.equal(state.requests.length, idle);
  await state.advance(1);
  assert.equal(state.requests.length, idle + 1);
  state.client.send(JSON.stringify({ type: 'state', muted: false, sharing: false }));
  await state.advance(0);
  assert.equal(state.requests.length, idle + 2);
});
