/* Ponte mínima com o sistema: entrega o caminho REAL de arquivos/pastas
   arrastados pra dentro do app — páginas web não têm acesso a isso.
   Nada além disso é exposto. */
const { contextBridge, webUtils } = require('electron');

contextBridge.exposeInMainWorld('livraiNative', {
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (_) {
      return '';
    }
  },
});
