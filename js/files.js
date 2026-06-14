/* Ponte com o computador: salva artes em Projetos/<nome do projeto>/ e
   abre direto no Photoshop.

   Dois modos:
   — DESKTOP (app Livrai): o Electron expõe a pasta do Estúdio em
     endpoints locais (/__studio). A pasta é predefinida na instalação
     e alterável nas Configurações — o sistema sempre sabe onde cada
     arquivo está, então NUNCA pergunta "onde salvar?".
   — NAVEGADOR (Chrome): fallback com a File System Access API, onde o
     usuário conecta a pasta "Projetos" uma vez. */
(function () {
  const E = window.Estudio;
  E.files = {};

  const supported = typeof window.showDirectoryPicker === 'function';

  /* ---------- modo desktop ---------- */
  const HD = { 'X-Livrai': '1' };
  let desktop = null; // { root, projetos } quando rodando dentro do app
  const desktopReady = (async () => {
    try {
      const r = await fetch('/__studio', { headers: HD });
      if (r.ok) desktop = await r.json();
    } catch (_) {}
    return desktop;
  })();

  E.files.desktop = () => desktop;
  E.files.ready = () => desktopReady;

  E.files.chooseStudioFolder = async function () {
    try {
      const r = await fetch('/__studio/choose', { method: 'POST', headers: HD });
      const data = await r.json();
      if (data && data.root && !data.canceled) {
        desktop = data;
        return data;
      }
    } catch (err) {
      console.error('chooseStudioFolder', err);
      E.ui.toast('⚠️ Não consegui alterar a pasta do Estúdio');
    }
    return null;
  };

  E.files.revealStudio = function () {
    fetch('/__studio/open', {
      method: 'POST',
      headers: HD,
      body: JSON.stringify({ path: '', app: 'reveal' }),
    }).catch(() => {});
  };

  async function desktopSave(projName, fname, blob) {
    const r = await fetch(
      '/__studio/save?project=' + encodeURIComponent(projName) + '&name=' + encodeURIComponent(fname),
      { method: 'POST', headers: HD, body: blob }
    );
    if (!r.ok) throw new Error('falha ao salvar no disco');
    return r.json(); // { path, mtime }
  }

  async function desktopStat(relPath) {
    try {
      const r = await fetch('/__studio/stat?path=' + encodeURIComponent(relPath), { headers: HD });
      if (!r.ok) return null;
      return await r.json(); // { mtime, size }
    } catch (_) {
      return null;
    }
  }

  async function desktopOpen(relPath, appName) {
    const r = await fetch('/__studio/open', {
      method: 'POST',
      headers: HD,
      body: JSON.stringify({ path: relPath, app: appName || 'default' }),
    });
    if (!r.ok) throw new Error('não consegui abrir o arquivo');
  }

  /* ---------- modo navegador (File System Access API) ---------- */
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

  function extFor(blob) {
    const type = (blob && blob.type) || '';
    const isVideo = type.indexOf('video/') === 0;
    const isAudio = type.indexOf('audio/') === 0;
    return type.indexOf('jpeg') >= 0 ? 'jpg'
      : type.indexOf('webp') >= 0 ? 'webp'
      : type.indexOf('quicktime') >= 0 ? 'mov'
      : type.indexOf('webm') >= 0 ? (isAudio ? 'weba' : 'webm')
      : type.indexOf('audio/mpeg') === 0 ? 'mp3'
      : type.indexOf('wav') >= 0 ? 'wav'
      : type.indexOf('audio/mp4') === 0 || type.indexOf('m4a') >= 0 ? 'm4a'
      : isAudio ? 'mp3'
      : isVideo ? 'mp4'
      : 'png';
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
    try {
      const state = E.canvas.getState();
      if (!state.project) return;
      const projName = sanitize(state.project.name);
      const type = (blob && blob.type) || '';
      const prefix = type.indexOf('video/') === 0 ? 'video ' : type.indexOf('audio/') === 0 ? 'audio ' : 'arte ';
      const fname = prefix + stamp() + '.' + extFor(blob);

      await desktopReady;
      if (desktop) {
        const saved = await desktopSave(projName, fname, blob);
        item.content.fileRef = { path: saved.path, mtime: saved.mtime };
        E.db.put('items', item);
        return;
      }

      if (!supported) return;
      const root = await getGrantedRoot();
      if (!root) return;
      const mtime = await writeToProject(root, projName, fname, blob);
      item.content.fileRef = { path: projName + '/' + fname, mtime: mtime };
      E.db.put('items', item);
    } catch (err) {
      console.error('autoSaveImage', err);
    }
  };

  /* Vigia os arquivos vinculados: editou no Photoshop e salvou (Cmd+S) →
     a imagem se atualiza sozinha aqui no canvas */
  function applyUpdatedBlob(it, blob, mtime, fname) {
    const oldBlobId = it.content.blobId;
    return E.db.saveBlob(blob).then((id) => {
      // histórico: a arte anterior vira uma versão (guardamos até 5)
      if (oldBlobId) {
        const vs = Array.isArray(it.content.versions) ? it.content.versions : [];
        vs.unshift({ blobId: oldBlobId, at: Date.now() });
        while (vs.length > 5) {
          const drop = vs.pop();
          if (drop && drop.blobId) E.db.del('blobs', drop.blobId);
        }
        it.content.versions = vs;
        E.db.releaseBlobUrl(oldBlobId);
      }
      it.content.blobId = id;
      it.content.fileRef.mtime = mtime;
      E.db.put('items', it);
      E.canvas.refreshItem(it);
      E.ui.toast('"' + fname + '" atualizado do Photoshop — a versão anterior ficou guardada');
    });
  }

  /* ---------- versões da imagem (histórico do Cmd+S) ---------- */

  async function restoreVersionToDisk(item) {
    // mantém o arquivo do disco igual ao que voltou a valer no canvas
    try {
      await desktopReady;
      const ref = item.content.fileRef;
      if (!desktop || !ref) return;
      const rec = await E.db.get('blobs', item.content.blobId);
      if (!rec || !rec.blob) return;
      const parts = ref.path.split('/');
      const saved = await desktopSave(parts[0], parts.slice(1).join('/'), rec.blob);
      item.content.fileRef.mtime = saved.mtime;
    } catch (_) {}
  }

  E.files.openVersions = async function (item) {
    const vs = (item.content && item.content.versions) || [];
    if (!vs.length) {
      E.ui.toast('Essa imagem ainda não tem versões anteriores (elas nascem quando o Photoshop salva por cima)');
      return;
    }
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal versions-modal';
    box.innerHTML = '<h3>Versões da imagem</h3><p class="modal-msg">A versão atual fica guardada quando você restaura uma antiga — nada se perde.</p>';
    const grid = document.createElement('div');
    grid.className = 'versions-grid';
    box.appendChild(grid);
    overlay.appendChild(box);
    root.appendChild(overlay);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) root.innerHTML = '';
    });

    const mkCell = async (blobId, label, isCurrent, idx) => {
      const cell = document.createElement('div');
      cell.className = 'versions-cell' + (isCurrent ? ' current' : '');
      const img = document.createElement('img');
      img.alt = '';
      E.db.blobUrl(blobId).then((u) => {
        if (u) img.src = u;
      });
      const cap = document.createElement('span');
      cap.className = 'mono';
      cap.textContent = label;
      cell.appendChild(img);
      cell.appendChild(cap);
      if (!isCurrent) {
        const btn = document.createElement('button');
        btn.className = 'btn';
        E.setLabel(btn, 'refresh', 'Restaurar');
        btn.addEventListener('click', async () => {
          const cur = item.content.blobId;
          const v = item.content.versions.splice(idx, 1)[0];
          item.content.versions.unshift({ blobId: cur, at: Date.now() });
          item.content.blobId = v.blobId;
          E.db.releaseBlobUrl(cur);
          await restoreVersionToDisk(item);
          E.canvas.refreshItem(item);
          root.innerHTML = '';
          E.ui.toast('Versão restaurada — a anterior continua no histórico');
        });
        cell.appendChild(btn);
      }
      grid.appendChild(cell);
    };

    await mkCell(item.content.blobId, 'atual', true, -1);
    for (let i = 0; i < vs.length; i++) {
      await mkCell(
        vs[i].blobId,
        new Date(vs[i].at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
        false,
        i
      );
    }
  };

  let watching = false;
  setInterval(async () => {
    if (watching || !E.canvas.isOpen()) return;
    watching = true;
    try {
      await desktopReady;
      const linked = E.canvas
        .getAllItems()
        .filter((it) => it.kind === 'image' && it.content && it.content.fileRef);

      if (desktop) {
        for (const it of linked) {
          try {
            const ref = it.content.fileRef;
            const st = await desktopStat(ref.path);
            if (st && st.mtime > (ref.mtime || 0) + 500) {
              const r = await fetch('/__studio/file?path=' + encodeURIComponent(ref.path), { headers: HD });
              if (!r.ok) continue;
              const blob = await r.blob();
              await applyUpdatedBlob(it, blob, st.mtime, ref.path.split('/').pop());
            }
          } catch (_) {
            /* arquivo movido/renomeado — ignora */
          }
        }
        return;
      }

      if (!supported) return;
      const root = await getGrantedRoot();
      if (root) {
        for (const it of linked) {
          try {
            const parts = it.content.fileRef.path.split('/');
            const dir = await root.getDirectoryHandle(parts[0]);
            const fh = await dir.getFileHandle(parts[1]);
            const f = await fh.getFile();
            if (f.lastModified > (it.content.fileRef.mtime || 0) + 500) {
              await applyUpdatedBlob(it, f, f.lastModified, parts[1]);
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

  /* ---------- pastas vinculadas e arquivos do projeto (modo desktop) ---------- */

  /* Diálogo nativo: escolhe uma pasta do computador e autoriza a navegação nela */
  E.files.linkFolder = async function () {
    await desktopReady;
    if (!desktop) {
      E.ui.toast('Vincular pastas precisa do app Livrai (desktop)');
      return null;
    }
    try {
      const r = await fetch('/__studio/link-folder', { method: 'POST', headers: HD });
      const data = await r.json();
      if (data && data.path && !data.canceled) return data; // { path, name }
    } catch (err) {
      console.error('linkFolder', err);
      E.ui.toast('⚠️ Não consegui vincular a pasta');
    }
    return null;
  };

  /* Caminho real de um arquivo/pasta arrastado (só existe no app desktop) */
  E.files.pathForFile = function (file) {
    try {
      return window.livraiNative && window.livraiNative.pathForFile
        ? window.livraiNative.pathForFile(file)
        : '';
    } catch (_) {
      return '';
    }
  };

  /* Autoriza uma pasta arrastada (gesto explícito do usuário) — sem diálogo */
  E.files.linkPath = async function (absPath) {
    try {
      const r = await fetch('/__studio/link-path', {
        method: 'POST',
        headers: HD,
        body: JSON.stringify({ path: absPath }),
      });
      if (!r.ok) return null;
      return await r.json(); // { path, name }
    } catch (_) {
      return null;
    }
  };

  /* Lista o conteúdo de uma pasta autorizada — { path, entries: [...] } */
  E.files.browse = async function (absPath) {
    const r = await fetch('/__studio/browse?path=' + encodeURIComponent(absPath), { headers: HD });
    if (!r.ok) throw new Error('pasta não encontrada ou não vinculada');
    return r.json();
  };

  /* Abre arquivo/pasta de caminho absoluto autorizado no app nativo */
  E.files.openPath = async function (absPath, appName) {
    const r = await fetch('/__studio/open', {
      method: 'POST',
      headers: HD,
      body: JSON.stringify({ path: absPath, abs: true, app: appName || 'default' }),
    });
    if (!r.ok) throw new Error('não consegui abrir');
  };

  /* Preview de link externo: metadados Open Graph (título, descrição, imagem) */
  E.files.unfurl = async function (url) {
    try {
      const r = await fetch('/__studio/unfurl?u=' + encodeURIComponent(url), { headers: HD });
      if (!r.ok) return null;
      return await r.json();
    } catch (_) {
      return null;
    }
  };

  /* Lê os bytes de um arquivo autorizado (pra importar pro canvas) */
  E.files.readPath = async function (absPath) {
    const r = await fetch('/__studio/file?abs=1&path=' + encodeURIComponent(absPath), { headers: HD });
    if (!r.ok) throw new Error('não consegui ler o arquivo');
    return r.blob();
  };

  E.files.isDesktop = async function () {
    await desktopReady;
    return !!desktop;
  };

  /* Arquivo genérico (PDF, Office…) salvo na pasta do projeto com o nome original */
  E.files.autoSaveFile = async function (item, blob, name) {
    try {
      const state = E.canvas.getState();
      if (!state.project) return;
      const projName = sanitize(state.project.name);
      const fname = String(name || 'arquivo').replace(/[\\/:*?"<>|]+/g, '-').replace(/^\.+/, '') || 'arquivo';
      await desktopReady;
      if (desktop) {
        const saved = await desktopSave(projName, fname, blob);
        item.content.fileRef = { path: saved.path, mtime: saved.mtime };
        E.db.put('items', item);
        return;
      }
      if (!supported) return;
      const root = await getGrantedRoot();
      if (!root) return;
      const mtime = await writeToProject(root, projName, fname, blob);
      item.content.fileRef = { path: projName + '/' + fname, mtime: mtime };
      E.db.put('items', item);
    } catch (err) {
      console.error('autoSaveFile', err);
    }
  };

  /* Abre um card de arquivo no app nativo (desktop) ou baixa (navegador) */
  E.files.openFileItem = async function (item, appName) {
    const c = item.content || {};
    await desktopReady;
    if (desktop && c.fileRef) {
      const st = await desktopStat(c.fileRef.path);
      if (st) {
        await desktopOpen(c.fileRef.path, appName || 'default');
        return;
      }
    }
    const rec = await E.db.get('blobs', c.blobId);
    if (!rec || !rec.blob) {
      E.ui.toast('Não encontrei esse arquivo');
      return;
    }
    if (desktop) {
      // arquivo ainda não estava no disco: salva agora e abre
      await E.files.autoSaveFile(item, rec.blob, c.name);
      if (item.content.fileRef) {
        await desktopOpen(item.content.fileRef.path, appName || 'default');
        return;
      }
    }
    const url = URL.createObjectURL(rec.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = c.name || 'arquivo';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  /* Salva as mídias de um post na pasta do projeto, prontas pra publicar.
     No app desktop ainda revela a primeira no Finder; no navegador, baixa. */
  E.files.exportPostMedia = async function (item) {
    const state = E.canvas.getState();
    if (!state.project) return 0;
    const media = E.items.postMedia(item.content || {});
    if (!media.length) return 0;
    const projName = sanitize(state.project.name);
    const base = 'post ' + stamp();
    let saved = 0;
    let firstPath = null;

    await desktopReady;
    for (let i = 0; i < media.length; i++) {
      const rec = await E.db.get('blobs', media[i].blobId);
      if (!rec || !rec.blob) continue;
      const fname = base + (media.length > 1 ? ' ' + (i + 1) : '') + '.' + extFor(rec.blob);
      if (desktop) {
        const r = await desktopSave(projName, fname, rec.blob);
        if (!firstPath) firstPath = r.path;
      } else {
        const url = URL.createObjectURL(rec.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fname;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
      saved++;
    }
    if (desktop && firstPath) {
      try {
        await desktopOpen(firstPath, 'reveal');
      } catch (_) {}
    }
    return saved;
  };

  E.files.openInPhotoshop = async function (item) {
    const state = E.canvas.getState();
    if (!state.project) return;

    await desktopReady;
    if (desktop) {
      try {
        // o sistema já sabe onde a imagem está — só salva se ela ainda
        // não existir no disco (item antigo, de antes do salvamento automático)
        let ref = item.content.fileRef;
        if (ref) {
          const st = await desktopStat(ref.path);
          if (!st) ref = null;
        }
        if (!ref) {
          const rec = await E.db.get('blobs', item.content.blobId);
          if (!rec || !rec.blob) {
            E.ui.toast('Não encontrei o arquivo dessa imagem');
            return;
          }
          const projName = sanitize(state.project.name);
          const saved = await desktopSave(projName, 'arte ' + stamp() + '.' + extFor(rec.blob), rec.blob);
          ref = { path: saved.path, mtime: saved.mtime };
          item.content.fileRef = ref;
          E.db.put('items', item);
        }
        await desktopOpen(ref.path, 'photoshop');
        E.ui.toast('Abrindo no Photoshop… (Cmd+S lá atualiza aqui)');
      } catch (err) {
        console.error(err);
        E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'erro desconhecido'));
      }
      return;
    }

    if (!supported) {
      E.ui.toast('Esse recurso precisa do app Livrai ou do Google Chrome. Alternativa: exporte a prancha e abra o PNG.');
      return;
    }
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
      const fname = 'arte ' + stamp() + '.' + extFor(rec.blob);
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
