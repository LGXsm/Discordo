import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import { attachVoiceServer } from './backend/src/voice.mjs';

export default defineConfig(({ mode }) => {
  const { DISCORDO_ICE_SERVERS, DISCORDO_ACCOUNT_SERVER } = loadEnv(mode, process.cwd(), 'DISCORDO_');
  const php = DISCORDO_ACCOUNT_SERVER || 'http://127.0.0.1:8081';
  const proxy = { '/account.php': php, '/servers.php': php, '/voice.php': php, '/chat.php': php, '/friends.php': php };
  const attach = ({ httpServer, middlewares }) => {
    if (!httpServer) return;
    const { close, presence } = attachVoiceServer(httpServer, DISCORDO_ICE_SERVERS);
    middlewares.use('/voice-presence', presence);
    httpServer.once('close', close);
  };
  return {
    root: fileURLToPath(new URL('./frontend/', import.meta.url)),
    build: { outDir: fileURLToPath(new URL('./dist/', import.meta.url)), emptyOutDir: false },
    base: process.env.VITE_DISCORDO_VOICE_TRANSPORT === 'http' ? './' : '/',
    server: { proxy },
    preview: { proxy },
    plugins: [{ name: 'discordo-voice', configureServer: attach, configurePreviewServer: attach }],
  };
});
