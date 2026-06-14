/* Inicialização e navegação entre galeria e canvas.
   O menu principal (topbar) é casca fixa: nunca some. Os projetos abertos
   viram abas na faixa #project-tabs, logo abaixo do menu — dá pra ter vários
   abertos e pular entre eles, e a faixa continua visível na galeria
   (Universo/Grade/Kanban) pra voltar pra dentro com um clique. */
(function () {
  const E = window.Estudio;
  const galleryView = document.getElementById('gallery-view');
  const canvasView = document.getElementById('canvas-view');
  const tabsEl = document.getElementById('project-tabs');

  const openTabs = []; // [{ id, name }] projetos abertos, na ordem das abas
  let loadedId = null; // projeto carregado no canvas (vivo na memória)
  let mode = 'gallery'; // 'gallery' | 'canvas'
  let tabsCollapsed = localStorage.getItem('estudio-tabs-collapsed') === '1'; // faixa retraída?

  async function openProject(id) {
    const project = await E.db.get('projects', id);
    if (!project) {
      E.ui.toast('Projeto não encontrado');
      return;
    }
    const tab = openTabs.find((t) => t.id === id);
    if (tab) tab.name = project.name;
    else openTabs.push({ id: id, name: project.name });

    // já carregado? só reexibe — preserva zoom/itens sem recarregar do disco
    if (loadedId !== id) {
      const items = await E.db.itemsByProject(id);
      E.canvas.open(project, items);
      loadedId = id;
    }
    mode = 'canvas';
    galleryView.classList.add('hidden');
    canvasView.classList.remove('hidden');
    renderTabs();
  }

  /* troca o conteúdo pra galeria sem mexer nas abas nem recarregar a grade */
  function enterGallery() {
    mode = 'gallery';
    canvasView.classList.add('hidden');
    galleryView.classList.remove('hidden');
    renderTabs();
  }

  function showGallery() {
    enterGallery();
    E.gallery.render();
  }

  function closeTab(id) {
    const i = openTabs.findIndex((t) => t.id === id);
    if (i < 0) return;
    openTabs.splice(i, 1);
    if (loadedId === id) {
      E.canvas.close();
      loadedId = null;
    }
    // fechou o que estava aberto: abre um vizinho ou cai na galeria
    if (mode === 'canvas') {
      const next = openTabs[Math.min(i, openTabs.length - 1)];
      if (next) {
        openProject(next.id);
        return;
      }
      showGallery();
      return;
    }
    renderTabs();
  }

  function setTabName(id, name) {
    const tab = openTabs.find((t) => t.id === id);
    if (tab && name) {
      tab.name = name;
      renderTabs();
    }
  }

  function renderTabs() {
    document.body.classList.toggle('in-project', mode === 'canvas');
    if (!openTabs.length) {
      tabsEl.classList.add('hidden');
      tabsEl.innerHTML = '';
      return;
    }
    tabsEl.classList.remove('hidden');
    tabsEl.classList.toggle('collapsed', tabsCollapsed);
    tabsEl.innerHTML = '';

    const list = document.createElement('div');
    list.className = 'proj-tabs-list';
    openTabs.forEach((t) => {
      const el = document.createElement('button');
      el.className = 'proj-tab' + (mode === 'canvas' && t.id === loadedId ? ' active' : '');
      el.title = t.name;
      const dot = document.createElement('span');
      dot.className = 'proj-tab-dot';
      el.appendChild(dot);
      const nm = document.createElement('span');
      nm.className = 'proj-tab-name';
      nm.textContent = t.name;
      el.appendChild(nm);
      const x = document.createElement('span');
      x.className = 'proj-tab-close';
      x.innerHTML = E.icon('close', 11);
      x.title = 'Fechar projeto';
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeTab(t.id);
      });
      el.appendChild(x);
      el.addEventListener('click', () => openProject(t.id));
      list.appendChild(el);
    });
    tabsEl.appendChild(list);

    // alça discreta pra recolher/mostrar a faixa (recolhe pra cima)
    const toggle = document.createElement('button');
    toggle.className = 'proj-tabs-toggle' + (tabsCollapsed ? '' : ' up');
    toggle.title = tabsCollapsed
      ? 'Mostrar projetos abertos (' + openTabs.length + ')'
      : 'Recolher projetos abertos';
    toggle.innerHTML = E.icon('chevron-down', 13);
    toggle.addEventListener('click', () => {
      tabsCollapsed = !tabsCollapsed;
      localStorage.setItem('estudio-tabs-collapsed', tabsCollapsed ? '1' : '0');
      renderTabs();
    });
    tabsEl.appendChild(toggle);
  }

  document.getElementById('btn-back').addEventListener('click', showGallery);

  /* Primeiro uso: cria um projeto de boas-vindas mostrando como tudo funciona */
  async function seed() {
    const now = Date.now();
    const pid = E.uid();
    const project = {
      id: pid,
      name: 'Bem-vindo ao seu Estúdio',
      type: 'outro',
      stage: 'ideia',
      createdAt: now,
      updatedAt: now,
    };
    await E.db.put('projects', project);

    const mk = (kind, x, y, w, h, content, z) =>
      E.db.put('items', { id: E.uid(), projectId: pid, kind, x, y, w, h, z: z || 1, content });

    await mk('label', 0, -90, 520, 56, { text: 'SEU ESTÚDIO' });
    await mk('note', 0, 0, 360, 330, {
      text:
        'Como usar este canvas:\n\n' +
        '• Arraste imagens da sua pasta direto pra cá\n' +
        '• Cmd+V cola imagens e textos copiados\n' +
        '• Dois cliques no fundo criam uma nota\n' +
        '• Dois cliques num item editam ele\n' +
        '• Arrastar no fundo seleciona vários itens\n' +
        '• Dois dedos no trackpad movem o canvas\n' +
        '• Espaço + arrastar também move o canvas\n' +
        '• Cmd + scroll (ou pinça) dá zoom\n' +
        '• Cmd+C / Cmd+V copia ENTRE projetos\n' +
        '• Botão direito abre mais opções (e edição com IA)',
    });
    await mk('note', 400, 0, 300, 170, {
      text:
        'Pra clientes fixos (marca, bar, social media):\n\nUse Criar > Post — cada card tem data e status. Clique no status pra avançar: Ideia, Roteiro, Gravado, Editado, Postado.',
    });
    await mk('post', 400, 200, 240, 150, {
      text: 'Vídeo: bastidores da produção',
      date: '',
      status: 'ideia',
    });
    await mk('label', 0, 380, 420, 44, { text: 'Sua paleta' });
    await mk('color', 0, 450, 120, 120, { hex: '#a78bfa' });
    await mk('color', 140, 450, 120, 120, { hex: '#fbbf24' });
    await mk('color', 280, 450, 120, 120, { hex: '#34d399' });
  }

  /* Limpeza: apaga imagens que não pertencem mais a nenhum item, capa,
     versão guardada ou exclusão na lixeira */
  async function gcBlobs() {
    const [blobs, items, projects, trash] = await Promise.all([
      E.db.getAll('blobs'),
      E.db.getAll('items'),
      E.db.getAll('projects'),
      E.db.getAll('trash'),
    ]);
    const used = new Set();
    const markItem = (it) => {
      if (it.content && it.content.blobId) used.add(it.content.blobId);
      if (it.content && it.content.sceneBlobId) used.add(it.content.sceneBlobId);
      if (it.content && Array.isArray(it.content.media)) {
        it.content.media.forEach((m) => m.blobId && used.add(m.blobId));
      }
      if (it.content && Array.isArray(it.content.versions)) {
        it.content.versions.forEach((v) => v.blobId && used.add(v.blobId));
      }
    };
    items.forEach(markItem);
    trash.forEach((t) => t.item && markItem(t.item));
    projects.forEach((p) => {
      if (p.coverBlobId) used.add(p.coverBlobId);
      const b = p.brand;
      if (b) {
        if (b.logoBlobId) used.add(b.logoBlobId);
        if (b.fontBlobId) used.add(b.fontBlobId);
        (b.productRefs || []).forEach((id) => used.add(id));
        (b.entities || []).forEach((en) => (en.refs || []).forEach((id) => used.add(id)));
      }
      // imagens coladas dentro das Notas (blocos de imagem)
      if (p.notes && Array.isArray(p.notes.pages)) {
        p.notes.pages.forEach((pg) =>
          (pg.blocks || []).forEach((bl) => bl && bl.blobId && used.add(bl.blobId))
        );
      }
    });
    for (const b of blobs) {
      if (!used.has(b.id)) await E.db.del('blobs', b.id);
    }
  }

  /* Lixeira: o que passou de 30 dias vai embora de vez */
  async function purgeTrash() {
    const limit = Date.now() - 30 * 86400e3;
    const trash = await E.db.getAll('trash');
    for (const t of trash) {
      if ((t.deletedAt || 0) < limit) await E.db.del('trash', t.id);
    }
  }

  function hideSplash() {
    const el = document.getElementById('splash');
    if (!el) return;
    const shown = performance.now();
    setTimeout(() => {
      el.classList.add('hide');
      setTimeout(() => el.remove(), 700);
    }, Math.max(0, 1250 - shown));
  }

  /* App desktop: a versão anterior guardava os projetos noutra origem.
     O Livrai exporta uma única vez e deixa em /__migration — importamos aqui. */
  async function consumeDesktopMigration() {
    if (location.protocol !== 'http:') return;
    try {
      const r = await fetch('/__migration', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      if (data && Array.isArray(data.projects) && data.projects.length && E.sync) {
        await E.sync.applyData(data);
        E.ui.toast('Seus projetos da versão anterior foram migrados');
      }
      fetch('/__migration?done=1').catch(() => {});
    } catch (_) {}
  }

  async function boot() {
    try {
      if (E.ai && E.ai.initSecrets) await E.ai.initSecrets();
      let projects = await E.db.getAll('projects');
      if (!projects.length) {
        await consumeDesktopMigration();
        projects = await E.db.getAll('projects');
      }
      if (!projects.length) await seed();
      showGallery();
      hideSplash();
      if (E.sync) {
        E.sync.init();
        setTimeout(() => E.sync.firstRunPrompt(), 1600);
      }
      if (E.updates) setTimeout(() => E.updates.check(), 4000);
      if (E.news) setTimeout(() => E.news.check(), 5000);
      if (E.account) E.account.init();
      if (E.cloudsync) E.cloudsync.init();
      purgeTrash().then(() => gcBlobs()).catch(() => {});
    } catch (err) {
      console.error(err);
      const sp = document.getElementById('splash');
      if (sp) sp.remove();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div class="boot-error">Não consegui acessar o armazenamento local do navegador. ' +
          'Tente abrir no Chrome e verifique se a navegação anônima está desativada.</div>'
      );
    }
  }

  E.app = { openProject, showGallery, enterGallery, setTabName, closeProject: closeTab };
  boot();
})();
