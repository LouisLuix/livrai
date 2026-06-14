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
    { id: 'h3', label: 'Sub-subtítulo', icon: 'type' },
    { id: 'li', label: 'Lista', icon: 'more' },
    { id: 'todo', label: 'Tarefa', icon: 'check' },
    { id: 'quote', label: 'Citação', icon: 'note' },
    { id: 'callout', label: 'Destaque', icon: 'star' },
    { id: 'code', label: 'Código', icon: 'terminal' },
    { id: 'divider', label: 'Divisor', icon: 'minus' },
  ];

  // larguras pra montar layout lado a lado (documento visual)
  const WIDTHS = [
    { id: 0, label: 'Largura cheia' },
    { id: 66, label: 'Dois terços' },
    { id: 50, label: 'Metade' },
    { id: 33, label: 'Um terço' },
    { id: 25, label: 'Um quarto' },
  ];

  let project = null;
  let pageId = null;
  let dragBlockId = null; // bloco sendo reordenado

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

  function mkImageBlock(blobId) {
    return { id: 'b-' + E.uid().slice(0, 8), type: 'image', blobId: blobId };
  }

  /* ---------- texto rico: markdown é a fonte, o editor mostra formatado ---------- */

  // markdown da linha → HTML pro contentEditable (negrito, itálico, sublinhado,
  // riscado, código, link)
  function mdToHtml(md) {
    return E.inlineFmt ? E.inlineFmt(md || '') : E.escapeHtml(md || '');
  }

  // HTML editado → markdown (serializa só as tags que usamos)
  function htmlToMd(node) {
    let out = '';
    node.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        out += n.nodeValue;
        return;
      }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      const inner = htmlToMd(n);
      if (tag === 'br') out += '\n';
      else if (tag === 'strong' || tag === 'b') out += '**' + inner + '**';
      else if (tag === 'em' || tag === 'i') out += '*' + inner + '*';
      else if (tag === 'u') out += '__' + inner + '__';
      else if (tag === 's' || tag === 'strike' || tag === 'del') out += '~~' + inner + '~~';
      else if (tag === 'code') out += '`' + inner + '`';
      else if (tag === 'a') out += '[' + inner + '](' + (n.getAttribute('href') || '') + ')';
      else out += inner;
    });
    return out.replace(new RegExp(String.fromCharCode(160), "g"), " ");
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
    // reordenar arrastando pela alça
    blocksEl.addEventListener('dragover', (e) => {
      if (!dragBlockId) return;
      e.preventDefault();
      clearDropMarks();
      const before = blockBeforePoint(blocksEl, e.clientX, e.clientY);
      if (before) before.classList.add('drop-before');
    });
    blocksEl.addEventListener('drop', (e) => {
      if (!dragBlockId) return;
      e.preventDefault();
      const before = blockBeforePoint(blocksEl, e.clientX, e.clientY);
      const id = dragBlockId;
      dragBlockId = null;
      clearDropMarks();
      reorderBlock(page, id, before);
    });
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

  function applyBlockWidth(wrap, b) {
    if (b.w && b.w > 0 && b.w < 100) {
      wrap.style.flex = '0 0 calc(' + b.w + '% - 6px)';
      wrap.style.maxWidth = 'calc(' + b.w + '% - 6px)';
    } else {
      wrap.style.flex = '';
      wrap.style.maxWidth = '';
    }
  }

  function openBlockMenu(page, b, wrap, handle) {
    const entries = [];
    if (b.type !== 'image' && b.type !== 'divider') {
      BLOCK_TYPES.forEach((t) =>
        entries.push({ label: t.label, icon: t.icon, onClick: () => convertBlock(page, b, wrap, t.id) })
      );
      entries.push({ separator: true });
    }
    entries.push({ header: 'Largura' });
    WIDTHS.forEach((w) =>
      entries.push({
        label: w.label,
        icon: (b.w || 0) === w.id ? 'check' : 'minus',
        onClick: () => {
          b.w = w.id;
          applyBlockWidth(wrap, b);
          save();
        },
      })
    );
    entries.push({ separator: true });
    entries.push({ label: 'Inserir bloco abaixo', icon: 'plus', onClick: () => insertAfter(page, b, wrap) });
    entries.push({ label: 'Excluir bloco', icon: 'trash', danger: true, onClick: () => removeBlock(page, b, wrap, true) });
    const r = handle.getBoundingClientRect();
    E.ui.menu(r.left, r.bottom + 4, entries);
  }

  function blockEl(page, b) {
    const wrap = document.createElement('div');
    wrap.className = 'nblock nblock-' + b.type + (b.checked ? ' done' : '');
    wrap.dataset.id = b.id;
    applyBlockWidth(wrap, b);

    const handle = document.createElement('button');
    handle.className = 'nblock-handle';
    handle.innerHTML = E.icon('more', 13);
    handle.title = 'Arraste pra reordenar · clique pras opções (tipo, largura…)';
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      dragBlockId = b.id;
      wrap.classList.add('nblock-dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', b.id); } catch (_) {}
    });
    handle.addEventListener('dragend', () => {
      dragBlockId = null;
      wrap.classList.remove('nblock-dragging');
      clearDropMarks();
    });
    handle.addEventListener('click', (e) => {
      e.stopPropagation();
      openBlockMenu(page, b, wrap, handle);
    });
    wrap.appendChild(handle);

    if (b.type === 'image') {
      const fig = document.createElement('div');
      fig.className = 'nblock-image';
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      if (b.blobId) E.db.blobUrl(b.blobId).then((u) => { if (u) img.src = u; });
      fig.appendChild(img);
      const grip = document.createElement('span');
      grip.className = 'nblock-img-resize';
      grip.title = 'Arraste pra redimensionar';
      attachImageResize(grip, wrap, b);
      fig.appendChild(grip);
      wrap.appendChild(fig);
      return wrap;
    }

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
    text.contentEditable = 'true';
    text.spellcheck = false;
    if (b.type === 'code') text.textContent = b.text || '';
    else text.innerHTML = mdToHtml(b.text || '') || '';
    text.dataset.placeholder =
      b.type === 'h1' ? 'Título' :
      b.type === 'h2' ? 'Subtítulo' :
      b.type === 'h3' ? 'Sub-subtítulo' :
      b.type === 'todo' ? 'Tarefa' :
      b.type === 'quote' ? 'Citação' :
      b.type === 'callout' ? 'Destaque' :
      b.type === 'code' ? 'Código' : 'Escreva algo…';

    text.addEventListener('input', () => {
      b.text = b.type === 'code' ? text.textContent : htmlToMd(text);
      // atalhos de conversão no começo do parágrafo
      if (b.type === 'p') {
        const plain = text.textContent;
        const conv =
          plain.indexOf('## ') === 0 ? 'h2' :
          plain.indexOf('### ') === 0 ? 'h3' :
          plain.indexOf('# ') === 0 ? 'h1' :
          plain.indexOf('- ') === 0 ? 'li' :
          plain.indexOf('[] ') === 0 ? 'todo' :
          plain.indexOf('> ') === 0 ? 'quote' : null;
        if (conv) {
          b.text = plain.replace(/^(###\s|##\s|#\s|-\s|\[\]\s|>\s)/, '');
          convertBlock(page, b, wrap, conv);
          return;
        }
      }
      save();
    });

    text.addEventListener('mouseup', () => maybeShowToolbar(text));
    text.addEventListener('keyup', (e) => {
      if (e.shiftKey || e.key === 'Shift' || e.key.indexOf('Arrow') === 0) maybeShowToolbar(text);
    });
    text.addEventListener('blur', () => setTimeout(hideToolbar, 150));

    text.addEventListener('keydown', (e) => {
      // atalhos de formatação (Cmd/Ctrl + B/I/U)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && 'biu'.indexOf(e.key.toLowerCase()) >= 0) {
        e.preventDefault();
        execFmt({ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase()]);
        afterFmt(text);
        return;
      }
      if (b.type === 'code') {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.execCommand('insertText', false, '\n');
        }
        return; // código não dispara conversões/navegação
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const keep = (b.type === 'li' || b.type === 'todo') && b.text !== '';
        if ((b.type === 'li' || b.type === 'todo') && b.text === '') {
          convertBlock(page, b, wrap, 'p');
          return;
        }
        insertAfter(page, b, wrap, keep ? b.type : 'p');
      } else if (e.key === 'Backspace' && text.textContent === '') {
        e.preventDefault();
        removeBlock(page, b, wrap, false);
      } else if (e.key === 'ArrowUp' && window.getSelection().anchorOffset === 0) {
        const prev = wrap.previousElementSibling;
        const pt = prev && prev.querySelector('.nblock-text');
        if (pt) {
          e.preventDefault();
          focusEnd(pt);
        }
      } else if (e.key === 'ArrowDown' && window.getSelection().anchorOffset >= text.textContent.length) {
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

  /* ---------- redimensionar imagem (arrasta a borda) ---------- */
  function attachImageResize(grip, wrap, b) {
    grip.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const container = wrap.parentElement;
      const cw = container ? container.getBoundingClientRect().width : 600;
      const move = (ev) => {
        const left = wrap.getBoundingClientRect().left;
        let pct = Math.round(((ev.clientX - left) / cw) * 100);
        pct = Math.max(20, Math.min(100, pct));
        b.w = pct >= 100 ? 0 : pct;
        applyBlockWidth(wrap, b);
      };
      const up = () => {
        window.removeEventListener('pointermove', move, true);
        window.removeEventListener('pointerup', up, true);
        save();
      };
      window.addEventListener('pointermove', move, true);
      window.addEventListener('pointerup', up, true);
    });
  }

  /* ---------- reordenar blocos (arrastar pela alça) ---------- */
  function clearDropMarks() {
    if (!content) return;
    content.querySelectorAll('.nblock.drop-before').forEach((el) => el.classList.remove('drop-before'));
  }
  function blockBeforePoint(container, x, y) {
    const list = [...container.querySelectorAll('.nblock:not(.nblock-dragging)')];
    return (
      list.find((el) => {
        const r = el.getBoundingClientRect();
        return y < r.top + r.height / 2;
      }) || null
    );
  }
  function reorderBlock(page, id, beforeEl) {
    const from = page.blocks.findIndex((x) => x.id === id);
    if (from < 0) return;
    const [moved] = page.blocks.splice(from, 1);
    if (!beforeEl) {
      page.blocks.push(moved);
    } else {
      const beforeId = beforeEl.dataset.id;
      const to = page.blocks.findIndex((x) => x.id === beforeId);
      page.blocks.splice(to < 0 ? page.blocks.length : to, 0, moved);
    }
    save();
    render();
  }

  /* ---------- barra de formatação (aparece ao selecionar texto) ---------- */
  let toolbarEl = null;
  function buildToolbar() {
    if (toolbarEl) return toolbarEl;
    toolbarEl = document.createElement('div');
    toolbarEl.className = 'notes-fmt-toolbar';
    const btns = [
      { cmd: 'bold', label: 'B', title: 'Negrito (Cmd/Ctrl+B)', cls: 'b' },
      { cmd: 'italic', label: 'i', title: 'Itálico (Cmd/Ctrl+I)', cls: 'i' },
      { cmd: 'underline', label: 'U', title: 'Sublinhado (Cmd/Ctrl+U)', cls: 'u' },
      { cmd: 'strikeThrough', label: 'S', title: 'Riscado', cls: 's' },
      { cmd: 'code', label: '</>', title: 'Código', cls: 'c' },
      { cmd: 'link', label: 'link', title: 'Link', cls: 'l' },
      { cmd: 'clear', label: '×', title: 'Limpar formatação', cls: 'x' },
    ];
    btns.forEach((bt) => {
      const button = document.createElement('button');
      button.className = 'notes-fmt-btn fmt-' + bt.cls;
      button.textContent = bt.label;
      button.title = bt.title;
      button.addEventListener('pointerdown', (e) => {
        e.preventDefault(); // não perde a seleção
        applyToolbar(bt.cmd);
      });
      toolbarEl.appendChild(button);
    });
    document.body.appendChild(toolbarEl);
    return toolbarEl;
  }
  let toolbarTarget = null;
  function maybeShowToolbar(textEl) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      hideToolbar();
      return;
    }
    const range = sel.getRangeAt(0);
    if (!textEl.contains(range.commonAncestorContainer)) {
      hideToolbar();
      return;
    }
    toolbarTarget = textEl;
    const tb = buildToolbar();
    tb.classList.add('show');
    const r = range.getBoundingClientRect();
    const tw = tb.offsetWidth || 240;
    let left = r.left + r.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = r.top - (tb.offsetHeight || 34) - 8;
    if (top < 8) top = r.bottom + 8;
    tb.style.left = left + 'px';
    tb.style.top = top + 'px';
  }
  function hideToolbar() {
    if (toolbarEl) toolbarEl.classList.remove('show');
  }
  function execFmt(cmd) {
    document.execCommand('styleWithCSS', false, '');
    document.execCommand(cmd, false, '');
  }
  function afterFmt(textEl) {
    if (textEl) textEl.dispatchEvent(new Event('input'));
  }
  async function applyToolbar(cmd) {
    const textEl = toolbarTarget;
    if (!textEl) return;
    if (cmd === 'bold' || cmd === 'italic' || cmd === 'underline' || cmd === 'strikeThrough') {
      execFmt(cmd);
    } else if (cmd === 'clear') {
      document.execCommand('removeFormat', false, '');
    } else if (cmd === 'code') {
      const sel = window.getSelection();
      const t = sel ? sel.toString() : '';
      if (t) {
        const safe = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        document.execCommand('insertHTML', false, '<code>' + safe + '</code>');
      }
    } else if (cmd === 'link') {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const saved = sel.getRangeAt(0).cloneRange();
      const vals = await E.ui.modal({
        title: 'Adicionar link',
        fields: [{ name: 'url', label: 'URL', value: 'https://' }],
        okLabel: 'Aplicar',
      });
      if (!vals || !vals.url) return;
      textEl.focus();
      const s2 = window.getSelection();
      s2.removeAllRanges();
      s2.addRange(saved);
      document.execCommand('createLink', false, vals.url);
    }
    afterFmt(textEl);
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

  /* colar imagem direto nas Notas (Cmd/Ctrl+V) — vira bloco de imagem */
  content.addEventListener('paste', async (e) => {
    if (!project) return;
    const items = (e.clipboardData && e.clipboardData.items) || [];
    const imgs = [];
    for (const it of items) {
      if (it.kind === 'file' && it.type.indexOf('image/') === 0) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (!imgs.length) return; // sem imagem: deixa o paste de texto normal seguir
    e.preventDefault();
    const page = currentPage();
    if (!page) return;
    // insere logo abaixo do bloco focado (ou no fim)
    const focused = document.activeElement && document.activeElement.closest
      ? document.activeElement.closest('.nblock')
      : null;
    let at = focused ? page.blocks.findIndex((x) => x.id === focused.dataset.id) : -1;
    for (const f of imgs) {
      const blobId = await E.db.saveBlob(f);
      const blk = mkImageBlock(blobId);
      if (at >= 0) page.blocks.splice(++at, 0, blk);
      else page.blocks.push(blk);
    }
    pruneEmptyBlocks(page);
    save();
    render();
    E.ui.toast(imgs.length === 1 ? 'Imagem colada nas Notas' : imgs.length + ' imagens coladas');
  });

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
      else if (line.indexOf('### ') === 0) blocks.push(mkBlock('h3', line.slice(4)));
      else if (line.indexOf('## ') === 0) blocks.push(mkBlock('h2', line.slice(3)));
      else if (line.indexOf('# ') === 0) blocks.push(mkBlock('h1', line.slice(2)));
      else if (line.indexOf('> ') === 0) blocks.push(mkBlock('quote', line.slice(2)));
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
      if (b.type === 'image') return; // imagem não vira texto de card
      if (b.type === 'divider') lines.push('---');
      else if (b.type === 'h1') lines.push('# ' + b.text);
      else if (b.type === 'h2') lines.push('## ' + b.text);
      else if (b.type === 'h3') lines.push('### ' + b.text);
      else if (b.type === 'quote') lines.push('> ' + b.text);
      else if (b.type === 'li') lines.push('- ' + b.text);
      else if (b.type === 'todo') lines.push((b.checked ? '[x] ' : '[] ') + b.text);
      else lines.push(b.text);
    });
    return lines.join('\n');
  }

  /* ---------- arrastar itens do canvas pra cá ---------- */

  // melhor imagem de um item (foto, resultado de IA, mídia de post/vídeo)
  function imageBlobOf(item) {
    const c = item.content || {};
    if (c.blobId) return c.blobId;
    if (Array.isArray(c.media) && c.media.length) {
      const m = c.media.find((x) => x && x.blobId && x.kind !== 'video') || c.media[0];
      if (m && m.blobId) return m.blobId;
    }
    return null;
  }

  // adiciona um item do canvas como bloco(s) na página atual; retorna 1 se entrou algo
  function appendItemBlocks(page, item) {
    const k = item.kind;
    const c = item.content || {};
    const img = imageBlobOf(item);

    if (img && (k === 'image' || k === 'gen' || k === 'post' || k === 'video')) {
      page.blocks.push(mkImageBlock(img));
      const cap = (k === 'gen' ? c.prompt : c.text) || '';
      if (cap.trim()) page.blocks.push(mkBlock('p', cap.trim()));
      return 1;
    }

    let lines = [];
    if (k === 'note' || k === 'label' || k === 'flownode' || k === 'post') {
      lines = String(c.text || '').split('\n');
    } else if (k === 'gen') {
      lines = [c.prompt || ''];
    } else if (k === 'link') {
      lines = [((c.title ? c.title + ' — ' : '') + (c.url || '')).trim()];
    } else if (k === 'color') {
      lines = ['Cor ' + (c.hex || '')];
    } else if (k === 'video') {
      lines = [c.title || 'Vídeo'];
    } else if (k === 'file') {
      lines = [c.name || 'Arquivo'];
    } else if (k === 'folder') {
      lines = [c.name || 'Pasta'];
    }
    lines = lines.filter((l) => l && l.trim());
    if (!lines.length) return 0;
    lines.forEach((l) => page.blocks.push(mkBlock('p', l)));
    return 1;
  }

  // remove o bloco de texto vazio inicial (a página nasce com um) se ficou sobrando
  function pruneEmptyBlocks(page) {
    if (page.blocks.length <= 1) return;
    page.blocks = page.blocks.filter((b, i) => !(i < page.blocks.length && b.type === 'p' && !b.text));
    if (!page.blocks.length) page.blocks.push(mkBlock('p', ''));
  }

  function acceptCanvasItems(list) {
    if (!Array.isArray(list) || !list.length) return;
    if (!isOpen()) open();
    const page = currentPage();
    if (!page) return;
    let added = 0;
    list.forEach((item) => {
      added += appendItemBlocks(page, item);
    });
    if (!added) return;
    pruneEmptyBlocks(page);
    save();
    render();
    E.ui.toast(added === 1 ? 'Item adicionado às Notas' : added + ' itens adicionados às Notas');
  }

  E.notes = { toggle, open, close, isOpen, openPage, refreshPage, pageFromText, pageToText, acceptCanvasItems };
})();
