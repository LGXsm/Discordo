import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const extension = new URL('../extensions/discordo-atalhos/', import.meta.url);

test('Global commands reach one Discordo call without opening or focusing a tab', async () => {
  const [manifestText, background, content] = await Promise.all(
    ['manifest.json', 'background.js', 'content.js'].map(file => readFile(new URL(file, extension), 'utf8')),
  );
  const manifest = JSON.parse(manifestText);
  for (const name of ['microphone', 'audio']) assert.equal(manifest.commands[name].global, true);
  let onMessage;
  let pageInCall = false;
  const actions = [];
  const document = new EventTarget();
  for (const action of ['microphone', 'audio']) {
    document.addEventListener('discordo:global-shortcut:' + action, event => {
      if (!pageInCall) return;
      actions.push(action);
      event.preventDefault();
    });
  }
  vm.runInNewContext(content, { Event, document, chrome: {
    runtime: { id: 'fixture-extension', onMessage: { addListener(handler) { onMessage = handler; } } },
  } });
  const attempts = [];
  let onCommand;
  vm.runInNewContext(background, { chrome: {
    commands: { onCommand: { addListener(handler) { onCommand = handler; } } },
    tabs: {
      async query(filter) {
        assert.deepEqual(Array.from(filter.url), manifest.content_scripts[0].matches);
        return [{ id: 30 }, { id: 20, lastAccessed: 2 }, { id: 10, active: true }];
      },
      async sendMessage(id, message) {
        attempts.push(id);
        if (id === 10) throw new Error('No content script in this tab');
        pageInCall = id === 20;
        return new Promise(resolve => onMessage(message, { id: 'fixture-extension' }, resolve));
      },
    },
  } });
  await onCommand('microphone');
  assert.deepEqual(attempts, [10, 20]);
  assert.deepEqual(actions, ['microphone']);
  await onCommand('audio');
  assert.deepEqual(actions, ['microphone', 'audio']);
  onMessage({ type: 'discordo-shortcut', command: 'audio' }, { id: 'another-extension' }, () => assert.fail());
  assert.deepEqual(actions, ['microphone', 'audio']);
});
