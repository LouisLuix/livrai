/* Livrai — app desktop (Electron)
   Embute: proxy da OpenAI (porta 8787), ponte do Photoshop e
   MODO DE ATUALIZAÇÃO AO VIVO: se a pasta de desenvolvimento existir,
   o app carrega as ferramentas direto dela — novas ferramentas chegam
   com ⌘R, sem reinstalar. Senão, usa a cópia embutida. */
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, safeStorage, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { exec, execFile, spawn } = require('child_process');

// O login "Continuar com o Google" dos sites (Pinterest etc.) usa FedCM,
// que fica MUDO em apps embutidos sem conta Google no perfil. Desligado,
// o botão volta pro popup clássico — que o navegador embutido permite.
app.commandLine.appendSwitch('disable-features', 'FedCm,FedCmIdPRegistration');

// Identidade de navegador comum — sem isso o Google bloqueia o login
app.userAgentFallback = app.userAgentFallback
  .replace(/\slivrai\/\S+/i, '')
  .replace(/\sElectron\/\S+/, '');

const APP_PORT = 8788; // fixo: a "origem" (e os dados) dependem dele
const DEV_DIR = path.join(os.homedir(), 'Desktop', 'ORGANIZADOR DE ENTREGAS');
const liveMode = fs.existsSync(path.join(DEV_DIR, 'index.html'));
const APP_DIR = liveMode ? DEV_DIR : path.join(__dirname, 'app');

/* ---------- pasta do Estúdio ----------
   Predefinida na instalação (Documentos/Livrai) e alterável nas
   Configurações. O app sempre sabe onde os arquivos estão — nenhuma
   ação pede "onde salvar?". */
const STUDIO_CONFIG = () => path.join(app.getPath('userData'), 'livrai-studio.json');
let mainWin = null;

function defaultStudioRoot() {
  return liveMode ? DEV_DIR : path.join(app.getPath('documents'), 'Livrai');
}

function studioConfig() {
  try {
    return JSON.parse(fs.readFileSync(STUDIO_CONFIG(), 'utf8')) || {};
  } catch (_) {
    return {};
  }
}

function saveStudioConfig(cfg) {
  try { fs.writeFileSync(STUDIO_CONFIG(), JSON.stringify(cfg)); } catch (_) {}
}

function studioRoot() {
  const cfg = studioConfig();
  if (cfg.root && fs.existsSync(cfg.root)) return cfg.root;
  return defaultStudioRoot();
}

function projetosDir() {
  const dir = path.join(studioRoot(), 'Projetos');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  return dir;
}

function setStudioRoot(root) {
  const cfg = studioConfig();
  cfg.root = root;
  saveStudioConfig(cfg);
}

/* Pastas do computador vinculadas a projetos: só caminhos que o usuário
   escolheu num diálogo nativo ficam autorizados pra navegação/abertura */
function linkedRoots() {
  const cfg = studioConfig();
  return Array.isArray(cfg.linkedRoots)
    ? cfg.linkedRoots.filter((p) => typeof p === 'string')
    : [];
}

function addLinkedRoot(p) {
  const cfg = studioConfig();
  const list = Array.isArray(cfg.linkedRoots) ? cfg.linkedRoots : [];
  if (list.indexOf(p) < 0) list.push(p);
  cfg.linkedRoots = list;
  saveStudioConfig(cfg);
}

function isUnder(base, file) {
  return file === base || file.startsWith(base + path.sep);
}

// caminho absoluto → só passa se estiver dentro do Estúdio ou de uma pasta vinculada
function authorizedAbs(p) {
  if (!p) return null;
  const file = path.resolve(String(p));
  const roots = [path.resolve(studioRoot())].concat(linkedRoots().map((r) => path.resolve(r)));
  for (const r of roots) {
    if (isUnder(r, file)) return file;
  }
  return null;
}

function safeSegment(s) {
  const clean = String(s || '').replace(/[\\/:*?"<>|.]+/g, '-').trim();
  return clean || 'projeto';
}

function safeFileName(s) {
  const clean = String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '').trim();
  return clean || 'arquivo';
}

// caminho relativo → absoluto, sempre confinado à pasta Projetos
function resolveInProjetos(rel) {
  const base = projetosDir();
  const file = path.resolve(base, String(rel || ''));
  if (file !== base && !file.startsWith(base + path.sep)) return null;
  return file;
}

/* ---------- proxy da OpenAI (substitui o proxy.py) ---------- */
function startProxy() {
  const server = http.createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (!req.url.startsWith('/openai/')) {
      res.writeHead(404, cors);
      res.end();
      return;
    }
    const headers = {};
    for (const h of ['authorization', 'content-type', 'openai-organization']) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
    const up = https.request(
      'https://api.openai.com/' + req.url.slice('/openai/'.length),
      { method: req.method, headers: headers, timeout: 600000 },
      (upRes) => {
        res.writeHead(upRes.statusCode, Object.assign({}, cors, {
          'Content-Type': upRes.headers['content-type'] || 'application/json',
        }));
        upRes.pipe(res);
      }
    );
    up.on('error', (e) => {
      res.writeHead(502, cors);
      res.end(String(e));
    });
    req.pipe(up);
  });
  server.on('error', () => {}); // porta ocupada = já tem proxy rodando
  server.listen(8787, '127.0.0.1');
}

/* ---------- servidor local do app ----------
   Servir por http://localhost (em vez de file://) dá ao app uma origem real:
   o login com Google passa a funcionar e o armazenamento fica estável. */
