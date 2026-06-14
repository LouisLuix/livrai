/* Ponte mínima com o sistema — nada além disto é exposto:
   — pathForFile: caminho REAL de arquivos/pastas arrastados pro app
   — captureWebview: print da página do navegador embutido (tirado no main)
   — term: sessões do Terminal embutido (PTY criado no processo principal) */
const { contextBridge, webUtils, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('livraiNative', {
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (_) {
      return '';
    }
  },
  captureWebview: (webContentsId) => ipcRenderer.invoke('livrai-capture-webview', webContentsId),
  term: {
    create: (opts) => ipcRenderer.invoke('livrai-term-create', opts),
    input: (id, data) => ipcRenderer.send('livrai-term-input', { id: id, data: data }),
    resize: (id, cols, rows) => ipcRenderer.send('livrai-term-resize', { id: id, cols: cols, rows: rows }),
    kill: (id) => ipcRenderer.send('livrai-term-kill', id),
    onData: (cb) => ipcRenderer.on('livrai-term-data', (e, m) => cb(m)),
    onExit: (cb) => ipcRenderer.on('livrai-term-exit', (e, m) => cb(m)),
  },
});
