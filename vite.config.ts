import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const immichUrl = env.IMMICH_URL || 'http://localhost:2283';

  return {
    server: {
      proxy: {
        '/api': {
          target: immichUrl,
          changeOrigin: true,
        },
      },
    },
  };
});
