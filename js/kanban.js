/* Kanban: projetos em colunas por fase da entrega, com arrasto fluido */
(function () {
  const E = window.Estudio;

  const DRAG_THRESHOLD = 6; // px antes de virar arrasto (abaixo disso é clique)

  function render(container, projects) {
    container.innerHTML = '';
    const byStage = {};
    projects.forEach((p) => {
      const k = p.stage || 'ideia';
      (byStage[k] = byStage[k] || []).push(p);
    });

    E.STAGES.forEach((stage, i) => {
      const col = document.createElement('div');
      col.className = 'kb-col';
      col.dataset.stage = stage.id;
      col.style.setProperty('--i', i);

      const head = document.createElement('div');
      head.className = 'kb-col-head';
      const dot = document.createElement('span');
      dot.className = 'stage-dot';
      dot.style.background = stage.color;
      const title = document.createElement('span');
      title.className = 'kb-col-title';
      title.textContent = stage.label;
      const count = document.createElement('span');
      count.className = 'kb-col-count';
      count.textContent = (byStage[stage.id] || []).length;
      head.appendChild(dot);
      head.appendChild(title);
      head.appendChild(count);
      col.appendChild(head);

      const body = document.createElement('div');
      body.className = 'kb-col-body';
      const list = byStage[stage.id] || [];
      if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'kb-empty';
        empty.textContent = 'Solte um projeto aqui';
        body.appendChild(empty);
      }
      list.forEach((p) => body.appendChild(card(p)));
      col.appendChild(body);
      container.appendChild(col);
    });
  }

  function card(p) {
    const type = E.typeById(p.type);
    const el = document.createElement('div');
    el.className = 'kb-card';
    el.dataset.id = p.id;

    if (p.coverBlobId) {
      const img = document.createElement('img');
      img.className = 'kb-card-thumb';
      img.alt = '';
      img.draggable = false;
      E.db.blobUrl(p.coverBlobId).then((u) => {
        if (u) img.src = u;
      });
      el.appendChild(img);
    }

    const name = document.createElement('div');
    name.className = 'kb-card-name';
    name.textContent = p.name;
    el.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'kb-card-meta';
    meta.insertAdjacentHTML('beforeend', E.icon(type.icon, 12));
    const tl = document.createElement('span');
    tl.textContent = type.label;
    meta.appendChild(tl);
    const client = E.clients.byId(p.clientId);
    if (client) {
      const cl = document.createElement('span');
      cl.className = 'kb-card-client';
      cl.textContent = '· ' + client.name;
      meta.appendChild(cl);
    }
    el.appendChild(meta);

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      E.ui.menu(e.clientX, e.clientY, [
        { label: 'Abrir projeto', icon: 'arrow-up-right', onClick: () => E.app.openProject(p.id) },
        { label: 'Renomear', icon: 'pencil', onClick: () => E.gallery.renameProject(p) },
        { label: 'Cliente…', icon: 'user', onClick: () => E.gallery.assignClient(p) },
        { label: 'Excluir projeto', icon: 'trash', danger: true, onClick: () => E.gallery.deleteProject(p) },
      ]);
    });

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      startPointer(e, el, p);
    });
    return el;
  }

  /* ---------- arrasto com clone flutuante ---------- */

  function startPointer(e, el, p) {
    const startX = e.clientX;
    const startY = e.clientY;
    let ghost = null;
    let dragging = false;
    let hoverCol = null;
    const rect = el.getBoundingClientRect();
    const offX = startX - rect.left;
    const offY = startY - rect.top;

    function onMove(ev) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      if (!dragging) {
        dragging = true;
        ghost = el.cloneNode(true);
        ghost.classList.add('kb-ghost');
        ghost.style.width = rect.width + 'px';
        document.body.appendChild(ghost);
        el.classList.add('lifting');
        document.body.classList.add('kb-dragging');
      }
      ghost.style.left = ev.clientX - offX + 'px';
      ghost.style.top = ev.clientY - offY + 'px';

      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const col = under ? under.closest('.kb-col') : null;
      if (col !== hoverCol) {
        if (hoverCol) hoverCol.classList.remove('drop-target');
        hoverCol = col;
        if (hoverCol) hoverCol.classList.add('drop-target');
      }
    }

    async function onUp(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);

      if (!dragging) {
        // foi um clique simples: abre o projeto
        if (!ev.target.closest('button')) E.app.openProject(p.id);
        return;
      }
      cleanupVisual();
      const stage = hoverCol ? hoverCol.dataset.stage : null;
      if (hoverCol) hoverCol.classList.remove('drop-target');
      if (stage && stage !== p.stage) {
        await E.db.put(
          'projects',
          Object.assign({}, p, { stage, updatedAt: Date.now() })
        );
        E.ui.toast('Movido pra ' + E.stageById(stage).label);
      }
      E.gallery.render();
    }

    function onKey(ev) {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onKey, true);
      if (hoverCol) hoverCol.classList.remove('drop-target');
      cleanupVisual();
    }

    function cleanupVisual() {
      if (ghost) ghost.remove();
      el.classList.remove('lifting');
      document.body.classList.remove('kb-dragging');
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onKey, true);
  }

  E.kanban = { render };
})();
