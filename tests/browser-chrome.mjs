import { spawn } from 'node:child_process';

export function launchTestChrome(profile) {
  return spawn(process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-proxy-server',
    '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
}
