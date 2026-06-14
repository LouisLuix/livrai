/* Atalhos de teclado do sistema + tela de ajuda (tecla ?) + remapeamento
   persistido (Configurações → Atalhos).
   Atalhos de uma letra só valem no canvas e fora de campos de texto;
   combinações com Cmd/Ctrl valem em qualquer lugar. */
(function () {
  const E = window.Estudio;
  E.shortcuts = {};

  const mac = navigator.platform.toLowerCase().indexOf('mac') >= 0;
  const MOD = mac ? '⌘' : 'Ctrl';
  const STORE = 'livrai-shortcuts';

  let overrides = {};
  try { overrides = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (_) { overrides = {}; }

  function click(id) {
    const el = document.getElementById(id);
    if (el) el.click();
  }
  function call(obj, fn) {
    return obj && obj[fn] ? obj[fn]() : undefined;
  }
  function canvasOpen() {
    return !!(E.canvas && E.canvas.isOpen && E.canvas.isOpen());
  }

  // id: chave estável (remapeamento) · group/desc: ajuda · run: ação (null = fixo/doc)
  // mod/shift + code|key: tecla padrão · canvas: só com canvas aberto
  const LIST = [
    { id: 'help', group: 'Geral', desc: 'Mostrar/ocultar esta ajuda', key: '?', run: toggleHelp },
    { id: 'settings', group: 'Geral', desc: 'Configurações', mod: true, key: ',', allowInput: true, run: () => click('btn-settings') },
    { id: 'dictate', group: 'Geral', desc: 'Ditar por voz (segure e fale)', fixed: true, mod: true, shift: true, code: 'KeyD', run: null },
    { id: 'search', group: 'Geral', desc: 'Buscar no projeto', fixed: true, mod: true, code: 'KeyF', run: null },

    { id: 'create', group: 'Projeto (no canvas)', desc: 'Criar item', code: 'KeyC', canvas: true, run: () => click('tool-create') },
    { id: 'project', group: 'Projeto (no canvas)', desc: 'Configurações do projeto', code: 'KeyP', canvas: true, run: () => click('tool-project') },
    { id: 'notes', group: 'Projeto (no canvas)', desc: 'Notas', code: 'KeyN', canvas: true, run: () => call(E.notes, 'toggle') },
    { id: 'brand', group: 'Projeto (no canvas)', desc: 'Marca & produto', code: 'KeyM', canvas: true, run: () => call(E.brand, 'toggle') },
    { id: 'schedule', group: 'Projeto (no canvas)', desc: 'Cronograma', code: 'KeyG', canvas: true, run: () => call(E.schedule, 'toggle') },
    { id: 'browser', group: 'Projeto (no canvas)', desc: 'Navegador', code: 'KeyB', canvas: true, run: () => call(E.browser, 'togglePanel') },
    { id: 'chat', group: 'Projeto (no canvas)', desc: 'Chat', code: 'KeyJ', canvas: true, run: () => call(E.chat, 'togglePanel') },
    { id: 'export', group: 'Projeto (no canvas)', desc: 'Exportar', code: 'KeyX', canvas: true, run: () => call(E.exporter, 'openExportModal') },

    { id: 'zoom-in', group: 'Zoom (no canvas)', desc: 'Aproximar', key: '+', canvas: true, run: () => click('zoom-in') },
    { id: 'zoom-out', group: 'Zoom (no canvas)', desc: 'Afastar', key: '-', canvas: true, run: () => click('zoom-out') },
    { id: 'zoom-fit', group: 'Zoom (no canvas)', desc: 'Enquadrar tudo', code: 'Digit0', canvas: true, run: () => click('zoom-fit') },

    { id: 'esc', group: 'Navegação', desc: 'Fechar menu/painel/ajuda', fixed: true, key: 'Escape', run: null },
  ];

  /* ---------- binding efetivo (padrão ou remapeado) ---------- */
  function effective(s) {
    const o = overrides[s.id];
    if (o) return o;
    return { mod: !!s.mod, shift: !!s.shift, code: s.code || null, key: s.key || null };
  }
  function keyLabel(b) {
    if (b.code) {
      if (b.code.indexOf('Key') === 0) return b.code.slice(3);
      if (b.code.indexOf('Digit') === 0) return b.code.slice(5);
      return b.code;
    }
    const k = b.key || '';
    if (k === ' ') return 'Espaço';
    if (k === 'Escape') return 'Esc';
    return k.length === 1 ? k.toUpperCase() : k;
  }
  function labelFor(b) {
    const p = [];
    if (b.mod) p.push(MOD);
    if (b.shift) p.push('⇧');
    p.push(keyLabel(b));
    return p.join(' ');
  }
  function bindingFromEvent(e) {
    if (e.key === 'Shift' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Alt') return null;
    const b = { mod: !!(e.metaKey || e.ctrlKey), shift: !!e.shiftKey };
    if (e.code && (e.code.indexOf('Key') === 0 || e.code.indexOf('Digit') === 0)) b.code = e.code;
    else b.key = e.key;
    return b;
  }

  function isTyping() {
    if (E.state && E.state.editing) return true;
    const a = document.activeElement;
    if (!a) return false;
    const t = a.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || a.isContentEditable;
  }

  function matches(s, e) {
    if (!s.run) return false;
    const b = effective(s);
    if (!!b.mod !== !!(e.metaKey || e.ctrlKey)) return false;
    if (!!b.shift !== e.shiftKey) return false;
    if (b.code) return e.code === b.code;
    if (b.key) return e.key === b.key;
    return false;
  }

  window.addEventListener('keydown', (e) => {
    if (helpEl && e.key === 'Escape') {
      closeHelp();
      return;
    }
    const typing = isTyping();
    for (const s of LIST) {
      if (!matches(s, e)) continue;
      if (typing && !(effective(s).mod && s.allowInput)) continue;
      if (s.canvas && !canvasOpen()) continue;
      e.preventDefault();
      e.stopPropagation();
      s.run();
      return;
    }
  });

  /* ---------- API pra Configurações ---------- */
  E.shortcuts.all = function () {
    return LIST.map((s) => ({
      id: s.id,
      group: s.group,
      desc: s.desc,
      combo: labelFor(effective(s)),
      editable: !!s.run && !s.fixed,
    }));
  };
  E.shortcuts.setBindingFromEvent = function (id, e) {
    const b = bindingFromEvent(e);
    if (!b) return null;
    overrides[id] = b;
    localStorage.setItem(STORE, JSON.stringify(overrides));
    return labelFor(b);
  };
  E.shortcuts.clear = function (id) {
    delete overrides[id];
    localStorage.setItem(STORE, JSON.stringify(overrides));
  };
  E.shortcuts.resetAll = function () {
    overrides = {};
    localStorage.removeItem(STORE);
  };
  // conflito: outro atalho já usa o mesmo combo?
  E.shortcuts.conflict = function (id, e) {
    const b = bindingFromEvent(e);
    if (!b) return null;
    for (const s of LIST) {
      if (s.id === id || !s.run) continue;
      const o = effective(s);
      if (!!o.mod === !!b.mod && !!o.shift === !!b.shift && (b.code ? o.code === b.code : o.key === b.key)) {
        return s.desc;
      }
    }
    return null;
  };

  /* ---------- tela de ajuda ---------- */
  let helpEl = null;
  function toggleHelp() {
    if (helpEl) closeHelp();
    else openHelp();
  }
  function closeHelp() {
    if (helpEl) helpEl.remove();
    helpEl = null;
  }
  function openHelp() {
    helpEl = document.createElement('div');
    helpEl.className = 'overlay shortcuts-overlay';
    helpEl.addEventListener('pointerdown', (ev) => {
      if (ev.target === helpEl) closeHelp();
    });

    const box = document.createElement('div');
    box.className = 'modal shortcuts-modal';

    const head = document.createElement('div');
    head.className = 'shortcuts-head';
    head.innerHTML = E.icon('keyboard', 18) + '<h2>Atalhos do teclado</h2>';
    const close = document.createElement('button');
    close.className = 'btn ghost icon-only';
    close.innerHTML = E.icon('close', 16);
    close.addEventListener('click', closeHelp);
    head.appendChild(close);
    box.appendChild(head);

    const groups = {};
    E.shortcuts.all().forEach((s) => {
      (groups[s.group] = groups[s.group] || []).push(s);
    });
    const grid = document.createElement('div');
    grid.className = 'shortcuts-grid';
    Object.keys(groups).forEach((g) => {
      const sec = document.createElement('div');
      sec.className = 'shortcuts-sec';
      const h = document.createElement('div');
      h.className = 'shortcuts-sec-title';
      h.textContent = g;
      sec.appendChild(h);
      groups[g].forEach((s) => {
        const row = document.createElement('div');
        row.className = 'shortcuts-row';
        row.innerHTML = '<span class="shortcuts-desc"></span><kbd class="shortcuts-key"></kbd>';
        row.querySelector('.shortcuts-desc').textContent = s.desc;
        row.querySelector('.shortcuts-key').textContent = s.combo;
        sec.appendChild(row);
      });
      grid.appendChild(sec);
    });
    box.appendChild(grid);

    const hint = document.createElement('p');
    hint.className = 'shortcuts-hint';
    hint.textContent = 'Personalize em Configurações → Atalhos.';
    box.appendChild(hint);

    helpEl.appendChild(box);
    document.body.appendChild(helpEl);
  }

  E.shortcuts.openHelp = openHelp;
  E.shortcuts.toggleHelp = toggleHelp;
})();
