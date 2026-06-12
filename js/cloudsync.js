/* Sincronização na nuvem (opt-in, Conta LIVRAI): espelha projetos, itens,
   clientes e imagens no Firestore — cada usuário só enxerga o próprio espaço.
   Incremental: cada mudança local entra numa fila e sobe em lote; ao abrir,
   o app baixa o que outros computadores mudaram (vence a edição mais nova).
   Sem Storage no plano gratuito: imagens viajam comprimidas (máx 2048px) e
   fatiadas; vídeos e áudios ficam só no computador (avisado na UI). */
(function () {
  const E = window.Estudio;
  E.cloudsync = {};

  const FLAG = 'livrai-cloud';
  const QUEUE_KEY = 'livrai-cloud-queue';
  const LAST_PULL = 'livrai-cloud-pull';
  const PUSH_DELAY = 6000;
  const STORES = ['projects', 'items', 'clients'];
  const MAX_BLOB = 3.5 * 1048576; // depois de comprimir, maior que isso não sobe

  let pushTimer = null;
  let pushing = false;
  let applying = false; // aplicando dados vindos da nuvem (não re-enfileira)
  let status = { state: 'off', pending: 0, lastPushAt: 0, lastPullAt: parseInt(localStorage.getItem(LAST_PULL), 10) || 0 };
  const statusListeners = [];

  function enabled() {
    return localStorage.getItem(FLAG) === '1';
  }

  function setStatus(state) {
    status.state = state;
    status.pending = queue().length;
    statusListeners.forEach((fn) => fn(status));
  }

  /* ---------- fila persistente ---------- */

  function queue() {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY)) || [];
    } catch (_) {
      return [];
    }
  }

  function setQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    status.pending = q.length;
  }

  function enqueue(op, store, id) {
    const q = queue().filter((e) => !(e.store === store && e.id === id));
    q.push({ op: op, store: store, id: id, at: Date.now() });
    setQueue(q);
    schedulePush();
  }

  /* ---------- intercepta as escritas (depois do sync.js) ---------- */

  const origPut = E.db.put;
  const origDel = E.db.del;
  E.db.put = function (name, value) {
    if (!applying && enabled() && STORES.indexOf(name) >= 0 && value && value.id) {
      // itens/clientes não têm relógio próprio — ganham um aqui; projetos
      // mantêm o do touchProject (salvar só a câmera não conta como edição)
      if (name !== 'projects') value.updatedAt = Date.now();
      else if (!value.updatedAt) value.updatedAt = Date.now();
      enqueue('put', name, value.id);
    }
    return origPut(name, value);
  };
  E.db.del = function (name, key) {
    if (!applying && enabled() && STORES.indexOf(name) >= 0) enqueue('del', name, key);
    return origDel(name, key);
  };

  /* ---------- blobs: coleta e transporte ---------- */

  function collectBlobIds(obj, out) {
    if (!obj || typeof obj !== 'object') return out;
    for (const k in obj) {
      const v = obj[k];
      if (typeof v === 'string' && /blobid/i.test(k)) out.add(v);
      else if (v && typeof v === 'object') collectBlobIds(v, out);
    }
    return out;
  }

  async function uploadBlob(db, uid, blobId) {
    const ref = db.collection('users').doc(uid).collection('blobs').doc(blobId);
    const exists = await ref.get();
    if (exists.exists) return; // blob é imutável — já está lá
    const rec = await E.db.get('blobs', blobId);
    if (!rec || !rec.blob) return;
    const type = rec.blob.type || '';
    if (type.indexOf('image/') !== 0) {
      await ref.set({ skipped: true, t: type, reason: 'mídia pesada fica no computador' });
      return;
    }
    const small = await E.cloud.compressImage(rec.blob, 2048, type === 'image/png');
    if (small.size > MAX_BLOB) {
      await ref.set({ skipped: true, t: type, reason: 'imagem acima do limite' });
      return;
    }
    const b64 = await E.cloud.blobToB64(small);
    const chunks = E.cloud.chunkString(b64);
    await ref.set({ t: small.type, chunkCount: chunks.length, bytes: b64.length, at: Date.now() });
    const batch = db.batch();
    chunks.forEach((d, i) => batch.set(ref.collection('chunks').doc(String(i)), { i: i, d: d }));
    await batch.commit();
  }

  async function downloadBlob(db, uid, blobId) {
    const local = await E.db.get('blobs', blobId);
    if (local && local.blob) return;
    const ref = db.collection('users').doc(uid).collection('blobs').doc(blobId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().skipped) return;
    const meta = snap.data();
    const chunks = await ref.collection('chunks').get();
    const b64 = chunks.docs.map((d) => d.data()).sort((a, b) => a.i - b.i).map((d) => d.d).join('');
    const buf = E.cloud.b64ToBuf(b64);
    await origPut('blobs', { id: blobId, blob: new Blob([buf], { type: meta.t || 'image/jpeg' }) });
  }

  /* ---------- subir ---------- */

  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, PUSH_DELAY);
  }

  async function pushNow() {
    if (pushing || !enabled()) return;
    const user = E.account.current();
    if (!user) return;
    const q = queue();
    if (!q.length) return;
    pushing = true;
    setStatus('enviando');
    try {
      const db = await E.cloud.db();
      const root = db.collection('users').doc(user.uid);
      for (const entry of q.slice()) {
        if (entry.op === 'del') {
          await root.collection(entry.store).doc(entry.id).delete();
          await root.collection('tombstones').doc(entry.id).set({ store: entry.store, at: entry.at });
        } else {
          const rec = await E.db.get(entry.store, entry.id);
          if (rec) {
            await root.collection(entry.store).doc(entry.id).set({
              d: JSON.stringify(rec),
              updatedAt: rec.updatedAt || entry.at,
            });
            const blobIds = collectBlobIds(rec, new Set());
            for (const bid of blobIds) await uploadBlob(db, user.uid, bid);
          }
        }
        setQueue(queue().filter((e) => !(e.store === entry.store && e.id === entry.id && e.at === entry.at)));
      }
      status.lastPushAt = Date.now();
      setStatus('ok');
    } catch (err) {
      console.error('cloudsync push', err);
      setStatus('erro');
      schedulePush(); // tenta de novo depois
    } finally {
      pushing = false;
    }
  }

  /* ---------- baixar / fundir ---------- */

  async function pullNow(toastResult) {
    if (!enabled()) return 0;
    const user = E.account.current();
    if (!user) return 0;
    setStatus('baixando');
    let appliedCount = 0;
    try {
      const db = await E.cloud.db();
      const root = db.collection('users').doc(user.uid);
      const since = status.lastPullAt || 0;
      const startedAt = Date.now();
      const pendingBlobIds = new Set();

      for (const store of STORES) {
        const snap = await root.collection(store).where('updatedAt', '>', since).get();
        for (const doc of snap.docs) {
          let rec = null;
          try {
            rec = JSON.parse(doc.data().d);
          } catch (_) {
            continue;
          }
          const local = await E.db.get(store, rec.id);
          if (local && (local.updatedAt || 0) >= (rec.updatedAt || 0)) continue; // local mais novo
          applying = true;
          try {
            await origPut(store, rec);
          } finally {
            applying = false;
          }
          collectBlobIds(rec, pendingBlobIds);
          appliedCount++;
        }
      }

      const tombs = await root.collection('tombstones').where('at', '>', since).get();
      for (const doc of tombs.docs) {
        const t = doc.data();
        const local = await E.db.get(t.store, doc.id);
        if (local && (local.updatedAt || 0) < t.at) {
          applying = true;
          try {
            await origDel(t.store, doc.id);
          } finally {
            applying = false;
          }
          appliedCount++;
        }
      }

      for (const bid of pendingBlobIds) {
        try {
          await downloadBlob(db, user.uid, bid);
        } catch (_) {}
      }

      status.lastPullAt = startedAt;
      localStorage.setItem(LAST_PULL, String(startedAt));
      setStatus('ok');
      if (appliedCount && E.gallery) E.gallery.render();
      if (toastResult) {
        E.ui.toast(appliedCount ? appliedCount + ' atualizações vindas da nuvem' : 'Tudo em dia com a nuvem');
      }
    } catch (err) {
      console.error('cloudsync pull', err);
      setStatus('erro');
      if (toastResult) E.ui.toast('⚠️ Não consegui falar com a nuvem agora');
    }
    return appliedCount;
  }

  /* ---------- ligar / desligar ---------- */

  async function enable() {
    const user = E.account.current();
    if (!user) {
      E.ui.toast('Conecte sua conta primeiro');
      return false;
    }
    localStorage.setItem(FLAG, '1');
    // primeira vez: enfileira tudo que existe pra subir
    const q = [];
    for (const store of STORES) {
      const all = await E.db.getAll(store);
      all.forEach((rec) => q.push({ op: 'put', store: store, id: rec.id, at: Date.now() }));
    }
    setQueue(q);
    E.ui.toast('Sincronização ligada — subindo ' + q.length + ' registros em segundo plano');
    setStatus('enviando');
    pullNow(false).then(() => pushNow());
    return true;
  }

  function disable() {
    localStorage.setItem(FLAG, '0');
    setQueue([]);
    setStatus('off');
    E.ui.toast('Sincronização desligada — os dados na nuvem continuam lá');
  }

  /* ---------- bloco no painel da conta ---------- */

  function stateLabel() {
    if (!enabled()) return 'desligada';
    if (status.state === 'enviando') return 'enviando ' + status.pending + '…';
    if (status.state === 'baixando') return 'baixando…';
    if (status.state === 'erro') return 'erro — vou tentar de novo';
    const when = status.lastPushAt || status.lastPullAt;
    return 'em dia' + (when ? ' · ' + new Date(when).toLocaleTimeString('pt-BR').slice(0, 5) : '');
  }

  E.cloudsync.renderBlock = function (content) {
    const block = document.createElement('div');
    block.className = 'settings-block';
    block.innerHTML =
      '<h4>' + E.icon('refresh', 16) + '<span>Sincronização na nuvem</span></h4>' +
      '<p>Seus projetos espelhados na sua conta: abra o LIVRAI em outro computador ' +
      'e está tudo lá. Imagens viajam comprimidas; vídeos e áudios ficam neste computador.</p>';
    const state = document.createElement('p');
    state.className = 'mono cloud-state';
    block.appendChild(state);

    const row = document.createElement('div');
    row.className = 'modal-actions';
    const toggle = document.createElement('button');
    toggle.className = 'btn primary';
    const syncBtn = document.createElement('button');
    syncBtn.className = 'btn ghost';
    E.setLabel(syncBtn, 'refresh', 'Sincronizar agora');
    syncBtn.addEventListener('click', async () => {
      syncBtn.disabled = true;
      await pullNow(true);
      await pushNow();
      syncBtn.disabled = false;
    });
    row.appendChild(syncBtn);
    row.appendChild(toggle);
    block.appendChild(row);

    function refresh() {
      state.textContent = 'estado: ' + stateLabel();
      E.setLabel(toggle, enabled() ? 'close' : 'check', enabled() ? 'Desligar' : 'Ligar sincronização');
      toggle.className = enabled() ? 'btn ghost danger' : 'btn primary';
      syncBtn.classList.toggle('hidden', !enabled());
    }
    refresh();
    statusListeners.push(refresh);

    toggle.addEventListener('click', async () => {
      if (enabled()) disable();
      else await enable();
      refresh();
    });

    content.appendChild(block);
  };

  /* ---------- boot ---------- */

  function init() {
    if (!enabled()) return;
    E.account.onChange((user) => {
      if (user) {
        pullNow(false).then(() => {
          if (queue().length) schedulePush();
        });
      }
    });
    // conta já carregada? o onChange dispara no onAuthStateChanged do boot
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && queue().length) pushNow();
    });
  }

  E.cloudsync.init = init;
  E.cloudsync.pullNow = pullNow;
  E.cloudsync.pushNow = pushNow;
  E.cloudsync.enabled = enabled;
  E.cloudsync.getStatus = () => status;
})();
