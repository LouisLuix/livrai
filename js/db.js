/* Camada de persistência local (IndexedDB) — tudo fica no seu computador */
(function () {
  const E = window.Estudio;
  const DB_NAME = 'estudio-entregas';
  const DB_VERSION = 3;
  let dbPromise = null;

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('items')) {
          const s = db.createObjectStore('items', { keyPath: 'id' });
          s.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        // Conexões com pastas do computador (File System Access API)
        if (!db.objectStoreNames.contains('handles')) {
          db.createObjectStore('handles', { keyPath: 'key' });
        }
        // Clientes — cadastro simples pra vincular e filtrar projetos
        if (!db.objectStoreNames.contains('clients')) {
          db.createObjectStore('clients', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function reqProm(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function store(name, mode) {
    const db = await openDb();
    return db.transaction(name, mode).objectStore(name);
  }

  async function put(name, value) {
    return reqProm((await store(name, 'readwrite')).put(value));
  }
  async function get(name, key) {
    return reqProm((await store(name, 'readonly')).get(key));
  }
  async function del(name, key) {
    return reqProm((await store(name, 'readwrite')).delete(key));
  }
  async function getAll(name) {
    return reqProm((await store(name, 'readonly')).getAll());
  }
  async function itemsByProject(projectId) {
    const s = await store('items', 'readonly');
    return reqProm(s.index('projectId').getAll(projectId));
  }

  // Imagens são guardadas como blobs; URLs de objeto ficam em cache na sessão
  const urlCache = new Map();

  async function saveBlob(blob) {
    const id = E.uid();
    await put('blobs', { id: id, blob: blob });
    return id;
  }

  async function blobUrl(id) {
    if (!id) return null;
    if (urlCache.has(id)) return urlCache.get(id);
    const rec = await get('blobs', id);
    if (!rec || !rec.blob) return null;
    const url = URL.createObjectURL(rec.blob);
    urlCache.set(id, url);
    return url;
  }

  function releaseBlobUrl(id) {
    const url = urlCache.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(id);
    }
  }

  E.db = { put, get, del, getAll, itemsByProject, saveBlob, blobUrl, releaseBlobUrl };
})();
