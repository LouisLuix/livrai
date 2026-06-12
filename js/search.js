/* Busca dentro do projeto (Cmd+F no canvas): acha card, nota, arquivo ou
   página de Notas em qualquer aba e voa até ele. */
(function () {
  const E = window.Estudio;
  E.search = {};

  const KIND_LABEL = {
    note: 'Nota', label: 'Título', image: 'Imagem', video: 'Vídeo', audio: 'Áudio',
    link: 'Link', color: 'Cor', post: 'Post', frame: 'Prancha', flownode: 'Fluxo',
    gen: 'Gerador', file: 'Arquivo', folder: 'Pasta',
  };
  const KIND_ICON = {
    note: 'note', label: 'type', image: 'image', video: 'film', audio: 'audio',
    link: 'link', color: 'droplet', post: 'calendar', frame: 'frame', flownode: 'flow',
    gen: 'sparkles', file: 'copy', folder: 'folder',
  };

  let active = -1;
  let results = [];

  function itemText(it) {
    const c = it.content || {};
    return [c.text, c.name, c.title, c.url, c.hex].filter(Boolean).join(' ');
  }

  function overlayRoot() {
    let el = document.getElementById('search-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'search-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function isOpen() {
    return !!overlayRoot().firstChild;
  }

  function close() {
    overlayRoot().innerHTML = '';
    results = [];
    active = -1;
  }
  E.search.close = close;

  function boardName(project, boardId) {
    const b = (project.boards || []).find((x) => x.id === boardId);
    return b ? b.name : '';
  }

  function collect(query) {
    const q = query.toLowerCase();
    const st = E.canvas.getState();
    const project = st.project;
    const out = [];

    E.canvas.getAllItems().forEach((it) => {
      if (it.kind === 'gen') return;
      const text = itemText(it);
      if (!text || text.toLowerCase().indexOf(q) < 0) return;
      out.push({
        type: 'item',
        id: it.id,
        icon: KIND_ICON[it.kind] || 'copy',
        label: text.replace(/\n/g, ' ').slice(0, 70),
        meta: (KIND_LABEL[it.kind] || 'Item') + ' · aba ' + boardName(project, it.board),
      });
    });

    const pages = (project.notes && project.notes.pages) || [];
    pages.forEach((pg) => {
      const text = (pg.title || '') + ' ' + (pg.blocks || []).map((b) => b.text || '').join(' ');
      if (text.toLowerCase().indexOf(q) < 0) return;
      out.push({
        type: 'page',
        id: pg.id,
        icon: 'note',
        label: pg.title || 'Sem título',
        meta: 'página de Notas',
      });
    });

    return out.slice(0, 30);
  }

  function openResult(r) {
    close();
    if (r.type === 'page') E.notes.openPage(r.id);
    else E.canvas.focusItem(r.id);
  }

  E.search.open = function () {
    if (!E.canvas.isOpen() || isOpen()) return;
    const root = overlayRoot();
    root.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'search-wrap';
    const box = document.createElement('div');
    box.className = 'search-box';
    wrap.appendChild(box);
    root.appendChild(wrap);

    wrap.addEventListener('pointerdown', (e) => {
      if (e.target === wrap) close();
    });

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'search-input';
    input.placeholder = 'Buscar neste projeto — card, nota, arquivo, página…';
    input.spellcheck = false;
    box.appendChild(input);

    const list = document.createElement('div');
    list.className = 'search-results';
    box.appendChild(list);

    function renderResults() {
      list.innerHTML = '';
      results.forEach((r, i) => {
        const row = document.createElement('button');
        row.className = 'search-row' + (i === active ? ' active' : '');
        row.innerHTML =
          E.icon(r.icon, 14) +
          '<span class="search-label">' + E.escapeHtml(r.label) + '</span>' +
          '<span class="search-meta mono">' + E.escapeHtml(r.meta) + '</span>';
        row.addEventListener('click', () => openResult(r));
        list.appendChild(row);
      });
      if (input.value.trim() && !results.length) {
        list.innerHTML = '<p class="search-empty">Nada com esse nome por aqui.</p>';
      }
    }

    input.addEventListener('input', () => {
      const q = input.value.trim();
      results = q ? collect(q) : [];
      active = results.length ? 0 : -1;
      renderResults();
    });

    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (results.length) {
          active = (active + 1) % results.length;
          renderResults();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length) {
          active = (active - 1 + results.length) % results.length;
          renderResults();
        }
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        openResult(results[active]);
      }
    });

    input.focus();
  };

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && (e.key === 'f' || e.key === 'F') && E.canvas.isOpen() && !E.state.editing) {
      e.preventDefault();
      E.search.open();
    }
  });
})();