const MIGRATION_FILE = () => path.join(app.getPath('userData'), 'livrai-migration.json');

/* ---------- preview de links (Open Graph) ---------- */
function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}
function metaContent(html, prop) {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + esc + '["\'][^>]*>', 'i');
  const m = html.match(re);
  if (!m) return '';
  const cm = m[0].match(/content=["\']([^"\']*)["\']/i);
  return cm ? decodeEntities(cm[1]) : '';
}
function parseLinkMeta(finalUrl, html) {
  const head = html.slice(0, 600000);
  const pick = (props) => {
    for (const p of props) {
      const v = metaContent(head, p);
      if (v) return v;
    }
    return '';
  };
  let title = pick(['og:title', 'twitter:title']);
  if (!title) {
    const t = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    title = t ? decodeEntities(t[1]) : '';
  }
  let image = pick(['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src']);
  if (image) { try { image = new URL(image, finalUrl).href; } catch (_) {} }
  return {
    url: finalUrl,
    title: title,
    description: pick(['og:description', 'twitter:description', 'description']),
    image: image,
    siteName: pick(['og:site_name', 'application-name']),
    type: pick(['og:type']),
  };
}

/* Endpoints locais da pasta do Estúdio (/__studio/...).
   Sem CORS e exigindo o cabeçalho X-Livrai: só o próprio app (mesma
   origem) consegue usar — páginas abertas no navegador não alcançam. */
function handleStudio(req, res, u) {
  if (req.headers['x-livrai'] !== '1') {
    res.writeHead(403);
    res.end();
    return;
  }
  const json = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (u.pathname === '/__studio' && req.method === 'GET') {
    return json(200, { root: studioRoot(), projetos: projetosDir() });
  }

  if (u.pathname === '/__studio/choose' && req.method === 'POST') {
    dialog
      .showOpenDialog(mainWin, {
        title: 'Pasta do Estúdio',
        message: 'Escolha onde o Estúdio guarda os arquivos dos projetos',
        defaultPath: studioRoot(),
        properties: ['openDirectory', 'createDirectory'],
      })
      .then((r) => {
        if (r.canceled || !r.filePaths[0]) return json(200, { canceled: true });
        setStudioRoot(r.filePaths[0]);
        json(200, { root: studioRoot(), projetos: projetosDir() });
      })
      .catch((e) => json(500, { error: String(e) }));
    return;
  }

  if (u.pathname === '/__studio/save' && req.method === 'POST') {
    const proj = safeSegment(u.searchParams.get('project'));
    const fname = safeFileName(u.searchParams.get('name'));
    const dir = path.join(projetosDir(), proj);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    const file = path.join(dir, fname);
    const out = fs.createWriteStream(file);
    req.pipe(out);
    out.on('finish', () => {
      try {
        const st = fs.statSync(file);
        json(200, { path: proj + '/' + fname, mtime: st.mtimeMs });
      } catch (e) {
        json(500, { error: String(e) });
      }
    });
    out.on('error', (e) => json(500, { error: String(e) }));
    return;
  }

  if (u.pathname === '/__studio/stat' && req.method === 'GET') {
    const file = resolveInProjetos(u.searchParams.get('path'));
    if (!file || !fs.existsSync(file)) return json(404, { error: 'não encontrado' });
    try {
      const st = fs.statSync(file);
      return json(200, { mtime: st.mtimeMs, size: st.size });
    } catch (e) {
      return json(500, { error: String(e) });
    }
  }

  if (u.pathname === '/__studio/file' && req.method === 'GET') {
    const rel = u.searchParams.get('path');
    const file = u.searchParams.get('abs') ? authorizedAbs(rel) : resolveInProjetos(rel);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': STUDIO_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
    return;
  }

  // ---------- Google Drive pessoal ----------
  if (u.pathname === '/__studio/drive-status' && req.method === 'GET') {
    const t = driveLoad();
    return json(200, { connected: !!(t && t.refresh_token), email: (t && t.email) || '' });
  }
  if (u.pathname === '/__studio/drive-connect' && req.method === 'POST') {
    if (!driveConfigured()) {
      return json(503, { error: 'Integração com o Google Drive não configurada nesta versão.' });
    }
    startDriveAuth();
    return json(200, { ok: true });
  }
  if (u.pathname === '/__studio/drive-disconnect' && req.method === 'POST') {
    try { fs.unlinkSync(DRIVE_FILE()); } catch (_) {}
    return json(200, { ok: true });
  }
  if (u.pathname === '/__studio/drive-upload' && req.method === 'POST') {
    const proj = String(u.searchParams.get('project') || 'Projeto');
    const fname = safeFileName(u.searchParams.get('name'));
    const mime = String(u.searchParams.get('type') || 'application/octet-stream');
    const parts = [];
    req.on('data', (c) => parts.push(c));
    req.on('end', async () => {
      try {
        const token = await driveToken();
        if (!token) return json(401, { error: 'Drive não conectado' });
        const livrai = await driveFolder(token, 'Livrai', null);
        const projetos = await driveFolder(token, 'Projetos', livrai);
        const folder = await driveFolder(token, proj, projetos);
        const out = await driveUpload(token, folder, fname, Buffer.concat(parts), mime);
        json(200, out);
      } catch (e) {
        json(500, { error: String(e && e.message ? e.message : e) });
      }
    });
    return;
  }

  if (u.pathname === '/__studio/calendar-status' && req.method === 'GET') {
    const t = calLoad();
    return json(200, { connected: !!(t && t.refresh_token), email: (t && t.email) || '' });
  }
  if (u.pathname === '/__studio/calendar-connect' && req.method === 'POST') {
    startCalAuth();
    return json(200, { ok: true });
  }
  if (u.pathname === '/__studio/calendar-disconnect' && req.method === 'POST') {
    try { fs.unlinkSync(CAL_FILE()); } catch (_) {}
    return json(200, { ok: true });
  }
  if (u.pathname === '/__studio/calendar-events' && req.method === 'GET') {
    const from = String(u.searchParams.get('from') || '');
    const to = String(u.searchParams.get('to') || '');
    (async () => {
      try {
        const token = await calToken();
        if (!token) return json(401, { error: 'Calendar não conectado' });
        const events = await calEvents(token, from, to);
        json(200, { events: events });
      } catch (e) {
        json(500, { error: String(e && e.message ? e.message : e) });
      }
    })();
    return;
  }

  // baixa uma imagem da web pro app (o processo principal não tem CORS) —
  // usado pelo "Guardar imagem no projeto" do navegador embutido
  if (u.pathname === '/__studio/fetch-url' && req.method === 'GET') {
    const target = String(u.searchParams.get('u') || '');
    if (!/^https?:\/\//i.test(target)) return json(400, { error: 'url inválida' });
    const MAX = 30 * 1048576;
    const get = (url, depth) => {
      if (depth > 5) return json(502, { error: 'redirecionamentos demais' });
      const mod = url.indexOf('https:') === 0 ? https : http;
      const r2 = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 30000 }, (up) => {
        if (up.statusCode >= 301 && up.statusCode <= 308 && up.headers.location) {
          up.resume();
          return get(new URL(up.headers.location, url).href, depth + 1);
        }
        if (up.statusCode !== 200) {
          up.resume();
          return json(502, { error: 'status ' + up.statusCode });
        }
        res.writeHead(200, { 'Content-Type': up.headers['content-type'] || 'application/octet-stream' });
        let total = 0;
        up.on('data', (c) => {
          total += c.length;
          if (total > MAX) {
            up.destroy();
            res.destroy();
            return;
          }
          res.write(c);
        });
        up.on('end', () => res.end());
      });
      r2.on('error', () => json(502, { error: 'falha na rede' }));
    };
    get(target, 0);
    return;
  }

  // preview de link: busca o HTML e extrai os metadados (Open Graph)
  if (u.pathname === '/__studio/unfurl' && req.method === 'GET') {
    const target = String(u.searchParams.get('u') || '');
    if (!/^https?:\/\//i.test(target)) return json(400, { error: 'url inválida' });
    const MAXH = 600 * 1024;
    let done = false;
    const finish = (finalUrl, html) => {
      if (done) return;
      done = true;
      try { json(200, parseLinkMeta(finalUrl, html)); } catch (_) { json(200, { url: finalUrl }); }
    };
    const get = (url, depth) => {
      if (depth > 5) return json(502, { error: 'redirecionamentos demais' });
      const mod = url.indexOf('https:') === 0 ? https : http;
      const r2 = mod.get(
        url,
        { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LivraiBot/1.0)', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' }, timeout: 15000 },
        (up) => {
          if (up.statusCode >= 301 && up.statusCode <= 308 && up.headers.location) {
            up.resume();
            return get(new URL(up.headers.location, url).href, depth + 1);
          }
          const ctype = up.headers['content-type'] || '';
          if (up.statusCode !== 200 || ctype.indexOf('text/html') < 0) {
            up.resume();
            return finish(url, ''); // sem HTML: sem preview (cliente usa o domínio)
          }
          let html = '';
          up.setEncoding('utf8');
          up.on('data', (c) => {
            html += c;
            if (html.length > MAXH) up.destroy(); // já pegamos o <head>
          });
          up.on('end', () => finish(url, html));
          up.on('close', () => finish(url, html));
        }
      );
      r2.on('error', () => finish(target, ''));
      r2.on('timeout', () => { r2.destroy(); finish(target, ''); });
    };
    get(target, 0);
    return;
  }

  // cofre de chaves: as chaves de IA ficam cifradas pelo sistema
  // (Keychain/DPAPI via safeStorage) num arquivo do app — fora do localStorage
  if (u.pathname === '/__studio/secrets' && req.method === 'GET') {
    const file = path.join(app.getPath('userData'), 'livrai-secrets.bin');
    try {
      if (!fs.existsSync(file)) return json(404, {});
      const buf = fs.readFileSync(file);
      const txt = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8');
      return json(200, { data: txt });
    } catch (e) {
      return json(500, { error: String(e) });
    }
  }
  if (u.pathname === '/__studio/secrets' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        const txt = String(payload.data || '{}');
        const buf = safeStorage.isEncryptionAvailable()
          ? safeStorage.encryptString(txt)
          : Buffer.from(txt, 'utf8');
        fs.writeFileSync(path.join(app.getPath('userData'), 'livrai-secrets.bin'), buf);
        json(200, { ok: true });
      } catch (e) {
        json(500, { error: String(e) });
      }
    });
    return;
  }

  // vincula uma pasta ARRASTADA pro app (o caminho vem do preload — gesto
  // explícito do usuário, equivalente ao diálogo nativo)
  if (u.pathname === '/__studio/link-path' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) {}
      const p = path.resolve(String(payload.path || ''));
      let ok = false;
      try { ok = p.length > 1 && fs.statSync(p).isDirectory(); } catch (_) {}
      if (!ok) return json(400, { error: 'pasta inválida' });
      addLinkedRoot(p);
      json(200, { path: p, name: path.basename(p) });
    });
    return;
  }

  // vincula uma pasta do computador (escolhida em diálogo nativo) ao Estúdio
  if (u.pathname === '/__studio/link-folder' && req.method === 'POST') {
    dialog
      .showOpenDialog(mainWin, {
        title: 'Vincular pasta ao projeto',
        message: 'Escolha a pasta do computador que faz parte deste projeto',
        properties: ['openDirectory', 'createDirectory'],
      })
      .then((r) => {
        if (r.canceled || !r.filePaths[0]) return json(200, { canceled: true });
        const p = r.filePaths[0];
        addLinkedRoot(p);
        json(200, { path: p, name: path.basename(p) });
      })
      .catch((e) => json(500, { error: String(e) }));
    return;
  }

  // lista o conteúdo de uma pasta autorizada (navegação dentro do app)
  if (u.pathname === '/__studio/browse' && req.method === 'GET') {
    const dir = authorizedAbs(u.searchParams.get('path'));
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return json(404, { error: 'pasta não encontrada ou não vinculada' });
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return json(500, { error: String(e) });
    }
    const out = [];
    for (const e of entries) {
      if (e.name.charAt(0) === '.') continue; // ocultos ficam ocultos
      const full = path.join(dir, e.name);
      let st = null;
      try { st = fs.statSync(full); } catch (_) { continue; }
      out.push({
        name: e.name,
        path: full,
        dir: st.isDirectory(),
        size: st.isDirectory() ? 0 : st.size,
        mtime: st.mtimeMs,
        ext: st.isDirectory() ? '' : path.extname(e.name).slice(1).toLowerCase(),
      });
      if (out.length >= 800) break; // pastas gigantes não travam o app
    }
    out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name, 'pt-BR') : a.dir ? -1 : 1));
    return json(200, { path: dir, entries: out });
  }

  if (u.pathname === '/__studio/open' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let payload = {};
      try { payload = JSON.parse(body || '{}'); } catch (_) {}
      const file = payload.abs ? authorizedAbs(payload.path) : resolveInProjetos(payload.path);
      if (!file || !fs.existsSync(file)) return json(404, { error: 'não encontrado' });
      if (fs.statSync(file).isDirectory()) shell.openPath(file); // pasta abre no Finder/Explorer
      else if (payload.app === 'reveal') shell.showItemInFolder(file);
      else if (payload.app === 'photoshop') openInPhotoshop(file);
      else shell.openPath(file);
      json(200, { ok: true });
    });
    return;
  }

  res.writeHead(404);
  res.end();
}

