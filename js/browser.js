/* Navegador embutido: pesquisa de referência SEM sair do LIVRAI.
   Guias persistentes (motor Chrome do próprio app), logins que ficam salvos
   (perfil separado do seu navegador) e as ferramentas de estudo:
   — print da página → card de imagem no projeto-alvo
   — botão direito numa imagem do site → card no projeto
   — texto selecionado → nota no projeto
   — página → card de link
   Exclusivo do app desktop (precisa do motor embutido). */
(function () {
  const E = window.Estudio;
  E.browser = {};

  const TABS_KEY = 'livrai-browser-tabs';
  const TARGET_KEY = 'livrai-browser-target';
  const HOME = 'https://www.google.com/';

  let container = null;
  let tabs = []; // { id, url, title, wv }
  let activeId = null;

  const isDesktop = () => !!(window.livraiNative && window.livraiNative.captureWebview);

  /* ---------- persistência das guias ---------- */

  function saveTabs() {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify(tabs.map((t) => ({ id: t.id, url: t.url, title: t.title })))
    );
    localStorage.setItem(TABS_KEY + '-active', activeId || '');
  }

  function loadTabs() {
    try {
      return JSON.parse(localStorage.getItem(TABS_KEY)) || [];
    } catch (_) {
      return [];
    }
  }

  /* ---------- destino das capturas ---------- */

  async function targetProject() {
    const id = localStorage.getItem(TARGET_KEY);
    if (!id) return null;
    return (await E.db.get('projects', id)) || null;
  }

  async function requireTarget() {
    const p = await targetProject();
    if (p) return p;
    E.ui.toast('Escolha em qual projeto guardar — no seletor "Guardar em" aí em cima');
    return null;
  }

  function jitter() {
    return Math.round(Math.random() * 90);
  }

  async function addItemToProject(p, partial) {
    const item = Object.assign(
      {
        id: E.uid(),
        projectId: p.id,
        board: p.lastBoard || (p.boards && p.boards[0] && p.boards[0].id),
        x: jitter(),
        y: jitter(),
        z: 1,
      },
      partial
    );
    await E.db.put('items', item);
    p.updatedAt = Date.now();
    await E.db.put('projects', p);
    return item;
  }

  async function saveImageBlob(p, blob, toastLabel) {
    const blobId = await E.db.saveBlob(blob);
    let w = 420;
    let h = 300;
    try {
      const bmp = await createImageBitmap(blob);
      w = Math.min(420, bmp.width || 420);
      h = Math.max(40, Math.round(w * ((bmp.height || 300) / (bmp.width || 420))));
      if (bmp.close) bmp.close();
    } catch (_) {}
    await addItemToProject(p, { kind: 'image', w: w, h: h, content: { blobId: blobId } });
    if (!p.coverBlobId) {
      p.coverBlobId = blobId;
      await E.db.put('projects', p);
    }
    E.ui.toast(toastLabel + ' guardado em "' + (p.name || 'Projeto') + '"');
  }

  /* ---------- ferramentas de estudo ---------- */

  async function capturePage() {
    const t = active();
    if (!t || !t.wv) return;
    const p = await requireTarget();
    if (!p) return;
    try {
      const dataUrl = await window.livraiNative.captureWebview(t.wv.getWebContentsId());
      if (!dataUrl) throw new Error('captura vazia');
      const blob = await (await fetch(dataUrl)).blob();
      await saveImageBlob(p, blob, 'Print da página');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ Não consegui capturar a página');
    }
  }

  async function saveWebImage(srcURL) {
    const p = await requireTarget();
    if (!p) return;
    try {
      const r = await fetch('/__studio/fetch-url?u=' + encodeURIComponent(srcURL), {
        headers: { 'X-Livrai': '1' },
      });
      if (!r.ok) throw new Error('download falhou');
      const blob = await r.blob();
      if ((blob.type || '').indexOf('image/') !== 0 && blob.size < 100) throw new Error('não é imagem');
      await saveImageBlob(p, blob, 'Imagem');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ Não consegui baixar essa imagem');
    }
  }

  async function saveSelText(text) {
    const p = await requireTarget();
    if (!p) return;
    await addItemToProject(p, { kind: 'note', w: 300, h: 220, content: { text: text } });
    E.ui.toast('Nota criada em "' + (p.name || 'Projeto') + '"');
  }

  async function savePageLink(url, title) {
    const p = await requireTarget();
    if (!p) return;
    await addItemToProject(p, {
      kind: 'link',
      w: 240,
      h: 110,
      content: { url: url, title: (title || '').slice(0, 60) },
    });
    E.ui.toast('Link guardado em "' + (p.name || 'Projeto') + '"');
  }

  /* ---------- guias ---------- */

  function active() {
    return tabs.find((t) => t.id === activeId) || null;
  }

  function normalizeInput(q) {
    const s = q.trim();
    if (!s) return HOME;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[^\s]+\.[^\s]{2,}/.test(s)) return 'https://' + s;
    return 'https://www.google.com/search?q=' + encodeURIComponent(s);
  }

  function mkWebview(tab) {
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:livrai-nav');
    wv.setAttribute('allowpopups', 'true');
    wv.className = 'browser-wv';
    wv.src = tab.url || HOME;

    wv.addEventListener('page-title-updated', (e) => {
      tab.title = e.title || tab.title;
      saveTabs();
      renderTabs();
    });
    const onNav = (e) => {
      if (e.url) {
        tab.url = e.url;
        saveTabs();
        if (tab.id === activeId) {
          const input = container.querySelector('.browser-url');
          if (input && document.activeElement !== input) input.value = e.url;
        }
      }
    };
    wv.addEventListener('did-navigate', onNav);
    wv.addEventListener('did-navigate-in-page', onNav);

    wv.addEventListener('context-menu', (e) => {
      const params = e.params || {};
      const rect = wv.getBoundingClientRect();
      const x = rect.left + (params.x || 0);
      const y = rect.top + (params.y || 0);
      const entries = [];
      if (params.mediaType === 'image' && params.srcURL) {
        entries.push({
          label: 'Guardar imagem no projeto',
          icon: 'image',
          onClick: () => saveWebImage(params.srcURL),
        });
      }
      if (params.selectionText && params.selectionText.trim().length > 2) {
        entries.push({
          label: 'Guardar texto como nota',
          icon: 'note',
          onClick: () => saveSelText(params.selectionText.trim()),
        });
      }
      if (params.linkURL) {
        entries.push({
          label: 'Abrir link em nova guia',
          icon: 'plus',
          onClick: () => newTab(params.linkURL),
        });
        entries.push({
          label: 'Guardar link no projeto',
          icon: 'link',
          onClick: () => savePageLink(params.linkURL, params.linkText || ''),
        });
      }
      entries.push({
        label: 'Tirar print da página',
        icon: 'camera',
        onClick: capturePage,
      });
      entries.push({
        label: 'Guardar esta página como link',
        icon: 'link',
        onClick: () => savePageLink(tab.url, tab.title),
      });
      E.ui.menu(x, y, entries);
    });

    return wv;
  }

  function newTab(url) {
    const tab = { id: E.uid(), url: url || HOME, title: 'Nova guia' };
    tabs.push(tab);
    activeId = tab.id;
    mountTab(tab);
    saveTabs();
    renderTabs();
    syncActive();
  }

  function closeTab(tab) {
    if (tab.wv) tab.wv.remove();
    tabs = tabs.filter((t) => t.id !== tab.id);
    if (activeId === tab.id) activeId = tabs.length ? tabs[tabs.length - 1].id : null;
    if (!tabs.length) {
      newTab(HOME);
      return;
    }
    saveTabs();
    renderTabs();
    syncActive();
  }

  function mountTab(tab) {
    if (tab.wv) return;
    tab.wv = mkWebview(tab);
    container.querySelector('.browser-stage').appendChild(tab.wv);
  }

  function syncActive() {
    tabs.forEach((t) => {
      if (t.wv) t.wv.classList.toggle('hidden', t.id !== activeId);
    });
    const t = active();
    const input = container.querySelector('.browser-url');
    if (t && input && document.activeElement !== input) input.value = t.url || '';
  }

  function renderTabs() {
    const strip = container.querySelector('.browser-tabs');
    if (!strip) return;
    strip.innerHTML = '';
    tabs.forEach((t) => {
      const el = document.createElement('button');
      el.className = 'browser-tab' + (t.id === activeId ? ' active' : '');
      const label = document.createElement('span');
      label.textContent = t.title || 'Guia';
      const x = document.createElement('span');
      x.className = 'browser-tab-x';
      x.innerHTML = E.icon('close', 11);
      x.title = 'Fechar guia';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(t);
      });
      el.appendChild(label);
      el.appendChild(x);
      el.addEventListener('click', () => {
        activeId = t.id;
        saveTabs();
        renderTabs();
        syncActive();
      });
      strip.appendChild(el);
    });
    const add = document.createElement('button');
    add.className = 'browser-tab browser-tab-add';
    add.innerHTML = E.icon('plus', 13);
    add.title = 'Nova guia';
    add.addEventListener('click', () => newTab(HOME));
    strip.appendChild(add);
  }

  async function renderTargetSelect() {
    const sel = container.querySelector('.browser-target');
    if (!sel) return;
    sel.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Guardar em…';
    sel.appendChild(none);
    const projects = (await E.db.getAll('projects'))
      .filter((p) => !p.archived)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    projects.forEach((p) => {
      const op = document.createElement('option');
      op.value = p.id;
      op.textContent = p.name;
      sel.appendChild(op);
    });
    sel.value = localStorage.getItem(TARGET_KEY) || '';
    if (sel.value === '' && localStorage.getItem(TARGET_KEY)) localStorage.removeItem(TARGET_KEY);
    sel.addEventListener('change', () => {
      if (sel.value) localStorage.setItem(TARGET_KEY, sel.value);
      else localStorage.removeItem(TARGET_KEY);
    });
  }

  /* ---------- view ---------- */

  E.browser.render = async function (root) {
    container = root;

    if (!isDesktop()) {
      root.innerHTML =
        '<div class="browser-only-desktop"><p class="hint-big">Navegador embutido</p>' +
        '<p>Esta visão precisa do aplicativo LIVRAI (desktop) — é ele que carrega o motor do navegador.<br>' +
        'Baixe em <a href="https://github.com/LouisLuix/livrai/releases/latest" target="_blank" rel="noopener">github.com/LouisLuix/livrai</a>.</p></div>';
      return;
    }

    if (!root.querySelector('.browser-bar')) {
      root.innerHTML =
        '<div class="browser-bar">' +
        '<button class="btn ghost icon-only browser-back" title="Voltar">‹</button>' +
        '<button class="btn ghost icon-only browser-fwd" title="Avançar">›</button>' +
        '<button class="btn ghost icon-only browser-reload" title="Recarregar">' + E.icon('refresh', 14) + '</button>' +
        '<input class="browser-url mono" spellcheck="false" placeholder="Endereço ou busca — Pinterest, Behance, referências…">' +
        '<select class="browser-target" title="Projeto onde os prints, imagens, textos e links serão guardados"></select>' +
        '<button class="btn browser-shot">' + E.icon('camera', 14) + '<span>Print</span></button>' +
        '<button class="btn ghost browser-savelink" title="Guardar esta página como card de link">' + E.icon('link', 14) + '<span>Guardar página</span></button>' +
        '</div>' +
        '<div class="browser-tabs"></div>' +
        '<div class="browser-stage"></div>';

      const input = root.querySelector('.browser-url');
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          const t = active();
          if (t && t.wv) {
            const url = normalizeInput(input.value);
            t.wv.loadURL(url);
            input.blur();
          }
        }
      });
      root.querySelector('.browser-back').addEventListener('click', () => {
        const t = active();
        if (t && t.wv && t.wv.canGoBack()) t.wv.goBack();
      });
      root.querySelector('.browser-fwd').addEventListener('click', () => {
        const t = active();
        if (t && t.wv && t.wv.canGoForward()) t.wv.goForward();
      });
      root.querySelector('.browser-reload').addEventListener('click', () => {
        const t = active();
        if (t && t.wv) t.wv.reload();
      });
      root.querySelector('.browser-shot').addEventListener('click', capturePage);
      root.querySelector('.browser-savelink').addEventListener('click', () => {
        const t = active();
        if (t) savePageLink(t.url, t.title);
      });

      tabs = loadTabs().map((t) => ({ id: t.id, url: t.url, title: t.title }));
      if (!tabs.length) tabs = [{ id: E.uid(), url: HOME, title: 'Nova guia' }];
      activeId = localStorage.getItem(TABS_KEY + '-active');
      if (!tabs.some((t) => t.id === activeId)) activeId = tabs[0].id;
      tabs.forEach((t) => mountTab(t));
    }

    renderTabs();
    syncActive();
    renderTargetSelect();
  };
})();
