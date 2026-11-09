const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const port = Number(process.env.PORT || 8080);
const version = process.env.APP_VERSION || 'dev';
const staticRoot = path.join(__dirname, 'dist');
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const sessions = [
  { id: 1, time: '10:00', room: 'Main', title: 'Kickoff and sponsor talks' },
  { id: 2, time: '11:00', room: 'Everywhere', title: 'Build' },
  { id: 3, time: '14:00', room: 'Main', title: 'Panel' },
  { id: 4, time: '17:30', room: 'Main', title: 'Submissions close' },
];

function createServer() {
  return http.createServer((req, res) => {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad request\n');
    }
    if (url.pathname === '/healthz' || url.pathname === '/readyz') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('ok\n');
    }
    if (url.pathname === '/api/sessions') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ version, sessions }));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, HEAD' });
      return res.end('method not allowed\n');
    }
    if (url.pathname === '/' || url.pathname.startsWith('/assets/')) {
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return res.end('bad path\n');
      }
      if (pathname.includes('\0')) {
        res.writeHead(400, { 'content-type': 'text/plain' });
        return res.end('bad path\n');
      }
      const file = path.resolve(staticRoot, pathname === '/' ? 'index.html' : `.${pathname}`);
      if (!file.startsWith(`${staticRoot}${path.sep}`)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found\n');
      }
      return fs.readFile(file, (error, content) => {
        if (error) {
          const missingBuild = pathname === '/' && error.code === 'ENOENT';
          const status = missingBuild ? 503 : error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500;
          if (status !== 404) console.error(`Static UI request failed: ${error.message}`);
          res.writeHead(status, { 'content-type': 'text/plain' });
          return res.end(missingBuild ? 'UI build missing. Run npm run build first.\n' : 'unable to serve asset\n');
        }
        res.writeHead(200, {
          'content-type': contentTypes[path.extname(file)] || 'application/octet-stream',
          'cache-control': pathname === '/' ? 'no-cache' : 'public, max-age=31536000, immutable',
          'x-content-type-options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : content);
      });
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found\n');
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(port, () => console.log(`listening on :${port}, version ${version}`));

  // Exit cleanly when Kubernetes stops the pod.
  process.on('SIGTERM', () => server.close(() => process.exit(0)));
}

module.exports = { createServer };
