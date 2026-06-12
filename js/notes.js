/* Notas: painel lateral estilo Notion — páginas + blocos editáveis.
   Blocos: texto, título, subtítulo, lista, tarefa (checkbox) e divisor.
   Atalhos no começo da linha: "# " título · "## " subtítulo · "- " lista · "[] " tarefa */
(function () {
  const E = window.Estudio;
  const panel = document.getElementById('notes-panel');
  const content = panel.querySelector('.panel-content');
  E.ui.initPanelResize(panel, 'estudio-notes-w');

  const BLOCK_TYPES = [
    { id: 'p', label: 'Texto', icon: 'type' },
    { id: 'h1', label: 'Título', icon: 'type' },
    { id: 'h2', label: 'Subtítulo', icon: 'type' },
    { id: 'li', label: 'Lista', icon: 'more' },
    { id: 'todo', label: 'Tarefa', icon: 'check' },
    { id: 'divider', label: 'Divisor', icon: 'minus' },
  ];

  let project = null;
  let pageId = null;

  const save = E.debounce(async () => {
    if (!project) return;
    const page = currentPage();
    if (page) page.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await E.db.put('projects', project);
    // cards do canvas vinculados a esta página se atualizam na hora
    if (page && E.canvas && E.canvas.refreshNoteCards) E.canvas.refreshNoteCards(page.id);
  }, 400);

  function isOpen() {
    return !panel.classList.contains('hidden');
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function mkBlock(type, text) {
    return { id: 'b-' + E.uid().slice(0, 8), type: type || 'p', text: text || '', checked: false };
  }

  function mkPage(title) {
    return {
      id: 'pg-' + E.uid().slice(0, 8),
      title: title || '',
      blocks: [mkBlock('p', '')],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function open() {
    const st = E.canvas.isOpen() ? E.canvas.getState() : null;
    if (!st || !st.project) return;
    project = st.project;
    if (!project.notes) project.notes = {};
    if (!Array.isArray(project.notes.pages)) project.notes.pages = [];
    if (!project.notes.pages.length) {
      project.notes.pages.push(mkPage('Anotações'));
      save();
    }
    pageId = project.notes.lastPageId;
    if (!currentPage()) pageId = project.notes.pages[0].id;

    if (E.schedule && E.schedule.isOpen()) E.schedule.close();
    if (E.brand && E.brand.isOpen()) E.brand.close();
    panel.classList.remove('hidden');
    E.ui.applyPanelWidth(panel, 'estudio-notes-w');
    document.getElementById('tool-notes').classList.add('active');
    render();
  }

  function close() {
    if (project) save();
    panel.classList.add('hidden');
    document.getElementById('tool-notes').classList.remove('active');
    project = null;
  }

  function currentPage() {
    if (!project || !project.notes) return null;
    return project.notes.pages.find((p) => p.id === pageId) || null;
  }

  /* ---------- render ---------- */

  function render() {
    const page = currentPage();
    content.innerHTML = '';

    // cabeçalho
    const head = document.createElement('div');
    head.className = 'sched-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.innerHTML = E.icon('note', 17) + '<span>Notas</span>';
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost';
    closeBtn.innerHTML = E.icon('close', 16);
    closeBtn.title = 'Fechar notas';
    closeBtn.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(spacer);
    head.appendChild(closeBtn);
    content.appendChild(head);

    // lista de páginas (organização à la Notion)
    const pagesEl = document.createElement('div');
    pagesEl.className = 'notes-pages';
    project.notes.pages.forEach((pg) => {
      const row = document.createElement('button');
      row.className = 'notes-page-row' + (pg.id === pageId ? ' active' : '');
      row.innerHTML = E.icon('note', 13);
      const t = document.createElement('span');
      t.textContent = pg.title || 'Sem título';
      row.appendChild(t);
      row.addEventListener('click', () => {
        pageId = pg.id;
        project.notes.lastPageId = pg.id;
        save();
        render();
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        pageMenu(e.clientX, e.clientY, pg);
      });
      pagesEl.appendChild(row);
    });
    const addPage = document.createElement('button');
    addPage.className = 'notes-page-row notes-page-add';
    addPage.innerHTML = E.icon('plus', 13);
    const at = document.createElement('span');
    at.textContent = 'Nova página';
    addPage.appendChild(at);
    addPage.addEventListener('click', () => {
      const pg = mkPage('');
      project.notes.pages.push(pg);
      pageId = pg.id;
      project.notes.lastPageId = pg.id;
      save();
      render();
      const ti = content.querySelector('.notes-title');
      if (ti) ti.focus();
    });
    pagesEl.appendChild(addPage);
    content.appendChild(pagesEl);

    if (!page) return;

    // editor
    const editor = document.createElement('div');
    editor.className = 'notes-editor';

    const titleInput = document.createElement('input');
    titleInput.className = 'notes-title';
    titleInput.placeholder = 'Sem título';
    titleInput.value = page.title;
    titleInput.spellcheck = false;
    titleInput.addEventListener('input', () => {
      page.title = titleInput.value;
      const row = pagesEl.querySelector('.notes-page-row.active span');
      if (row) row.textContent = page.title || 'Sem título';
      save();
    });
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = editor.querySelector('.nblock-text');
        if (first) first.focus();
      }
    });
    editor.appendChild(titleInput);

    const blocksEl = document.createElement('div');
    blocksEl.className = 'notes-blocks';
    page.blocks.forEach((b) => blocksEl.appendChild(blockEl(page, b)));
    editor.appendChild(blocksEl);

    // clicar no vazio abaixo dos blocos cria/foca o último bloco
    editor.addEventListener('pointerdown', (e) => {
      if (e.target !== editor) return;
      const last = page.blocks[page.blocks.length - 1];
      if (!last || (last.text && last.type !== 'divider')) {
        const nb = mkBlock('p', '');
        page.blocks.push(nb);
        blocksEl.appendChild(blockEl(page, nb));
        save();
      }
      const texts = blocksEl.querySelectorAll('.nblock-text');
      if (texts.length) {
        e.preventDefault();
        texts[texts.length - 1].focus();
      }
    });

    content.appendChild(editor);
  }

  function pageMenu(x, y, pg) {
    E.ui.menu(x, y, [
      {
        label: 'Duplicar página',
        icon: 'copy',
        onClick: () => {
          const copy = mkPage((pg.title || 'Sem título') + ' (cópia)');
          copy.blocks = pg.blocks.map((b) => Object.assign(mkBlock(b.type, b.text), { checked: b.checked }));
          project.notes.pages.push(copy);
          pageId = copy.id;
          save();
          render();
        },
      },
      {
        label: 'Excluir página',
        icon: 'trash',
        danger: true,
        onClick: async () => {
          const ok = await E.ui.confirm(
            'Excluir "' + (pg.title || 'Sem título') + '"?',
            'Os blocos desta página serão apagados.',
            'Excluir'
          );
          if (!ok) return;
          project.notes.pages = project.notes.pages.filter((p) => p.id !== pg.id);
          if (!project.notes.pages.length) project.notes.pages.push(mkPage('Anotações'));
          if (pageId === pg.id) pageId = project.notes.pages[0].id;
          project.notes.lastPageId = pageId;
          save();
          render();
        },
      },
    ]);
  }

  /* ---------- blocos ---------- */

  function blockEl(page, b) {
    const wrap = document.createElement('div');
    wrap.className = 'nblock nblock-' + b.type + (b.checked ? ' done' : '');
    wrap.dataset.id = b.id;

    const handle = document.createElement('button');
    handle.className = 'nblock-handle';
    handle.innerHTML = E.icon('plus', 13);
    handle.title = 'Mudar tipo, inserir ou excluir';
    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      const entries = BLOCK_TYPES.map((t) => ({
        label: t.label,
        icon: t.icon,
        onClick: () => convertBlock(page, b, wrap, t.id),
      }));
      entries.push({
        label: 'Inserir bloco abaixo',
        icon: 'plus',
        onClick: () => insertAfter(page, b, wrap),
      });
      entries.push({
        label: 'Excluir bloco',
        icon: 'trash',
        danger: true,
        onClick: () => removeBlock(page, b, wrap, true),
      });
      const r = handle.getBoundingClientRect();
      E.ui.menu(r.left, r.bottom + 4, entries);
    });
    wrap.appendChild(handle);

    if (b.type === 'divider') {
      const hr = document.createElement('div');
      hr.className = 'nblock-hr';
      wrap.appendChild(hr);
      return wrap;
    }

    if (b.type === 'todo') {
      const cb = document.createElement('button');
      cb.className = 'nblock-check';
      cb.innerHTML = b.checked ? E.icon('check', 12) : '';
      cb.title = 'Concluir tarefa';
      cb.addEventListener('click', () => {
        b.checked = !b.checked;
        cb.innerHTML = b.checked ? E.icon('check', 12) : '';
        wrap.classList.toggle('done', b.checked);
        save();
      });
      wrap.appendChild(cb);
    } else if (b.type === 'li') {
      const dot = document.createElement('span');
      dot.className = 'nblock-bullet';
      wrap.appendChild(dot);
    }

    const text = document.createElement('div');
    text.className = 'nblock-text';
    text.contentEditable = 'plaintext-only';
    if (text.contentEditable !== 'plaintext-only') text.contentEditable = 'true';
    text.spellcheck = false;
    text.textContent = b.text;
    text.dataset.placeholder =
      b.type === 'h1' ? 'Título' : b.type === 'h2' ? 'Subtítulo' : b.type === 'todo' ? 'Tarefa' : 'Escreva algo…';

    text.addEventListener('input', () => {
      b.text = text.textContent;
      // atalhos de conversão no começo da linha
      const conv =
        b.text.indexOf('## ') === 0 ? 'h2' :
        b.text.indexOf('# ') === 0 ? 'h1' :
        b.text.indexOf('- ') === 0 ? 'li' :
        b.text.indexOf('[] ') === 0 ? 'todo' : null;
      if (conv && b.type === 'p') {
        b.text = b.text.replace(/^(##\s|#\s|-\s|\[\]\s)/, '');
        convertBlock(page, b, wrap, conv);
        return;
      }
      save();
    });

    text.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        // lista/tarefa continuam o tipo; vazio volta pra texto
        const keep = (b.type === 'li' || b.type === 'todo') && b.text !== '';
        if ((b.type === 'li' || b.type === 'todo') && b.text === '') {
          convertBlock(page, b, wrap, 'p');
          return;
        }
        insertAfter(page, b, wrap, keep ? b.type : 'p');
      } else if (e.key === 'Backspace' && b.text === '') {
        e.preventDefault();
        removeBlock(page, b, wrap, false);
      } else if (e.key === 'ArrowUp' && window.getSelection().anchorOffset === 0) {
        const prev = wrap.previousElementSibling;
        const pt = prev && prev.querySelector('.nblock-text');
        if (pt) {
          e.preventDefault();
          focusEnd(pt);
        }
      } else if (e.key === 'ArrowDown' && window.getSelection().anchorOffset >= b.text.length) {
        const next = wrap.nextElementSibling;
        const nt = next && next.querySelector('.nblock-text');
        if (nt) {
          e.preventDefault();
          focusEnd(nt);
        }
      }
    });

    wrap.appendChild(text);
    return wrap;
  }

  function focusEnd(el) {
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function convertBlock(page, b, wrap, type) {
    b.type = type;
    if (type !== 'todo') b.checked = false;
    const fresh = blockEl(page, b);
    wrap.replaceWith(fresh);
    const t = fresh.querySelector('.nblock-text');
    if (t) focusEnd(t);
    save();
  }

  function insertAfter(page, b, wrap, type) {
    const idx = page.blocks.findIndex((x) => x.id === b.id);
    const nb = mkBlock(type || 'p', '');
    page.blocks.splice(idx + 1, 0, nb);
    const fresh = blockEl(page, nb);
    wrap.after(fresh);
    const t = fresh.querySelector('.nblock-text');
    if (t) t.focus();
    save();
  }

  function removeBlock(page, b, wrap, force) {
    const idx = page.blocks.findIndex((x) => x.id === b.id);
    if (page.blocks.length === 1 && !force) return; // sempre sobra um bloco
    page.blocks = page.blocks.filter((x) => x.id !== b.id);
    if (!page.blocks.length) {
      const nb = mkBlock('p', '');
      page.blocks.push(nb);
      wrap.replaceWith(blockEl(page, nb));
      save();
      return;
    }
    const prev = wrap.previousElementSibling;
    wrap.remove();
    const pt = prev && prev.querySelector('.nblock-text');
    if (pt) focusEnd(pt);
    save();
  }

  document.getElementById('tool-notes').addEventListener('click', toggle);

  /* ---------- ponte com os cards de nota do canvas ---------- */

  /* Abre o painel já na página pedida (cards vinculados usam no duplo clique) */
  function openPage(id) {
    if (!isOpen()) open();
    if (!project) return;
    if (project.notes.pages.some((p) => p.id === id)) {
      pageId = id;
      project.notes.lastPageId = id;
      save();
      render();
    }
  }

  /* Re-renderiza o painel se a página estiver visível (ex.: tarefa marcada no card) */
  function refreshPage(id) {
    if (isOpen() && project && pageId === id) render();
  }

  /* Texto de card (sintaxe markdown-lite) → página de Notas */
  function pageFromText(text) {
    const lines = String(text || '').split('\n');
    let title = '';
    const blocks = [];
    lines.forEach((line) => {
      const todo = line.match(/^\[(x|X| )?\]\s?(.*)$/);
      if (!title && line.indexOf('# ') === 0) {
        title = line.slice(2).trim();
        return;
      }
      if (/^---+\s*$/.test(line)) blocks.push(mkBlock('divider', ''));
      else if (line.indexOf('## ') === 0) blocks.push(mkBlock('h2', line.slice(3)));
      else if (line.indexOf('# ') === 0) blocks.push(mkBlock('h1', line.slice(2)));
      else if (line.indexOf('- ') === 0) blocks.push(mkBlock('li', line.slice(2)));
      else if (todo) {
        blocks.push(Object.assign(mkBlock('todo', todo[2]), { checked: (todo[1] || '').toLowerCase() === 'x' }));
      } else if (line.trim()) blocks.push(mkBlock('p', line));
    });
    if (!title && blocks.length && blocks[0].type === 'p') {
      title = blocks[0].text.trim().slice(0, 60);
      blocks.shift();
    }
    const page = mkPage(title);
    if (blocks.length) page.blocks = blocks;
    return page;
  }

  /* Página de Notas → texto de card (pra desvincular sem perder nada) */
  function pageToText(page) {
    const lines = [];
    if (page.title) lines.push('# ' + page.title);
    (page.blocks || []).forEach((b) => {
      if (b.type === 'divider') lines.push('---');
      else if (b.type === 'h1') lines.push('# ' + b.text);
      else if (b.type === 'h2') lines.push('## ' + b.text);
      else if (b.type === 'li') lines.push('- ' + b.text);
      else if (b.type === 'todo') lines.push((b.checked ? '[x] ' : '[] ') + b.text);
      else lines.push(b.text);
    });
    return lines.join('\n');
  }

  E.notes = { toggle, open, close, isOpen, openPage, refreshPage, pageFromText, pageToText };
})();
