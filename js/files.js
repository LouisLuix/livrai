/* Ponte com o computador: salva artes em Projetos/<nome do projeto>/ e
   avisa a ponte (photoshop-bridge.sh) pra abrir no Photoshop. */
(function () {
  const E = window.Estudio;
  E.files = {};

  const supported = typeof window.showDirectoryPicker === 'function';

  async function getProjectsDir(interactive) {
    let rec = null;
    try {
      rec = await E.db.get('handles', 'projectsDir');
    } catch (_) {}
    let handle = rec && rec.handle;

    if (handle) {
      try {
        let perm = await handle.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
        if (perm === 'granted') return handle;
      } catch (_) {}
      handle = null;
    }
    if (!interactive) return null;

    const ok = await E.ui.confirm(
      'Conectar a pasta "Projetos"',
      'Na próxima janela, escolha a pasta "Projetos" que fica dentro de "ORGANIZADOR DE ENTREGAS" na sua Mesa. ' +
        'É lá que as artes serão salvas, organizadas por projeto — e de onde o Photoshop abre automaticamente. ' +
        'Você só faz isso uma vez.',
      'Escolher pasta'
    );
    if (!ok) return null;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (_) {
      return null; // usuário cancelou
    }
    await E.db.put('handles', { key: 'projectsDir', handle: handle });
    return handle;
  }

  function sanitize(s) {
    const clean = String(s || '').replace(/[\\/:*?"<>|.]+/g, '-').trim();
    return clean || 'projeto';
  }

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return (
      d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + 'h' + p(d.getMinutes()) + 'm' + p(d.getSeconds()) + 's'
    );
  }

  async function writeFile(dirHandle, name, data) {
    const fh = await dirHandle.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  /* Pasta conectada SEM pedir permissão (pra ações automáticas em segundo plano) */
  async function getGrantedRoot() {
    try {
      const rec = await E.db.get('handles', 'projectsDir');
      const handle = rec && rec.handle;
      if (!handle) return null;
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      return perm === 'granted' ? handle : null;
    } catch (_) {
      return null;
    }
  }

  async function writeToProject(root, projName, fname, blob) {
    const projDir = await root.getDirectoryHandle(projName, { create: true });
    await writeFile(projDir, fname, blob);
    const fh = await projDir.getFileHandle(fname);
    const f = await fh.getFile();
    return f.lastModified;
  }

  /* Toda imagem colada/arrastada/gerada é salva sozinha na pasta do projeto */
  E.files.autoSaveImage = async function (item, blob) {
    if (!supported) return;
    try {
      const root = await getGrantedRoot();
      if (!root) return;
      const state = E.canvas.getState();
      if (!state.project) return;
      const projName = sanitize(state.project.name);
      const type = blob.type || '';
      const isVideo = type.indexOf('video/') === 0;
      const ext = type.indexOf('jpeg') >= 0 ? 'jpg'
        : type.indexOf('webp') >= 0 ? 'webp'
        : type.indexOf('quicktime') >= 0 ? 'mov'
        : type.indexOf('webm') >= 0 ? 'webm'
        : isVideo ? 'mp4'
        : 'png';
      const fname = (isVideo ? 'video ' : 'arte ') + stamp() + '.' + ext;
      const mtime = await writeToProject(root, projName, fname, blob);
      item.content.fileRef = { path: projName + '/' + fname, mtime: mtime };
      E.db.put('items', item);
    } catch (err) {
      console.error('autoSaveImage', err);
    }
  };

  /* Vigia os arquivos vinculados: editou no Photoshop e salvou (Cmd+S) →
     a imagem se atualiza sozinha aqui no canvas */
  let watching = false;
  setInterval(async () => {
    if (watching || !supported || !E.canvas.isOpen()) return;
    watching = true;
    try {
      const root = await getGrantedRoot();
      if (root) {
        const linked = E.canvas
          .getAllItems()
          .filter((it) => it.kind === 'image' && it.content && it.content.fileRef);
        for (const it of linked) {
          try {
            const parts = it.content.fileRef.path.split('/');
            const dir = await root.getDirectoryHandle(parts[0]);
            const fh = await dir.getFileHandle(parts[1]);
            const f = await fh.getFile();
            if (f.lastModified > (it.content.fileRef.mtime || 0) + 500) {
              const oldBlobId = it.content.blobId;
              it.content.blobId = await E.db.saveBlob(f);
              it.content.fileRef.mtime = f.lastModified;
              if (oldBlobId) E.db.releaseBlobUrl(oldBlobId);
              E.canvas.refreshItem(it);
              E.ui.toast('"' + parts[1] + '" atualizado do Photoshop');
            }
          } catch (_) {
            /* arquivo movido/renomeado — ignora */
          }
        }
      }
    } finally {
      watching = false;
    }
  }, 4000);

  E.files.openInPhotoshop = async function (item) {
    if (!supported) {
      E.ui.toast('Esse recurso precisa do Google Chrome. Alternativa: exporte a prancha e abra o PNG.');
      return;
    }
    const state = E.canvas.getState();
    if (!state.project) return;
    const rec = await E.db.get('blobs', item.content.blobId);
    if (!rec || !rec.blob) {
      E.ui.toast('Não encontrei o arquivo dessa imagem');
      return;
    }
    try {
      const root = await getProjectsDir(true);
      if (!root) {
        E.ui.toast('Pasta não conectada — tente de novo quando quiser');
        return;
      }
      const projName = sanitize(state.project.name);
      const projDir = await root.getDirectoryHandle(projName, { create: true });
      const type = rec.blob.type || '';
      const ext = type.indexOf('jpeg') >= 0 ? 'jpg' : type.indexOf('webp') >= 0 ? 'webp' : 'png';
      const fname = 'arte ' + stamp() + '.' + ext;
      await writeFile(projDir, fname, rec.blob);

      // gatilho pra ponte do Photoshop (iniciada pelo ABRIR ESTUDIO.command)
      const fila = await root.getDirectoryHandle('.fila', { create: true });
      await writeFile(fila, fname + '.txt', projName + '/' + fname);

      // vincula o arquivo ao item: Cmd+S no Photoshop atualiza a imagem aqui
      item.content.fileRef = { path: projName + '/' + fname, mtime: Date.now() + 2000 };
      E.db.put('items', item);

      E.ui.toast('Salvo em ' + projName + ' — abrindo no Photoshop… (Cmd+S lá atualiza aqui)');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ Não consegui salvar: ' + (err && err.message ? err.message : 'erro desconhecido'));
    }
  };
})();