const STUDIO_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
};

function startAppServer() {
  const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.txt': 'text/plain; charset=utf-8',
    '.woff2': 'font/woff2',
  };
  const root = path.resolve(APP_DIR);
  const authTokens = {}; // state -> idToken (login Google feito no navegador)
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/__studio')) {
      handleStudio(req, res, u);
      return;
    }
    if (u.pathname === '/__gauth') {
      handleGAuth(req, res, u);
      return;
    }
    if (u.pathname === '/__auth') {
      const cors = { 'Access-Control-Allow-Origin': '*' };
      if (req.method === 'OPTIONS') {
        res.writeHead(204, cors);
        res.end();
        return;
      }
      const state = u.searchParams.get('state') || '';
      const idToken = u.searchParams.get('idToken');
      if (!state) {
        res.writeHead(400, cors);
        res.end();
        return;
      }
      if (idToken) {
        // o site de login entrega a credencial aqui
        authTokens[state] = idToken;
        setTimeout(() => delete authTokens[state], 120000); // expira em 2 min
        res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
        res.end('{"ok":true}');
      } else {
        // o app consulta se a credencial já chegou
        const t = authTokens[state];
        if (t) {
          delete authTokens[state];
          res.writeHead(200, Object.assign({ 'Content-Type': 'application/json' }, cors));
          res.end(JSON.stringify({ idToken: t }));
        } else {
          res.writeHead(204, cors);
          res.end();
        }
      }
      return;
    }
    if (u.pathname === '/__migration') {
      // entrega (e depois apaga) os projetos exportados da versão antiga
      if (u.searchParams.get('done')) {
        try { fs.unlinkSync(MIGRATION_FILE()); } catch (_) {}
        res.writeHead(204);
        res.end();
        return;
      }
      if (fs.existsSync(MIGRATION_FILE())) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        fs.createReadStream(MIGRATION_FILE()).pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
      return;
    }
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const file = path.resolve(path.join(root, p));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  server.on('error', () => {}); // porta ocupada = outra instância já serve
  server.listen(APP_PORT, '127.0.0.1');
}

