/* Galeria: home do estúdio — grade ou kanban, filtros por fase e cliente */
(function () {
  const E = window.Estudio;
  const grid = document.getElementById('project-grid');
  const board = document.getElementById('kanban-board');
  const filters = document.getElementById('stage-filters');
  const clientFilters = document.getElementById('client-filters');
  const heroCount = document.getElementById('hero-count');
  const heroDate = document.getElementById('hero-date');

  /* ---------- data do hero ---------- */
  if (heroDate) {
    heroDate.textContent = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  }

  /* ---------- alternador de visualização ----------
     "Visualização" é um dropdown com os modos de projeto (Universo,
     Grade, Kanban); Explorar, Chat e Navegador são botões próprios. */

  const PROJECT_VIEWS = [
    { id: 'universe', label: 'Universo', icon: 'logo', hint: 'Galeria 360 — projetos em órbita, com busca' },
    { id: 'grid', label: 'Grade', icon: 'grid', hint: 'Ver projetos em grade' },
    { id: 'kanban', label: 'Kanban', icon: 'kanban', hint: 'Ver projetos por fase, em colunas' },
  ];
  function isProjectView(v) {
    return PROJECT_VIEWS.some((pv) => pv.id === v);
  }

  E.state.galleryView = localStorage.getItem('estudio-view') || 'universe';
  // estado antigo apontando pra uma aba removida do menu volta pro Universo
  if (E.state.galleryView === 'chat' || E.state.galleryView === 'browser') {
    E.state.galleryView = 'universe';
    localStorage.setItem('estudio-view', 'universe');
  }

  const galleryView = document.getElementById('gallery-view');
  const universe = document.getElementById('universe-view');
  const switchEl = document.getElementById('view-switch');
  const projectsBtn = document.getElementById('view-projects');
  const projectsLabel = document.getElementById('view-projects-label');
  // Chat e Navegador saíram do menu principal — vivem só dentro dos projetos
  const viewBtns = {
    explore: document.getElementById('view-explore'),
    terminal: document.getElementById('view-terminal'),
  };
  const exploreView = document.getElementById('explore-view');
  const chatView = document.getElementById('chat-view');
  const browserView = document.getElementById('browser-view');
  const terminalView = document.getElementById('terminal-view');
  const thumb = switchEl.querySelector('.view-thumb');

  // último modo de projeto usado — é o que o dropdown mostra e reabre
  let lastProjectView = isProjectView(E.state.galleryView) ? E.state.galleryView : 'universe';

  function moveThumb() {
    const v = E.state.galleryView;
    const active = isProjectView(v) ? projectsBtn : viewBtns[v] || projectsBtn;
    thumb.style.left = active.offsetLeft + 'px';
    thumb.style.width = active.offsetWidth + 'px';
  }

  function syncViewButtons() {
    const v = E.state.galleryView;
    if (isProjectView(v)) lastProjectView = v;
    const pv = PROJECT_VIEWS.find((x) => x.id === lastProjectView) || PROJECT_VIEWS[0];
    projectsLabel.textContent = pv.label;
    projectsBtn.classList.toggle('active', isProjectView(v));
    Object.keys(viewBtns).forEach((k) => {
      viewBtns[k].classList.toggle('active', v === k);
    });
    requestAnimationFrame(moveThumb);
  }

  let selecting = false;
  const selectedIds = new Set();
  let showArchived = false;

  function setView(view) {
    // clicar numa aba do menu principal de dentro de um projeto volta pra galeria
    if (E.app && E.app.enterGallery) E.app.enterGallery();
    E.state.galleryView = view;
    localStorage.setItem('estudio-view', view);
    selecting = false;
    selectedIds.clear();
    showArchived = false;
    syncViewButtons();
    render();
  }

  projectsBtn.addEventListener('click', () => {
    const r = projectsBtn.getBoundingClientRect();
    E.ui.menu(
      r.left,
      r.bottom + 8,
      PROJECT_VIEWS.map((pv) => ({
        label: pv.label,
        icon: E.state.galleryView === pv.id ? 'check' : pv.icon,
        onClick: () => setView(pv.id),
      }))
    );
  });
  Object.keys(viewBtns).forEach((k) => {
    viewBtns[k].addEventListener('click', () => setView(k));
  });
  window.addEventListener('resize', E.debounce(moveThumb, 120));

  /* ---------- render principal ---------- */

  async function render() {
    const all = (await E.db.getAll('projects')).sort(
      (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
    );
    E.state.projects = all;
    await E.clients.all();

    const active = all.filter((p) => !p.archived);
    const archived = all.filter((p) => p.archived);
    const view = E.state.galleryView;
    if (!archived.length) showArchived = false;
    const base = showArchived ? archived : active;

    syncViewButtons();

    if (heroCount) {
      const n = active.length;
      heroCount.textContent = String(n).padStart(2, '0') + (n === 1 ? ' projeto' : ' projetos');
    }

    renderFilters(base, archived);
    renderClientFilters(base);

    const visible = base.filter(
      (p) => (E.state.galleryFilter === 'all' || p.stage === E.state.galleryFilter) && matchClient(p)
    );

    galleryView.classList.toggle('universe-mode', view === 'universe');
    galleryView.classList.toggle('chat-mode', view === 'chat' || view === 'browser' || view === 'terminal');
    galleryView.classList.toggle('explore-mode', view === 'explore');
    grid.classList.toggle('hidden', view !== 'grid');
    grid.classList.toggle('selecting', selecting);
    board.classList.toggle('hidden', view !== 'kanban');
    universe.classList.toggle('hidden', view !== 'universe');
    exploreView.classList.toggle('hidden', view !== 'explore');
    chatView.classList.toggle('hidden', view !== 'chat');
    browserView.classList.toggle('hidden', view !== 'browser');
    terminalView.classList.toggle('hidden', view !== 'terminal');

    if (view === 'universe') {
      E.universe.render(universe, active);
    } else {
      E.universe.stop();
      universe.innerHTML = '';
      if (view === 'explore') {
        E.explore.render(exploreView);
      } else if (view === 'chat') {
        E.chat.render(chatView);
      } else if (view === 'browser') {
        E.browser.render(browserView);
      } else if (view === 'terminal') {
        E.terminal.render(terminalView);
      } else if (view === 'kanban') {
        E.kanban.render(board, active.filter(matchClient));
      } else {
        renderGrid(visible);
      }
    }
    renderSelectBar(visible);
  }

  function renderClientFilters(projects) {
    clientFilters.innerHTML = '';
    const clients = E.state.clients;
    if (!clients.length) return; // sem cadastro, sem filtro

    const counts = {};
    projects.forEach((p) => {
      const k = p.clientId || 'none';
      counts[k] = (counts[k] || 0) + 1;
    });

    const sel = E.state.galleryClientFilter;
    const all = chip('Todos os clientes', null, projects.length, sel === 'all', 'users');
    all.addEventListener('click', () => {
      E.state.galleryClientFilter = 'all';
      render();
    });
    clientFilters.appendChild(all);

    clients.forEach((c) => {
      const ch = chip(c.name, null, counts[c.id] || 0, sel === c.id, 'user');
      ch.addEventListener('click', () => {
        E.state.galleryClientFilter = c.id;
        render();
      });
      clientFilters.appendChild(ch);
    });

    if (counts.none) {
      const ch = chip('Sem cliente', null, counts.none, sel === 'none');
      ch.addEventListener('click', () => {
        E.state.galleryClientFilter = 'none';
        render();
      });
      clientFilters.appendChild(ch);
    }
  }

  function renderFilters(projects, archived) {
    filters.innerHTML = '';
    const counts = {};
    projects.forEach((p) => (counts[p.stage] = (counts[p.stage] || 0) + 1));

    const all = chip('Todos', null, projects.length, E.state.galleryFilter === 'all');
    all.addEventListener('click', () => {
      E.state.galleryFilter = 'all';
      render();
    });
    filters.appendChild(all);

    E.STAGES.forEach((s) => {
      const n = counts[s.id] || 0;
      if (!n) return;
      const c = chip(s.label, s.color, n, E.state.galleryFilter === s.id);
      c.addEventListener('click', () => {
        E.state.galleryFilter = s.id;
        render();
      });
      filters.appendChild(c);
    });

    if (E.state.galleryView !== 'grid') return;

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    filters.appendChild(spacer);

    if (archived && archived.length) {
      const arc = chip('Arquivados', null, archived.length, showArchived, 'archive');
      arc.addEventListener('click', () => {
        showArchived = !showArchived;
        selecting = false;
        selectedIds.clear();
        E.state.galleryFilter = 'all';
        render();
      });
      filters.appendChild(arc);
    }

    if (projects.length) {
      const sel = chip(selecting ? 'Sair da seleção' : 'Selecionar', null, selecting ? selectedIds.size : projects.length, selecting, selecting ? 'close' : 'check');
      sel.addEventListener('click', () => {
        selecting = !selecting;
        selectedIds.clear();
        render();
      });
      filters.appendChild(sel);
    }
  }

  function chip(label, color, count, active, icon) {
    const b = document.createElement('button');
    b.className = 'chip' + (active ? ' active' : '');
    if (color) {
      const dot = document.createElement('span');
      dot.className = 'chip-dot';
      dot.style.background = color;
      b.appendChild(dot);
    } else if (icon) {
      b.insertAdjacentHTML('beforeend', E.icon(icon, 14));
    }
    const sp = document.createElement('span');
    sp.textContent = label;
    b.appendChild(sp);
    const n = document.createElement('span');
    n.className = 'chip-count';
    n.textContent = count;
    b.appendChild(n);
    return b;
  }

  function matchClient(p) {
    const f = E.state.galleryClientFilter;
    if (f === 'all') return true;
    if (f === 'none') return !p.clientId;
    return p.clientId === f;
  }

  function renderGrid(projects) {
    grid.innerHTML = '';
    if (!selecting && !showArchived) {
      grid.appendChild(newProjectCard());
      grid.appendChild(importFolderCard());
    }
    if (showArchived && !projects.length) {
      const empty = document.createElement('p');
      empty.className = 'grid-empty';
      empty.textContent = 'Nenhum projeto arquivado.';
      grid.appendChild(empty);
    }
    projects.forEach((p, i) => {
      const el = card(p);
      el.style.setProperty('--i', i + 2);
      grid.appendChild(el);
    });
  }

  /* ---------- seleção em massa: arquivar / excluir ---------- */

  function renderSelectBar(visible) {
    const old = document.getElementById('select-bar');
    if (old) old.remove();
    if (!selecting || E.state.galleryView !== 'grid') return;

    const bar = document.createElement('div');
    bar.id = 'select-bar';

    const label = document.createElement('span');
    label.className = 'select-count mono';
    label.textContent = selectedIds.size + ' selecionado' + (selectedIds.size === 1 ? '' : 's');
    bar.appendChild(label);

    const allBtn = document.createElement('button');
    allBtn.className = 'btn ghost';
    E.setLabel(allBtn, 'check', selectedIds.size === visible.length ? 'Limpar' : 'Todos');
    allBtn.addEventListener('click', () => {
      if (selectedIds.size === visible.length) selectedIds.clear();
      else visible.forEach((p) => selectedIds.add(p.id));
      render();
    });
    bar.appendChild(allBtn);

    const arcBtn = document.createElement('button');
    arcBtn.className = 'btn';
    E.setLabel(arcBtn, 'archive', showArchived ? 'Desarquivar' : 'Arquivar');
    arcBtn.addEventListener('click', () => bulkArchive(!showArchived));
    bar.appendChild(arcBtn);

    const delBtn = document.createElement('button');
    delBtn.className = 'btn ghost danger';
    E.setLabel(delBtn, 'trash', 'Excluir');
    delBtn.addEventListener('click', bulkDelete);
    bar.appendChild(delBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn ghost';
    E.setLabel(cancelBtn, 'close', 'Cancelar');
    cancelBtn.addEventListener('click', () => {
      selecting = false;
      selectedIds.clear();
      render();
    });
    bar.appendChild(cancelBtn);

    galleryView.appendChild(bar);
  }

  async function bulkArchive(toArchived) {
    if (!selectedIds.size) {
      E.ui.toast('Selecione pelo menos um projeto');
      return;
    }
    const n = selectedIds.size;
    for (const id of selectedIds) {
      const p = E.state.projects.find((x) => x.id === id);
      if (p) await E.db.put('projects', Object.assign({}, p, { archived: toArchived, updatedAt: Date.now() }));
    }
    selecting = false;
    selectedIds.clear();
    E.ui.toast(
      toArchived
        ? n + (n === 1 ? ' projeto arquivado' : ' projetos arquivados')
        : n + (n === 1 ? ' projeto restaurado' : ' projetos restaurados')
    );
    render();
  }

  async function bulkDelete() {
    if (!selectedIds.size) {
      E.ui.toast('Selecione pelo menos um projeto');
      return;
    }
    const n = selectedIds.size;
    const ok = await E.ui.confirm(
      'Excluir ' + n + (n === 1 ? ' projeto?' : ' projetos?'),
      'Os projetos selecionados e tudo que está nos canvas deles serão apagados. Essa ação não tem volta.',
      'Excluir'
    );
    if (!ok) return;
    for (const id of selectedIds) {
      const list = await E.db.itemsByProject(id);
      for (const it of list) await E.db.del('items', it.id);
      await E.db.del('projects', id);
    }
    selecting = false;
    selectedIds.clear();
    E.ui.toast(n + (n === 1 ? ' projeto excluído' : ' projetos excluídos'));
    render();
  }

  function newProjectCard() {
    const el = document.createElement('button');
    el.className = 'card card-new';
    el.style.setProperty('--i', 0);
    el.innerHTML =
      '<span class="plus-ring">' + E.icon('plus', 18) + '</span><span>Novo projeto</span>';
    el.addEventListener('click', createProject);
    return el;
  }

  /* mesmo fluxo do arrastar pasta, mas pelo diálogo nativo do sistema */
  function importFolderCard() {
    const el = document.createElement('button');
    el.className = 'card card-new';
    el.style.setProperty('--i', 1);
    el.title = 'Escolha uma pasta do computador — ela vira um projeto vinculado, sem copiar nada';
    el.innerHTML =
      '<span class="plus-ring">' + E.icon('folder', 18) + '</span><span>Importar pasta</span>';
    el.addEventListener('click', importFolder);
    return el;
  }

  async function importFolder() {
    const linked = await E.files.linkFolder();
    if (!linked) return;
    await createProjectFromLinked(linked);
  }

  function clientOptions() {
    return [{ value: '', label: 'Sem cliente' }].concat(
      E.state.clients.map((c) => ({ value: c.id, label: c.name }))
    );
  }

  async function createProject() {
    const fields = [
      { name: 'name', label: 'Nome', placeholder: 'Clipe do fulano, Marca de pão de alho…' },
      {
        name: 'type',
        label: 'Tipo',
        type: 'select',
        options: E.TYPES.map((t) => ({ value: t.id, label: t.label })),
      },
    ];
    if (E.state.clients.length) {
      fields.push({
        name: 'client',
        label: 'Cliente (cadastre em Configurações → Clientes)',
        type: 'select',
        options: clientOptions(),
      });
    }
    const vals = await E.ui.modal({ title: 'Novo projeto', fields, okLabel: 'Criar' });
    if (vals === null || !vals.name.trim()) return;
    const now = Date.now();
    const p = {
      id: E.uid(),
      name: vals.name.trim(),
      type: vals.type,
      clientId: vals.client || null,
      stage: vals.type === 'marca' ? 'continuo' : 'ideia',
      createdAt: now,
      updatedAt: now,
    };
    await E.db.put('projects', p);
    E.app.openProject(p.id);
  }

  async function assignClient(p) {
    if (!E.state.clients.length) {
      E.ui.toast('Cadastre um cliente primeiro: Configurações → Clientes');
      return;
    }
    const vals = await E.ui.modal({
      title: 'Cliente do projeto',
      message: '"' + p.name + '"',
      fields: [
        { name: 'client', label: 'Cliente', type: 'select', value: p.clientId || '', options: clientOptions() },
      ],
      okLabel: 'Vincular',
    });
    if (vals === null) return;
    await E.db.put('projects', Object.assign({}, p, { clientId: vals.client || null, updatedAt: Date.now() }));
    E.ui.toast(vals.client ? 'Projeto vinculado' : 'Vínculo removido');
    render();
  }

  function card(p) {
    const type = E.typeById(p.type);
    const stage = E.stageById(p.stage);

    const el = document.createElement('div');
    el.className = 'card';
    el.dataset.id = p.id;

    const cover = document.createElement('div');
    cover.className = 'card-cover';
    cover.style.background =
      'linear-gradient(150deg, ' + stage.color + '14, var(--panel) 70%)';
    const mark = document.createElement('span');
    mark.className = 'cover-mark';
    mark.innerHTML = E.icon(type.icon, 42);
    cover.appendChild(mark);
    const open = document.createElement('span');
    open.className = 'card-open';
    open.innerHTML = E.icon('arrow-up-right', 16);
    cover.appendChild(open);
    if (p.coverBlobId) {
      E.db.blobUrl(p.coverBlobId).then((u) => {
        if (!u) return;
        const img = document.createElement('img');
        img.src = u;
        img.alt = '';
        img.draggable = false;
        cover.innerHTML = '';
        cover.appendChild(img);
        cover.appendChild(open);
      });
    }
    el.appendChild(cover);

    const info = document.createElement('div');
    info.className = 'card-info';

    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = p.name;
    info.appendChild(name);

    const typeLine = document.createElement('div');
    typeLine.className = 'card-type';
    typeLine.textContent = type.label;
    info.appendChild(typeLine);

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    const dot = document.createElement('span');
    dot.className = 'stage-dot';
    dot.style.background = stage.color;
    const sel = document.createElement('select');
    sel.className = 'stage-select-card';
    sel.title = 'Fase da entrega';
    E.STAGES.forEach((s) => {
      const op = document.createElement('option');
      op.value = s.id;
      op.textContent = s.label;
      sel.appendChild(op);
    });
    sel.value = p.stage || 'ideia';
    sel.addEventListener('pointerdown', (e) => e.stopPropagation());
    sel.addEventListener('click', (e) => e.stopPropagation());
    sel.addEventListener('change', async (e) => {
      e.stopPropagation();
      p.stage = sel.value;
      p.updatedAt = Date.now();
      await E.db.put('projects', p);
      render();
    });
    meta.appendChild(dot);
    meta.appendChild(sel);
    info.appendChild(meta);

    const client = E.clients.byId(p.clientId);
    if (client) {
      const cl = document.createElement('div');
      cl.className = 'card-client';
      cl.innerHTML = E.icon('user', 13);
      const cs = document.createElement('span');
      cs.textContent = client.name;
      cl.appendChild(cs);
      info.appendChild(cl);
    }
    el.appendChild(info);

    if (selecting) {
      el.classList.add('selectable');
      el.classList.toggle('selected', selectedIds.has(p.id));
      const check = document.createElement('span');
      check.className = 'card-check';
      check.innerHTML = E.icon('check', 13);
      el.appendChild(check);
      el.addEventListener('click', () => {
        if (selectedIds.has(p.id)) selectedIds.delete(p.id);
        else selectedIds.add(p.id);
        el.classList.toggle('selected', selectedIds.has(p.id));
        const bar = document.getElementById('select-bar');
        if (bar) {
          bar.querySelector('.select-count').textContent =
            selectedIds.size + ' selecionado' + (selectedIds.size === 1 ? '' : 's');
        }
      });
      return el;
    }

    const menuBtn = document.createElement('button');
    menuBtn.className = 'card-menu';
    menuBtn.innerHTML = E.icon('more', 15);
    menuBtn.title = 'Opções do projeto';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      E.ui.menu(e.clientX, e.clientY, [
        { label: 'Renomear', icon: 'pencil', onClick: () => renameProject(p) },
        { label: 'Cliente…', icon: 'user', onClick: () => assignClient(p) },
        { label: 'Salvar em arquivo…', icon: 'download', onClick: () => E.projectFile.exportProject(p.id) },
        { label: 'Excluir projeto', icon: 'trash', danger: true, onClick: () => deleteProject(p) },
      ]);
    });
    el.appendChild(menuBtn);

    el.addEventListener('click', (e) => {
      if (e.target.closest('select, button')) return;
      E.app.openProject(p.id);
    });
    return el;
  }

  async function renameProject(p) {
    const vals = await E.ui.modal({
      title: 'Renomear projeto',
      fields: [{ name: 'name', label: 'Nome', value: p.name }],
    });
    if (vals === null || !vals.name.trim()) return;
    p.name = vals.name.trim();
    p.updatedAt = Date.now();
    await E.db.put('projects', p);
    render();
  }

  async function deleteProject(p) {
    const ok = await E.ui.confirm(
      'Excluir "' + p.name + '"?',
      'O projeto e tudo que está no canvas dele serão apagados. Essa ação não tem volta.',
      'Excluir'
    );
    if (!ok) return;
    const list = await E.db.itemsByProject(p.id);
    for (const it of list) await E.db.del('items', it.id);
    await E.db.del('projects', p.id);
    E.ui.toast('Projeto excluído');
    render();
  }

  /* ---------- arrastar pasta do computador = novo projeto vinculado ----------
     Nada é copiado: o projeto usa o CAMINHO real da pasta. Os arquivos ficam
     organizados no explorador embutido — só vira card o que o usuário puxar. */

  galleryView.addEventListener('dragover', (e) => e.preventDefault());
  galleryView.addEventListener('drop', async (e) => {
    e.preventDefault();
    // snapshot síncrono — o dataTransfer só vale durante o evento
    const dirs = [...e.dataTransfer.items]
      .map((it) => ({
        dir: !!(it.webkitGetAsEntry && it.webkitGetAsEntry() && it.webkitGetAsEntry().isDirectory),
        file: it.getAsFile ? it.getAsFile() : null,
      }))
      .filter((d) => d.dir && d.file);
    if (!dirs.length) return;
    for (const d of dirs) await projectFromFolder(d.file);
  });

  async function projectFromFolder(file) {
    const abs = E.files.pathForFile(file);
    if (!abs) {
      E.ui.toast('Criar projeto arrastando pasta precisa do app Livrai (desktop)');
      return;
    }
    const linked = await E.files.linkPath(abs);
    if (!linked) {
      E.ui.toast('⚠️ Não consegui vincular a pasta');
      return;
    }
    await createProjectFromLinked(linked);
  }

  async function createProjectFromLinked(linked) {
    // a mesma pasta não vira dois projetos — abre o que já existe
    const all = await E.db.getAll('projects');
    const dup = all.find((p) => p.linkedFolder === linked.path);
    if (dup) {
      E.ui.toast('"' + dup.name + '" já usa essa pasta — abrindo');
      E.app.openProject(dup.id);
      return;
    }

    const now = Date.now();
    const boardId = 'b-' + E.uid().slice(0, 8);
    const p = {
      id: E.uid(),
      name: linked.name,
      type: 'outro',
      clientId: null,
      stage: 'ideia',
      createdAt: now,
      updatedAt: now,
      linkedFolder: linked.path,
      boards: [{ id: boardId, name: 'Principal' }],
    };
    await E.db.put('projects', p);

    // o canvas do projeto já nasce com o card da pasta, pronto pra explorar
    await E.db.put('items', {
      id: E.uid(), projectId: p.id, board: boardId, z: 1,
      kind: 'folder', x: -110, y: -66, w: 220, h: 132,
      content: { path: linked.path, name: linked.name },
    });

    // capa automática: primeira imagem encontrada (na pasta ou 1 nível abaixo)
    try {
      const cover = await findCoverImage(linked.path, 0);
      if (cover) {
        const blob = await E.files.readPath(cover);
        p.coverBlobId = await E.db.saveBlob(blob);
        await E.db.put('projects', p);
      }
    } catch (_) {}

    E.ui.toast('Projeto "' + linked.name + '" criado da pasta — nada foi copiado');
    render();
  }

  const COVER_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  async function findCoverImage(dir, depth) {
    if (depth > 1) return null;
    const data = await E.files.browse(dir);
    const img = data.entries.find((en) => !en.dir && COVER_EXTS.indexOf(en.ext) >= 0);
    if (img) return img.path;
    for (const en of data.entries) {
      if (en.dir) {
        const found = await findCoverImage(en.path, depth + 1);
        if (found) return found;
      }
    }
    return null;
  }

  document.getElementById('btn-settings').addEventListener('click', () => E.settings.open());

  E.gallery = { render, setView, importFolder, createProject, assignClient, renameProject, deleteProject };
})();
