/* Inicialização e navegação entre galeria e canvas */
(function () {
  const E = window.Estudio;
  const galleryView = document.getElementById('gallery-view');
  const canvasView = document.getElementById('canvas-view');

  async function openProject(id) {
    const project = await E.db.get('projects', id);
    if (!project) {
      E.ui.toast('Projeto não encontrado');
      return;
    }
    const items = await E.db.itemsByProject(id);
    galleryView.classList.add('hidden');
    canvasView.classList.remove('hidden');
    E.canvas.open(project, items);
  }

  function showGallery() {
    E.canvas.close();
    canvasView.classList.add('hidden');
    galleryView.classList.remove('hidden');
    E.gallery.render();
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

  /* Limpeza: apaga imagens que não pertencem mais a nenhum item ou capa */
  async function gcBlobs() {
    const [blobs, items, projects] = await Promise.all([
      E.db.getAll('blobs'),
      E.db.getAll('items'),
      E.db.getAll('projects'),
    ]);
    const used = new Set();
    items.forEach((it) => {
      if (it.content && it.content.blobId) used.add(it.content.blobId);
      if (it.content && it.content.sceneBlobId) used.add(it.content.sceneBlobId);
      if (it.content && Array.isArray(it.content.media)) {
        it.content.media.forEach((m) => m.blobId && used.add(m.blobId));
      }
    });
    projects.forEach((p) => {
      if (p.coverBlobId) used.add(p.coverBlobId);
      const b = p.brand;
      if (b) {
        if (b.logoBlobId) used.add(b.logoBlobId);
        if (b.fontBlobId) used.add(b.fontBlobId);
        (b.productRefs || []).forEach((id) => used.add(id));
        (b.entities || []).forEach((en) => (en.refs || []).forEach((id) => used.add(id)));
      }
    });
    for (const b of blobs) {
      if (!used.has(b.id)) await E.db.del('blobs', b.id);
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
      if (E.account) E.account.init();
      gcBlobs().catch(() => {});
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

  E.app = { openProject, showGallery };
  boot();
})();
