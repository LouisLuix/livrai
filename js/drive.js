/* Google Drive PESSOAL: cada usuário conecta a própria conta (janela do
   app, token cifrado só neste computador) e sobe arquivos do projeto pra
   Livrai/Projetos/(nome do projeto)/ no Drive DELE. Mesmo nome = nova
   versão do mesmo arquivo (histórico nativo do Drive). */
(function () {
  const E = window.Estudio;
  E.drive = {};
  const HD = { 'X-Livrai': '1' };

  E.drive.status = async function () {
    try {
      const r = await fetch('/__studio/drive-status', { headers: HD });
      if (!r.ok) return { connected: false };
      return await r.json();
    } catch (_) {
      return { connected: false, unavailable: true };
    }
  };

  function extFor(blob) {
    const t = (blob && blob.type) || '';
    if (t.indexOf('jpeg') >= 0) return 'jpg';
    if (t.indexOf('png') >= 0) return 'png';
    if (t.indexOf('webp') >= 0) return 'webp';
    if (t.indexOf('gif') >= 0) return 'gif';
    if (t.indexOf('pdf') >= 0) return 'pdf';
    if (t.indexOf('quicktime') >= 0) return 'mov';
    if (t.indexOf('video/') === 0) return 'mp4';
    if (t.indexOf('audio/') === 0) return 'mp3';
    return 'bin';
  }

  function baseName(it, blob) {
    const c = it.content || {};
    if (c.name) return c.name; // cards de arquivo guardam o nome original
    if (c.fileRef && c.fileRef.path) return c.fileRef.path.split('/').pop();
    const label = { image: 'arte', video: 'video', audio: 'audio' }[it.kind] || 'arquivo';
    return label + '.' + extFor(blob);
  }

  /* Sobe os itens selecionados pro Drive do usuário, no contexto do projeto */
  E.drive.uploadItems = async function (items) {
    const st = E.canvas.getState();
    const projName = (st.project && st.project.name) || 'Projeto';
    const status = await E.drive.status();
    if (!status.connected) {
      E.ui.toast('Conecte seu Google Drive primeiro — painel da Conta, bloco Nuvens');
      if (E.account) E.account.openPanel();
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    let ok = 0;
    let versions = 0;
    E.ui.toast('Subindo ' + items.length + (items.length > 1 ? ' arquivos' : ' arquivo') + ' pro seu Drive…');
    for (const it of items) {
      const c = it.content || {};
      if (!c.blobId) continue;
      const rec = await E.db.get('blobs', c.blobId);
      if (!rec || !rec.blob) continue;
      const name = projName + ' — ' + date + ' — ' + baseName(it, rec.blob);
      try {
        const r = await fetch(
          '/__studio/drive-upload?project=' + encodeURIComponent(projName) +
            '&name=' + encodeURIComponent(name) +
            '&type=' + encodeURIComponent(rec.blob.type || 'application/octet-stream'),
          { method: 'POST', headers: HD, body: rec.blob }
        );
        if (r.ok) {
          const d = await r.json();
          ok++;
          if (d.version) versions++;
        }
      } catch (_) {}
    }
    if (ok) {
      E.ui.toast(
        ok + (ok > 1 ? ' arquivos' : ' arquivo') + ' no seu Drive — Livrai/Projetos/' + projName +
          (versions ? ' (' + versions + ' como nova versão)' : '')
      );
    } else {
      E.ui.toast('⚠️ Nenhum arquivo subiu — confira a conexão com o Drive');
    }
  };

  /* Bloco "Nuvens conectadas" no painel da Conta */
  E.drive.renderBlock = async function (content) {
    const st = await E.drive.status();
    if (st.unavailable) return; // só no app desktop
    const block = document.createElement('div');
    block.className = 'settings-block';
    block.innerHTML =
      '<h4>' + E.icon('upload', 16) + '<span>Nuvens conectadas</span></h4>' +
      '<p>SUA nuvem, na SUA conta: o LIVRAI só acessa a pasta que ele mesmo cria ' +
      '(Livrai/Projetos) e o acesso fica guardado cifrado neste computador. ' +
      'Depois de conectar, selecione arquivos no projeto → botão direito → Subir pro Drive.</p>';
    const state = document.createElement('p');
    state.className = 'mono cloud-state';
    state.textContent = st.connected
      ? 'Google Drive conectado' + (st.email ? ' — ' + st.email : '')
      : 'Nenhuma nuvem conectada · Dropbox em breve';
    block.appendChild(state);

    const row = document.createElement('div');
    row.className = 'modal-actions';
    row.style.justifyContent = 'flex-start';
    const btn = document.createElement('button');
    btn.className = st.connected ? 'btn ghost danger' : 'btn primary';
    E.setLabel(btn, st.connected ? 'close' : 'upload', st.connected ? 'Desconectar Drive' : 'Conectar Google Drive');
    btn.addEventListener('click', async () => {
      if (st.connected) {
        await fetch('/__studio/drive-disconnect', { method: 'POST', headers: HD });
        E.ui.toast('Drive desconectado deste computador');
        block.replaceWith(await freshBlock());
        return;
      }
      await fetch('/__studio/drive-connect', { method: 'POST', headers: HD });
      E.ui.toast('Autorize na janela que abriu — eu espero aqui');
      const deadline = Date.now() + 180000;
      const poll = setInterval(async () => {
        const now = await E.drive.status();
        if (now.connected) {
          clearInterval(poll);
          E.ui.toast('Google Drive conectado!');
          block.replaceWith(await freshBlock());
        } else if (Date.now() > deadline) {
          clearInterval(poll);
        }
      }, 2000);
    });
    row.appendChild(btn);
    block.appendChild(row);

    async function freshBlock() {
      const holder = document.createElement('div');
      await E.drive.renderBlock(holder);
      return holder.firstChild || holder;
    }

    content.appendChild(block);
  };
})();
