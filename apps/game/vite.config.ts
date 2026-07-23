import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const platformTarget = env.WHITEROOM_PLATFORM_URL ?? 'http://127.0.0.1:8787';
  const proxy = {
    '/api': {
      target: platformTarget,
      changeOrigin: false,
      secure: false,
      ws: true,
    },
    '/avatars': {
      target: platformTarget,
      changeOrigin: false,
      secure: false,
    },
    '/lobby-assets': {
      target: platformTarget,
      changeOrigin: false,
      secure: false,
    },
  };
  return {
    base: './',
    server: { proxy },
    preview: { proxy },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
  };
});