/* ---------- migração da origem antiga (file://) ----------
   Versões anteriores guardavam os projetos sob file://. Uma única vez,
   abrimos uma janela invisível lá, exportamos tudo e deixamos no
   /__migration pro app importar. Ninguém perde nada. */
function runMigration() {
  return new Promise((resolve) => {
    const marker = path.join(app.getPath('userData'), 'livrai-migrated.txt');
    if (fs.existsSync(marker)) return resolve();
    let hasOld = false;
    try {
      hasOld = fs
        .readdirSync(path.join(app.getPath('userData'), 'IndexedDB'))
        .some((n) => n.startsWith('file__0.indexeddb'));
    } catch (_) {}
    if (!hasOld) {
      try { fs.writeFileSync(marker, 'fresh'); } catch (_) {}
      return resolve();
    }
    const migratePage = path.join(APP_DIR, 'migrate.html');
    if (!fs.existsSync(migratePage)) {
      try { fs.writeFileSync(marker, 'sem-pagina'); } catch (_) {}
      return resolve();
    }
    const hidden = new BrowserWindow({
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    let settled = false;
    function done(payload) {
      if (settled) return;
      settled = true;
      try {
        if (payload && Array.isArray(payload.projects) && payload.projects.length) {
          fs.writeFileSync(MIGRATION_FILE(), JSON.stringify(payload));
        }
        fs.writeFileSync(marker, 'ok');
      } catch (_) {}
      try { hidden.destroy(); } catch (_) {}
      resolve();
    }
    ipcMain.once('livrai-migration', (e, payload) => done(payload));
    setTimeout(() => done(null), 15000);
    hidden.loadFile(migratePage);
  });
}

/* ---------- ponte do Photoshop (substitui photoshop-bridge.sh) ---------- */
function listFilaTxt(dir, depth, out) {
  if (depth > 4) return;
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.fila') {
        try {
          for (const f of fs.readdirSync(p)) {
            if (f.endsWith('.txt')) out.push(path.join(p, f));
          }
        } catch (_) {}
      } else if (e.name !== 'node_modules' && e.name !== 'desktop' && !e.name.startsWith('.')) {
        listFilaTxt(p, depth + 1, out);
      }
    }
  }
}

