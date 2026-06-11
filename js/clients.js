/* Clientes: cadastro simples pra vincular projetos e filtrar a galeria.
   A administração vive em Configurações → Clientes (settings.js). */
(function () {
  const E = window.Estudio;

  async function all() {
    const list = await E.db.getAll('clients');
    list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    E.state.clients = list;
    return list;
  }

  function byId(id) {
    return E.state.clients.find((c) => c.id === id) || null;
  }

  async function add(name) {
    const c = { id: E.uid(), name: name.trim(), createdAt: Date.now() };
    await E.db.put('clients', c);
    return c;
  }

  function openManager() {
    E.settings.open('clients');
  }

  E.clients = { all, byId, add, openManager };
})();
