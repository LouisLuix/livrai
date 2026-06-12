/* Configurações: painel lateral com navegação por seções —
   Clientes, IA & Identidade, Backup e Integrações */
(function () {
  const E = window.Estudio;
  const root = document.getElementById('settings-root');

  const SECTIONS = [
    { id: 'clients', label: 'Clientes', icon: 'users' },
    { id: 'ai', label: 'IA & Identidade', icon: 'sparkles' },
    { id: 'backup', label: 'Backup', icon: 'database' },
    { id: 'integrations', label: 'Integrações', icon: 'brush' },
    { id: 'updates', label: 'Atualizações', icon: 'refresh' },
    { id: 'about', label: 'Licença', icon: 'logo' },
  ];

  let currentSection = 'clients';

  /* ---------- backup completo (projetos + imagens) ---------- */

  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function exportBackup() {
    E.ui.toast('Preparando backup…');
    const [projects, items, blobs, clients] = await Promise.all([
      E.db.getAll('projects'),
      E.db.getAll('items'),
      E.db.getAll('blobs'),
      E.db.getAll('clients'),
    ]);
    const blobsB64 = [];
    for (const b of blobs) {
      blobsB64.push({ id: b.id, type: b.blob.type, data: await blobToB64(b.blob) });
    }
    const payload = JSON.stringify({ app: 'estudio', version: 1, projects, items, clients, blobs: blobsB64 });
    const date = new Date().toISOString().slice(0, 10);
    E.exporter.downloadBlob('estudio-backup-' + date + '.json', new Blob([payload], { type: 'application/json' }));
    E.ui.toast('Backup salvo na pasta de Downloads — guarde esse arquivo!');
  }

  async function importBackup(file) {
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (_) {
      E.ui.toast('⚠️ Esse arquivo não é um backup válido');
      return;
    }
    if (!data || data.app !== 'estudio' || !Array.isArray(data.projects)) {
      E.ui.toast('⚠️ Esse arquivo não é um backup do Estúdio');
      return;
    }
    const ok = await E.ui.confirm(
      'Restaurar backup?',
      'Vai trazer ' + data.projects.length + ' projeto(s) do arquivo. Projetos com o mesmo nome interno serão sobrescritos pela versão do backup.',
      'Restaurar'
    );
    if (!ok) return;
    try {
      // Decodifica TODOS os blobs antes de gravar qualquer coisa —
      // um arquivo corrompido não deixa a restauração pela metade
      const decoded = [];
      for (const b of data.blobs || []) {
        const bin = atob(b.data || '');
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        decoded.push({ id: b.id, blob: new Blob([bytes], { type: b.type }) });
      }
      for (const b of decoded) await E.db.put('blobs', b);
      for (const it of data.items || []) await E.db.put('items', it);
      for (const c of data.clients || []) await E.db.put('clients', c);
      for (const p of data.projects) await E.db.put('projects', p);
      E.ui.toast('Backup restaurado');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ O arquivo de backup parece corrompido — nada foi alterado');
    }
    E.gallery.render();
  }

  /* ---------- seções ---------- */

  function sectionClients(content) {
    content.innerHTML =
      '<p class="settings-section-title">Clientes</p>' +
      '<p class="settings-desc">Cadastre seus clientes pra vincular aos projetos e filtrar a galeria. ' +
      'O vínculo é só organização — nada financeiro.</p>';

    const list = document.createElement('div');
    list.className = 'client-list';
    content.appendChild(list);

    function renderList() {
      list.innerHTML = '';
      if (!E.state.clients.length) {
        const empty = document.createElement('p');
        empty.className = 'settings-desc';
        empty.textContent = 'Nenhum cliente cadastrado ainda.';
        list.appendChild(empty);
        return;
      }
      E.state.clients.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'client-row';
        const name = document.createElement('span');
        name.className = 'client-name';
        name.innerHTML = E.icon('user', 14);
        const ns = document.createElement('span');
        ns.textContent = c.name;
        name.appendChild(ns);
        row.appendChild(name);

        const n = E.state.projects.filter((p) => p.clientId === c.id).length;
        const count = document.createElement('span');
        count.className = 'chip-count';
        count.title = 'Projetos vinculados';
        count.textContent = n + (n === 1 ? ' projeto' : ' projetos');
        row.appendChild(count);

        const ren = document.createElement('button');
        ren.className = 'btn ghost';
        ren.textContent = 'Renomear';
        ren.addEventListener('click', async () => {
          const vals = await E.ui.modal({
            title: 'Renomear cliente',
            fields: [{ name: 'name', label: 'Nome', value: c.name }],
          });
          if (vals === null || !vals.name.trim()) return;
          await E.db.put('clients', Object.assign({}, c, { name: vals.name.trim() }));
          await E.clients.all();
          renderList();
          E.gallery.render();
        });
        row.appendChild(ren);

        const del = document.createElement('button');
        del.className = 'btn ghost danger';
        del.textContent = 'Excluir';
        del.addEventListener('click', async () => {
          const ok = await E.ui.confirm(
            'Excluir cliente "' + c.name + '"?',
            n
              ? 'Os ' + n + ' projeto(s) vinculados NÃO serão apagados — só ficam sem cliente.'
              : 'Nenhum projeto está vinculado a este cliente.',
            'Excluir'
          );
          if (!ok) return;
          for (const p of E.state.projects) {
            if (p.clientId === c.id) {
              await E.db.put('projects', Object.assign({}, p, { clientId: null }));
            }
          }
          await E.db.del('clients', c.id);
          if (E.state.galleryClientFilter === c.id) E.state.galleryClientFilter = 'all';
          E.ui.toast('Cliente excluído');
          await E.clients.all();
          renderList();
          E.gallery.render();
        });
        row.appendChild(del);
        list.appendChild(row);
      });
    }
    renderList();

    const addRow = document.createElement('form');
    addRow.className = 'client-add';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Nome do novo cliente';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const addBtn = document.createElement('button');
    addBtn.type = 'submit';
    addBtn.className = 'btn primary';
    E.setLabel(addBtn, 'plus', 'Cadastrar');
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    addRow.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      const exists = E.state.clients.some(
        (c) => c.name.toLowerCase() === name.toLowerCase()
      );
      if (exists) {
        E.ui.toast('Já existe um cliente com esse nome');
        return;
      }
      await E.clients.add(name);
      input.value = '';
      await E.clients.all();
      renderList();
      E.gallery.render();
      E.ui.toast('Cliente cadastrado');
    });
    content.appendChild(addRow);
  }

  function sectionAi(content) {
    content.innerHTML =
      '<p class="settings-section-title">IA & Identidade</p>' +
      '<p class="settings-desc">Conecte suas chaves de IA (texto, imagem, vídeo e áudio) e descreva sua identidade criativa — ' +
      'ela entra em todas as gerações, em todos os projetos.</p>';

    const block = document.createElement('div');
    block.className = 'settings-block';
    block.innerHTML =
      '<h4>' + E.icon('key', 16) + '<span>Chaves e identidade criativa</span></h4>' +
      '<p>As chaves ficam salvas só neste navegador, no seu computador. ' +
      'Configure Claude, OpenAI, Gemini, ElevenLabs e fal.ai, teste cada conexão e escreva sua assinatura estética.</p>';
    const btn = document.createElement('button');
    btn.className = 'btn primary';
    E.setLabel(btn, 'sparkles', 'Abrir configurações de IA');
    btn.addEventListener('click', () => {
      close();
      E.ai.openSettings();
    });
    block.appendChild(btn);
    content.appendChild(block);
  }

  function sectionBackup(content) {
    content.innerHTML =
      '<p class="settings-section-title">Backup</p>' +
      '<p class="settings-desc">Tudo fica salvo localmente. Conecte uma pasta pro salvamento ' +
      'automático — e gere backups manuais quando quiser.</p>';

    const folder = document.createElement('div');
    folder.className = 'settings-block';
    folder.innerHTML =
      '<h4>' + E.icon('folder', 16) + '<span>Pasta do Estúdio</span></h4>' +
      '<p>Seus projetos são salvos sozinhos num arquivo dentro da pasta escolhida. ' +
      'Aponte o navegador e o aplicativo pra MESMA pasta e os dois mostram os mesmos projetos.</p>';
    const status = document.createElement('p');
    status.className = 'mono sync-status';
    status.textContent = 'Verificando…';
    folder.appendChild(status);
    const folderActions = document.createElement('div');
    folder.appendChild(folderActions);
    content.appendChild(folder);

    async function refreshFolder() {
      const st = await E.sync.getStatus();
      folderActions.innerHTML = '';
      if (!st.supported) {
        status.textContent = 'Este ambiente não permite conectar pasta — use o Chrome.';
        return;
      }
      if (st.connected) {
        status.textContent =
          'Conectado a "' + st.name + '"' +
          (st.lastSavedAt
            ? ' · salvo ' + new Date(st.lastSavedAt).toLocaleString('pt-BR')
            : '');
        const saveBtn = document.createElement('button');
        saveBtn.className = 'btn primary';
        E.setLabel(saveBtn, 'check', 'Salvar agora');
        saveBtn.addEventListener('click', async () => {
          const ok = await E.sync.saveNow(true);
          E.ui.toast(ok ? 'Projetos salvos na pasta' : '⚠️ Não consegui salvar — permissão negada?');
          refreshFolder();
        });
        folderActions.appendChild(saveBtn);
        const swapBtn = document.createElement('button');
        swapBtn.className = 'btn';
        E.setLabel(swapBtn, 'folder', 'Trocar pasta');
        swapBtn.addEventListener('click', async () => {
          await E.sync.connect();
          refreshFolder();
        });
        folderActions.appendChild(swapBtn);
        const offBtn = document.createElement('button');
        offBtn.className = 'btn ghost danger';
        E.setLabel(offBtn, 'close', 'Desconectar');
        offBtn.addEventListener('click', async () => {
          await E.sync.disconnect();
          refreshFolder();
        });
        folderActions.appendChild(offBtn);
      } else {
        status.textContent = 'Nenhuma pasta conectada — os projetos vivem só neste app.';
        const onBtn = document.createElement('button');
        onBtn.className = 'btn primary';
        E.setLabel(onBtn, 'folder', 'Escolher pasta…');
        onBtn.addEventListener('click', async () => {
          await E.sync.connect();
          localStorage.setItem('livrai-storage-choice', 'folder');
          refreshFolder();
        });
        folderActions.appendChild(onBtn);
      }
    }
    refreshFolder();

    const save = document.createElement('div');
    save.className = 'settings-block';
    save.innerHTML =
      '<h4>' + E.icon('download', 16) + '<span>Salvar backup</span></h4>' +
      '<p>Gera um arquivo .json com tudo. Guarde num pen drive ou na nuvem.</p>';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn primary';
    E.setLabel(saveBtn, 'download', 'Salvar backup agora');
    saveBtn.addEventListener('click', exportBackup);
    save.appendChild(saveBtn);
    content.appendChild(save);

    const restore = document.createElement('div');
    restore.className = 'settings-block';
    restore.innerHTML =
      '<h4>' + E.icon('upload', 16) + '<span>Restaurar backup</span></h4>' +
      '<p>Traz de volta os projetos de um arquivo de backup gerado aqui.</p>';
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'btn';
    E.setLabel(restoreBtn, 'upload', 'Escolher arquivo…');
    restoreBtn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.addEventListener('change', () => {
        if (input.files[0]) importBackup(input.files[0]);
      });
      input.click();
    });
    restore.appendChild(restoreBtn);
    content.appendChild(restore);
  }

  function sectionIntegrations(content) {
    content.innerHTML =
      '<p class="settings-section-title">Integrações</p>' +
      '<p class="settings-desc">Conexões com ferramentas externas do seu fluxo de trabalho.</p>';

    const desktop = E.files.desktop && E.files.desktop();
    if (desktop) {
      // App desktop: a pasta do Estúdio é predefinida na instalação e
      // alterável aqui — nenhuma ação do dia a dia pergunta onde salvar.
      const st = document.createElement('div');
      st.className = 'settings-block';
      st.innerHTML =
        '<h4>' + E.icon('folder', 16) + '<span>Pasta do Estúdio</span></h4>' +
        '<p>Tudo que você cria fica guardado aqui, organizado por projeto — ' +
        'e abre direto no Photoshop, sem perguntar onde salvar.</p>' +
        '<p class="mono">' + E.escapeHtml(desktop.root) + '</p>';
      const changeBtn = document.createElement('button');
      changeBtn.className = 'btn';
      E.setLabel(changeBtn, 'folder', 'Alterar pasta…');
      changeBtn.addEventListener('click', async () => {
        const r = await E.files.chooseStudioFolder();
        if (r) {
          E.ui.toast('Pasta do Estúdio atualizada');
          sectionIntegrations(content);
        }
      });
      const revealBtn = document.createElement('button');
      revealBtn.className = 'btn ghost';
      E.setLabel(revealBtn, 'eye', 'Mostrar a pasta');
      revealBtn.addEventListener('click', () => E.files.revealStudio());
      st.appendChild(changeBtn);
      st.appendChild(revealBtn);
      content.appendChild(st);
    } else {
      const ps = document.createElement('div');
      ps.className = 'settings-block';
      ps.innerHTML =
        '<h4>' + E.icon('brush', 16) + '<span>Photoshop</span></h4>' +
        '<p>O Estúdio salva imagens numa pasta vigiada e abre direto no Photoshop. ' +
        'Se a pasta mudou de lugar, desconecte aqui e escolha de novo no próximo uso.</p>';
      const btn = document.createElement('button');
      btn.className = 'btn';
      E.setLabel(btn, 'refresh', 'Reconectar pasta');
      btn.addEventListener('click', async () => {
        await E.db.del('handles', 'projectsDir');
        E.ui.toast('Pasta desconectada — no próximo "Abrir no Photoshop" você escolhe de novo');
      });
      ps.appendChild(btn);
      content.appendChild(ps);
    }

    const ig = document.createElement('div');
    ig.className = 'settings-block';
    ig.innerHTML =
      '<h4>' + E.icon('smartphone', 16) + '<span>Instagram</span></h4>' +
      '<p>Publicação assistida: botão direito num post → "Publicar no Instagram" salva as ' +
      'mídias na pasta do projeto, copia a legenda e abre o Instagram — é só arrastar e colar. ' +
      'Salve seu usuário aqui pro Estúdio abrir direto no seu perfil.</p>';
    const igRow = document.createElement('form');
    igRow.className = 'client-add';
    const igInput = document.createElement('input');
    igInput.type = 'text';
    igInput.placeholder = '@seuusuario';
    igInput.autocomplete = 'off';
    igInput.spellcheck = false;
    igInput.value = E.insta.user() ? '@' + E.insta.user() : '';
    const igBtn = document.createElement('button');
    igBtn.type = 'submit';
    igBtn.className = 'btn primary';
    E.setLabel(igBtn, 'check', 'Salvar');
    igRow.appendChild(igInput);
    igRow.appendChild(igBtn);
    igRow.addEventListener('submit', (e) => {
      e.preventDefault();
      const clean = E.insta.setUser(igInput.value);
      igInput.value = clean ? '@' + clean : '';
      E.ui.toast(clean ? 'Conta @' + clean + ' vinculada' : 'Conta desvinculada');
    });
    ig.appendChild(igRow);
    content.appendChild(ig);
  }

  /* Link direto do instalador no release da versão (tag v{versão} — nunca quebra
     mesmo que uma versão mais nova vire "latest" antes do usuário clicar) */
  function updateAssetUrl(version, file) {
    return E.REPO_URL + '/releases/download/v' + version + '/' + file;
  }

  function sectionUpdates(content) {
    content.innerHTML =
      '<p class="settings-section-title">Atualizações</p>' +
      '<p class="settings-desc">O Estúdio confere sozinho a cada 6 horas. ' +
      'Aqui você verifica na hora e baixa a versão nova quando houver.</p>';

    const current = document.createElement('div');
    current.className = 'settings-block';
    const last = E.updates.lastChecked();
    current.innerHTML =
      '<h4>' + E.icon('logo', 16) + '<span>Versão instalada</span></h4>' +
      '<p class="mono">v' + E.APP_VERSION +
      (last
        ? ' · última verificação: ' + new Date(last).toLocaleString('pt-BR')
        : ' · nunca verificado') +
      '</p>';
    const checkBtn = document.createElement('button');
    checkBtn.className = 'btn primary';
    E.setLabel(checkBtn, 'refresh', 'Verificar atualizações agora');
    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      E.setLabel(checkBtn, 'refresh', 'Verificando…');
      const res = await E.updates.check(true);
      if (res === 'update') {
        E.ui.toast('Versão ' + E.updates.info().version + ' disponível!');
      } else if (res === 'current') {
        E.ui.toast('Você já está na versão mais recente');
      } else {
        E.ui.toast('⚠️ Não consegui verificar — confira a internet e tente de novo');
      }
      sectionUpdates(content); // re-renderiza com o resultado
    });
    current.appendChild(checkBtn);
    content.appendChild(current);

    const up = E.updates.info();
    if (up) {
      const block = document.createElement('div');
      block.className = 'settings-block update-avail';
      block.innerHTML =
        '<h4>' + E.icon('download', 16) + '<span>Nova versão disponível — v' + E.escapeHtml(up.version) + '</span></h4>' +
        (up.notes ? '<p>' + E.escapeHtml(up.notes) + '</p>' : '') +
        '<p>Baixe e instale por cima da versão atual — seus projetos continuam onde estão. ' +
        'Quando o download terminar, feche o Estúdio e abra o arquivo baixado.</p>';
      const actions = document.createElement('div');
      actions.className = 'update-actions';
      const mkDl = (label, file, primary) => {
        const b = document.createElement('button');
        b.className = primary ? 'btn primary' : 'btn';
        E.setLabel(b, 'download', label);
        b.addEventListener('click', () => {
          window.open(updateAssetUrl(up.version, file), '_blank', 'noopener');
          E.ui.toast('Baixando v' + up.version + '… quando terminar, feche o Estúdio e rode o arquivo');
        });
        actions.appendChild(b);
      };
      const plat = String(navigator.platform || '');
      if (/mac/i.test(plat)) {
        mkDl('Baixar pra Mac (Apple Silicon)', 'Livrai-' + up.version + '-macOS-arm64.zip', true);
        mkDl('Mac com chip Intel', 'Livrai-' + up.version + '-macOS-x64.zip', false);
      } else {
        mkDl('Baixar e atualizar (Windows)', 'Instalar-Livrai-' + up.version + '-Windows.exe', true);
      }
      const page = document.createElement('button');
      page.className = 'btn ghost';
      E.setLabel(page, 'arrow-up-right', 'Ver no GitHub');
      page.addEventListener('click', () => {
        window.open(up.url || E.REPO_URL + '/releases/latest', '_blank', 'noopener');
      });
      actions.appendChild(page);
      block.appendChild(actions);
      content.appendChild(block);
    } else {
      const okBlock = document.createElement('div');
      okBlock.className = 'settings-block';
      okBlock.innerHTML =
        '<h4>' + E.icon('check', 16) + '<span>Tudo em dia</span></h4>' +
        '<p>Nenhuma atualização pendente. Quando sair versão nova, uma bolinha laranja ' +
        'acende no botão Configurações e o download aparece aqui.</p>';
      content.appendChild(okBlock);
    }
  }

  function sectionAbout(content) {
    content.innerHTML =
      '<p class="settings-section-title">Sobre &amp; Licença</p>' +

      '<div class="about-brand">' +
      E.icon('logo', 34) +
      '<div><h3>LIVRAI</h3><p class="about-tag mono">Estúdio — organizador de entregas</p></div>' +
      '</div>' +

      '<div class="settings-block">' +
      '<h4>' + E.icon('star', 16) + '<span>O que o LIVRAI resolve</span></h4>' +
      '<p>Quem dirige criação vive com o trabalho espalhado: referências numa pasta, ' +
      'roteiros em notas soltas, datas de postagem na cabeça e entregas de cada cliente ' +
      'em dez lugares diferentes. O LIVRAI junta tudo isso num lugar só — um estúdio visual ' +
      'onde cada projeto é um canvas vivo, com fases de entrega, cronograma de posts, ' +
      'identidade de marca e geração por IA trabalhando dentro do seu processo, e não contra ele.</p>' +
      '<p>Tudo roda no seu computador: seus projetos, imagens e chaves ficam com você. ' +
      'Sem conta, sem nuvem obrigatória, sem mensalidade.</p>' +
      '</div>' +

      '<div class="settings-block">' +
      '<h4>' + E.icon('check', 16) + '<span>Código aberto</span></h4>' +
      '<p>O LIVRAI é um software de código aberto (open source), distribuído sob a licença MIT: ' +
      'você pode usar, estudar, modificar e redistribuir este software livremente, ' +
      'inclusive em trabalhos comerciais, desde que preserve o aviso de copyright e esta licença.</p>' +
      '<p>O software é fornecido "como está", sem garantias de qualquer tipo. ' +
      'Em nenhuma circunstância os autores serão responsabilizados por danos ' +
      'decorrentes do uso deste software.</p>' +
      '</div>' +

      '<div class="settings-block">' +
      '<h4>' + E.icon('pencil', 16) + '<span>Desenvolvedor</span></h4>' +
      '<p>Criado e desenvolvido por <strong>Luis Gustavo Felix</strong> ' +
      '<a class="about-handle mono" href="https://instagram.com/luisluix" target="_blank" rel="noopener">@luisluix</a></p>' +
      '<p class="mono about-copy">© ' + new Date().getFullYear() + ' Luis Gustavo Felix · Licença MIT · v' + E.APP_VERSION + '</p>' +
      '</div>';
  }

  const RENDERERS = {
    clients: sectionClients,
    ai: sectionAi,
    backup: sectionBackup,
    integrations: sectionIntegrations,
    updates: sectionUpdates,
    about: sectionAbout,
  };

  /* ---------- painel ---------- */

  let panelEl = null;

  function close() {
    if (!panelEl) return;
    const p = panelEl;
    panelEl = null;
    window.removeEventListener('keydown', onEsc, true);
    p.panel.classList.add('closing');
    p.backdrop.style.opacity = '0';
    setTimeout(() => {
      root.innerHTML = '';
    }, 280);
  }

  function onEsc(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  async function open(section) {
    if (E.account && E.account.closePanel) E.account.closePanel(true);
    await E.clients.all();
    if (section) currentSection = section;
    root.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'settings-backdrop';
    backdrop.style.transition = 'opacity 0.25s';
    backdrop.addEventListener('pointerdown', close);

    const panel = document.createElement('div');
    panel.className = 'settings-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Configurações');

    const head = document.createElement('div');
    head.className = 'settings-head';
    const h = document.createElement('h2');
    h.textContent = 'Configurações';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost icon-only';
    closeBtn.innerHTML = E.icon('close', 18);
    closeBtn.title = 'Fechar (Esc)';
    closeBtn.addEventListener('click', close);
    head.appendChild(h);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const up = E.updates && E.updates.info();
    if (up) {
      const banner = document.createElement('button');
      banner.className = 'update-banner';
      banner.innerHTML =
        E.icon('download', 16) +
        '<span><strong>Atualização disponível — v' + E.escapeHtml(up.version) + '</strong>' +
        (up.notes ? '<em>' + E.escapeHtml(up.notes) + '</em>' : '') +
        '</span>' +
        E.icon('arrow-up-right', 14);
      banner.title = 'Ver e baixar a nova versão';
      banner.addEventListener('click', () => setSection('updates'));
      panel.appendChild(banner);
    }

    const body = document.createElement('div');
    body.className = 'settings-body';

    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    const content = document.createElement('div');
    content.className = 'settings-content';

    function setSection(id) {
      currentSection = id;
      nav.querySelectorAll('button').forEach((b) => {
        b.classList.toggle('active', b.dataset.id === id);
      });
      RENDERERS[id](content);
    }

    SECTIONS.forEach((s) => {
      const b = document.createElement('button');
      b.dataset.id = s.id;
      b.insertAdjacentHTML('beforeend', E.icon(s.icon, 16));
      const sp = document.createElement('span');
      sp.textContent = s.label;
      b.appendChild(sp);
      b.addEventListener('click', () => setSection(s.id));
      nav.appendChild(b);
    });

    body.appendChild(nav);
    body.appendChild(content);
    panel.appendChild(body);

    root.appendChild(backdrop);
    root.appendChild(panel);
    panelEl = { panel, backdrop };
    window.addEventListener('keydown', onEsc, true);
    setSection(currentSection);
  }

  E.settings = { open, close, exportBackup };
})();
