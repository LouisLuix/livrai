/* Ponte mínima com o sistema — nada além disto é exposto:
   — pathForFile: caminho REAL de arquivos/pastas arrastados pro app
   — captureWebview: print da página do navegador embutido (tirado no main) */
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
});
