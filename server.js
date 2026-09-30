// خادم محلي/أونلاين بدون أي مكتبات خارجية — يقرأ مجلد MiniPc تلقائيًا ويعرضه في الواجهة
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const MiniPc_DIR = path.join(ROOT, 'MiniPc');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.bmp': 'image/bmp', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.pdf': 'application/pdf'
};

function safeJoin(base, rel) {
  const full = path.normalize(path.join(base, rel));
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function listDir(dirFull, urlDir) {
  return fs.readdirSync(dirFull, { withFileTypes: true })
    .filter(e => !e.name.startsWith('.'))
    .map(e => {
      const isFolder = e.isDirectory();
      const p = urlDir + encodeURIComponent(e.name) + (isFolder ? '/' : '');
      const fullPath = path.join(dirFull, e.name);
      let size = null, lastModified = null;
      try {
        const st = fs.statSync(fullPath);
        size = st.size;
        lastModified = st.mtimeMs;
      } catch (_) {}
      return {
        name: e.name,
        isFolder,
        path: p,
        size: isFolder ? null : size,
        lastModified: isFolder ? null : lastModified
      };
    });
}

function serveFile(req, res, file) {
  const stat = fs.statSync(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1
    });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'no-store'
  });
  fs.createReadStream(file).pipe(res);
}

// ✅ دوال مساعدة للعمليات على الملفات
function uniquePath(dir, baseName, ext) {
  let name = baseName + ext;
  let full = path.join(dir, name);
  let i = 1;
  while (fs.existsSync(full)) {
    name = `${baseName} (${i})${ext}`;
    full = path.join(dir, name);
    i++;
  }
  return full;
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.copyFileSync(src, dest);
  }
}

