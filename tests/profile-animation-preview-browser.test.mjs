import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { launchTestChrome } from './browser-chrome.mjs';

test('The alien gesture stays behind the wiped glass and the smoke follows both curls', { timeout: 20000 }, async () => {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'discordo-animation-test-'));
  const chrome = launchTestChrome(profile);
  let socket;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome did not start')), 8000);
      chrome.once('error', error => { clearTimeout(timer); reject(error); });
      let output = '';
      chrome.stderr.on('data', chunk => {
        output += chunk;
        const match = output.match(/DevTools listening on ws:\/\/([^/]+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    const pages = await fetch('http://' + endpoint + '/json/list').then(response => response.json());
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', event => {
      const { id, result, error } = JSON.parse(event.data);
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(new Error(error.message));
      else request.resolve(result);
    });
    const command = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const url = new URL('../prototypes/animations/index.html?clean=1', import.meta.url).href;
    await command('Page.navigate', { url });
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await command('Runtime.evaluate', { expression: 'Boolean(window.OPENER?.ready)' });
      if (response.result?.value) break;
      await new Promise(resolve => setTimeout(resolve, 70));
    }
    const evaluation = await command('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const select = selector => document.querySelector(selector);
        const visible = node => Number(node.getAttribute('opacity')) > .05;
        const flow = route => Array.from(select('[data-route=' + route + ']').children)
          .filter(visible)
          .map(node => {
            const { e: x, f: y } = node.transform.baseVal.getItem(0).matrix;
            return { x, y };
          });
        OPENER.seek(1.85);
        const diagonal = flow('smoke-start').some(({x,y}) => x > 112 && y > 135);
        const branchesWait = !flow('smoke-right').length && !flow('smoke-left').length;
        OPENER.seek(3.3);
        const rightRises = flow('smoke-right').some(({x,y}) => x > 280 && y < 130);
        const leftCrossesBottom = flow('smoke-left').some(({x,y}) => x < 170 && y > 265);
        const gesture = select('#gesture');
        const clearedArea = gesture.closest('#visitor-window[clip-path="url(#wipe-cut)"]');
        const fog = select('#condensation');
        const behindFog = Boolean(clearedArea?.compareDocumentPosition(fog) & Node.DOCUMENT_POSITION_FOLLOWING);
        const showsGesture = visible(gesture) && !visible(select('#hand'));
        OPENER.seek(5);
        return {
          duration: OPENER.duration, diagonal, branchesWait, rightRises, leftCrossesBottom,
          behindFog, showsGesture,
          clearedAtEnd: ['#gesture', '#visitor', '#condensation', '#plume'].every(selector => !visible(select(selector))),
        };
      })()`,
    });
    assert.equal(evaluation.exceptionDetails, undefined, JSON.stringify(evaluation.exceptionDetails));
    assert.deepEqual(evaluation.result.value, {
      duration: 5, diagonal: true, branchesWait: true, rightRises: true, leftCrossesBottom: true,
      behindFog: true, showsGesture: true, clearedAtEnd: true,
    });
  } finally {
    socket?.close();
    if (chrome.exitCode === null && chrome.signalCode === null && chrome.pid) {
      const exited = new Promise(resolve => chrome.once('exit', resolve));
      chrome.kill();
      await exited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
