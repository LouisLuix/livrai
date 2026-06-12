/* Explorador: navega nas pastas vinculadas ao projeto sem sair do Estúdio.
   Fotos e vídeos abrem em PREVIEW dentro do próprio explorador — setas
   (↑↓←→) folheiam a pasta, Enter manda pro canvas. Pasta entra na navegação;
   arquivos sem preview abrem no app nativo. */
(function () {
  const E = window.Estudio;
  E.explorer = {};

  const IMG_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'];
  const VID_EXTS = ['mp4', 'mov', 'webm'];
  const THUMB_LIMIT = 60; // miniaturas carregadas por pasta

  let rootPath = null; // a pasta vinculada (teto da navegação)
  let rootName = '';
  let current = null; // pasta atual
  let entries = []; // conteúdo da pasta atual
  let mediaList = []; // só fotos/vídeos (ordem da lista) — navegação do preview
  let previewIdx = -1; // índice em mediaList; -1 = sem preview
  const urls = new Map(); // path -> objectURL (thumbs e preview)

  function isImg(en) {
    return !en.dir && IMG_EXTS.indexOf(en.ext) >= 0;
  }
  function isVid(en) {
    return !en.dir && VID_EXTS.indexOf(en.ext) >= 0;
  }
  function isMedia(en) {
    return isImg(en) || isVid(en);
  }

  async function blobUrlFor(path) {
    if (urls.has(path)) return urls.get(path);
    const blob = await E.files.readPath(path);
    const u = URL.createObjectURL(blob);
    urls.set(path, u);
    return u;
  }

  function releaseUrls() {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
  }

  function overlayRoot() {
    let el = document.getElementById('explorer-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'explorer-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function isOpen() {
    return !!overlayRoot().firstChild;
  }

  E.explorer.close = function () {
    window.removeEventListener('keydown', onKey, true);
    releaseUrls();
    previewIdx = -1;
    overlayRoot().innerHTML = '';
  };

  E.explorer.open = async function (path, name) {
    const ok = await E.files.isDesktop();
    if (!ok) {
      E.ui.toast('Explorar pastas precisa do app Livrai (desktop)');
      return;
    }
    rootPath = path;
    rootName = name || String(path || '').split('/').filter(Boolean).pop() || 'Pasta';
    window.removeEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);
    navigate(path);
  };

  /* ---------- teclado: setas folheiam, Enter manda pro canvas ---------- */

  function onKey(e) {
    if (!isOpen()) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (previewIdx >= 0) setPreview(-1);
      else E.explorer.close();
      return;
    }
    if (previewIdx < 0 || !mediaList.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
      setPreview((previewIdx + 1) % mediaList.length);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      setPreview((previewIdx - 1 + mediaList.length) % mediaList.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      sendToCanvas(mediaList[previewIdx]);
    }
  }

  async function sendToCanvas(en) {
    try {
      const blob = await E.files.readPath(en.path);
      await E.canvas.importFile(blob, en.name);
      E.ui.toast('"' + en.name + '" adicionado ao canvas');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ Não consegui importar esse arquivo');
    }
  }

  /* ---------- navegação ---------- */

  async function navigate(dir) {
    releaseUrls(); // pasta nova, miniaturas novas
    previewIdx = -1;
    current = dir;
    try {
      const data = await E.files.browse(dir);
      entries = data.entries;
    } catch (err) {
      entries = null;
    }
    mediaList = (entries || []).filter(isMedia);
    render();
  }

  /* ---------- render ---------- */

  function render() {
    const root = overlayRoot();
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal explorer' + (previewIdx >= 0 ? ' previewing' : '');
    overlay.appendChild(box);
    root.appendChild(overlay);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) E.explorer.close();
    });

    // cabeçalho: migalhas de pão + ações
    const head = document.createElement('div');
    head.className = 'explorer-head';
    const crumbs = document.createElement('div');
    crumbs.className = 'explorer-crumbs';
    const relParts = current === rootPath ? [] : current.slice(rootPath.length).split('/').filter(Boolean);
    const mkCrumb = (label, target, last) => {
      const b = document.createElement('button');
      b.className = 'explorer-crumb' + (last ? ' current' : '');
      b.textContent = label;
      if (!last) b.addEventListener('click', () => navigate(target));
      crumbs.appendChild(b);
      if (!last) {
        const sep = document.createElement('span');
        sep.className = 'explorer-sep';
        sep.textContent = '›';
        crumbs.appendChild(sep);
      }
    };
    mkCrumb(rootName, rootPath, relParts.length === 0);
    relParts.forEach((part, i) => {
      mkCrumb(part, rootPath + '/' + relParts.slice(0, i + 1).join('/'), i === relParts.length - 1);
    });
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const finderBtn = document.createElement('button');
    finderBtn.className = 'btn ghost';
    E.setLabel(finderBtn, 'folder', 'Abrir no Finder');
    finderBtn.addEventListener('click', () => E.files.openPath(current));
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost icon-only';
    closeBtn.innerHTML = E.icon('close', 16);
    closeBtn.title = 'Fechar (Esc)';
    closeBtn.addEventListener('click', E.explorer.close);
    head.appendChild(crumbs);
    head.appendChild(spacer);
    head.appendChild(finderBtn);
    head.appendChild(closeBtn);
    box.appendChild(head);

    const body = document.createElement('div');
    body.className = 'explorer-body';
    box.appendChild(body);

    const list = document.createElement('div');
    list.className = 'explorer-list';
    body.appendChild(list);
    renderList(list);

    if (previewIdx >= 0) body.appendChild(renderPreview());
  }

  function renderList(list) {
    if (entries === null) {
      list.innerHTML = '<p class="explorer-empty">Não consegui abrir esta pasta — ela foi movida ou desvinculada.</p>';
      return;
    }
    if (!entries.length) {
      list.innerHTML = '<p class="explorer-empty">Pasta vazia</p>';
      return;
    }

    let thumbs = 0;
    entries.forEach((en) => {
      const row = document.createElement('div');
      row.className =
        'explorer-row' +
        (en.dir ? ' is-dir' : '') +
        (previewIdx >= 0 && mediaList[previewIdx] === en ? ' active' : '');
      row.dataset.path = en.path;

      const ic = document.createElement('span');
      ic.className = 'explorer-ic';
      if (isImg(en) && thumbs < THUMB_LIMIT) {
        // miniatura de verdade no lugar do ícone
        thumbs++;
        const im = document.createElement('img');
        im.className = 'explorer-thumb';
        im.alt = '';
        im.draggable = false;
        blobUrlFor(en.path).then((u) => {
          im.src = u;
        }).catch(() => {
          ic.innerHTML = E.icon('image', 16);
        });
        ic.appendChild(im);
      } else {
        ic.innerHTML = E.icon(en.dir ? 'folder' : E.items.fileMeta(en.name).icon, 16);
      }

      const nm = document.createElement('span');
      nm.className = 'explorer-name';
      nm.textContent = en.name;

      const meta = document.createElement('span');
      meta.className = 'explorer-meta mono';
      meta.textContent = en.dir ? 'pasta' : E.items.humanSize(en.size);

      row.appendChild(ic);
      row.appendChild(nm);
      row.appendChild(meta);

      if (!en.dir) {
        const add = document.createElement('button');
        add.className = 'btn ghost explorer-add';
        E.setLabel(add, 'plus', 'Pro canvas');
        add.title = 'Copiar este arquivo pro canvas do projeto';
        add.addEventListener('click', (e) => {
          e.stopPropagation();
          sendToCanvas(en);
        });
        row.appendChild(add);
      }

      row.addEventListener('click', () => {
        if (en.dir) navigate(en.path);
        else if (isMedia(en)) setPreview(mediaList.indexOf(en));
        else E.files.openPath(en.path).catch(() => E.ui.toast('⚠️ Não consegui abrir o arquivo'));
      });
      row.addEventListener('dblclick', () => {
        if (!en.dir) E.files.openPath(en.path).catch(() => {});
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const menu = [];
        if (!en.dir) {
          if (isMedia(en)) {
            menu.push({ label: 'Ver no Estúdio', icon: 'eye', onClick: () => setPreview(mediaList.indexOf(en)) });
          }
          menu.push({ label: 'Abrir no aplicativo', icon: 'arrow-up-right', onClick: () => E.files.openPath(en.path) });
          menu.push({ label: 'Copiar pro canvas do projeto', icon: 'plus', onClick: () => sendToCanvas(en) });
        } else {
          menu.push({ label: 'Entrar na pasta', icon: 'folder', onClick: () => navigate(en.path) });
        }
        menu.push({ label: 'Mostrar no Finder', icon: 'eye', onClick: () => E.files.openPath(en.path, 'reveal') });
        E.ui.menu(e.clientX, e.clientY, menu);
      });

      list.appendChild(row);
    });
  }

  /* ---------- preview dentro do software ---------- */

  function setPreview(idx) {
    previewIdx = idx;
    render();
    // mantém a linha ativa à vista na lista
    const active = overlayRoot().querySelector('.explorer-row.active');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  function renderPreview() {
    const en = mediaList[previewIdx];
    const pane = document.createElement('div');
    pane.className = 'explorer-preview';

    const stage = document.createElement('div');
    stage.className = 'preview-stage';
    if (isVid(en)) {
      const v = document.createElement('video');
      v.controls = true;
      v.playsInline = true;
      v.autoplay = false;
      blobUrlFor(en.path).then((u) => {
        v.src = u;
      });
      stage.appendChild(v);
    } else {
      const im = document.createElement('img');
      im.alt = '';
      im.draggable = false;
      blobUrlFor(en.path).then((u) => {
        im.src = u;
      });
      stage.appendChild(im);
    }
    // setas na própria imagem
    if (mediaList.length > 1) {
      const prev = document.createElement('button');
      prev.className = 'preview-nav preview-prev';
      prev.textContent = '‹';
      prev.title = 'Anterior (←/↑)';
      prev.addEventListener('click', () => setPreview((previewIdx - 1 + mediaList.length) % mediaList.length));
      const next = document.createElement('button');
      next.className = 'preview-nav preview-next';
      next.textContent = '›';
      next.title = 'Próxima (→/↓)';
      next.addEventListener('click', () => setPreview((previewIdx + 1) % mediaList.length));
      stage.appendChild(prev);
      stage.appendChild(next);
    }
    pane.appendChild(stage);

    const info = document.createElement('div');
    info.className = 'preview-info';
    const nm = document.createElement('span');
    nm.className = 'preview-name';
    nm.textContent = en.name;
    nm.title = en.name;
    const count = document.createElement('span');
    count.className = 'preview-count mono';
    count.textContent = previewIdx + 1 + ' / ' + mediaList.length + ' · ' + E.items.humanSize(en.size);
    info.appendChild(nm);
    info.appendChild(count);
    pane.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'preview-actions';
    const toCanvas = document.createElement('button');
    toCanvas.className = 'btn primary';
    E.setLabel(toCanvas, 'plus', 'Pro canvas');
    toCanvas.title = 'Copiar pro canvas do projeto (Enter)';
    toCanvas.addEventListener('click', () => sendToCanvas(en));
    const openNative = document.createElement('button');
    openNative.className = 'btn ghost';
    E.setLabel(openNative, 'arrow-up-right', 'Abrir no app');
    openNative.addEventListener('click', () => E.files.openPath(en.path).catch(() => {}));
    const backBtn = document.createElement('button');
    backBtn.className = 'btn ghost';
    E.setLabel(backBtn, 'close', 'Fechar preview');
    backBtn.title = 'Voltar pra lista (Esc)';
    backBtn.addEventListener('click', () => setPreview(-1));
    actions.appendChild(toCanvas);
    actions.appendChild(openNative);
    actions.appendChild(backBtn);
    pane.appendChild(actions);

    return pane;
  }
})();