let winPhotoshopExe; // cache: caminho do Photoshop.exe no Windows (null = não achou)
function findWindowsPhotoshop() {
  if (winPhotoshopExe !== undefined) return winPhotoshopExe;
  const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean);
  const hits = [];
  for (const root of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(path.join(root, 'Adobe'));
    } catch (_) {
      continue;
    }
    for (const name of entries) {
      if (!/photoshop/i.test(name)) continue;
      const exe = path.join(root, 'Adobe', name, 'Photoshop.exe');
      if (fs.existsSync(exe)) hits.push(exe);
    }
  }
  hits.sort(); // "Adobe Photoshop 2026" > "Adobe Photoshop 2025" — fica o mais novo
  winPhotoshopExe = hits.pop() || null;
  return winPhotoshopExe;
}

function openInPhotoshop(file) {
  if (process.platform === 'win32') {
    const ps = findWindowsPhotoshop();
    if (ps) execFile(ps, [file], () => {});
    else shell.openPath(file); // sem Photoshop instalado: abre no app padrão
    return;
  }
  const q = "'" + file.replace(/'/g, "'\\''") + "'";
  exec('open -b com.adobe.Photoshop ' + q + ' || open -a "Adobe Photoshop" ' + q + ' || open ' + q);
}

function startPhotoshopBridge() {
  try {
    fs.mkdirSync(path.join(projetosDir(), '.fila'), { recursive: true });
  } catch (_) {}
  setInterval(() => {
    const triggers = [];
    listFilaTxt(studioRoot(), 0, triggers);
    for (const t of triggers) {
      try {
        const rel = fs.readFileSync(t, 'utf8').trim();
        fs.unlinkSync(t);
        const f = path.join(path.dirname(path.dirname(t)), rel);
        if (fs.existsSync(f)) openInPhotoshop(f);
      } catch (_) {}
    }
  }, 2000);
}

/* ---------- janela ---------- */
function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'Livrai',
    backgroundColor: '#0d0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webviewTag: true, // navegador embutido (visão Navegador)
    },
  });
  mainWin = win;
  win.on('closed', () => { if (mainWin === win) mainWin = null; });
  win.loadURL('http://localhost:' + APP_PORT + '/index.html');
  win.webContents.setWindowOpenHandler(({ url }) => {
    // o popup de login (Google/Firebase) precisa abrir DENTRO do app
    if (
      url.indexOf('firebaseapp.com') >= 0 ||
      url.indexOf('accounts.google.com') >= 0 ||
      url.indexOf('google.com/o/oauth') >= 0
    ) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true },
      };
    }
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  const template = [
    {
      label: 'Livrai',
      submenu: [
        {
          label: '🔄 Atualizar ferramentas',
          accelerator: 'CmdOrCtrl+R',
          click: () => win.reload(),
        },
        {
          label: 'Sobre as atualizações',
          click: () =>
            dialog.showMessageBox(win, {
              message: 'Livrai ' + app.getVersion(),
              detail: liveMode
                ? 'Modo de atualização ao vivo ATIVO: as ferramentas são carregadas da pasta "ORGANIZADOR DE ENTREGAS". Ferramenta nova entrou lá? Aperte ' + (process.platform === 'darwin' ? '⌘R' : 'Ctrl+R') + ' e ela aparece — sem reinstalar.'
                : 'Usando a versão embutida no app. Para atualizar as ferramentas, instale a versão mais nova do Livrai.',
            }),
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair do Livrai' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'togglefullscreen' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { role: 'resetZoom' }, { type: 'separator' }, { role: 'toggleDevTools' },
      ],
    },
    { label: 'Janela', submenu: [{ role: 'minimize' }, { role: 'close' }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------- Google Drive (nuvem PESSOAL do usuário) ----------
   Cada usuário autoriza a própria conta numa janela do app; o token fica
   cifrado no computador dele (safeStorage). Escopo drive.file: o app só
   enxerga o que ele mesmo criar no Drive da pessoa. */
// Credenciais do Google Drive (app desktop). NÃO ficam no repositório: são
// lidas de variáveis de ambiente ou de um arquivo local gitignored
// (desktop/drive-credentials.json) — embarcado só nos builds de release.
// Sem credenciais, a integração com o Drive fica indisponível (degrada).
function loadDriveClient() {
  if (process.env.LIVRAI_DRIVE_ID && process.env.LIVRAI_DRIVE_SECRET) {
    return { id: process.env.LIVRAI_DRIVE_ID, secret: process.env.LIVRAI_DRIVE_SECRET };
  }
  const candidates = [
    path.join(__dirname, 'drive-credentials.json'),
    path.join(process.resourcesPath || __dirname, 'drive-credentials.json'),
  ];
  for (const p of candidates) {
    try {
      const c = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (c && c.id && c.secret) return { id: c.id, secret: c.secret };
    } catch (_) {}
  }
  return { id: '', secret: '' };
}
const DRIVE_CLIENT = loadDriveClient();
const driveConfigured = () => !!(DRIVE_CLIENT.id && DRIVE_CLIENT.secret);

// PKCE: protege o código de autorização contra interceptação. O verifier de
// cada fluxo fica guardado por "state" até o callback trocar o código por token.
const pkceStore = {};
function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function newPkce(state) {
  const verifier = b64url(crypto.randomBytes(32));
  pkceStore[state] = verifier;
  return b64url(crypto.createHash('sha256').update(verifier).digest());
}
const DRIVE_FILE = () => path.join(app.getPath('userData'), 'livrai-drive.bin');
let driveAuthWin = null;

function driveLoad() {
  try {
    const buf = fs.readFileSync(DRIVE_FILE());
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

function driveSave(tokens) {
  const txt = JSON.stringify(tokens);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8');
  fs.writeFileSync(DRIVE_FILE(), buf);
}

function httpsJson(url, options, body) {
  if (body) {
    options.headers = options.headers || {};
    options.headers['Content-Length'] = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(body);
  }
  return new Promise((resolve, reject) => {
    const r = https.request(url, options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, json: JSON.parse(data || '{}') });
        } catch (e) {
          resolve({ status: res.statusCode, json: {} });
        }
      });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

async function driveToken() {
  const t = driveLoad();
  if (!t || !t.refresh_token) return null;
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;
  const body =
    'client_id=' + encodeURIComponent(DRIVE_CLIENT.id) +
    '&client_secret=' + encodeURIComponent(DRIVE_CLIENT.secret) +
    '&refresh_token=' + encodeURIComponent(t.refresh_token) +
    '&grant_type=refresh_token';
  const r = await httpsJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  if (!r.json.access_token) return null;
  t.access_token = r.json.access_token;
  t.expires_at = Date.now() + (r.json.expires_in || 3500) * 1000;
  driveSave(t);
  return t.access_token;
}

async function driveApi(method, url, token, body, contentType) {
  return httpsJson(url, {
    method: method,
    headers: Object.assign(
      { Authorization: 'Bearer ' + token },
      body ? { 'Content-Type': contentType || 'application/json' } : {}
    ),
  }, body);
}

/* acha (ou cria) a cadeia Livrai/Projetos/<projeto> e devolve o id da ponta */
async function driveFolder(token, name, parentId) {
  const q = encodeURIComponent(
    "name='" + name.replace(/'/g, "\\'") + "' and mimeType='application/vnd.google-apps.folder' and trashed=false and '" +
    (parentId || 'root') + "' in parents"
  );
  const list = await driveApi('GET', 'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)', token);
  if (list.json.error) throw new Error('Drive: ' + (list.json.error.message || list.status));
  if (list.json.files && list.json.files.length) return list.json.files[0].id;
  const made = await driveApi('POST', 'https://www.googleapis.com/drive/v3/files?fields=id', token,
    JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId || 'root'] }));
  if (!made.json.id) throw new Error('Drive (pasta): ' + ((made.json.error && made.json.error.message) || made.status));
  return made.json.id;
}

async function driveUpload(token, folderId, name, buf, mime) {
  // mesmo nome na pasta? vira NOVA VERSÃO do mesmo arquivo (histórico do Drive)
  const q = encodeURIComponent("name='" + name.replace(/'/g, "\\'") + "' and trashed=false and '" + folderId + "' in parents");
  const list = await driveApi('GET', 'https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id)', token);
  const existing = list.json.files && list.json.files[0];
  if (existing) {
    const up = await httpsJson(
      'https://www.googleapis.com/upload/drive/v3/files/' + existing.id + '?uploadType=media&fields=id,webViewLink',
      { method: 'PATCH', headers: { Authorization: 'Bearer ' + token, 'Content-Type': mime } }, buf);
    return { id: existing.id, link: up.json.webViewLink, version: true };
  }
  const boundary = 'livrai' + Date.now();
  const meta = JSON.stringify({ name: name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from('--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + boundary + '\r\nContent-Type: ' + mime + '\r\n\r\n'),
    buf,
    Buffer.from('\r\n--' + boundary + '--'),
  ]);
  const up = await httpsJson(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'multipart/related; boundary=' + boundary } }, body);
  if (!up.json.id) throw new Error('Drive (upload): ' + ((up.json.error && up.json.error.message) || up.status));
  return { id: up.json.id, link: up.json.webViewLink, version: false };
}

function startDriveAuth() {
  const redirect = 'http://127.0.0.1:' + APP_PORT + '/__gauth';
  const challenge = newPkce('drive');
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(DRIVE_CLIENT.id) +
    '&redirect_uri=' + encodeURIComponent(redirect) +
    '&response_type=code&scope=' + encodeURIComponent('https://www.googleapis.com/auth/drive.file') +
    '&access_type=offline&prompt=consent&state=drive' +
    '&code_challenge=' + encodeURIComponent(challenge) + '&code_challenge_method=S256';
  // navegador EXTERNO: quem já está logado no Google só confirma com 1 clique
  shell.openExternal(url);
}

async function handleGAuth(req, res, u) {
  const code = u.searchParams.get('code');
  const state = u.searchParams.get('state') || 'drive';
  const label = state === 'calendar' ? 'Google Calendar conectado' : 'Drive conectado';
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<body style="background:#0a0a0b;color:#e8e8ec;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:95vh"><p>' +
    (code ? label + ' — pode voltar pro LIVRAI.' : 'Autorização cancelada.') + '</p></body>');
  if (driveAuthWin) { setTimeout(() => { try { driveAuthWin.close(); } catch (_) {} }, 900); }
  if (!code) return;
  try {
    const verifier = pkceStore[state] || '';
    delete pkceStore[state];
    const body =
      'code=' + encodeURIComponent(code) +
      '&client_id=' + encodeURIComponent(DRIVE_CLIENT.id) +
      '&client_secret=' + encodeURIComponent(DRIVE_CLIENT.secret) +
      '&redirect_uri=' + encodeURIComponent('http://127.0.0.1:' + APP_PORT + '/__gauth') +
      '&grant_type=authorization_code' +
      (verifier ? '&code_verifier=' + encodeURIComponent(verifier) : '');
    const r = await httpsJson('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }, body);
    if (!r.json.refresh_token && !r.json.access_token) return;
    const tokens = {
      refresh_token: r.json.refresh_token,
      access_token: r.json.access_token,
      expires_at: Date.now() + (r.json.expires_in || 3500) * 1000,
    };
    if (state === 'calendar') {
      // o id do calendário "primary" É o e-mail da conta — sem escopo extra
      const who = await driveApi('GET', 'https://www.googleapis.com/calendar/v3/calendars/primary?fields=id', tokens.access_token);
      tokens.email = (who.json && who.json.id) || '';
      calSave(tokens);
    } else {
      const who = await driveApi('GET', 'https://www.googleapis.com/drive/v3/about?fields=user', tokens.access_token);
      tokens.email = (who.json.user && who.json.user.emailAddress) || '';
      driveSave(tokens);
    }
  } catch (_) {}
}

/* ---------- Google Calendar (só leitura) ----------
   Mesmo cliente OAuth do Drive, escopo calendar.readonly, token cifrado
   à parte (livrai-calendar.bin). A Agenda do app puxa os eventos do mês
   visível pra exibir junto com os posts dos projetos. */
const CAL_FILE = () => path.join(app.getPath('userData'), 'livrai-calendar.bin');

function calLoad() {
  try {
    const buf = fs.readFileSync(CAL_FILE());
    const txt = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
    return JSON.parse(txt);
  } catch (_) {
    return null;
  }
}

function calSave(tokens) {
  const txt = JSON.stringify(tokens);
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(txt) : Buffer.from(txt, 'utf8');
  fs.writeFileSync(CAL_FILE(), buf);
}

async function calToken() {
  const t = calLoad();
  if (!t || !t.refresh_token) return null;
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 60000) return t.access_token;
  const body =
    'client_id=' + encodeURIComponent(DRIVE_CLIENT.id) +
    '&client_secret=' + encodeURIComponent(DRIVE_CLIENT.secret) +
    '&refresh_token=' + encodeURIComponent(t.refresh_token) +
    '&grant_type=refresh_token';
  const r = await httpsJson('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, body);
  if (!r.json.access_token) return null;
  t.access_token = r.json.access_token;
  t.expires_at = Date.now() + (r.json.expires_in || 3500) * 1000;
  calSave(t);
  return t.access_token;
}

function startCalAuth() {
  const redirect = 'http://127.0.0.1:' + APP_PORT + '/__gauth';
  const challenge = newPkce('calendar');
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + encodeURIComponent(DRIVE_CLIENT.id) +
    '&redirect_uri=' + encodeURIComponent(redirect) +
    '&response_type=code&scope=' + encodeURIComponent('https://www.googleapis.com/auth/calendar.readonly') +
    '&access_type=offline&prompt=consent&state=calendar' +
    '&code_challenge=' + encodeURIComponent(challenge) + '&code_challenge_method=S256';
  shell.openExternal(url);
}

/* eventos de todos os calendários selecionados no intervalo [from, to] (ISO) */
async function calEvents(token, fromIso, toIso) {
  const listed = await driveApi(
    'GET',
    'https://www.googleapis.com/calendar/v3/users/me/calendarList?fields=items(id,summary,backgroundColor,selected)',
    token
  );
  if (listed.json.error) throw new Error('Calendar: ' + (listed.json.error.message || listed.status));
  const cals = (listed.json.items || []).filter((c) => c.selected !== false).slice(0, 25);
  const out = [];
  for (const cal of cals) {
    const q =
      'https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(cal.id) +
      '/events?singleEvents=true&orderBy=startTime&maxResults=250' +
      '&timeMin=' + encodeURIComponent(fromIso) +
      '&timeMax=' + encodeURIComponent(toIso) +
      '&fields=items(id,summary,start,end,htmlLink)';
    const ev = await driveApi('GET', q, token);
    (ev.json.items || []).forEach((e) => {
      const allDay = !!(e.start && e.start.date);
      out.push({
        id: e.id,
        title: e.summary || '(sem título)',
        allDay: allDay,
        start: (e.start && (e.start.dateTime || e.start.date)) || '',
        end: (e.end && (e.end.dateTime || e.end.date)) || '',
        link: e.htmlLink || '',
        calendar: cal.summary || '',
        color: cal.backgroundColor || '#7aa2f7',
      });
    });
  }
  return out;
}

/* Navegador embutido: links _blank navegam na própria guia, e o print
   da página é tirado aqui no processo principal (via ponte do preload) */
app.on('web-contents-created', (e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      // popups de LOGIN (Google/Facebook/Apple/OAuth) precisam ser janelas de
      // verdade: eles conversam com a página que os abriu e herdam a sessão
      // do navegador embutido — logou no popup, está logado na guia
      const isAuth = !url || url === 'about:blank' ||
        /accounts\.google\.|facebook\.com\/(login|dialog|oauth)|appleid\.apple\.|login\.microsoftonline|\/oauth|\/authorize|\/signin/i.test(url);
      if (isAuth) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true },
        };
      }
      if (/^https?:/i.test(url)) contents.loadURL(url); // link comum: navega na própria guia
      return { action: 'deny' };
    });
  }
});

