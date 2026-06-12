/* Compartilhamento visual de decks: gera um link público SÓ DE VISUALIZAÇÃO
   da aba atual do canvas. Exclusivo pra quem tem conta conectada.
   Com senha: o conteúdo sobe cifrado (AES) — sem ela, ninguém abre, nem nós.
   O mesmo board atualiza o mesmo link (project.shares[boardId] = shareId). */
(function () {
  const E = window.Estudio;
  E.share = {};

  const VIEW_URL = 'https://louisluix.github.io/livrai/v/?id=';
  const MAX_CHUNKS = 40; // mesmo limite das regras do Firestore

  /* ---------- snapshot do board ---------- */

  function cleanItem(it, mediaKeys) {
    const c = it.content || {};
    const base = { id: it.id, kind: it.kind, x: it.x, y: it.y, w: it.w, h: it.h, z: it.z || 1 };
    const next = Array.isArray(c.next) && c.next.length ? c.next.map((e) => ({ to: e.to, label: e.label || '' })) : null;
    let content = null;

    if (it.kind === 'note') {
      let text = c.text || '';
      if (c.pageId && E.canvas.isOpen()) {
        const proj = E.canvas.getState().project;
        const page = proj.notes && (proj.notes.pages || []).find((p) => p.id === c.pageId);
        if (page) text = E.notes.pageToText(page);
      }
      content = { text: text };
    } else if (it.kind === 'label') content = { text: c.text || '' };
    else if (it.kind === 'color') content = { hex: c.hex || '#a78bfa' };
    else if (it.kind === 'link') content = { url: c.url || '', title: c.title || '' };
    else if (it.kind === 'frame') content = { text: c.text || '', preset: c.preset || '1:1' };
    else if (it.kind === 'flownode') content = { text: c.text || '', shape: c.shape || 'step', color: c.color || '#ff5c26' };
    else if (it.kind === 'image') content = { m: mediaKeys.want(c.blobId, !!c.hasAlpha), hasAlpha: !!c.hasAlpha };
    else if (it.kind === 'video') content = { placeholder: 'video', title: c.title || 'Vídeo' };
    else if (it.kind === 'audio') content = { placeholder: 'audio', title: c.title || 'Áudio' };
    else if (it.kind === 'file') content = { placeholder: 'file', name: c.name || 'Arquivo' };
    else if (it.kind === 'post') {
      const media = E.items.postMedia(c)
        .filter((m) => m.kind !== 'video')
        .slice(0, 10)
        .map((m) => ({ m: mediaKeys.want(m.blobId) }));
      content = { text: c.text || '', date: c.date || '', status: c.status || 'ideia', media: media };
    } else return null; // gen (privado) e folder (caminho local) ficam de fora

    const out = Object.assign(base, { content: content });
    if (next) out.content.next = next;
    return out;
  }

  async function buildPayload() {
    const st = E.canvas.getState();
    const project = st.project;
    const boardId = project.lastBoard || (project.boards && project.boards[0] && project.boards[0].id);
    const board = (project.boards || []).find((b) => b.id === boardId);

    const wanted = [];
    const keyByBlob = new Map();
    const mediaKeys = {
      want(blobId, alpha) {
        if (!blobId) return null;
        if (!keyByBlob.has(blobId)) {
          keyByBlob.set(blobId, 'm' + keyByBlob.size);
          wanted.push({ blobId: blobId, alpha: !!alpha });
        }
        return keyByBlob.get(blobId);
      },
    };

    const items = st.items
      .map((it) => cleanItem(it, mediaKeys))
      .filter(Boolean);

    const media = {};
    let firstThumb = null;
    for (const w of wanted) {
      const rec = await E.db.get('blobs', w.blobId);
      if (!rec || !rec.blob) continue;
      // PNG só quando a imagem TEM recorte — o resto vira JPEG (link leve)
      const small = await E.cloud.compressImage(rec.blob, 1280, w.alpha);
      media[keyByBlob.get(w.blobId)] = {
        t: small.type || 'image/jpeg',
        d: await E.cloud.blobToB64(small),
      };
      if (!firstThumb) {
        const tiny = await E.cloud.compressImage(rec.blob, 360, false);
        firstThumb = 'data:' + (tiny.type || 'image/jpeg') + ';base64,' + (await E.cloud.blobToB64(tiny));
      }
    }

    return {
      payload: {
        v: 1,
        project: project.name || 'Projeto',
        board: (board && board.name) || 'Principal',
        items: items,
        media: media,
      },
      boardId: boardId,
      title: (project.name || 'Projeto') + ' · ' + ((board && board.name) || 'Principal'),
      cover: firstThumb,
    };
  }

  /* ---------- publicar / atualizar ---------- */

  async function publish(opts) {
    const user = E.account.current();
    if (!user) throw new Error('faça login pra compartilhar');
    const db = await E.cloud.db();
    const built = await buildPayload();
    const st = E.canvas.getState();
    const project = st.project;

    const json = JSON.stringify(built.payload);
    let buf = await E.cloud.gzip(json);
    const gz = !!buf;
    if (!buf) buf = new TextEncoder().encode(json).buffer;

    let salt = '';
    let iv = '';
    const enc = !!(opts.password && opts.password.length);
    if (enc) {
      const r = await E.cloud.encrypt(buf, opts.password);
      buf = r.dataBuf;
      salt = r.saltB64;
      iv = r.ivB64;
    }

    const b64 = E.cloud.bufToB64(buf);
    const chunks = E.cloud.chunkString(b64);
    if (chunks.length > MAX_CHUNKS) {
      throw new Error('esse deck ficou pesado demais pro link (~' + Math.round(b64.length / 1048576) + 'MB). Tire alguns itens e tente de novo.');
    }

    if (!project.shares) project.shares = {};
    const existingId = project.shares[built.boardId] || null;
    const shareId = existingId || E.uid();
    const ref = db.collection('shares').doc(shareId);

    let oldChunkCount = 0;
    if (existingId) {
      try {
        const snap = await ref.get();
        if (snap.exists) {
          if (snap.data().ownerUid !== user.uid) throw new Error('esse link pertence a outra conta');
          oldChunkCount = snap.data().chunkCount || 0;
        }
      } catch (e) {
        if (String(e.message).indexOf('outra conta') >= 0) throw e;
      }
    }

    const doc = {
      ownerUid: user.uid,
      title: built.title,
      enc: enc,
      gz: gz,
      salt: salt,
      iv: iv,
      chunkCount: chunks.length,
      bytes: b64.length,
      cover: enc ? '' : built.cover || '',
      gallery: !enc && !!opts.gallery,
      app: E.APP_VERSION,
      updatedAt: Date.now(),
    };
    if (!existingId) doc.createdAt = Date.now();
    await ref.set(doc, { merge: true });

    // o vínculo é salvo JÁ — se a subida falhar no meio, "Atualizar link"
    // regrava por cima do mesmo id em vez de criar um link órfão
    if (!project.shares) project.shares = {};
    project.shares[built.boardId] = shareId;
    project.updatedAt = Date.now();
    await E.db.put('projects', project);

    // Firestore aceita no máx ~10MiB por lote — sobe em grupos de 8 chunks
    const PER_BATCH = 8;
    for (let i = 0; i < chunks.length; i += PER_BATCH) {
      const batch = db.batch();
      chunks.slice(i, i + PER_BATCH).forEach((d, j) => {
        batch.set(ref.collection('chunks').doc(String(i + j)), { i: i + j, d: d });
      });
      await batch.commit();
    }
    if (oldChunkCount > chunks.length) {
      const batch = db.batch();
      for (let i = chunks.length; i < oldChunkCount; i++) {
        batch.delete(ref.collection('chunks').doc(String(i)));
      }
      await batch.commit();
    }

    // galeria da comunidade: vitrine pública opcional
    try {
      const gref = db.collection('gallery').doc(shareId);
      if (!enc && opts.gallery) {
        await gref.set({ title: built.title, cover: built.cover || '', updatedAt: Date.now() });
      } else {
        await gref.delete().catch(() => {});
      }
    } catch (_) {}

    return { id: shareId, url: VIEW_URL + shareId, updated: !!existingId };
  }

  async function revoke(shareId) {
    const db = await E.cloud.db();
    const ref = db.collection('shares').doc(shareId);
    let count = 0;
    try {
      const snap = await ref.get();
      count = (snap.exists && snap.data().chunkCount) || 0;
    } catch (_) {}
    const batch = db.batch();
    for (let i = 0; i < count; i++) batch.delete(ref.collection('chunks').doc(String(i)));
    batch.delete(db.collection('gallery').doc(shareId));
    batch.delete(ref);
    await batch.commit();
    localStorage.removeItem('livrai-share-pass:' + shareId);
  }
  E.share.revoke = revoke;

  /* ---------- diálogo ---------- */

  function overlayRoot() {
    let el = document.getElementById('share-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'share-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function closeDialog() {
    overlayRoot().innerHTML = '';
  }

  E.share.openDialog = function () {
    if (!E.canvas.isOpen()) return;
    const root = overlayRoot();
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal share-modal';
    overlay.appendChild(box);
    root.appendChild(overlay);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) closeDialog();
    });

    const user = E.account.current();
    const h = document.createElement('h3');
    h.textContent = 'Compartilhar deck';
    box.appendChild(h);

    if (!user) {
      const p = document.createElement('p');
      p.className = 'modal-msg';
      p.textContent =
        'Compartilhar por link é uma função da Conta LIVRAI (gratuita). ' +
        'Conecte a sua e o botão libera na hora.';
      box.appendChild(p);
      const row = document.createElement('div');
      row.className = 'modal-actions';
      const cancel = document.createElement('button');
      cancel.className = 'btn ghost';
      cancel.textContent = 'Agora não';
      cancel.addEventListener('click', closeDialog);
      const connect = document.createElement('button');
      connect.className = 'btn primary';
      E.setLabel(connect, 'user', 'Conectar conta');
      connect.addEventListener('click', () => {
        closeDialog();
        E.account.openPanel();
      });
      row.appendChild(cancel);
      row.appendChild(connect);
      box.appendChild(row);
      return;
    }

    const st = E.canvas.getState();
    const boardId = st.project.lastBoard || (st.project.boards && st.project.boards[0].id);
    const existingId = (st.project.shares && st.project.shares[boardId]) || null;
    const isUpdate = !!existingId;
    // a senha nunca sai do computador — fica guardada AQUI pra reexibição
    const savedPass = existingId ? localStorage.getItem('livrai-share-pass:' + existingId) || '' : '';

    const p = document.createElement('p');
    p.className = 'modal-msg';
    p.textContent =
      'Gera um link público SÓ DE VISUALIZAÇÃO da aba atual (' + st.items.length + ' itens). ' +
      'Vídeos e geradores de IA ficam de fora. ' +
      (isUpdate ? 'Este board já tem um link publicado — ele aparece abaixo, e publicar de novo ATUALIZA o mesmo link.' : '');
    box.appendChild(p);

    const passLabel = document.createElement('label');
    passLabel.className = 'share-field';
    passLabel.innerHTML = '<span>Senha (opcional — o deck sobe cifrado, só abre com ela)</span>';
    const passInput = document.createElement('input');
    passInput.type = 'text';
    passInput.placeholder = 'sem senha = link aberto';
    passInput.autocomplete = 'off';
    passInput.spellcheck = false;
    passInput.value = savedPass;
    passLabel.appendChild(passInput);
    if (savedPass) {
      const hint = document.createElement('span');
      hint.className = 'share-pass-hint mono';
      hint.textContent = 'essa é a senha atual do link — mude e atualize, ou apague pra abrir o link';
      passLabel.appendChild(hint);
    }
    box.appendChild(passLabel);

    const galLabel = document.createElement('label');
    galLabel.className = 'share-check';
    const galInput = document.createElement('input');
    galInput.type = 'checkbox';
    galLabel.appendChild(galInput);
    galLabel.appendChild(document.createTextNode(' Exibir na galeria da comunidade (só sem senha)'));
    box.appendChild(galLabel);
    passInput.addEventListener('input', () => {
      const has = !!passInput.value.length;
      galInput.disabled = has;
      if (has) galInput.checked = false;
    });

    const result = document.createElement('div');
    result.className = 'share-result hidden';
    box.appendChild(result);

    function showResult(url) {
      result.classList.remove('hidden');
      result.innerHTML = '';
      const urlEl = document.createElement('input');
      urlEl.type = 'text';
      urlEl.readOnly = true;
      urlEl.value = url;
      urlEl.className = 'share-url mono';
      urlEl.addEventListener('focus', () => urlEl.select());
      const copy = document.createElement('button');
      copy.className = 'btn';
      E.setLabel(copy, 'copy', 'Copiar link');
      copy.addEventListener('click', () => {
        navigator.clipboard.writeText(url).then(() => E.ui.toast('Link copiado'));
      });
      result.appendChild(urlEl);
      result.appendChild(copy);
    }

    // link já existe? mostra na hora, sem precisar republicar
    if (existingId) showResult(VIEW_URL + existingId);

    const row = document.createElement('div');
    row.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'btn ghost';
    cancel.textContent = 'Fechar';
    cancel.addEventListener('click', closeDialog);
    const go = document.createElement('button');
    go.className = 'btn primary';
    E.setLabel(go, 'arrow-up-right', isUpdate ? 'Atualizar link' : 'Publicar link');
    row.appendChild(cancel);
    row.appendChild(go);
    box.appendChild(row);

    go.addEventListener('click', async () => {
      go.disabled = true;
      E.setLabel(go, 'refresh', 'Publicando…');
      try {
        const pass = passInput.value.trim();
        const r = await publish({ password: pass, gallery: galInput.checked });
        if (pass) localStorage.setItem('livrai-share-pass:' + r.id, pass);
        else localStorage.removeItem('livrai-share-pass:' + r.id);
        showResult(r.url);
        E.ui.toast(r.updated ? 'Link atualizado' : 'Link publicado');
        E.setLabel(go, 'arrow-up-right', 'Atualizar link');
        go.disabled = false;
      } catch (err) {
        console.error(err);
        E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'erro ao publicar'));
        E.setLabel(go, 'arrow-up-right', isUpdate ? 'Atualizar link' : 'Publicar link');
        go.disabled = false;
      }
    });
  };

  /* ---------- "Meus links" (painel da conta) ---------- */

  E.share.renderLinksBlock = async function (content) {
    const user = E.account.current();
    if (!user) return;
    const block = document.createElement('div');
    block.className = 'settings-block';
    block.innerHTML = '<h4>' + E.icon('link', 16) + '<span>Meus links compartilhados</span></h4>';
    content.appendChild(block);

    const list = document.createElement('div');
    list.className = 'share-list';
    list.innerHTML = '<p class="settings-desc">Carregando…</p>';
    block.appendChild(list);

    try {
      const db = await E.cloud.db();
      const snap = await db.collection('shares').where('ownerUid', '==', user.uid).get();
      const docs = snap.docs
        .map((d) => Object.assign({ id: d.id }, d.data()))
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      list.innerHTML = '';
      if (!docs.length) {
        list.innerHTML = '<p class="settings-desc">Nenhum link ainda — no canvas, use o botão Compartilhar.</p>';
        return;
      }
      docs.forEach((d) => {
        const row = document.createElement('div');
        row.className = 'share-row';
        const info = document.createElement('div');
        info.className = 'share-row-info';
        const localPass = localStorage.getItem('livrai-share-pass:' + d.id);
        info.innerHTML =
          '<strong>' + E.escapeHtml(d.title || 'Deck') + '</strong>' +
          '<span class="mono">' +
          new Date(d.updatedAt || d.createdAt || 0).toLocaleDateString('pt-BR') +
          (d.enc ? ' · senha: ' + (localPass ? E.escapeHtml(localPass) : '••• (definida em outro computador)') : '') +
          (d.gallery ? ' · na galeria' : '') +
          '</span>';
        const copy = document.createElement('button');
        copy.className = 'btn ghost icon-only';
        copy.innerHTML = E.icon('copy', 15);
        copy.title = 'Copiar link';
        copy.addEventListener('click', () => {
          navigator.clipboard.writeText(VIEW_URL + d.id).then(() => E.ui.toast('Link copiado'));
        });
        const del = document.createElement('button');
        del.className = 'btn ghost icon-only danger';
        del.innerHTML = E.icon('trash', 15);
        del.title = 'Revogar — o link para de funcionar na hora';
        del.addEventListener('click', async () => {
          const ok = await E.ui.confirm('Revogar este link?', '"' + (d.title || 'Deck') + '" deixa de abrir pra quem tem o link.', 'Revogar');
          if (!ok) return;
          try {
            await revoke(d.id);
            row.remove();
            E.ui.toast('Link revogado');
          } catch (err) {
            E.ui.toast('⚠️ Não consegui revogar: ' + err.message);
          }
        });
        row.appendChild(info);
        row.appendChild(copy);
        row.appendChild(del);
        list.appendChild(row);
      });
    } catch (err) {
      console.error(err);
      list.innerHTML = '<p class="settings-desc">Não consegui carregar seus links agora.</p>';
    }
  };

  /* ---------- botão no canvas ---------- */

  const btn = document.getElementById('tool-share');
  if (btn) btn.addEventListener('click', () => E.share.openDialog());
})();
