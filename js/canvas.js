/* Canvas infinito: navegação (pan/zoom), seleção, arrastar, redimensionar,
   copiar/colar entre projetos, atalhos e ferramentas */
(function () {
  const E = window.Estudio;

  const viewport = document.getElementById('viewport');
  const world = document.getElementById('world');
  const marqueeEl = document.getElementById('marquee');
  const emptyHint = document.getElementById('empty-hint');
  const zoomLabel = document.getElementById('zoom-label');
  const titleInput = document.getElementById('project-title');
  const stageSelect = document.getElementById('stage-select');
  const stageDot = document.getElementById('stage-dot');
  const fileInput = document.getElementById('file-input');

  let project = null;
  let boardId = null; // aba atual
  let allList = []; // todos os itens do projeto (todas as abas)
  let items = new Map(); // id -> item (só da aba atual)
  let els = new Map(); // id -> elemento DOM
  let selection = new Set();
  let camera = { x: 0, y: 0, z: 1 };
  let maxZ = 1;
  let mode = null; // 'pan' | 'drag' | 'resize' | 'marquee'
  let drag = null;
  let spaceDown = false; // segurar Espaço = mover o canvas
  let pendingCreate = null; // ferramenta escolhida esperando o clique de posicionamento
  let pendingConnectFrom = null; // item de origem esperando o clique no destino da seta
  let pendingImagePoint = null; // onde colocar as imagens escolhidas no seletor de arquivos
  let deletedStack = []; // pilha pra desfazer exclusões (Cmd+Z)

  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 4;

  /* ---------- persistência ---------- */

  function saveItem(item) {
    E.db.put('items', item);
    touchProject();
    if (E.schedule && E.schedule.isOpen()) E.schedule.refreshSoon();
  }
  const saveProjectDebounced = E.debounce(saveProjectNow, 400);
  function saveProjectNow() {
    if (!project) return;
    if (!project.cameras) project.cameras = {};
    if (boardId) project.cameras[boardId] = { x: camera.x, y: camera.y, z: camera.z };
    delete project.camera;
    E.db.put('projects', project);
  }
  function touchProject() {
    if (!project) return;
    project.updatedAt = Date.now();
    saveProjectDebounced();
  }

  /* ---------- abrir / fechar ---------- */

  /* Abas: cada projeto tem pelo menos uma; itens antigos caem na primeira */
  function ensureBoards(p) {
    if (!p.boards || !p.boards.length) {
      p.boards = [{ id: 'b-' + E.uid().slice(0, 8), name: 'Principal' }];
    }
    if (!p.cameras) p.cameras = {};
    if (p.camera && !p.cameras[p.boards[0].id]) {
      p.cameras[p.boards[0].id] = p.camera;
    }
  }

  function open(p, list) {
    project = p;
    ensureBoards(p);
    allList = list;
    const ids = p.boards.map((b) => b.id);
    boardId = ids.indexOf(p.lastBoard) >= 0 ? p.lastBoard : ids[0];
    allList.forEach((it) => {
      if (!it.board) it.board = ids[0];
    });
    titleInput.value = p.name || '';
    buildStageSelect();
    mountBoard();
  }

  function mountBoard() {
    world.innerHTML = '';
    els = new Map();
    selection = new Set();
    items = new Map();
    deletedStack = [];
    maxZ = 1;
    E.flow.mountLayer(world);
    allList.forEach((it) => {
      if (it.board === boardId) {
        items.set(it.id, it);
        maxZ = Math.max(maxZ, it.z || 1);
        mount(it);
      }
    });
    E.flow.refresh();
    const cam = project.cameras && project.cameras[boardId];
    const camOk =
      cam &&
      isFinite(cam.x) && isFinite(cam.y) && isFinite(cam.z) &&
      cam.z > MIN_ZOOM && cam.z <= MAX_ZOOM;
    if (camOk) {
      camera = { x: cam.x, y: cam.y, z: cam.z };
      applyCamera();
    } else {
      fitView();
    }
    updateEmptyHint();
    renderBoardTabs();
    if (E.schedule && E.schedule.isOpen()) E.schedule.refreshSoon();
  }

  function switchBoard(id) {
    if (id === boardId || !project) return;
    saveProjectNow();
    boardId = id;
    project.lastBoard = id;
    mountBoard();
    saveProjectDebounced();
  }

  function close() {
    if (project) saveProjectNow();
    if (E.schedule && E.schedule.isOpen()) E.schedule.close();
    if (E.notes && E.notes.isOpen()) E.notes.close();
    allList.forEach((it) => {
      if (it.content && it.content.blobId) {
        E.db.releaseBlobUrl(it.content.blobId);
      }
      if (it.content && it.content.sceneBlobId) {
        E.db.releaseBlobUrl(it.content.sceneBlobId);
      }
      if (it.content && Array.isArray(it.content.media)) {
        it.content.media.forEach((m) => m.blobId && E.db.releaseBlobUrl(m.blobId));
      }
    });
    project = null;
    boardId = null;
    allList = [];
    world.innerHTML = '';
    items.clear();
    els.clear();
    selection.clear();
    document.getElementById('board-tabs').innerHTML = '';
  }

  function isOpen() {
    return !!project && !document.getElementById('canvas-view').classList.contains('hidden');
  }

  function mount(item) {
    const el = E.items.render(item, saveItem);
    els.set(item.id, el);
    world.appendChild(el);
  }

  /* ---------- abas (sub-canvas dentro do projeto) ---------- */

  const tabsEl = document.getElementById('board-tabs');

  function renderBoardTabs() {
    if (!project) return;
    tabsEl.innerHTML = '';
    project.boards.forEach((b) => {
      const t = document.createElement('button');
      t.className = 'board-tab' + (b.id === boardId ? ' active' : '');
      t.textContent = b.name;
      t.title = 'Clique abre · duplo clique renomeia · botão direito = opções';
      t.addEventListener('click', () => switchBoard(b.id));
      t.addEventListener('dblclick', () => renameBoard(b));
      t.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        E.ui.menu(e.clientX, e.clientY, [
          { label: 'Renomear aba', icon: 'pencil', onClick: () => renameBoard(b) },
          { label: 'Excluir aba', icon: 'trash', danger: true, onClick: () => deleteBoard(b) },
        ]);
      });
      tabsEl.appendChild(t);
    });
    const add = document.createElement('button');
    add.className = 'board-tab board-add';
    E.setLabel(add, 'plus', 'Aba');
    add.title = 'Nova aba de ideias dentro deste projeto';
    add.addEventListener('click', addBoard);
    tabsEl.appendChild(add);
  }

  async function addBoard() {
    const vals = await E.ui.modal({
      title: 'Nova aba',
      message: 'Cada aba é um canvas separado dentro do projeto — ideal pra explorar ideias diferentes. Cmd+C / Cmd+V copia itens entre abas.',
      fields: [{ name: 'name', label: 'Nome', placeholder: 'Ideia B, Conceito 2, Rascunhos…' }],
      okLabel: 'Criar',
    });
    if (vals === null || !vals.name.trim()) return;
    const b = { id: 'b-' + E.uid().slice(0, 8), name: vals.name.trim() };
    project.boards.push(b);
    touchProject();
    switchBoard(b.id);
  }

  async function renameBoard(b) {
    const vals = await E.ui.modal({
      title: 'Renomear aba',
      fields: [{ name: 'name', label: 'Nome', value: b.name }],
    });
    if (vals === null || !vals.name.trim()) return;
    b.name = vals.name.trim();
    touchProject();
    renderBoardTabs();
  }

  async function deleteBoard(b) {
    if (project.boards.length <= 1) {
      E.ui.toast('O projeto precisa de pelo menos uma aba');
      return;
    }
    const count = allList.filter((it) => it.board === b.id).length;
    const ok = await E.ui.confirm(
      'Excluir a aba "' + b.name + '"?',
      count
        ? 'Os ' + count + ' itens dela serão apagados junto. Essa ação não tem volta.'
        : 'A aba está vazia.',
      'Excluir'
    );
    if (!ok) return;
    for (const it of allList) {
      if (it.board === b.id) await E.db.del('items', it.id);
    }
    allList = allList.filter((x) => x.board !== b.id);
    project.boards = project.boards.filter((x) => x.id !== b.id);
    if (project.cameras) delete project.cameras[b.id];
    if (boardId === b.id) {
      boardId = project.boards[0].id;
      project.lastBoard = boardId;
    }
    touchProject();
    mountBoard();
  }

  function buildStageSelect() {
    stageSelect.innerHTML = '';
    E.STAGES.forEach((s) => {
      const op = document.createElement('option');
      op.value = s.id;
      op.textContent = s.label;
      stageSelect.appendChild(op);
    });
    stageSelect.value = project.stage || 'ideia';
    stageDot.style.background = E.stageById(stageSelect.value).color;
  }

  /* ---------- câmera ---------- */

  function applyCamera() {
    world.style.transform = 'translate(' + camera.x + 'px, ' + camera.y + 'px) scale(' + camera.z + ')';
    const grid = 24 * camera.z;
    viewport.style.backgroundSize = grid + 'px ' + grid + 'px';
    viewport.style.backgroundPosition = camera.x + 'px ' + camera.y + 'px';
    zoomLabel.textContent = Math.round(camera.z * 100) + '%';
  }

  function screenToWorld(sx, sy) {
    const r = viewport.getBoundingClientRect();
    return {
      x: (sx - r.left - camera.x) / camera.z,
      y: (sy - r.top - camera.y) / camera.z,
    };
  }

  function viewCenterWorld() {
    const r = viewport.getBoundingClientRect();
    return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
  }

  function zoomAt(sx, sy, nz) {
    nz = E.clamp(nz, MIN_ZOOM, MAX_ZOOM);
    const r = viewport.getBoundingClientRect();
    const px = sx - r.left;
    const py = sy - r.top;
    const wx = (px - camera.x) / camera.z;
    const wy = (py - camera.y) / camera.z;
    camera.z = nz;
    camera.x = px - wx * nz;
    camera.y = py - wy * nz;
    applyCamera();
    saveProjectDebounced();
  }

  function zoomCenter(factor) {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, camera.z * factor);
  }

  function fitView() {
    const r = viewport.getBoundingClientRect();
    // Layout ainda não pronto (ex.: CSS carregando) — tenta de novo no próximo frame
    if (r.width < 40 || r.height < 40) {
      requestAnimationFrame(() => {
        if (project) fitView();
      });
      return;
    }
    if (!items.size) {
      camera = { x: r.width / 2, y: r.height / 2, z: 1 };
    } else {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      items.forEach((it) => {
        minX = Math.min(minX, it.x);
        minY = Math.min(minY, it.y);
        maxX = Math.max(maxX, it.x + it.w);
        maxY = Math.max(maxY, it.y + it.h);
      });
      const pad = 80;
      const bw = maxX - minX + pad * 2;
      const bh = maxY - minY + pad * 2;
      const z = E.clamp(Math.min(r.width / bw, r.height / bh), MIN_ZOOM, 1.4);
      camera.z = z;
      camera.x = (r.width - (maxX + minX) * z) / 2;
      camera.y = (r.height - (maxY + minY) * z) / 2;
    }
    applyCamera();
    saveProjectDebounced();
  }

  /* ---------- criação de itens ---------- */

  function addItem(partial) {
    const item = Object.assign(
      { id: E.uid(), projectId: project.id, board: boardId, z: ++maxZ, content: {} },
      partial
    );
    items.set(item.id, item);
    allList.push(item);
    mount(item);
    saveItem(item);
    updateEmptyHint();
    return item;
  }

  function spawnPoint() {
    const c = viewCenterWorld();
    const jitter = (items.size % 5) * 24;
    return { x: c.x + jitter, y: c.y + jitter };
  }

  function createNote(x, y, text) {
    return addItem({ kind: 'note', x, y, w: 230, h: 150, content: { text: text || '' } });
  }
  function createLabel(x, y, text) {
    return addItem({ kind: 'label', x, y, w: 420, h: 52, content: { text: text || 'Título' } });
  }
  function createColor(x, y, hex) {
    return addItem({ kind: 'color', x, y, w: 130, h: 130, content: { hex: hex || '#a78bfa' } });
  }
  function createLink(url, title, x, y) {
    return addItem({
      kind: 'link', x, y, w: 240, h: 110,
      content: { url: E.items.normalizeUrl(url), title: title || '' },
    });
  }
  function createPost(x, y) {
    return addItem({
      kind: 'post', x, y, w: 240, h: 170,
      content: { text: '', date: '', status: 'ideia' },
    });
  }
  function createFlowNode(x, y, shape, text, color) {
    return addItem({
      kind: 'flownode', x, y,
      w: shape === 'decision' ? 210 : 220,
      h: shape === 'decision' ? 130 : 88,
      content: {
        text: text || '',
        shape: shape || 'step',
        color: color || E.flow.PALETTE[0],
        next: [],
      },
    });
  }

  /* Pranchas ficam sempre atrás dos outros itens */
  function nextFrameZ() {
    let z = 0;
    items.forEach((it) => {
      if (it.kind === 'frame') z = Math.min(z, it.z || 0);
    });
    return z - 1;
  }

  function createFrame(name, presetId, x, y) {
    const p = E.framePresetById(presetId);
    return addItem({
      kind: 'frame', x, y, w: p.w, h: p.h, z: nextFrameZ(),
      content: { text: name, preset: p.id },
    });
  }

  function frameCount() {
    let n = 0;
    items.forEach((it) => {
      if (it.kind === 'frame') n++;
    });
    return n;
  }

  async function createImageFromBlob(blob, x, y) {
    const blobId = await E.db.saveBlob(blob);
    const url = await E.db.blobUrl(blobId);
    const dim = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth || 420, h: im.naturalHeight || 300 });
      im.onerror = () => res({ w: 420, h: 300 });
      im.src = url;
    });
    const w = Math.min(420, dim.w);
    const h = Math.max(40, Math.round(w * (dim.h / dim.w)));
    const item = addItem({ kind: 'image', x, y, w, h, content: { blobId } });
    if (!project.coverBlobId) {
      project.coverBlobId = blobId;
      touchProject();
    }
    // se a pasta estiver conectada, salva o arquivo na pasta do projeto sozinho
    if (E.files && E.files.autoSaveImage) E.files.autoSaveImage(item, blob);
    return item;
  }

  async function createVideoFromBlob(blob, x, y) {
    const blobId = await E.db.saveBlob(blob);
    const title = (blob.name || 'Vídeo').replace(/\.[^.]+$/, '');
    const item = addItem({
      kind: 'video', x, y, w: 380, h: 250,
      content: { blobId, title },
    });
    if (E.files && E.files.autoSaveImage) E.files.autoSaveImage(item, blob);
    return item;
  }

  async function createAudioFromBlob(blob, x, y) {
    const blobId = await E.db.saveBlob(blob);
    const title = (blob.name || 'Áudio').replace(/\.[^.]+$/, '');
    const item = addItem({
      kind: 'audio', x, y, w: 320, h: 100,
      content: { blobId, title },
    });
    if (E.files && E.files.autoSaveImage) E.files.autoSaveImage(item, blob);
    return item;
  }

  /* Qualquer outro arquivo (PDF, Office, ZIP…) vira um card de arquivo —
     guardado no projeto e aberto no app nativo com um clique */
  async function createFileFromBlob(blob, x, y) {
    const blobId = await E.db.saveBlob(blob);
    const name = blob.name || 'Arquivo';
    const item = addItem({
      kind: 'file', x, y, w: 220, h: 132,
      content: { blobId, name: name, size: blob.size || 0, mime: blob.type || '' },
    });
    if (E.files && E.files.autoSaveFile) E.files.autoSaveFile(item, blob, name);
    return item;
  }

  /* Imagem OU vídeo vindo do computador (drag&drop, colar, file picker) */
  function isMediaFile(f) {
    return f.type.indexOf('image/') === 0 || f.type.indexOf('video/') === 0;
  }
  function createMediaFromBlob(f, x, y) {
    return f.type.indexOf('video/') === 0 ? createVideoFromBlob(f, x, y) : createImageFromBlob(f, x, y);
  }

  /* Roteia qualquer arquivo do computador pro card certo */
  function createAnyFromBlob(f, x, y) {
    const t = f.type || '';
    if (t.indexOf('video/') === 0) return createVideoFromBlob(f, x, y);
    if (t.indexOf('image/') === 0) return createImageFromBlob(f, x, y);
    if (t.indexOf('audio/') === 0) return createAudioFromBlob(f, x, y);
    return createFileFromBlob(f, x, y);
  }

  /* Importação vinda do explorador de pastas vinculadas */
  async function importFile(blob, name) {
    const c = viewCenterWorld();
    let f = blob;
    try {
      f = new File([blob], name || blob.name || 'arquivo', { type: blob.type });
    } catch (_) {}
    return createAnyFromBlob(f, c.x - 110, c.y - 70);
  }

  /* ---------- seleção ---------- */

  function setSelected(id, on) {
    const el = els.get(id);
    if (!el) return;
    if (on) {
      selection.add(id);
      el.classList.add('sel');
    } else {
      selection.delete(id);
      el.classList.remove('sel');
    }
  }
  function clearSelection() {
    [...selection].forEach((id) => setSelected(id, false));
  }
  function selectOnly(id) {
    clearSelection();
    setSelected(id, true);
  }
  function selectedItems() {
    return [...selection].map((id) => items.get(id)).filter(Boolean);
  }

  /* ---------- ponteiro: pan / drag / resize / marquee ---------- */

  function isFormTarget(t) {
    return !!(
      t &&
      t.closest &&
      t.closest('input, textarea, select, button, video, audio, label, summary, [contenteditable]')
    );
  }

  viewport.addEventListener('pointerdown', (e) => {
    if (E.state.editing) return;
    // Modo de colocação: o item é criado exatamente onde o usuário clicar
    if (pendingCreate && e.button === 0) {
      e.preventDefault();
      const fn = pendingCreate;
      cancelPlacement();
      fn(screenToWorld(e.clientX, e.clientY));
      return;
    }
    // Modo "Conectar com seta": o próximo clique em um item fecha a conexão
    if (pendingConnectFrom && e.button === 0) {
      e.preventDefault();
      const fromId = pendingConnectFrom;
      cancelConnectClick();
      const target = e.target.closest && e.target.closest('.item');
      if (target && target.dataset.id !== fromId) {
        E.flow.connect(fromId, target.dataset.id);
      } else {
        E.ui.toast('Conexão cancelada');
      }
      return;
    }
    if (isFormTarget(e.target)) return;
    E.ui.closeMenu();
    const itemEl = e.target.closest('.item');

    if (mode) return; // já existe um gesto em andamento com outro ponteiro

    // Arrastar do pontinho de conexão = desenhar uma seta até outro item
    if (itemEl && e.button === 0 && e.target.classList.contains('flow-port')) {
      selectOnly(itemEl.dataset.id);
      mode = 'connect';
      drag = { pointerId: e.pointerId, fromId: itemEl.dataset.id, sx: e.clientX, sy: e.clientY, moved: false, overEl: null };
      viewport.setPointerCapture(e.pointerId);
      return;
    }

    // Mover o canvas: botão do meio, ou Espaço segurado (mesmo em cima de itens)
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      mode = 'pan';
      drag = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, cx: camera.x, cy: camera.y, moved: false };
      viewport.classList.add('panning');
      viewport.setPointerCapture(e.pointerId);
      return;
    }
    // Arrastar no fundo = laço de seleção (Shift mantém a seleção atual e soma)
    if (!itemEl && e.button === 0) {
      if (!e.shiftKey) clearSelection();
      mode = 'marquee';
      drag = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY };
      viewport.setPointerCapture(e.pointerId);
      return;
    }
    if (itemEl && e.button === 0) {
      const id = itemEl.dataset.id;
      const it = items.get(id);
      if (!it) return;

      if (e.target.classList.contains('handle')) {
        selectOnly(id);
        mode = 'resize';
        drag = { pointerId: e.pointerId, id, sx: e.clientX, sy: e.clientY, w: it.w, h: it.h, aspect: it.w / it.h, kind: it.kind };
        viewport.setPointerCapture(e.pointerId);
        return;
      }
      if (e.shiftKey) {
        setSelected(id, !selection.has(id));
        return;
      }
      const wasSelected = selection.has(id);
      if (!wasSelected) selectOnly(id);
      mode = 'drag';
      drag = {
        pointerId: e.pointerId, id, wasSelected, sx: e.clientX, sy: e.clientY, moved: false,
        starts: [...selection].map((sid) => {
          const s = items.get(sid);
          return { id: sid, x: s.x, y: s.y };
        }),
      };
      viewport.setPointerCapture(e.pointerId);
    }
  });

  viewport.addEventListener('pointermove', (e) => {
    if (!mode || !drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;

    if (mode === 'pan') {
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      camera.x = drag.cx + dx;
      camera.y = drag.cy + dy;
      applyCamera();
    } else if (mode === 'drag') {
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      drag.starts.forEach((s) => {
        const it = items.get(s.id);
        if (!it) return;
        it.x = s.x + dx / camera.z;
        it.y = s.y + dy / camera.z;
        E.items.position(els.get(s.id), it);
      });
      E.flow.refresh();
    } else if (mode === 'resize') {
      const it = items.get(drag.id);
      if (!it) return;
      let w = drag.w + dx / camera.z;
      let h = drag.h + dy / camera.z;
      if (drag.kind === 'image' && !e.shiftKey) {
        w = Math.max(60, w);
        h = w / drag.aspect;
      }
      it.w = Math.max(60, w);
      it.h = Math.max(36, h);
      E.items.position(els.get(drag.id), it);
      E.flow.refresh();
    } else if (mode === 'connect') {
      if (Math.hypot(dx, dy) > 6) drag.moved = true;
      E.flow.temp(drag.fromId, screenToWorld(e.clientX, e.clientY));
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const overEl = hit && hit.closest ? hit.closest('.item') : null;
      if (drag.overEl && drag.overEl !== overEl) drag.overEl.classList.remove('flow-target');
      if (overEl && overEl.dataset.id !== drag.fromId) {
        overEl.classList.add('flow-target');
        drag.overEl = overEl;
      } else {
        drag.overEl = null;
      }
    } else if (mode === 'marquee') {
      const r = viewport.getBoundingClientRect();
      const x1 = Math.min(drag.sx, e.clientX) - r.left;
      const y1 = Math.min(drag.sy, e.clientY) - r.top;
      const x2 = Math.max(drag.sx, e.clientX) - r.left;
      const y2 = Math.max(drag.sy, e.clientY) - r.top;
      marqueeEl.classList.remove('hidden');
      marqueeEl.style.left = x1 + 'px';
      marqueeEl.style.top = y1 + 'px';
      marqueeEl.style.width = x2 - x1 + 'px';
      marqueeEl.style.height = y2 - y1 + 'px';
      drag.rect = { x1, y1, x2, y2 };
    }
  });

  viewport.addEventListener('pointerup', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (mode === 'pan') {
      viewport.classList.remove('panning');
      saveProjectDebounced();
    } else if (mode === 'drag' && drag) {
      if (drag.moved) {
        drag.starts.forEach((s) => {
          const it = items.get(s.id);
          if (it) saveItem(it);
        });
      } else if (drag.wasSelected && selection.size > 1) {
        selectOnly(drag.id);
      }
    } else if (mode === 'resize' && drag) {
      const it = items.get(drag.id);
      if (it) saveItem(it);
    } else if (mode === 'connect' && drag) {
      E.flow.clearTemp();
      if (drag.overEl) drag.overEl.classList.remove('flow-target');
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const overEl = hit && hit.closest ? hit.closest('.item') : null;
      if (overEl && overEl.dataset.id !== drag.fromId) {
        E.flow.connect(drag.fromId, overEl.dataset.id);
      } else if (!overEl && drag.moved) {
        // soltou no vazio: cria a próxima etapa já conectada
        const p = screenToWorld(e.clientX, e.clientY);
        const from = items.get(drag.fromId);
        const color = from && from.kind === 'flownode' ? from.content.color : null;
        const node = createFlowNode(p.x - 110, p.y - 44, 'step', '', color);
        E.flow.connect(drag.fromId, node.id);
        selectOnly(node.id);
        E.items.beginEdit(node, els.get(node.id), saveItem);
      } else if (!drag.moved) {
        E.ui.toast('Arraste o pontinho até outro item pra criar a seta');
      }
      E.flow.refresh();
    } else if (mode === 'marquee' && drag && drag.rect) {
      const a = screenToWorld(drag.rect.x1 + viewport.getBoundingClientRect().left, drag.rect.y1 + viewport.getBoundingClientRect().top);
      const b = screenToWorld(drag.rect.x2 + viewport.getBoundingClientRect().left, drag.rect.y2 + viewport.getBoundingClientRect().top);
      items.forEach((it, id) => {
        if (it.kind === 'frame') return; // pranchas se movem pela barra de título
        const hit = it.x < b.x && it.x + it.w > a.x && it.y < b.y && it.y + it.h > a.y;
        if (hit) setSelected(id, true);
      });
      marqueeEl.classList.add('hidden');
    }
    mode = null;
    drag = null;
  });

  /* ---------- zoom / scroll ---------- */

  viewport.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.clientX, e.clientY, camera.z * Math.exp(-e.deltaY * 0.01));
      } else {
        camera.x -= e.deltaX;
        camera.y -= e.deltaY;
        applyCamera();
        saveProjectDebounced();
      }
    },
    { passive: false }
  );

  /* ---------- duplo clique: editar ou criar nota ---------- */

  viewport.addEventListener('dblclick', (e) => {
    if (E.state.editing) return;
    // A captura de ponteiro do arrasto faz o e.target virar o viewport;
    // o que importa é o que está DEBAIXO do cursor neste momento
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    if (isFormTarget(hit)) return;
    if (hit && hit.closest && hit.closest('.flow-edge')) return; // a seta tem menu próprio no clique
    const itemEl = hit && hit.closest ? hit.closest('.item') : null;
    if (itemEl) {
      const it = items.get(itemEl.dataset.id);
      if (it) E.items.beginEdit(it, itemEl, saveItem);
    } else {
      const p = screenToWorld(e.clientX, e.clientY);
      const note = createNote(p.x - 115, p.y - 75, '');
      selectOnly(note.id);
      E.items.beginEdit(note, els.get(note.id), saveItem);
    }
  });

  /* ---------- menu de contexto ---------- */

  viewport.addEventListener('contextmenu', (e) => {
    const itemEl = e.target.closest('.item');
    if (!itemEl) return;
    e.preventDefault();
    const id = itemEl.dataset.id;
    const wasSelected = selection.has(id);
    // captura as imagens/vídeos selecionados ANTES do clique direito mexer na seleção
    const prevMediaSel = selectedItems().filter((s) => s.kind === 'image' || s.kind === 'video');
    if (!wasSelected) selectOnly(id);
    const it = items.get(id);
    const entries = [];
    const noteLinked = it && it.kind === 'note' && it.content && it.content.pageId;
    if (it && ((it.kind === 'note' && !noteLinked) || it.kind === 'post' || it.kind === 'label')) {
      entries.push({
        label: 'Reescrever com IA',
        icon: 'wand',
        onClick: () => E.ai.rewriteItem(it),
      });
    }
    if (it && it.kind === 'note') {
      if (noteLinked) {
        entries.push(
          {
            label: 'Abrir nas Notas',
            icon: 'note',
            onClick: () => E.notes.openPage(it.content.pageId),
          },
          {
            label: 'Desvincular das Notas',
            icon: 'link',
            onClick: () => unlinkNoteCard(it),
          }
        );
      } else {
        entries.push({
          label: 'Vincular às Notas do projeto',
          icon: 'note',
          onClick: () => linkNoteCard(it),
        });
      }
    }
    if (it && it.kind === 'flownode') {
      const nextShape = E.flow.SHAPES[(E.flow.SHAPES.indexOf(it.content.shape || 'step') + 1) % E.flow.SHAPES.length];
      entries.push(
        {
          label: 'Mudar formato (→ ' + E.flow.shapeLabel(nextShape) + ')',
          icon: 'frame',
          onClick: () => {
            it.content.shape = nextShape;
            E.items.refreshBody(it, els.get(it.id), saveItem);
            saveItem(it);
            E.flow.refresh();
          },
        },
        {
          label: 'Mudar cor do nó',
          icon: 'droplet',
          onClick: () => {
            const i = E.flow.PALETTE.indexOf(it.content.color);
            it.content.color = E.flow.PALETTE[(i + 1) % E.flow.PALETTE.length];
            E.items.refreshBody(it, els.get(it.id), saveItem);
            saveItem(it);
            E.flow.refresh();
          },
        }
      );
    }
    if (it) {
      entries.push({
        label: 'Conectar com seta',
        icon: 'flow',
        onClick: () => startConnectClick(it.id),
      });
    }
    entries.push(
      { label: 'Duplicar', icon: 'copy', onClick: duplicateSelection },
      {
        label: 'Trazer pra frente',
        onClick: () => {
          selectedItems().forEach((s) => {
            s.z = ++maxZ;
            E.items.position(els.get(s.id), s);
            saveItem(s);
          });
        },
      },
      {
        label: 'Enviar pro fundo',
        onClick: () => {
          let z = 0;
          items.forEach((s) => (z = Math.min(z, s.z || 1)));
          selectedItems().forEach((s) => {
            s.z = z - 1;
            E.items.position(els.get(s.id), s);
            saveItem(s);
          });
        },
      }
    );
    // pro post vale a seleção anterior (as imagens marcadas antes do clique direito);
    // pra imagem/vídeo, a seleção atual se ele fazia parte dela
    const mediaSel =
      it && it.kind === 'post'
        ? prevMediaSel
        : wasSelected
          ? prevMediaSel
          : it && (it.kind === 'image' || it.kind === 'video')
            ? [it]
            : [];
    if (it && it.kind === 'post') {
      if (mediaSel.length) {
        entries.unshift({
          label: 'Anexar ' + mediaSel.length + (mediaSel.length > 1 ? ' itens selecionados' : ' item selecionado') + ' ao carrossel',
          icon: 'layers',
          onClick: () => attachSelectionToPost(it, mediaSel),
        });
      }
      entries.unshift({
        label: 'Adicionar imagens ao post',
        icon: 'image',
        onClick: () => pickImageForPost(it),
      });
      entries.unshift({
        label: 'Gerar texto com IA (lê as imagens)',
        icon: 'sparkles',
        onClick: () => E.ai.captionPost(it),
      });
      entries.unshift({
        label: 'Publicar no Instagram',
        icon: 'smartphone',
        onClick: () => E.insta.publishPost(it),
      });
    }
    if (it && (it.kind === 'image' || it.kind === 'video')) {
      if (it.kind === 'image') {
        entries.unshift({
          label: 'Salvar e abrir no Photoshop',
          icon: 'brush',
          onClick: () => E.files.openInPhotoshop(it),
        });
      }
      entries.unshift({
        label:
          mediaSel.length > 1
            ? 'Criar post carrossel (' + mediaSel.length + ' itens)'
            : 'Transformar em post',
        icon: 'calendar',
        onClick: () => selectionToPost(mediaSel.length ? mediaSel : [it]),
      });
      if (it.kind === 'image') {
        entries.unshift({
          label: 'Editar com IA',
          icon: 'wand',
          onClick: () => E.ai.editImageItem(it),
        });
      }
    }
    if (it && it.kind === 'file') {
      entries.unshift(
        {
          label: 'Abrir no aplicativo',
          icon: 'arrow-up-right',
          onClick: () => E.files.openFileItem(it),
        },
        {
          label: 'Mostrar no Finder',
          icon: 'eye',
          onClick: () => E.files.openFileItem(it, 'reveal'),
        }
      );
    }
    if (it && it.kind === 'folder') {
      entries.unshift(
        {
          label: 'Explorar aqui dentro',
          icon: 'eye',
          onClick: () => E.explorer.open(it.content.path, it.content.name),
        },
        {
          label: 'Abrir no Finder',
          icon: 'folder',
          onClick: () => E.files.openPath(it.content.path).catch(() => {}),
        }
      );
    }
    if (it && it.kind === 'image') {
      entries.push({
        label: 'Usar como capa do projeto',
        icon: 'image',
        onClick: () => {
          project.coverBlobId = it.content.blobId;
          touchProject();
          E.ui.toast('Capa do projeto atualizada');
        },
      });
    }
    entries.push({ label: 'Excluir', icon: 'trash', danger: true, onClick: deleteSelection });
    E.ui.menu(e.clientX, e.clientY, entries);
  });

  /* ---------- nota do canvas ↔ Notas do projeto ---------- */

  /* O texto do card vira uma página nas Notas; o card passa a espelhar a página */
  function linkNoteCard(it) {
    if (!project.notes) project.notes = {};
    if (!Array.isArray(project.notes.pages)) project.notes.pages = [];
    const page = E.notes.pageFromText(it.content.text);
    project.notes.pages.push(page);
    project.notes.lastPageId = page.id;
    it.content.pageId = page.id;
    touchProject();
    saveProjectNow();
    E.items.refreshBody(it, els.get(it.id), saveItem);
    saveItem(it);
    E.ui.toast('Nota vinculada — agora ela vive nas Notas do projeto');
    E.notes.openPage(page.id);
  }

  /* Desfaz o vínculo: o conteúdo da página volta pro card como texto */
  function unlinkNoteCard(it) {
    const pages = (project.notes && project.notes.pages) || [];
    const page = pages.find((p) => p.id === it.content.pageId);
    if (page) it.content.text = E.notes.pageToText(page);
    delete it.content.pageId;
    E.items.refreshBody(it, els.get(it.id), saveItem);
    saveItem(it);
    E.ui.toast('Nota desvinculada' + (page ? ' — a página continua nas Notas' : ''));
  }

  /* Re-renderiza os cards vinculados a uma página (edição feita no painel) */
  function refreshNoteCards(pgId) {
    items.forEach((it) => {
      if (it.kind === 'note' && it.content && it.content.pageId === pgId) {
        const el = els.get(it.id);
        if (el) E.items.refreshBody(it, el, saveItem);
      }
    });
  }

  /* ---------- posts com imagem / carrossel ---------- */

  function mediaEntry(it) {
    return { blobId: it.content.blobId, kind: it.kind === 'video' ? 'video' : 'image' };
  }

  /* Setas do fluxograma sobrevivem quando cards somem pra dentro de um post:
     toda conexão de/para os cards absorvidos passa a ser do post */
  function transferEdges(absorbed, target) {
    const goneIds = new Set(absorbed.map((it) => it.id));
    if (!target.content.next) target.content.next = [];

    // saídas: setas que partiam das imagens agora partem do post
    absorbed.forEach((it) => {
      const edges = it.content && Array.isArray(it.content.next) ? it.content.next : [];
      edges.forEach((e) => {
        if (goneIds.has(e.to) || e.to === target.id) return; // interna ao grupo
        if (!target.content.next.some((x) => x.to === e.to)) {
          target.content.next.push({ to: e.to, label: e.label || '' });
        }
      });
    });

    // entradas: setas que chegavam nas imagens agora chegam no post
    allList.forEach((src) => {
      if (goneIds.has(src.id) || src.id === target.id) return;
      const edges = src.content && Array.isArray(src.content.next) ? src.content.next : null;
      if (!edges || !edges.length) return;
      let changed = false;
      const kept = new Set(edges.filter((e) => !goneIds.has(e.to)).map((e) => e.to));
      const remapped = [];
      edges.forEach((e) => {
        if (!goneIds.has(e.to)) {
          remapped.push(e);
          return;
        }
        changed = true;
        if (!kept.has(target.id)) {
          remapped.push({ to: target.id, label: e.label || '' });
          kept.add(target.id);
        }
      });
      if (changed) {
        src.content.next = remapped;
        saveItem(src);
      }
    });

    saveItem(target);
  }

  /* Vários itens selecionados viram um post carrossel (ordem: esquerda → direita).
     Os cards originais SOMEM do canvas — as imagens passam a viver só dentro
     do post (Cmd+Z desfaz e traz os cards de volta). */
  function selectionToPost(mediaItems) {
    const list = mediaItems.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const media = list.map(mediaEntry).filter((m) => m.blobId);
    if (!media.length) return;
    const first = list[0];
    const post = addItem({
      kind: 'post',
      x: first.x,
      y: first.y,
      w: 280,
      h: 380,
      content: { text: '', date: '', status: 'ideia', media: media, mediaIndex: 0 },
    });
    transferEdges(list, post); // setas do fluxograma continuam — agora no post
    removeItems(list);
    selectOnly(post.id);
    E.ui.toast(
      media.length > 1
        ? 'Post carrossel criado — as ' + media.length + ' mídias agora vivem dentro dele (Cmd+Z desfaz)'
        : 'Virou post — a imagem agora vive dentro dele (Cmd+Z desfaz)'
    );
  }

  function growPost(it) {
    if (it.h < 320) {
      it.h = 380;
      E.items.position(els.get(it.id), it);
    }
  }

  function attachSelectionToPost(post, mediaItems) {
    const list = mediaItems.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const media = E.items.postMedia(post.content).slice();
    list.forEach((m) => {
      if (m.content.blobId) media.push(mediaEntry(m));
    });
    post.content.media = media;
    delete post.content.blobId;
    growPost(post);
    transferEdges(list, post); // setas do fluxograma continuam — agora no post
    removeItems(list); // os cards somem — as mídias agora vivem dentro do post
    E.items.refreshBody(post, els.get(post.id), saveItem);
    saveItem(post);
    E.ui.toast('Carrossel agora tem ' + media.length + ' itens (Cmd+Z traz os cards de volta)');
  }

  function pickImageForPost(it) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.addEventListener('change', async () => {
      const files = [...input.files].filter(isMediaFile);
      if (!files.length) return;
      const media = E.items.postMedia(it.content).slice();
      for (const f of files) {
        media.push({
          blobId: await E.db.saveBlob(f),
          kind: f.type.indexOf('video/') === 0 ? 'video' : 'image',
        });
      }
      it.content.media = media;
      delete it.content.blobId;
      growPost(it);
      E.items.refreshBody(it, els.get(it.id), saveItem);
      saveItem(it);
      E.ui.toast(
        media.length > 1 ? 'Carrossel com ' + media.length + ' itens' : 'Mídia adicionada ao post'
      );
    });
    input.click();
  }

  /* ---------- excluir / desfazer / duplicar / copiar ---------- */

  /* Remove itens do canvas (com direito a Cmd+Z) — usado pela exclusão e
     pelas imagens que "somem" pra dentro de um post */
  function removeItems(sel) {
    if (!sel.length) return;
    deletedStack.push(sel.map((it) => Object.assign({}, it, { content: structuredClone(it.content) })));
    const goneIds = new Set(sel.map((it) => it.id));
    sel.forEach((it) => {
      const el = els.get(it.id);
      if (el) el.remove();
      els.delete(it.id);
      items.delete(it.id);
      selection.delete(it.id);
      E.db.del('items', it.id);
    });
    allList = allList.filter((it) => !goneIds.has(it.id));
    touchProject();
    updateEmptyHint();
    // setas que apontavam pros excluídos somem do desenho (os dados ficam,
    // então o Cmd+Z traz item E conexões de volta)
    E.flow.refresh();
    if (E.schedule && E.schedule.isOpen()) E.schedule.refreshSoon();
  }

  function deleteSelection() {
    const sel = selectedItems();
    if (!sel.length) return;
    removeItems(sel);
    selection.clear();
    E.ui.toast(sel.length + (sel.length > 1 ? ' itens excluídos' : ' item excluído') + ' — Cmd+Z desfaz');
  }

  function restoreDeleted() {
    const batch = deletedStack.pop();
    if (!batch) return;
    batch.forEach((it) => {
      items.set(it.id, it);
      allList.push(it);
      mount(it);
      E.db.put('items', it);
    });
    clearSelection();
    batch.forEach((it) => setSelected(it.id, true));
    touchProject();
    updateEmptyHint();
    E.flow.refresh();
    E.ui.toast('Exclusão desfeita');
  }

  /* Cópias de imagem ganham um blob próprio, pra nenhuma cópia depender da original */
  async function cloneContent(kind, content) {
    const c = structuredClone(content || {});
    if (c.blobId) {
      const rec = await E.db.get('blobs', c.blobId);
      if (rec && rec.blob) c.blobId = await E.db.saveBlob(rec.blob);
    }
    if (c.sceneBlobId) {
      const rec = await E.db.get('blobs', c.sceneBlobId);
      if (rec && rec.blob) c.sceneBlobId = await E.db.saveBlob(rec.blob);
    }
    if (Array.isArray(c.media)) {
      for (const m of c.media) {
        if (!m.blobId) continue;
        const rec = await E.db.get('blobs', m.blobId);
        if (rec && rec.blob) m.blobId = await E.db.saveBlob(rec.blob);
      }
    }
    return c;
  }

  /* Conexões de fluxo das cópias: aponta pra cópia quando o destino também foi
     copiado; senão mantém o destino original se ele ainda existir nesta aba */
  function remapFlowEdges(copies, idMap) {
    copies.forEach((copy) => {
      const c = copy.content;
      if (!c || !Array.isArray(c.next) || !c.next.length) return;
      c.next = c.next
        .map((e) => (idMap.has(e.to) ? { to: idMap.get(e.to), label: e.label || '' } : e))
        .filter((e) => items.has(e.to));
      saveItem(copy);
    });
    E.flow.refresh();
  }

  async function duplicateSelection() {
    const sel = selectedItems();
    if (!sel.length) return;
    clearSelection();
    const idMap = new Map();
    const copies = [];
    for (const it of sel) {
      const copy = addItem({
        kind: it.kind,
        x: it.x + 28,
        y: it.y + 28,
        w: it.w,
        h: it.h,
        content: await cloneContent(it.kind, it.content),
      });
      idMap.set(it.id, copy.id);
      copies.push(copy);
      setSelected(copy.id, true);
    }
    remapFlowEdges(copies, idMap);
  }

  function copySelection() {
    const sel = selectedItems();
    if (!sel.length) return;
    let minX = Infinity, minY = Infinity;
    sel.forEach((it) => {
      minX = Math.min(minX, it.x);
      minY = Math.min(minY, it.y);
    });
    E.state.clipboard = sel.map((it) => ({
      srcId: it.id, // pra religar as setas do fluxograma ao colar
      kind: it.kind,
      dx: it.x - minX,
      dy: it.y - minY,
      w: it.w,
      h: it.h,
      content: structuredClone(it.content),
    }));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(E.CLIP_MARKER).catch(() => {});
    }
    E.ui.toast(sel.length + (sel.length > 1 ? ' itens copiados' : ' item copiado') + ' — cole em qualquer projeto');
  }

  async function pasteInternal() {
    const clip = E.state.clipboard;
    if (!clip || !clip.length) {
      E.ui.toast('Nada copiado ainda');
      return;
    }
    const c = viewCenterWorld();
    clearSelection();
    const idMap = new Map();
    const copies = [];
    for (const d of clip) {
      const copy = addItem({
        kind: d.kind,
        x: c.x + d.dx - 60,
        y: c.y + d.dy - 40,
        w: d.w,
        h: d.h,
        content: await cloneContent(d.kind, d.content),
      });
      if (d.srcId) idMap.set(d.srcId, copy.id);
      copies.push(copy);
      setSelected(copy.id, true);
    }
    remapFlowEdges(copies, idMap);
    E.ui.toast('Colado');
  }

  /* ---------- colar (Cmd+V) e arrastar arquivos ---------- */

  window.addEventListener('paste', async (e) => {
    if (!isOpen() || E.state.editing || isFormTarget(document.activeElement)) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...cd.files];
    if (files.length) {
      e.preventDefault();
      const c = viewCenterWorld();
      for (let i = 0; i < files.length; i++) {
        await createAnyFromBlob(files[i], c.x + i * 36, c.y + i * 36);
      }
      return;
    }
    const text = cd.getData('text/plain').trim();
    if (text === E.CLIP_MARKER) {
      e.preventDefault();
      pasteInternal();
      return;
    }
    if (text) {
      e.preventDefault();
      const c = viewCenterWorld();
      if (/^https?:\/\/\S+$/i.test(text)) {
        const link = createLink(text, '', c.x - 120, c.y - 55);
        selectOnly(link.id);
      } else {
        const note = createNote(c.x - 115, c.y - 75, text);
        selectOnly(note.id);
      }
      return;
    }
    if (E.state.clipboard) {
      e.preventDefault();
      pasteInternal();
    }
  });

  viewport.addEventListener('dragover', (e) => e.preventDefault());
  viewport.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!isOpen()) return;
    const p = screenToWorld(e.clientX, e.clientY);
    const files = [...e.dataTransfer.files];
    if (files.length) {
      for (let i = 0; i < files.length; i++) {
        await createAnyFromBlob(files[i], p.x + i * 44, p.y + i * 44);
      }
      return;
    }
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uri && /^https?:/i.test(uri.trim())) {
      createLink(uri.trim().split('\n')[0], '', p.x, p.y);
    }
  });

  /* ---------- atalhos de teclado ---------- */

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      viewport.classList.remove('space-pan');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (!isOpen() || E.state.editing || isFormTarget(document.activeElement)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if (!spaceDown) {
        spaceDown = true;
        viewport.classList.add('space-pan');
      }
      return;
    }
    const mod = e.metaKey || e.ctrlKey;

    if ((e.key === 'Delete' || e.key === 'Backspace') && selection.size) {
      e.preventDefault();
      deleteSelection();
    } else if (mod && (e.key === 'c' || e.key === 'C') && selection.size) {
      e.preventDefault();
      copySelection();
    } else if (mod && (e.key === 'd' || e.key === 'D') && selection.size) {
      e.preventDefault();
      duplicateSelection();
    } else if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      restoreDeleted();
    } else if (mod && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      items.forEach((_, id) => setSelected(id, true));
    } else if (e.key === 'Escape') {
      if (pendingCreate) {
        cancelPlacement();
        E.ui.toast('Criação cancelada');
      } else if (pendingConnectFrom) {
        cancelConnectClick();
        E.ui.toast('Conexão cancelada');
      } else {
        clearSelection();
      }
    }
  });

  /* ---------- barra de ferramentas ---------- */

  titleInput.addEventListener('change', () => {
    if (!project) return;
    project.name = titleInput.value.trim() || 'Sem nome';
    titleInput.value = project.name;
    touchProject();
  });
  titleInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') titleInput.blur();
  });

  stageSelect.addEventListener('change', () => {
    if (!project) return;
    project.stage = stageSelect.value;
    stageDot.style.background = E.stageById(project.stage).color;
    touchProject();
  });

  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files].filter(isMediaFile);
    const c = pendingImagePoint || spawnPoint();
    pendingImagePoint = null;
    for (let i = 0; i < files.length; i++) {
      await createMediaFromBlob(files[i], c.x - 200 + i * 44, c.y - 140 + i * 44);
    }
    fileInput.value = '';
  });

  /* Modo de colocação: escolheu a ferramenta → clica no canvas onde quer criar */
  function startPlacement(label, fn) {
    pendingCreate = fn;
    viewport.classList.add('placing');
    E.ui.toast('Clique no canvas onde quer criar ' + label + ' — Esc cancela');
  }
  function cancelPlacement() {
    pendingCreate = null;
    viewport.classList.remove('placing');
  }

  /* Conexão por clique (menu de contexto): escolhe a origem, clica no destino */
  function startConnectClick(fromId) {
    pendingConnectFrom = fromId;
    viewport.classList.add('placing');
    E.ui.toast('Clique no item de destino da seta — Esc cancela');
  }
  function cancelConnectClick() {
    pendingConnectFrom = null;
    viewport.classList.remove('placing');
  }

  const PALETTE = ['#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#fb7185', '#f472b6', '#e8e8ec'];

  document.getElementById('tool-create').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    E.ui.menu(r.left, r.bottom + 6, [
      {
        label: 'Gerador de IA',
        icon: 'sparkles',
        onClick: () =>
          startPlacement('o gerador', (p) => {
            const gen = addItem({
              kind: 'gen', x: p.x - 150, y: p.y - 260, w: 300, h: 520,
              content: {
                prompt: '', type: 'imagem', imageModel: 'gemini', aspect: '1:1',
                quality: 'alta', useIdentity: true, useBrand: true, useProduct: true,
              },
            });
            selectOnly(gen.id);
          }),
      },
      {
        label: 'Nota',
        icon: 'note',
        onClick: () =>
          startPlacement('a nota', (p) => {
            const note = createNote(p.x - 115, p.y - 75, '');
            selectOnly(note.id);
            E.items.beginEdit(note, els.get(note.id), saveItem);
          }),
      },
      {
        label: 'Imagem ou vídeo (do computador)',
        icon: 'image',
        onClick: () =>
          startPlacement('a mídia', (p) => {
            pendingImagePoint = p;
            fileInput.click();
          }),
      },
      {
        label: 'Arquivo (PDF, Office, qualquer um)',
        icon: 'copy',
        onClick: () =>
          startPlacement('o arquivo', (p) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.addEventListener('change', async () => {
              const files = [...input.files];
              for (let i = 0; i < files.length; i++) {
                await createAnyFromBlob(files[i], p.x - 110 + i * 44, p.y - 66 + i * 44);
              }
            });
            input.click();
          }),
      },
      {
        label: 'Pasta do computador',
        icon: 'folder',
        onClick: () =>
          startPlacement('a pasta', async (p) => {
            const r = await E.files.linkFolder();
            if (!r) return;
            const folder = addItem({
              kind: 'folder', x: p.x - 110, y: p.y - 66, w: 220, h: 132,
              content: { path: r.path, name: r.name },
            });
            selectOnly(folder.id);
            E.ui.toast('Pasta vinculada — dois cliques pra explorar sem sair do Estúdio');
          }),
      },
      {
        label: 'Fluxograma',
        icon: 'flow',
        onClick: () =>
          startPlacement('a primeira etapa do fluxo', (p) => {
            const node = createFlowNode(p.x - 110, p.y - 44, 'step', 'Nova etapa');
            selectOnly(node.id);
            E.items.beginEdit(node, els.get(node.id), saveItem);
            E.ui.toast('Arraste do pontinho na borda do nó até outro item — ou solte no vazio pra criar a próxima etapa');
          }),
      },
      {
        label: 'Post',
        icon: 'calendar',
        onClick: () =>
          startPlacement('o post', (p) => {
            const post = createPost(p.x - 120, p.y - 85);
            selectOnly(post.id);
            E.items.beginEdit(post, els.get(post.id), saveItem);
          }),
      },
      {
        label: 'Prancha',
        icon: 'frame',
        onClick: () =>
          startPlacement('a prancha', (p) => {
            const frame = createFrame('Prancha ' + (frameCount() + 1), '1:1', p.x - 360, p.y - 360);
            selectOnly(frame.id);
            E.ui.toast('Prancha criada — mude o formato no seletor da barrinha dela');
          }),
      },
      {
        label: 'Link',
        icon: 'link',
        onClick: () =>
          startPlacement('o link', (p) => {
            const link = addItem({
              kind: 'link', x: p.x - 120, y: p.y - 60, w: 240, h: 130,
              content: { url: '', title: '' },
            });
            selectOnly(link.id);
            const inp = els.get(link.id).querySelector('.link-url-input');
            if (inp) inp.focus();
          }),
      },
      {
        label: 'Cor',
        icon: 'droplet',
        onClick: () =>
          startPlacement('a cor', (p) => {
            const color = createColor(p.x - 65, p.y - 65, PALETTE[items.size % PALETTE.length]);
            selectOnly(color.id);
          }),
      },
      {
        label: 'Título',
        icon: 'type',
        onClick: () =>
          startPlacement('o título', (p) => {
            const label = createLabel(p.x - 210, p.y - 26, 'Título da seção');
            selectOnly(label.id);
            E.items.beginEdit(label, els.get(label.id), saveItem);
          }),
      },
    ]);
  });

  document.getElementById('tool-brand').addEventListener('click', () => E.brand.toggle());
  document.getElementById('tool-schedule').addEventListener('click', () => E.schedule.toggle());
  document.getElementById('tool-export').addEventListener('click', () => E.exporter.openExportModal());

  document.getElementById('zoom-in').addEventListener('click', () => zoomCenter(1.25));
  document.getElementById('zoom-out').addEventListener('click', () => zoomCenter(0.8));
  document.getElementById('zoom-fit').addEventListener('click', fitView);

  /* ---------- avisos ---------- */

  function updateEmptyHint() {
    emptyHint.classList.toggle('hidden', items.size > 0);
  }

  /* Estado do canvas pro exportador */
  function getState() {
    return { project, items: [...items.values()] };
  }

  /* Todos os itens do projeto (todas as abas) — usado pelo cronograma */
  function getAllItems() {
    return allList.slice();
  }

  /* Centraliza a câmera num item (troca de aba se precisar) e seleciona */
  function focusItem(id) {
    const it = allList.find((i) => i.id === id);
    if (!it || !project) return;
    if (it.board !== boardId) switchBoard(it.board);
    const r = viewport.getBoundingClientRect();
    camera.x = r.width / 2 - (it.x + it.w / 2) * camera.z;
    camera.y = r.height / 2 - (it.y + it.h / 2) * camera.z;
    applyCamera();
    selectOnly(id);
    saveProjectDebounced();
  }

  /* Re-renderiza os cards Gerador (ex.: produto novo criado no painel Marca) */
  function refreshGenCards() {
    items.forEach((it) => {
      if (it.kind === 'gen') {
        const el = els.get(it.id);
        if (el) E.items.refreshBody(it, el, saveItem);
      }
    });
  }

  /* Re-renderiza e salva um item alterado por fora (ex.: legenda da IA) */
  function refreshItem(item) {
    const el = els.get(item.id);
    if (el) E.items.refreshBody(item, el, saveItem);
    saveItem(item);
  }

  /* Inserção de conteúdo gerado por IA */
  async function addGeneratedImage(blob, nearItem) {
    if (nearItem) {
      return createImageFromBlob(blob, nearItem.x + nearItem.w + 30, nearItem.y);
    }
    const c = viewCenterWorld();
    return createImageFromBlob(blob, c.x - 200, c.y - 140);
  }
  async function addGeneratedVideo(blob, title) {
    const blobId = await E.db.saveBlob(blob);
    const c = viewCenterWorld();
    const item = addItem({
      kind: 'video', x: c.x - 190, y: c.y - 125, w: 380, h: 250,
      content: { blobId, title: title || 'Vídeo gerado' },
    });
    selectOnly(item.id);
    return item;
  }
  async function addGeneratedAudio(blob, title) {
    const blobId = await E.db.saveBlob(blob);
    const c = viewCenterWorld();
    const item = addItem({
      kind: 'audio', x: c.x - 160, y: c.y - 50, w: 320, h: 100,
      content: { blobId, title: title || 'Áudio gerado' },
    });
    selectOnly(item.id);
    return item;
  }
  function addGeneratedNote(text, nearItem) {
    const pos = nearItem
      ? { x: nearItem.x + nearItem.w + 30, y: nearItem.y }
      : (() => {
          const c = viewCenterWorld();
          return { x: c.x - 160, y: c.y - 120 };
        })();
    const item = addItem({
      kind: 'note', x: pos.x, y: pos.y, w: 320, h: 260,
      content: { text: text },
    });
    selectOnly(item.id);
    return item;
  }

  /* O fluxograma lê os itens da aba atual e salva pelo mesmo caminho do canvas */
  E.flow.bind({
    items: () => items,
    els: () => els,
    save: saveItem,
  });

  E.canvas = {
    open, close, isOpen, createPost, spawnPoint, getState,
    addGeneratedImage, addGeneratedVideo, addGeneratedAudio, addGeneratedNote,
    getAllItems, focusItem, refreshItem, refreshGenCards, refreshNoteCards, importFile,
  };
})();
