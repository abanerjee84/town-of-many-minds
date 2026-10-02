import { defineConfig } from 'vite';

const llmProxy = {
  '/lm': {
    target: 'http://localhost:1234',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/lm/, '')
  }
};

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
    proxy: llmProxy
  },
  preview: {
    proxy: llmProxy
  },
  build: {
    target: 'es2020',
    sourcemap: true
  }
});
