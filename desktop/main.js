/* Livrai — app desktop (Electron)
   Embute: proxy da OpenAI (porta 8787), ponte do Photoshop e
   MODO DE ATUALIZAÇÃO AO VIVO: se a pasta de desenvolvimento existir,
   o app carrega as ferramentas direto dela — novas ferramentas chegam
   com ⌘R, sem reinstalar. Senão, usa a cópia embutida. */
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const https = require('https');
const { exec, execFile } = require('child_process');

const DEV_DIR = path.join(os.homedir(), 'Desktop', 'ORGANIZADOR DE ENTREGAS');
const liveMode = fs.existsSync(path.join(DEV_DIR, 'index.html'));
const APP_DIR = liveMode ? DEV_DIR : path.join(__dirname, 'app');
const WATCH_ROOT = liveMode ? DEV_DIR : path.join(app.getPath('documents'), 'Livrai');

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
    fs.mkdirSync(path.join(WATCH_ROOT, 'Projetos', '.fila'), { recursive: true });
  } catch (_) {}
  setInterval(() => {
    const triggers = [];
    listFilaTxt(WATCH_ROOT, 0, triggers);
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
  });
  win.loadFile(path.join(APP_DIR, 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
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

app.whenReady().then(() => {
  startProxy();
  startPhotoshopBridge();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => app.quit());
