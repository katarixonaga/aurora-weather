// Minimal zero-dependency static server for Aurora Weather.
// Usage: node serve.js   →   http://localhost:4173
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, port = process.env.PORT || 4173;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const fp = path.join(root, p);
  if (!fp.startsWith(root)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(fp, (e, data) => {
    if (e) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(fp)] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(port, () => console.log('Aurora Weather → http://localhost:' + port));
