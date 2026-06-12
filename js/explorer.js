/* Explorador: navega nas pastas vinculadas ao projeto sem sair do Estúdio.
   Pasta abre dentro do próprio explorador; arquivo abre no app nativo com
   um clique — e qualquer arquivo pode ser puxado pro canvas do projeto. */
(function () {
  const E = window.Estudio;
  E.explorer = {};

  let rootPath = null; // a pasta vinculada (teto da navegação)
  let rootName = '';

  function overlayRoot() {
    let el = document.getElementById('explorer-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'explorer-root';
      document.body.appendChild(el);
    }
    return el;
  }

  E.explorer.close = function () {
    overlayRoot().innerHTML = '';
  };

  E.explorer.open = async function (path, name) {
    const ok = await E.files.isDesktop();
    if (!ok) {
      E.ui.toast('Explorar pastas precisa do app Livrai (desktop)');
      return;
    }
    rootPath = path;
    rootName = name || String(path || '').split('/').filter(Boolean).pop() || 'Pasta';
    render(path);
  };

  async function render(current) {
    const root = overlayRoot();
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal explorer';
    overlay.appendChild(box);
    root.appendChild(overlay);

    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) E.explorer.close();
    });
    window.addEventListener(
      'keydown',
      function onEsc(e) {
        if (e.key === 'Escape') {
          e.stopPropagation();
          window.removeEventListener('keydown', onEsc, true);
          E.explorer.close();
        }
      },
      true
    );

    // cabeçalho: migalhas de pão (até o teto da pasta vinculada) + ações
    const head = document.createElement('div');
    head.className = 'explorer-head';
    const crumbs = document.createElement('div');
    crumbs.className = 'explorer-crumbs';
    const relParts = current === rootPath ? [] : current.slice(rootPath.length).split('/').filter(Boolean);
    const mkCrumb = (label, target, last) => {
      const b = document.createElement('button');
      b.className = 'explorer-crumb' + (last ? ' current' : '');
      b.textContent = label;
      if (!last) b.addEventListener('click', () => render(target));
      crumbs.appendChild(b);
      if (!last) {
        const sep = document.createElement('span');
        sep.className = 'explorer-sep';
        sep.textContent = '›';
        crumbs.appendChild(sep);
      }
    };
    mkCrumb(rootName, rootPath, relParts.length === 0);
    relParts.forEach((part, i) => {
      mkCrumb(part, rootPath + '/' + relParts.slice(0, i + 1).join('/'), i === relParts.length - 1);
    });
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const finderBtn = document.createElement('button');
    finderBtn.className = 'btn ghost';
    E.setLabel(finderBtn, 'folder', 'Abrir no Finder');
    finderBtn.addEventListener('click', () => E.files.openPath(current));
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost icon-only';
    closeBtn.innerHTML = E.icon('close', 16);
    closeBtn.title = 'Fechar (Esc)';
    closeBtn.addEventListener('click', E.explorer.close);
    head.appendChild(crumbs);
    head.appendChild(spacer);
    head.appendChild(finderBtn);
    head.appendChild(closeBtn);
    box.appendChild(head);

    const list = document.createElement('div');
    list.className = 'explorer-list';
    box.appendChild(list);

    let data;
    try {
      data = await E.files.browse(current);
    } catch (err) {
      list.innerHTML = '<p class="explorer-empty">Não consegui abrir esta pasta — ela foi movida ou desvinculada.</p>';
      return;
    }

    if (!data.entries.length) {
      list.innerHTML = '<p class="explorer-empty">Pasta vazia</p>';
      return;
    }

    data.entries.forEach((en) => {
      const row = document.createElement('div');
      row.className = 'explorer-row' + (en.dir ? ' is-dir' : '');

      const ic = document.createElement('span');
      ic.className = 'explorer-ic';
      ic.innerHTML = E.icon(en.dir ? 'folder' : E.items.fileMeta(en.name).icon, 16);

      const nm = document.createElement('span');
      nm.className = 'explorer-name';
      nm.textContent = en.name;

      const meta = document.createElement('span');
      meta.className = 'explorer-meta mono';
      meta.textContent = en.dir ? 'pasta' : E.items.humanSize(en.size);

      row.appendChild(ic);
      row.appendChild(nm);
      row.appendChild(meta);

      if (!en.dir) {
        const add = document.createElement('button');
        add.className = 'btn ghost explorer-add';
        E.setLabel(add, 'plus', 'Pro canvas');
        add.title = 'Copiar este arquivo pro canvas do projeto';
        add.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            const blob = await E.files.readPath(en.path);
            await E.canvas.importFile(blob, en.name);
            E.ui.toast('"' + en.name + '" adicionado ao canvas');
          } catch (err) {
            console.error(err);
            E.ui.toast('⚠️ Não consegui importar esse arquivo');
          }
        });
        row.appendChild(add);
      }

      row.addEventListener('click', () => {
        if (en.dir) render(en.path);
        else E.files.openPath(en.path).catch(() => E.ui.toast('⚠️ Não consegui abrir o arquivo'));
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const entries = [];
        if (!en.dir) {
          entries.push({
            label: 'Abrir no aplicativo',
            icon: 'arrow-up-right',
            onClick: () => E.files.openPath(en.path),
          });
          entries.push({
            label: 'Copiar pro canvas do projeto',
            icon: 'plus',
            onClick: async () => {
              try {
                const blob = await E.files.readPath(en.path);
                await E.canvas.importFile(blob, en.name);
                E.ui.toast('"' + en.name + '" adicionado ao canvas');
              } catch (_) {
                E.ui.toast('⚠️ Não consegui importar esse arquivo');
              }
            },
          });
        } else {
          entries.push({ label: 'Entrar na pasta', icon: 'folder', onClick: () => render(en.path) });
        }
        entries.push({
          label: 'Mostrar no Finder',
          icon: 'eye',
          onClick: () => E.files.openPath(en.path, 'reveal'),
        });
        E.ui.menu(e.clientX, e.clientY, entries);
      });

      list.appendChild(row);
    });
  }
})();
