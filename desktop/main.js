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
const { exec, execFile } = require('child_process');

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

/* Navegador embutido: links _blank navegam na própria guia, e o print
   da página é tirado aqui no processo principal (via ponte do preload) */
app.on('web-contents-created', (e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/i.test(url)) contents.loadURL(url);
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

app.whenReady().then(async () => {
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