// ✅ معالجة طلبات API
async function handleApi(req, res, urlPath) {
  try {
    const body = await readBody(req);

    // POST /api/mkdir  { parent: '/MiniPc/...', name: 'newFolder' }
    if (urlPath === '/api/mkdir' && req.method === 'POST') {
      const { parent = '/MiniPc/', name } = body;
      if (!name) return send(res, 400, JSON.stringify({ ok: false, error: 'Name required' }), 'application/json');
      const rel = parent.replace(/^\/MiniPc\//, '');
      const dirFull = safeJoin(MiniPc_DIR, rel);
      if (!dirFull) return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid path' }), 'application/json');
      if (!fs.existsSync(dirFull)) return send(res, 404, JSON.stringify({ ok: false, error: 'Parent not found' }), 'application/json');
      const target = uniquePath(dirFull, name, '');
      fs.mkdirSync(target, { recursive: true });
      return send(res, 200, JSON.stringify({ ok: true, name: path.basename(target) }), 'application/json');
    }

    // POST /api/newfile  { parent: '/MiniPc/...', name: 'newFile.txt', content: '' }
    if (urlPath === '/api/newfile' && req.method === 'POST') {
      const { parent = '/MiniPc/', name, content = '' } = body;
      if (!name) return send(res, 400, JSON.stringify({ ok: false, error: 'Name required' }), 'application/json');
      const rel = parent.replace(/^\/MiniPc\//, '');
      const dirFull = safeJoin(MiniPc_DIR, rel);
      if (!dirFull) return send(res, 400, JSON.stringify({ ok: false, error: 'Invalid path' }), 'application/json');
      if (!fs.existsSync(dirFull)) return send(res, 404, JSON.stringify({ ok: false, error: 'Parent not found' }), 'application/json');
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      const target = uniquePath(dirFull, base, ext);
      fs.writeFileSync(target, content, 'utf-8');
      return send(res, 200, JSON.stringify({ ok: true, name: path.basename(target) }), 'application/json');
    }

    // POST /api/rename  { path: '/MiniPc/...', newName: 'newName.txt' }
    if (urlPath === '/api/rename' && req.method === 'POST') {
      const { path: itemPath, newName } = body;
      if (!itemPath || !newName) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing params' }), 'application/json');
      const rel = itemPath.replace(/^\/MiniPc\//, '').replace(/\/$/, '');
      const full = safeJoin(MiniPc_DIR, rel);
      if (!full || !fs.existsSync(full)) return send(res, 404, JSON.stringify({ ok: false, error: 'Not found' }), 'application/json');
      const parentDir = path.dirname(full);
      const target = path.join(parentDir, newName);
      if (fs.existsSync(target)) return send(res, 409, JSON.stringify({ ok: false, error: 'Name already exists' }), 'application/json');
      fs.renameSync(full, target);
      return send(res, 200, JSON.stringify({ ok: true, name: newName }), 'application/json');
    }

    // POST /api/delete  { path: '/MiniPc/...' }
    if (urlPath === '/api/delete' && req.method === 'POST') {
      const { path: itemPath } = body;
      if (!itemPath) return send(res, 400, JSON.stringify({ ok: false, error: 'Path required' }), 'application/json');
      const rel = itemPath.replace(/^\/MiniPc\//, '').replace(/\/$/, '');
      const full = safeJoin(MiniPc_DIR, rel);
      if (!full || !fs.existsSync(full)) return send(res, 404, JSON.stringify({ ok: false, error: 'Not found' }), 'application/json');
      fs.rmSync(full, { recursive: true, force: true });
      return send(res, 200, JSON.stringify({ ok: true }), 'application/json');
    }

    // POST /api/paste  { src: '/MiniPc/...', dest: '/MiniPc/...' }  (dest is parent dir)
    if (urlPath === '/api/paste' && req.method === 'POST') {
      const { src, dest, move = false } = body;
      if (!src || !dest) return send(res, 400, JSON.stringify({ ok: false, error: 'Missing params' }), 'application/json');
      const srcRel = src.replace(/^\/MiniPc\//, '').replace(/\/$/, '');
      const destRel = dest.replace(/^\/MiniPc\//, '').replace(/\/$/, '');
      const srcFull = safeJoin(MiniPc_DIR, srcRel);
      const destDirFull = safeJoin(MiniPc_DIR, destRel);
      if (!srcFull || !fs.existsSync(srcFull)) return send(res, 404, JSON.stringify({ ok: false, error: 'Source not found' }), 'application/json');
      if (!destDirFull || !fs.existsSync(destDirFull) || !fs.statSync(destDirFull).isDirectory()) {
        return send(res, 404, JSON.stringify({ ok: false, error: 'Dest not a folder' }), 'application/json');
      }
      const srcName = path.basename(srcFull);
      const targetBase = path.join(destDirFull, srcName);
      if (path.resolve(srcFull) === path.resolve(targetBase)) {
        return send(res, 400, JSON.stringify({ ok: false, error: 'Same location' }), 'application/json');
      }
      let target = targetBase;
      if (fs.existsSync(target)) {
        const ext = path.extname(srcName);
        const base = path.basename(srcName, ext);
        target = uniquePath(destDirFull, base, ext);
      }
      if (move) {
        fs.renameSync(srcFull, target);
      } else {
        copyRecursive(srcFull, target);
      }
      return send(res, 200, JSON.stringify({ ok: true, name: path.basename(target) }), 'application/json');
    }

    return send(res, 404, JSON.stringify({ ok: false, error: 'Unknown endpoint' }), 'application/json');
  } catch (err) {
    return send(res, 500, JSON.stringify({ ok: false, error: err.message }), 'application/json');
  }
}

http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);

    // ✅ API routes
    if (urlPath.startsWith('/api/')) {
      return handleApi(req, res, urlPath);
    }

    // /MiniPc/**/.index.json  ->  قائمة المجلد
    if (urlPath.startsWith('/MiniPc/') && urlPath.endsWith('/.index.json')) {
      const urlDir = urlPath.slice(0, -'.index.json'.length);
      const relDir = urlDir.slice('/MiniPc/'.length);
      const dir = safeJoin(MiniPc_DIR, relDir);
      if (dir && fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
        const urlDirForClient = '/MiniPc/' + relDir;
        return send(res, 200, JSON.stringify(listDir(dir, urlDirForClient)), 'application/json; charset=utf-8');
      }
      return send(res, 404, '[]', 'application/json');
    }

    let file;
    if (urlPath.startsWith('/MiniPc/')) file = safeJoin(MiniPc_DIR, urlPath.slice('/MiniPc/'.length));
    else file = safeJoin(PUBLIC_DIR, urlPath === '/' ? 'index.html' : urlPath.slice(1));

    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found');
    serveFile(req, res, file);
  } catch (err) {
    send(res, 500, 'Server error: ' + err.message);
  }
}).listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  ✅ مستكشف الأصول يعمل على:  ${url}`);
  console.log(`  📁 المجلد المقروء: ${MiniPc_DIR}`);
  console.log(`  🌐 للوصول من نفس الشبكة: http://<IP-الجهاز>:${PORT}\n`);
});