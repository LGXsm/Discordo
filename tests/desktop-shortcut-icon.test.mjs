import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import shortcutIcon from '../desktop/shortcut-icon.cjs';

test('Installed updates point existing shell shortcuts at the version-specific icon without changing their target', t => {
  const fixture = mkdtempSync(path.join(tmpdir(), 'discordo-lnk-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const root = path.join(fixture, 'Discordo');
  const desktop = path.join(fixture, 'Desktop');
  const appData = path.join(fixture, 'Roaming');
  const executable = path.join(root, 'app-0.2.1-beta3', 'Discordo.exe');
  const target = path.join(root, 'Discordo.exe');
  const shortcut = path.join(desktop, 'Discordo.lnk');
  const pinned = path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar', 'Discordo.lnk');
  const start = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'LGXsm', 'Discordo.lnk');
  for (const file of [path.join(root, 'Update.exe'), shortcut, pinned, start]) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
  const expandedTarget = path.join(realpathSync.native(root), 'Discordo.exe');
  const original = { target: expandedTarget, icon: target, iconIndex: 0, args: '', appUserModelId: 'com.squirrel.Discordo.Discordo' };
  const details = new Map([
    [shortcut, original],
    [pinned, { ...original, icon: path.join(root, 'app-0.2.1-beta2', 'Discordo.exe') }],
    [start, { ...original, icon: path.join(fixture, 'my-icon.ico') }],
  ]);
  const writes = [];
  const shell = {
    readShortcutLink: file => details.get(file),
    writeShortcutLink(file, operation, update) {
      writes.push([file, operation, update]);
      details.set(file, { ...details.get(file), ...update });
      return true;
    },
  };
  shortcutIcon.refreshShortcutIcons(shell, executable, desktop, appData);
  shortcutIcon.refreshShortcutIcons(shell, executable, desktop, appData);
  assert.deepEqual(writes, [
    [shortcut, 'update', { icon: executable, iconIndex: 0 }],
    [pinned, 'update', { icon: executable, iconIndex: 0 }],
  ]);
  assert.deepEqual(details.get(shortcut), { ...original, icon: executable });
});
