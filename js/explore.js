/* Explorar: galeria pública da comunidade. Mostra os decks que os usuários
   publicaram com "Exibir na galeria da comunidade" no Compartilhar.
   Leitura aberta (sem conta) — clicar abre o link público de visualização. */
(function () {
  const E = window.Estudio;
  E.explore = {};

  const VIEW_URL = 'https://louisluix.github.io/livrai/v/?id=';
  const MAX_DOCS = 80;
  const CACHE_MS = 60000; // navegação entre abas não refaz a busca toda hora

  let cache = null;
  let cacheAt = 0;

  async function fetchGallery(force) {
    if (!force && cache && Date.now() - cacheAt < CACHE_MS) return cache;
    const db = await E.cloud.db();
    const snap = await db.collection('gallery').limit(MAX_DOCS).get();
    const docs = snap.docs
      .map((d) => Object.assign({ id: d.id }, d.data()))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    cache = docs;
    cacheAt = Date.now();
    return docs;
  }

  E.explore.render = async function (container) {
    container.innerHTML = '';

    const head = document.createElement('header');
    head.className = 'explore-head';
    const title = document.createElement('div');
    title.innerHTML =
      '<h2 class="explore-title">Explorar</h2>' +
      '<p class="explore-sub">Projetos públicos da comunidade — decks compartilhados na galeria.</p>';
    head.appendChild(title);
    const refresh = document.createElement('button');
    refresh.className = 'btn ghost';
    E.setLabel(refresh, 'refresh', 'Atualizar');
    refresh.addEventListener('click', () => {
      cache = null;
      E.explore.render(container);
    });
    head.appendChild(refresh);
    container.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'explore-grid';
    container.appendChild(grid);

    const status = document.createElement('p');
    status.className = 'explore-status';
    status.textContent = 'Carregando a galeria…';
    container.appendChild(status);

    let docs;
    try {
      docs = await fetchGallery();
    } catch (err) {
      console.error('explore', err);
      status.textContent = 'Não consegui carregar a galeria agora — confira sua internet e tente de novo.';
      return;
    }

    if (!docs.length) {
      status.textContent =
        'Ainda não tem projetos públicos por aqui. Publique o seu: no canvas, Compartilhar → "Exibir na galeria da comunidade".';
      return;
    }
    status.remove();

    docs.forEach((d, i) => {
      grid.appendChild(exploreCard(d, i));
    });
  };

  function exploreCard(d, i) {
    const el = document.createElement('a');
    el.className = 'card explore-card';
    el.href = VIEW_URL + d.id;
    el.target = '_blank';
    el.rel = 'noopener';
    el.style.setProperty('--i', i);

    const cover = document.createElement('div');
    cover.className = 'card-cover';
    if (d.cover) {
      const img = document.createElement('img');
      img.src = d.cover;
      img.alt = '';
      img.loading = 'lazy';
      img.draggable = false;
      cover.appendChild(img);
    } else {
      const mark = document.createElement('span');
      mark.className = 'cover-mark';
      mark.innerHTML = E.icon('compass', 42);
      cover.appendChild(mark);
    }
    const open = document.createElement('span');
    open.className = 'card-open';
    open.innerHTML = E.icon('arrow-up-right', 16);
    cover.appendChild(open);
    el.appendChild(cover);

    const info = document.createElement('div');
    info.className = 'card-info';
    const name = document.createElement('div');
    name.className = 'card-name';
    name.textContent = d.title || 'Deck';
    info.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'card-type';
    meta.textContent = d.updatedAt
      ? 'Atualizado em ' + new Date(d.updatedAt).toLocaleDateString('pt-BR')
      : 'Deck público';
    info.appendChild(meta);
    el.appendChild(info);

    return el;
  }
})();