ipcMain.handle('livrai-capture-webview', async (e, wcId) => {
  const wc = webContents.fromId(wcId);
  if (!wc || wc.getType() !== 'webview') return null;
  const img = await wc.capturePage();
  return img.toDataURL();
});

/* ---------- Terminal embutido (visão Terminal) ----------
   PTY sem módulo nativo: o wrapper livrai-term.py (Python, que já vem no macOS)
   cria o pseudo-terminal e repassa teclado/tela por pipes; redimensionar
   chega por um canal de controle (fd 3). No Windows, sem pty, o
   PowerShell roda em modo simples — funciona, mas sem apps de tela cheia. */
const termSessions = new Map();
let termSeq = 0;

ipcMain.handle('livrai-term-create', (e, opts) => {
  const cols = Math.max(20, (opts && opts.cols) || 80);
  const rows = Math.max(5, (opts && opts.rows) || 24);
  // aba pode nascer na pasta de um projeto — mas só em caminho autorizado
  let cwd = studioRoot();
  const want = opts && opts.cwd ? authorizedAbs(opts.cwd) : null;
  if (want) {
    try { fs.mkdirSync(want, { recursive: true }); } catch (_) {}
    if (fs.existsSync(want)) cwd = want;
  }
  const env = Object.assign({}, process.env, { TERM: 'xterm-256color' });
  let child;
  if (process.platform === 'win32') {
    child = spawn('powershell.exe', ['-NoLogo'], { cwd: cwd, env: env });
  } else {
    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
    // empacotado, o script fica fora do asar (asarUnpack) — corrige o caminho;
    // em dev (sem app.asar) o replace não faz nada
    const termScript = path.join(__dirname, 'livrai-term.py').replace(/app\.asar([\/\\])/, 'app.asar.unpacked$1');
    child = spawn('python3', [termScript, shell, String(cols), String(rows)], {
      cwd: cwd,
      env: env,
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });
  }

  const id = ++termSeq;
  const sender = e.sender;
  termSessions.set(id, child);

  const relay = (d) => {
    try { sender.send('livrai-term-data', { id: id, data: d }); } catch (_) {}
  };
  child.stdout.on('data', relay);
  if (child.stderr) child.stderr.on('data', relay);
  child.on('exit', (code) => {
    termSessions.delete(id);
    try { sender.send('livrai-term-exit', { id: id, code: code }); } catch (_) {}
  });
  child.on('error', () => {
    termSessions.delete(id);
    try { sender.send('livrai-term-exit', { id: id, code: -1 }); } catch (_) {}
  });
  return { id: id, cwd: cwd };
});

ipcMain.on('livrai-term-input', (e, m) => {
  const s = termSessions.get(m && m.id);
  if (s && s.stdin && s.stdin.writable) s.stdin.write(m.data);
});

ipcMain.on('livrai-term-resize', (e, m) => {
  const s = termSessions.get(m && m.id);
  if (!s) return;
  const ctl = s.stdio && s.stdio[3];
  if (ctl && ctl.writable) {
    ctl.write(JSON.stringify({ cols: m.cols, rows: m.rows }) + '\n');
  }
});

ipcMain.on('livrai-term-kill', (e, id) => {
  const s = termSessions.get(id);
  if (!s) return;
  termSessions.delete(id);
  try { s.kill(); } catch (_) {}
});

app.on('quit', () => {
  for (const s of termSessions.values()) {
    try { s.kill(); } catch (_) {}
  }
  termSessions.clear();
});

app.whenReady().then(async () => {
  // libera o microfone (ditado por voz) na camada web; no macOS o sistema
  // ainda pede confirmação na primeira vez
  try {
    const { session } = require('electron');
    session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(true));
  } catch (_) {}
  startProxy();
  startAppServer();
  startPhotoshopBridge();
  await runMigration();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
