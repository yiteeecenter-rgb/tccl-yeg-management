const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

const ROOT = __dirname;

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
  const ext = path.extname(filePath);
  if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}).listen(5679, '127.0.0.1', () => console.log('Serving on http://127.0.0.1:5679'));
