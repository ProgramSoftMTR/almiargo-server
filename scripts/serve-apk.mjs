/**
 * Sirve la carpeta artifacts/ por HTTP para descargar el APK en la LAN.
 *
 * Uso:
 *   node scripts/serve-apk.mjs
 *   APK_PORT=8081 APK_HOST=0.0.0.0 node scripts/serve-apk.mjs
 *
 * Luego abre en el teléfono:
 *   http://<IP_DE_TU_PC>:8081/almiargo-online-release.apk
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'artifacts');
const port = Number(process.env.APK_PORT || 8081);
const host = process.env.APK_HOST || '0.0.0.0';

const types = {
  '.apk': 'application/vnd.android.package-archive',
  '.aab': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function listFiles() {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const stat = fs.statSync(path.join(root, entry.name));
      return { name: entry.name, size: stat.size, mtime: stat.mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

function renderIndex() {
  const rows = listFiles().map((file) => `
    <tr>
      <td><a href="/${encodeURIComponent(file.name)}">${file.name}</a></td>
      <td>${(file.size / 1024 / 1024).toFixed(2)} MB</td>
      <td>${file.mtime.toLocaleString('es-AR')}</td>
    </tr>`).join('');
  return `<!doctype html>
<html lang="es"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Almiargo Online · descargas</title>
<style>
  body{font-family:system-ui,sans-serif;background:#10131a;color:#e7ecf3;padding:24px;max-width:760px;margin:auto}
  h1{font-size:20px} a{color:#5ad1ff} table{width:100%;border-collapse:collapse;margin-top:16px}
  td,th{padding:10px;border-bottom:1px solid #263041;text-align:left;font-size:14px}
  code{background:#1b2230;padding:2px 6px;border-radius:4px}
</style>
<h1>Almiargo Online · APK</h1>
<p>Descarga e instala en Android. Si el navegador lo bloquea, habilita “Instalar apps desconocidas”.</p>
<table><thead><tr><th>Archivo</th><th>Tamaño</th><th>Fecha</th></tr></thead><tbody>${rows}</tbody></table>
<p style="margin-top:18px;color:#94a3b8">Servidor temporal. Para detenerlo: Ctrl+C.</p>
</html>`;
}

function sendFile(req, res, file) {
  const stat = fs.statSync(file);
  const ext = path.extname(file).toLowerCase();
  const headers = {
    'Content-Type': types[ext] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (ext === '.apk') {
    headers['Content-Disposition'] = `attachment; filename="${path.basename(file)}"`;
  }

  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
      if (start <= end && start < stat.size) {
        res.writeHead(206, {
          ...headers,
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': end - start + 1,
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }
    }
    res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
    res.end();
    return;
  }

  res.writeHead(200, { ...headers, 'Content-Length': stat.size });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '/index.html') {
      const body = renderIndex();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
      });
      res.end(body);
      return;
    }
    const file = path.resolve(root, `.${rel}`);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('No encontrado');
      return;
    }
    sendFile(req, res, file);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Error: ${err.message}`);
  }
});

server.listen(port, host, () => {
  const interfaces = os.networkInterfaces();
  const ips = Object.values(interfaces).flat()
    .filter((net) => net && net.family === 'IPv4' && !net.internal)
    .map((net) => net.address);
  console.log(`[apk] sirviendo ${root}`);
  console.log(`[apk] local:    http://127.0.0.1:${port}/`);
  for (const ip of ips) console.log(`[apk] teléfono: http://${ip}:${port}/`);
  console.log('[apk] Ctrl+C para detener');
});
