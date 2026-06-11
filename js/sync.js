/* Pasta do Estúdio: salvamento automático dos projetos num arquivo da sua pasta.
   Aponte o navegador e o aplicativo pra MESMA pasta e os dois veem os mesmos
   projetos — quem abre depois carrega o que o outro salvou. */
(function () {
  const E = window.Estudio;
  const FILE_NAME = 'livrai-projetos.json';
  const HANDLE_KEY = 'dataDir';
  const DATA_STORES = ['projects', 'items', 'blobs', 'clients'];
  const SAVE_DELAY = 8000; // junta várias edições num salvamento só

  const supported = typeof window.showDirectoryPicker === 'function';

  let saveTimer = null;
  let saving = false;
  let applying = false; // true enquanto carrega da pasta (não re-agenda salvamento)
  let lastSavedAt = parseInt(localStorage.getItem('livrai-synced'), 10) || 0;

  function localRev() {
    return parseInt(localStorage.getItem('livrai-rev'), 10) || 0;
  }
  function markLocalChange() {
    localStorage.setItem('livrai-rev', String(Date.now()));
  }

  /* ---------- intercepta as escritas do banco ---------- */

  const origPut = E.db.put;
  const origDel = E.db.del;
  E.db.put = function (name, value) {
    const p = origPut(name, value);
    if (!applying && DATA_STORES.indexOf(name) >= 0) {
      markLocalChange();
      scheduleSave();
    }
    return p;
  };
  E.db.del = function (name, key) {
    const p = origDel(name, key);
    if (!applying && DATA_STORES.indexOf(name) >= 0) {
      markLocalChange();
      scheduleSave();
    }
    return p;
  };

  /* ---------- pasta conectada ---------- */

  async function getHandle() {
    try {
      const rec = await E.db.get('handles', HANDLE_KEY);
      return rec ? rec.handle : null;
    } catch (_) {
      return null;
    }
  }

  async function hasPermission(handle, interactive) {
    try {
      if (!handle.queryPermission) return true; // ambientes sem a checagem (ex.: OPFS)
      let p = await handle.queryPermission({ mode: 'readwrite' });
      if (p === 'granted') return true;
      if (interactive && p === 'prompt') {
        p = await handle.requestPermission({ mode: 'readwrite' });
        return p === 'granted';
      }
    } catch (_) {}
    return false;
  }

  /* ---------- montar / aplicar o arquivo ---------- */

  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function buildPayload() {
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
    return {
      app: 'estudio',
      version: 1,
      savedAt: Date.now(),
      projects,
      items,
      clients,
      blobs: blobsB64,
    };
  }

  /** Substitui os dados locais pelo conteúdo do arquivo (decodifica tudo antes). */
  async function applyData(data) {
    const decoded = [];
    for (const b of data.blobs || []) {
      const bin = atob(b.data || '');
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      decoded.push({ id: b.id, blob: new Blob([bytes], { type: b.type }) });
    }
    applying = true;
    try {
      // troca completa: o que vale é o conteúdo da pasta
      for (const storeName of DATA_STORES) {
        const old = await E.db.getAll(storeName);
        for (const rec of old) await origDel(storeName, rec.id);
      }
      for (const b of decoded) await origPut('blobs', b);
      for (const it of data.items || []) await origPut('items', it);
      for (const c of data.clients || []) await origPut('clients', c);
      for (const p of data.projects || []) await origPut('projects', p);
    } finally {
      applying = false;
    }
    lastSavedAt = data.savedAt || Date.now();
    localStorage.setItem('livrai-synced', String(lastSavedAt));
    localStorage.setItem('livrai-rev', String(lastSavedAt));
  }

  async function readFile(handle) {
    try {
      const fh = await handle.getFileHandle(FILE_NAME);
      const file = await fh.getFile();
      const data = JSON.parse(await file.text());
      if (data && data.app === 'estudio' && Array.isArray(data.projects)) return data;
    } catch (_) {}
    return null;
  }

  /* ---------- salvar ---------- */

  async function saveNow(interactive) {
    if (saving) return false;
    const handle = await getHandle();
    if (!handle) return false;
    if (!(await hasPermission(handle, !!interactive))) return false;
    saving = true;
    try {
      const payload = await buildPayload();
      const fh = await handle.getFileHandle(FILE_NAME, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(payload));
      await w.close();
      lastSavedAt = payload.savedAt;
      localStorage.setItem('livrai-synced', String(lastSavedAt));
      return true;
    } catch (err) {
      console.error('sync', err);
      return false;
    } finally {
      saving = false;
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveNow(false), SAVE_DELAY);
  }

  // saindo da página com salvamento pendente? grava já
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      saveNow(false);
    }
  });

  /* ---------- conectar / desconectar ---------- */

  async function connect() {
    if (!supported) {
      E.ui.toast('⚠️ Este ambiente não permite escolher pasta — use o Chrome');
      return false;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (_) {
      return false; // usuário cancelou
    }
    await origPut('handles', { key: HANDLE_KEY, handle });

    const data = await readFile(handle);
    if (data && (data.projects || []).length) {
      const when = new Date(data.savedAt || 0).toLocaleString('pt-BR');
      const ok = await E.ui.confirm(
        'Essa pasta já tem projetos do LIVRAI',
        'Foram salvos em ' + when + '. Quer carregar eles aqui? ' +
          '(Se escolher não, os projetos deste app passam a valer e serão salvos por cima.)',
        'Carregar da pasta'
      );
      if (ok) {
        await applyData(data);
        E.gallery.render();
        E.ui.toast('Projetos carregados da pasta');
        return true;
      }
    }
    const saved = await saveNow(true);
    E.ui.toast(
      saved
        ? 'Pasta conectada — seus projetos serão salvos nela automaticamente'
        : 'Pasta conectada'
    );
    return true;
  }

  async function disconnect() {
    await origDel('handles', HANDLE_KEY);
    E.ui.toast('Pasta desconectada — os projetos continuam salvos neste app');
  }

  async function getStatus() {
    const handle = await getHandle();
    return {
      supported,
      connected: !!handle,
      name: handle ? handle.name : '',
      lastSavedAt,
    };
  }

  /* ---------- boot ---------- */

  async function checkRemote(handle) {
    const data = await readFile(handle);
    if (!data) {
      scheduleSave(); // pasta vazia: garante o primeiro arquivo
      return;
    }
    if ((data.savedAt || 0) <= lastSavedAt) return; // já estamos em dia
    const when = new Date(data.savedAt).toLocaleString('pt-BR');
    const ok = await E.ui.confirm(
      'Carregar projetos da pasta?',
      'A Pasta do Estúdio tem uma versão mais recente dos projetos (salva em ' + when + '). ' +
        'Carregar substitui o que está neste app pelo conteúdo da pasta.',
      'Carregar'
    );
    if (ok) {
      await applyData(data);
      E.gallery.render();
      E.ui.toast('Projetos atualizados da pasta');
    }
  }

  async function init() {
    const handle = await getHandle();
    if (!handle) return;
    if (await hasPermission(handle, false)) {
      checkRemote(handle);
      return;
    }
    // pedir permissão exige um gesto: aproveita o primeiro clique
    const once = async () => {
      window.removeEventListener('pointerdown', once, true);
      if (await hasPermission(handle, true)) checkRemote(handle);
    };
    window.addEventListener('pointerdown', once, true);
  }

  /** Primeiro uso: pergunta onde salvar (padrão do LIVRAI) */
  async function firstRunPrompt() {
    if (!supported) return;
    if (localStorage.getItem('livrai-storage-choice')) return;
    const handle = await getHandle();
    if (handle) {
      localStorage.setItem('livrai-storage-choice', 'folder');
      return;
    }
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML =
      '<h3>' + E.icon('folder', 18) + '<span> Onde salvar seus projetos?</span></h3>' +
      '<p class="modal-msg">Escolha uma pasta do seu computador e o LIVRAI salva tudo nela ' +
      'automaticamente. Apontando o navegador e o aplicativo pra mesma pasta, ' +
      'os dois mostram os mesmos projetos. Dá pra mudar depois em Configurações.</p>';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const localBtn = document.createElement('button');
    localBtn.className = 'btn ghost';
    localBtn.textContent = 'Só neste app';
    const folderBtn = document.createElement('button');
    folderBtn.className = 'btn primary';
    E.setLabel(folderBtn, 'folder', 'Escolher pasta');
    actions.appendChild(localBtn);
    actions.appendChild(folderBtn);
    box.appendChild(actions);
    overlay.appendChild(box);
    root.appendChild(overlay);

    function close() {
      root.innerHTML = '';
    }
    localBtn.addEventListener('click', () => {
      localStorage.setItem('livrai-storage-choice', 'local');
      close();
    });
    folderBtn.addEventListener('click', async () => {
      const ok = await connect();
      if (ok) {
        localStorage.setItem('livrai-storage-choice', 'folder');
        close();
      }
    });
  }

  E.sync = { init, connect, disconnect, saveNow, getStatus, applyData, firstRunPrompt, supported };
})();
