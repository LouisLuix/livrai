/* Terminal embutido: xterm.js (o mesmo motor do terminal do VS Code) na
   tela, e shells de verdade (PTY) criados pelo app desktop.
   Multiterminal: várias sessões ao mesmo tempo, vistas por ABAS ou LADO A
   LADO. No lado a lado, os painéis são um mosaico: arraste pelo cabeçalho
   e solte na esquerda/direita de outro terminal (mesma linha) ou em
   cima/embaixo (linha nova) — dá pra montar 3x3 e além.
   Cada aba pode nascer na pasta de um projeto, pronta pra rodar um agente.
   As sessões continuam vivas ao trocar de visão.
   No navegador (sem o app), a visão explica que é função do desktop. */
(function () {
  const E = window.Estudio;
  E.terminal = {};

  const XTERM_JS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.min.js';
  const XTERM_CSS = 'https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.min.css';
  const FIT_JS = 'https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.min.js';
  const MAX_TABS = 12;
  const ROW_FILL = 3; // novas abas completam a linha até 3, depois abrem linha nova

  const THEME = {
    background: '#0b0b0d',
    foreground: '#e8e6e2',
    cursor: '#ff5c26',
    cursorAccent: '#0b0b0d',
    selectionBackground: 'rgba(255, 92, 38, 0.28)',
  };

  function native() {
    return (window.livraiNative && window.livraiNative.term) || null;
  }

  /* xterm.js carrega sob demanda do CDN — mesmo padrão do Firebase */
  let libPromise = null;
  function loadLib() {
    if (libPromise) return libPromise;
    libPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = XTERM_CSS;
      document.head.appendChild(css);
      const urls = [XTERM_JS, FIT_JS];
      let i = 0;
      function next() {
        if (i >= urls.length) {
          resolve();
          return;
        }
        const s = document.createElement('script');
        s.src = urls[i++];
        s.onload = next;
        s.onerror = () => {
          libPromise = null;
          reject(new Error('offline'));
        };
        document.head.appendChild(s);
      }
      next();
    });
    return libPromise;
  }

  let built = false;
  let tabsEl = null;
  let body = null;
  let statusEl = null;
  let layoutBtn = null;

  const tabs = []; // { sessId, term, fit, pane, mount, btn, dot, name, cwd, alive }
  let rows = []; // mosaico do lado a lado: linhas de painéis
  let active = null;
  let dragging = null;
  let seq = 0;
  let layout = localStorage.getItem('livrai-term-layout') || 'tabs'; // 'tabs' | 'split'

  E.terminal.render = async function (container) {
    if (!built) {
      built = true;
      await build(container);
    }
    refitAll();
    focusActive();
  };

  /* ---------- estrutura da visão ---------- */

  async function build(container) {
    container.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'term-head';

    const title = document.createElement('span');
    title.className = 'term-title';
    title.innerHTML = E.icon('terminal', 15) + '<span>Terminal</span>';
    head.appendChild(title);

    tabsEl = document.createElement('div');
    tabsEl.className = 'term-tabs';
    head.appendChild(tabsEl);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn ghost icon-only term-add';
    addBtn.innerHTML = E.icon('plus', 15);
    addBtn.title = 'Novo terminal — no Estúdio ou na pasta de um projeto';
    addBtn.addEventListener('click', (ev) => openAddMenu(ev));
    head.appendChild(addBtn);

    const sp = document.createElement('span');
    sp.className = 'term-spacer';
    head.appendChild(sp);

    statusEl = document.createElement('span');
    statusEl.className = 'term-status mono';
    head.appendChild(statusEl);

    layoutBtn = document.createElement('button');
    layoutBtn.className = 'btn ghost';
    layoutBtn.addEventListener('click', () => {
      setLayout(layout === 'tabs' ? 'split' : 'tabs');
    });
    head.appendChild(layoutBtn);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn ghost';
    E.setLabel(clearBtn, 'brush', 'Limpar');
    clearBtn.title = 'Limpar a tela do terminal ativo (a sessão continua)';
    clearBtn.addEventListener('click', () => {
      if (active && active.term) {
        active.term.clear();
        active.term.focus();
      }
    });
    head.appendChild(clearBtn);

    container.appendChild(head);

    body = document.createElement('div');
    body.className = 'term-body';
    container.appendChild(body);

    if (!native()) {
      body.innerHTML =
        '<div class="term-msg"><p class="hint-big">Terminal é função do app desktop</p>' +
        '<p>No navegador não dá pra abrir um shell do computador. Abra o app Livrai e a visão Terminal funciona por aqui.</p></div>';
      statusEl.textContent = 'indisponível no navegador';
      return;
    }

    try {
      await loadLib();
    } catch (_) {
      body.innerHTML =
        '<div class="term-msg"><p class="hint-big">Sem internet</p>' +
        '<p>O Terminal usa o xterm.js, carregado da rede na primeira vez. Conecte e tente de novo.</p></div>';
      statusEl.textContent = 'offline';
      built = false; // tenta de novo na próxima visita
      return;
    }

    // roteia saída e encerramento pra aba dona da sessão
    native().onData((m) => {
      const t = tabs.find((x) => x.sessId === m.id);
      if (!t) return;
      t.term.write(m.data);
      if (t !== active && layout === 'tabs') t.dot.classList.add('on');
    });
    native().onExit((m) => {
      const t = tabs.find((x) => x.sessId === m.id);
      if (!t) return;
      t.alive = false;
      t.btn && t.btn.classList.add('dead');
      t.term.write('\r\n\x1b[2m— sessão encerrada. Reabra pelo botão + ou feche esta aba. —\x1b[0m\r\n');
      syncStatus();
    });

    const ro = new ResizeObserver(E.debounce(refitAll, 120));
    ro.observe(body);

    // soltar no vão entre linhas (ou no fundo) = nova linha no fim
    body.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      if (!e.target.closest('.term-pane')) {
        clearDropMarks();
        body.classList.add('drop-end');
      }
    });
    body.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      if (!e.target.closest('.term-pane')) moveToNewRowAtEnd(dragging);
      clearDropMarks();
    });

    applyLayout();
    await addTab({ name: 'Estúdio', cwd: null });
  }

  /* ---------- abas ---------- */

  async function addTab(opts) {
    if (tabs.length >= MAX_TABS) {
      E.ui.toast('Máximo de ' + MAX_TABS + ' terminais — feche um pra abrir outro');
      return;
    }
    seq++;
    const name = (opts && opts.name) || 'Terminal ' + seq;

    const pane = document.createElement('div');
    pane.className = 'term-pane';

    const paneHead = document.createElement('div');
    paneHead.className = 'term-pane-head';
    paneHead.title = 'Arraste pra reposicionar este terminal no mosaico';
    const paneName = document.createElement('span');
    paneName.className = 'term-pane-name';
    paneName.textContent = name;
    paneHead.appendChild(paneName);
    const paneClose = document.createElement('button');
    paneClose.className = 'term-close';
    paneClose.innerHTML = E.icon('close', 11);
    paneClose.title = 'Fechar este terminal';
    paneHead.appendChild(paneClose);
    pane.appendChild(paneHead);

    const mount = document.createElement('div');
    mount.className = 'term-mount';
    pane.appendChild(mount);

    const term = new window.Terminal({
      cursorBlink: true,
      fontFamily: '"IBM Plex Mono", Menlo, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 4000,
      theme: THEME,
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);

    const tab = {
      sessId: null,
      term: term,
      fit: fit,
      pane: pane,
      mount: mount,
      btn: null,
      dot: null,
      name: name,
      cwd: (opts && opts.cwd) || null,
      alive: false,
    };
    tabs.push(tab);

    // posição padrão no mosaico: completa a última linha, depois abre outra
    const last = rows[rows.length - 1];
    if (last && last.length < ROW_FILL) last.push(tab);
    else rows.push([tab]);

    paneClose.addEventListener('click', (ev) => {
      ev.stopPropagation();
      closeTab(tab);
    });
    pane.addEventListener('pointerdown', () => {
      if (active !== tab) activate(tab, true);
    });

    wireDrag(tab, paneHead);

    term.onData((d) => {
      if (tab.alive && tab.sessId != null) native().input(tab.sessId, d);
    });
    term.onResize((size) => {
      if (tab.alive && tab.sessId != null) native().resize(tab.sessId, size.cols, size.rows);
    });

    renderTabs();
    applyLayout();
    activate(tab, false); // deixa o painel visível antes do xterm medir
    term.open(mount);
    requestAnimationFrame(() => {
      safeFit(tab);
      startSession(tab);
    });
  }

  async function startSession(tab) {
    try {
      const r = await native().create({
        cols: tab.term.cols,
        rows: tab.term.rows,
        cwd: tab.cwd || undefined,
      });
      tab.sessId = r.id;
      tab.alive = true;
      tab.cwd = r.cwd || tab.cwd;
      syncStatus();
      tab.term.focus();
    } catch (err) {
      console.error('terminal', err);
      tab.alive = false;
      tab.term.write('\x1b[31mNão consegui abrir o shell.\x1b[0m\r\n');
      syncStatus();
    }
  }

  function closeTab(tab) {
    const i = tabs.indexOf(tab);
    if (i < 0) return;
    if (tab.alive && tab.sessId != null) native().kill(tab.sessId);
    try { tab.term.dispose(); } catch (_) {}
    tab.pane.remove();
    tabs.splice(i, 1);
    removeFromRows(tab);
    if (active === tab) {
      active = null;
      const next = tabs[Math.min(i, tabs.length - 1)];
      if (next) activate(next, true);
    }
    renderTabs();
    applyLayout();
    refitAll();
    syncStatus();
    if (!tabs.length) {
      statusEl.textContent = 'nenhum terminal aberto — use o botão +';
    }
  }

  function activate(tab, focus) {
    active = tab;
    tab.dot && tab.dot.classList.remove('on');
    tabs.forEach((t) => {
      t.btn && t.btn.classList.toggle('active', t === tab);
      t.pane.classList.toggle('active', t === tab);
      if (layout === 'tabs') t.pane.classList.toggle('hidden', t !== tab);
    });
    syncStatus();
    requestAnimationFrame(() => {
      safeFit(tab);
      if (focus) tab.term.focus();
    });
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    tabs.forEach((t) => {
      const b = document.createElement('button');
      b.className =
        'term-tab' +
        (t === active ? ' active' : '') +
        (t.alive || t.sessId == null ? '' : ' dead');
      const dot = document.createElement('span');
      dot.className = 'term-tab-dot';
      b.appendChild(dot);
      const nm = document.createElement('span');
      nm.className = 'term-tab-name';
      nm.textContent = t.name;
      b.appendChild(nm);
      const x = document.createElement('span');
      x.className = 'term-close';
      x.innerHTML = E.icon('close', 10);
      x.title = 'Fechar';
      x.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeTab(t);
      });
      b.appendChild(x);
      b.addEventListener('click', () => activate(t, true));
      t.btn = b;
      t.dot = dot;
      tabsEl.appendChild(b);
    });
  }

  /* ---------- mosaico: arrastar e soltar ---------- */

  function rowOf(tab) {
    return rows.find((r) => r.indexOf(tab) >= 0) || null;
  }

  function removeFromRows(tab) {
    const r = rowOf(tab);
    if (!r) return;
    r.splice(r.indexOf(tab), 1);
    if (!r.length) rows.splice(rows.indexOf(r), 1);
  }

  function wireDrag(tab, handle) {
    handle.draggable = true;
    handle.addEventListener('dragstart', (e) => {
      if (layout !== 'split') {
        e.preventDefault();
        return;
      }
      dragging = tab;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', tab.name);
      tab.pane.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      if (dragging) dragging.pane.classList.remove('dragging');
      dragging = null;
      clearDropMarks();
    });
    tab.pane.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      markDrop(tab.pane, zoneFor(e, tab.pane));
    });
    tab.pane.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.stopPropagation();
      dropOn(tab, zoneFor(e, tab.pane));
      clearDropMarks();
    });
  }

  /* qual borda do painel recebe o arrasto: topo/fundo = linha nova,
     esquerda/direita = entra na mesma linha */
  function zoneFor(e, pane) {
    const r = pane.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    const x = (e.clientX - r.left) / Math.max(1, r.width);
    if (y < 0.25) return 'top';
    if (y > 0.75) return 'bottom';
    return x < 0.5 ? 'left' : 'right';
  }

  function markDrop(pane, zone) {
    clearDropMarks();
    pane.classList.add('drop-' + zone);
  }

  function clearDropMarks() {
    body.classList.remove('drop-end');
    tabs.forEach((t) => {
      t.pane.classList.remove('drop-top', 'drop-bottom', 'drop-left', 'drop-right');
    });
  }

  function dropOn(target, zone) {
    const tab = dragging;
    if (!tab || tab === target) return;
    removeFromRows(tab);
    const r = rowOf(target);
    if (!r) {
      rows.push([tab]);
    } else if (zone === 'left' || zone === 'right') {
      r.splice(r.indexOf(target) + (zone === 'right' ? 1 : 0), 0, tab);
    } else {
      rows.splice(rows.indexOf(r) + (zone === 'bottom' ? 1 : 0), 0, [tab]);
    }
    applyLayout();
    refitAll();
    activate(tab, false);
  }

  function moveToNewRowAtEnd(tab) {
    const r = rowOf(tab);
    if (r && rows.length && rows[rows.length - 1] === r && r.length === 1) return; // já está lá
    removeFromRows(tab);
    rows.push([tab]);
    applyLayout();
    refitAll();
    activate(tab, false);
  }

  /* ---------- novo terminal: Estúdio ou pasta de projeto ---------- */

  function sanitize(s) {
    const clean = String(s || '').replace(/[\\/:*?"<>|.]+/g, '-').trim();
    return clean || 'projeto';
  }

  function openAddMenu(ev) {
    const entries = [
      { label: 'Estúdio', icon: 'terminal', onClick: () => addTab({ name: 'Estúdio', cwd: null }) },
    ];
    const desktop = E.files.desktop();
    const projects = (E.state.projects || []).filter((p) => !p.archived).slice(0, 12);
    projects.forEach((p) => {
      const cwd =
        p.linkedFolder ||
        (desktop && desktop.projetos ? desktop.projetos + '/' + sanitize(p.name) : null);
      if (!cwd) return;
      entries.push({
        label: p.name,
        icon: 'folder',
        onClick: () => addTab({ name: p.name, cwd: cwd }),
      });
    });
    const r = ev.currentTarget.getBoundingClientRect();
    E.ui.menu(r.left, r.bottom + 8, entries);
  }

  /* ---------- layout: abas ou lado a lado ---------- */

  function setLayout(mode) {
    layout = mode;
    localStorage.setItem('livrai-term-layout', mode);
    applyLayout();
    refitAll();
    focusActive();
  }

  /* reconstrói o corpo: plano nas abas, linhas de mosaico no lado a lado */
  function applyLayout() {
    if (!body) return;
    body.classList.toggle('split', layout === 'split');
    body.innerHTML = '';
    if (layout === 'split') {
      rows.forEach((r) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'term-row';
        r.forEach((t) => rowEl.appendChild(t.pane));
        body.appendChild(rowEl);
      });
    } else {
      tabs.forEach((t) => body.appendChild(t.pane));
    }
    tabs.forEach((t) => {
      if (layout === 'split') {
        t.pane.classList.remove('hidden');
        t.dot && t.dot.classList.remove('on');
      } else {
        t.pane.classList.toggle('hidden', t !== active);
      }
      t.pane.classList.toggle('active', t === active);
    });
    if (layoutBtn) {
      E.setLabel(
        layoutBtn,
        layout === 'split' ? 'clipboard' : 'grid',
        layout === 'split' ? 'Abas' : 'Lado a lado'
      );
      layoutBtn.title =
        layout === 'split'
          ? 'Voltar pra um terminal por vez, em abas'
          : 'Ver todos os terminais ao mesmo tempo, num mosaico arrastável';
    }
  }

  /* ---------- medidas ---------- */

  function safeFit(tab) {
    if (!tab || !tab.fit) return;
    if (!tab.mount.clientWidth || !tab.mount.clientHeight) return;
    try { tab.fit.fit(); } catch (_) {}
  }

  function refitAll() {
    tabs.forEach(safeFit);
  }

  function focusActive() {
    if (active && active.term) active.term.focus();
  }

  function syncStatus() {
    if (!statusEl) return;
    if (!active) {
      statusEl.textContent = '';
      return;
    }
    statusEl.textContent = (active.alive ? '' : 'encerrado · ') + (active.cwd || '');
  }
})();
