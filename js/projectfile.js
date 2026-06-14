/* Salvar / importar projeto como arquivo .livrai (JSON por dentro).
   Um arquivo carrega um projeto inteiro — itens, abas, cliente e imagens
   (em base64) — pra mandar pra alguém ou guardar de backup. Importar NÃO
   apaga nada: o projeto entra com IDs novos, ao lado dos que já existem. */
(function () {
  const E = window.Estudio;
  E.projectFile = {};

  const EXT = '.livrai';

  /* ---------- base64 <-> blob ---------- */

  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  function b64ToBlob(b64, type) {
    const bin = atob(b64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  }

  /* ---------- coleta de imagens referenciadas ---------- */

  function collectItemBlobs(it, out) {
    const c = it.content || {};
    if (c.blobId) out.add(c.blobId);
    if (c.sceneBlobId) out.add(c.sceneBlobId);
    (c.media || []).forEach((m) => m && m.blobId && out.add(m.blobId));
    (c.versions || []).forEach((v) => v && v.blobId && out.add(v.blobId));
  }

  function collectProjectBlobs(p, out) {
    if (p.coverBlobId) out.add(p.coverBlobId);
    const b = p.brand;
    if (b) {
      if (b.logoBlobId) out.add(b.logoBlobId);
      if (b.fontBlobId) out.add(b.fontBlobId);
      (b.productRefs || []).forEach((id) => id && out.add(id));
      (b.entities || []).forEach((en) => (en.refs || []).forEach((id) => id && out.add(id)));
    }
  }

  /* ---------- remapeamento de IDs na importação ---------- */

  function remapContentBlobs(content, map) {
    if (!content) return content;
    const swap = (id) => (id ? map.get(id) || id : id);
    const c = { ...content };
    if (c.blobId) c.blobId = swap(c.blobId);
    if (c.sceneBlobId) c.sceneBlobId = swap(c.sceneBlobId);
    if (Array.isArray(c.media)) c.media = c.media.map((m) => (m ? { ...m, blobId: swap(m.blobId) } : m));
    if (Array.isArray(c.versions)) c.versions = c.versions.map((v) => (v ? { ...v, blobId: swap(v.blobId) } : v));
    return c;
  }

  function remapProject(proj, newId, blobMap, clientMap) {
    const p = JSON.parse(JSON.stringify(proj));
    const swap = (id) => (id ? blobMap.get(id) || id : id);
    p.id = newId;
    p.clientId = p.clientId ? clientMap.get(p.clientId) || null : null;
    p.coverBlobId = swap(p.coverBlobId);
    if (p.brand) {
      const b = p.brand;
      b.logoBlobId = swap(b.logoBlobId);
      b.fontBlobId = swap(b.fontBlobId);
      if (Array.isArray(b.productRefs)) b.productRefs = b.productRefs.map(swap);
      if (Array.isArray(b.entities)) {
        b.entities.forEach((en) => {
          if (Array.isArray(en.refs)) en.refs = en.refs.map(swap);
        });
      }
    }
    return p;
  }

  function remapItem(it, newProjectId, blobMap) {
    const ni = JSON.parse(JSON.stringify(it));
    ni.id = E.uid();
    ni.projectId = newProjectId;
    ni.content = remapContentBlobs(ni.content, blobMap);
    return ni;
  }

  /* ---------- download ---------- */

  function safeName(s) {
    return String(s || 'projeto').replace(/[\\/:*?"<>|]+/g, '-').trim();
  }

  function download(name, text) {
    if (E.exporter && E.exporter.downloadBlob) {
      E.exporter.downloadBlob(name, new Blob([text], { type: 'application/json' }));
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /* ---------- exportar um projeto ---------- */

  E.projectFile.exportProject = async function (projectId) {
    const project = await E.db.get('projects', projectId);
    if (!project) {
      E.ui.toast('Projeto não encontrado');
      return;
    }
    const items = await E.db.itemsByProject(projectId);

    const blobIds = new Set();
    collectProjectBlobs(project, blobIds);
    items.forEach((it) => collectItemBlobs(it, blobIds));

    const clients = [];
    if (project.clientId) {
      const c = (await E.db.getAll('clients')).find((x) => x.id === project.clientId);
      if (c) clients.push(c);
    }

    const blobs = [];
    for (const id of blobIds) {
      const rec = await E.db.get('blobs', id);
      if (rec && rec.blob) blobs.push({ id: id, type: rec.blob.type, data: await blobToB64(rec.blob) });
    }

    const pack = {
      app: 'livrai',
      kind: 'project-pack',
      version: 1,
      exportedAt: Date.now(),
      projects: [project],
      items: items,
      clients: clients,
      blobs: blobs,
    };
    download(safeName(project.name) + EXT, JSON.stringify(pack));
    E.ui.toast('Projeto salvo — veja sua pasta de Downloads');
  };

  /* ---------- importar (sem apagar nada) ---------- */

  E.projectFile.importData = async function (pack) {
    if (!pack || (pack.app !== 'livrai' && pack.app !== 'estudio') || !Array.isArray(pack.projects)) {
      throw new Error('formato inválido');
    }

    // imagens: cada uma ganha um id novo
    const blobMap = new Map();
    for (const b of pack.blobs || []) {
      const newId = await E.db.saveBlob(b64ToBlob(b.data, b.type));
      blobMap.set(b.id, newId);
    }

    // clientes: reaproveita um existente com o mesmo nome; senão cria
    const existingClients = await E.db.getAll('clients');
    const clientMap = new Map();
    for (const c of pack.clients || []) {
      const found = existingClients.find((x) => x.name === c.name);
      if (found) {
        clientMap.set(c.id, found.id);
      } else {
        const nc = { ...c, id: E.uid() };
        await E.db.put('clients', nc);
        existingClients.push(nc);
        clientMap.set(c.id, nc.id);
      }
    }

    const itemsByProj = {};
    (pack.items || []).forEach((it) => {
      (itemsByProj[it.projectId] = itemsByProj[it.projectId] || []).push(it);
    });

    const names = [];
    let firstId = null;
    for (const proj of pack.projects) {
      const newPid = E.uid();
      if (!firstId) firstId = newPid;
      const np = remapProject(proj, newPid, blobMap, clientMap);
      np.updatedAt = Date.now();
      np.importedAt = Date.now();
      delete np.linkedFolder; // o caminho original pode não existir nesta máquina
      await E.db.put('projects', np);
      names.push(np.name);
      for (const it of itemsByProj[proj.id] || []) {
        await E.db.put('items', remapItem(it, newPid, blobMap));
      }
    }
    return { count: pack.projects.length, names, firstId };
  };

  E.projectFile.importFromFile = function () {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.livrai,.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const pack = JSON.parse(await file.text());
        const res = await E.projectFile.importData(pack);
        if (E.gallery) E.gallery.render();
        E.ui.toast(
          res.count > 1
            ? res.count + ' projetos importados'
            : 'Projeto "' + (res.names[0] || '') + '" importado'
        );
      } catch (err) {
        console.error('import .livrai', err);
        E.ui.toast('⚠️ Arquivo inválido — escolha um .livrai exportado pelo estúdio');
      }
    });
    input.click();
  };

  /* botão da barra superior */
  const btn = document.getElementById('btn-import');
  if (btn) btn.addEventListener('click', E.projectFile.importFromFile);
})();
