/* Componentes de interface: modal, menu de contexto e toast */
(function () {
  const E = window.Estudio;
  E.ui = {};

  let toastTimer = null;
  E.ui.toast = function (msg, ms) {
    const el = document.getElementById('toast');
    let text = String(msg);
    // compatibilidade: mensagens antigas começavam com ⚠️ pra indicar erro
    const isWarn = text.indexOf('⚠️') === 0 || text.indexOf('Erro') === 0;
    text = text.replace(/^⚠️\s*/, '');
    el.textContent = text;
    el.classList.toggle('warn', isWarn);
    el.classList.add('show');
    clearTimeout(toastTimer);
    // erros ficam mais tempo na tela pra dar tempo de ler
    const dur = ms || (isWarn ? 9000 : 2600);
    toastTimer = setTimeout(() => el.classList.remove('show'), dur);
  };

  /**
   * Modal simples com campos de formulário.
   * opts: { title, message?, fields?: [{name, label, value?, placeholder?, type?: 'text'|'select'|'date', options?}], okLabel?, danger? }
   * Resolve com objeto {name: valor} ou null se cancelado.
   */
  E.ui.modal = function (opts) {
    return new Promise((resolve) => {
      const root = document.getElementById('modal-root');
      root.innerHTML = '';

      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      const box = document.createElement('div');
      box.className = 'modal';

      const h = document.createElement('h3');
      h.textContent = opts.title || '';
      box.appendChild(h);

      if (opts.message) {
        const p = document.createElement('p');
        p.className = 'modal-msg';
        p.textContent = opts.message;
        box.appendChild(p);
      }

      const form = document.createElement('form');
      (opts.fields || []).forEach((f) => {
        const lab = document.createElement('label');
        const span = document.createElement('span');
        span.textContent = f.label || '';
        lab.appendChild(span);
        let input;
        if (f.type === 'select') {
          input = document.createElement('select');
          (f.options || []).forEach((o) => {
            const op = document.createElement('option');
            op.value = o.value;
            op.textContent = o.label;
            input.appendChild(op);
          });
          if (f.value != null) input.value = f.value;
        } else {
          input = document.createElement('input');
          input.type = f.type === 'date' ? 'date' : 'text';
          input.value = f.value || '';
          input.placeholder = f.placeholder || '';
          input.autocomplete = 'off';
          input.spellcheck = false;
        }
        input.name = f.name;
        lab.appendChild(input);
        form.appendChild(lab);
      });

      const row = document.createElement('div');
      row.className = 'modal-actions';
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn ghost';
      cancelBtn.textContent = 'Cancelar';
      const okBtn = document.createElement('button');
      okBtn.type = 'submit';
      okBtn.className = 'btn primary' + (opts.danger ? ' danger' : '');
      okBtn.textContent = opts.okLabel || 'Salvar';
      row.appendChild(cancelBtn);
      row.appendChild(okBtn);
      form.appendChild(row);
      box.appendChild(form);
      overlay.appendChild(box);
      root.appendChild(overlay);

      function close(val) {
        window.removeEventListener('keydown', onEsc, true);
        root.innerHTML = '';
        resolve(val);
      }
      function onEsc(e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close(null);
        }
      }
      window.addEventListener('keydown', onEsc, true);
      overlay.addEventListener('pointerdown', (e) => {
        if (e.target === overlay) close(null);
      });
      cancelBtn.addEventListener('click', () => close(null));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const vals = {};
        new FormData(form).forEach((v, k) => (vals[k] = String(v)));
        close(vals);
      });

      const first = form.querySelector('input, select');
      if (first) {
        first.focus();
        if (first.select) first.select();
      }
    });
  };

  E.ui.confirm = function (title, message, okLabel) {
    return E.ui
      .modal({ title, message, okLabel: okLabel || 'Confirmar', danger: true })
      .then((v) => v !== null);
  };

  /** Menu de contexto flutuante. entries: [{label, icon?, danger?, onClick}] */
  E.ui.menu = function (x, y, entries) {
    closeMenu();
    const m = document.createElement('div');
    m.className = 'ctx-menu';
    m.id = 'ctx-menu';
    entries.forEach((en) => {
      if (en.separator) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        m.appendChild(sep);
        return;
      }
      if (en.header) {
        const h = document.createElement('div');
        h.className = 'ctx-header';
        h.textContent = en.header;
        m.appendChild(h);
        return;
      }
      const b = document.createElement('button');
      if (en.icon) b.insertAdjacentHTML('beforeend', E.icon(en.icon));
      const sp = document.createElement('span');
      sp.textContent = en.label;
      b.appendChild(sp);
      if (en.danger) b.classList.add('danger');
      b.addEventListener('click', () => {
        closeMenu();
        en.onClick();
      });
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect();
    m.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
    m.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
    setTimeout(() => {
      window.addEventListener('pointerdown', onAway, { once: true, capture: true });
    }, 0);
    function onAway(e) {
      if (!m.contains(e.target)) closeMenu();
      else window.addEventListener('pointerdown', onAway, { once: true, capture: true });
    }
  };

  function closeMenu() {
    const old = document.getElementById('ctx-menu');
    if (old) old.remove();
  }
  E.ui.closeMenu = closeMenu;

  /* Painéis laterais redimensionáveis (arrasta a borda esquerda) */
  function clampPanelWidth(w) {
    return Math.min(Math.round(window.innerWidth * 0.8), Math.max(300, w));
  }

  E.ui.initPanelResize = function (panel, storageKey) {
    const rz = panel.querySelector('.panel-resizer');
    if (!rz) return;
    let active = false;
    let startX = 0;
    let startW = 0;
    rz.addEventListener('pointerdown', (e) => {
      active = true;
      startX = e.clientX;
      startW = panel.getBoundingClientRect().width;
      e.preventDefault();
      // véu por cima de TUDO (inclusive webview) — o arrasto nunca escapa
      const veil = document.createElement('div');
      veil.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:col-resize;';
      document.body.appendChild(veil);
      document.body.classList.add('panel-resizing');
      const onMove = (ev) => {
        panel.style.width = clampPanelWidth(startW + (startX - ev.clientX)) + 'px';
      };
      const onUp = () => {
        active = false;
        veil.remove();
        document.body.classList.remove('panel-resizing');
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', onUp, true);
        const w = parseInt(panel.style.width, 10);
        if (w) localStorage.setItem(storageKey, String(w));
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', onUp, true);
    });
  };

  E.ui.applyPanelWidth = function (panel, storageKey) {
    const w = parseInt(localStorage.getItem(storageKey), 10);
    if (w) panel.style.width = clampPanelWidth(w) + 'px';
  };
})();
