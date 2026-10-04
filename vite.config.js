import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const llmProxy = {
  '/lm': {
    target: 'http://localhost:1234',
    changeOrigin: true,
    rewrite: (p) => p.replace(/^\/lm/, '')
  }
};

function mapNowWriter() {
  const root = process.cwd();
  const mapDir = path.join(root, 'MapNow');
  const historyDir = path.join(mapDir, 'history');
  const write = (req, res, next) => {
    if (req.method !== 'POST') return next();
    let body = '';
    let size = 0;
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > 2_000_000) {
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on('end', () => {
      if (!body) {
        res.statusCode = 400;
        res.end('MapNow body is empty');
        return;
      }
      fs.mkdirSync(historyDir, { recursive: true });
      fs.writeFileSync(path.join(mapDir, 'latest.map.txt'), body, 'utf8');
      const day = body.match(/^DAY=([^\s]+)/m)?.[1] || 'unknown';
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.writeFileSync(path.join(historyDir, `turn-${stamp}-day-${day}.map.txt`), body, 'utf8');
      const history = fs.readdirSync(historyDir)
        .filter((name) => name.endsWith('.map.txt'))
        .sort()
        .reverse();
      for (const old of history.slice(48)) fs.rmSync(path.join(historyDir, old), { force: true });
      res.statusCode = 204;
      res.end();
    });
  };
  return {
    name: 'tomm-mapnow-writer',
    configureServer(server) { server.middlewares.use('/__mapnow', write); },
    configurePreviewServer(server) { server.middlewares.use('/__mapnow', write); }
  };
}

export default defineConfig({
  base: './',
  plugins: [mapNowWriter()],
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
