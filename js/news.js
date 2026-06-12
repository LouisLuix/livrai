/* Novidades e comunidade: o app busca o news.json publicado no repositório
   (mesma mecânica do checador de versão — silencioso, 1x a cada 6h) e mostra
   na seção Novidades das Configurações, com bolinha quando há post não lido. */
(function () {
  const E = window.Estudio;
  const CHECK_EVERY = 6 * 3600e3;
  const URL =
    localStorage.getItem('livrai-news-url') ||
    'https://raw.githubusercontent.com/LouisLuix/livrai/main/news.json';

  let data = null;
  try {
    data = JSON.parse(localStorage.getItem('livrai-news') || 'null');
  } catch (_) {}

  function newestId() {
    return data && data.posts && data.posts[0] ? data.posts[0].id : '';
  }

  function hasUnread() {
    const seen = localStorage.getItem('livrai-news-seen') || '';
    return !!(newestId() && newestId() !== seen);
  }

  function markRead() {
    if (newestId()) localStorage.setItem('livrai-news-seen', newestId());
    const dot = document.querySelector('#btn-settings .news-dot');
    if (dot) dot.remove();
  }

  function showBadge() {
    const btn = document.getElementById('btn-settings');
    if (!btn || btn.querySelector('.news-dot') || btn.querySelector('.update-dot')) return;
    const dot = document.createElement('span');
    dot.className = 'update-dot news-dot';
    dot.title = 'Novidades do LIVRAI';
    btn.appendChild(dot);
  }

  async function check(force) {
    const last = parseInt(localStorage.getItem('livrai-news-checked'), 10) || 0;
    if (!force && Date.now() - last < CHECK_EVERY) {
      if (hasUnread()) showBadge();
      return;
    }
    try {
      const r = await fetch(URL + '?t=' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return;
      const fresh = await r.json();
      if (!fresh || !Array.isArray(fresh.posts)) return;
      data = fresh;
      localStorage.setItem('livrai-news', JSON.stringify(fresh));
      localStorage.setItem('livrai-news-checked', String(Date.now()));
      if (hasUnread()) showBadge();
    } catch (_) {
      /* offline — fica pra próxima */
    }
  }

  /* ---------- seção nas Configurações ---------- */

  function communityBlock() {
    const c = (data && data.community) || {};
    const block = document.createElement('div');
    block.className = 'settings-block';
    block.innerHTML =
      '<h4>' + E.icon('users', 16) + '<span>Comunidade</span></h4>' +
      '<p>Quem usa o LIVRAI no dia a dia, trocando referência e processo.</p>';
    const row = document.createElement('div');
    row.className = 'modal-actions';
    row.style.justifyContent = 'flex-start';
    const links = [
      ['discord', 'Discord'],
      ['whatsapp', 'Grupo no WhatsApp'],
      ['instagram', 'Instagram'],
    ];
    let any = false;
    links.forEach(([key, label]) => {
      if (!c[key]) return;
      any = true;
      const a = document.createElement('a');
      a.className = 'btn';
      a.href = c[key];
      a.target = '_blank';
      a.rel = 'noopener';
      a.innerHTML = E.icon('arrow-up-right', 14) + '<span>' + label + '</span>';
      row.appendChild(a);
    });
    if (!any) {
      const p = document.createElement('p');
      p.className = 'settings-desc';
      p.textContent = 'O espaço da comunidade está sendo preparado — o link aparece aqui assim que abrir.';
      block.appendChild(p);
    } else {
      block.appendChild(row);
    }
    return block;
  }

  function renderSection(content) {
    content.innerHTML =
      '<p class="settings-section-title">Novidades</p>' +
      '<p class="settings-desc">O que está chegando no LIVRAI, em primeira mão.</p>';

    markRead();

    const posts = (data && data.posts) || [];
    if (!posts.length) {
      const p = document.createElement('p');
      p.className = 'settings-desc';
      p.textContent = 'Nada por aqui ainda — volte depois da próxima atualização.';
      content.appendChild(p);
    }
    posts.forEach((post) => {
      const block = document.createElement('div');
      block.className = 'settings-block news-post';
      block.innerHTML =
        '<h4>' + E.icon('star', 16) + '<span>' + E.escapeHtml(post.title) + '</span></h4>' +
        '<p class="mono news-date">' +
        new Date(post.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }) +
        '</p><p>' + E.escapeHtml(post.body) + '</p>';
      content.appendChild(block);
    });

    content.appendChild(communityBlock());

    const gal = document.createElement('div');
    gal.className = 'settings-block';
    gal.innerHTML =
      '<h4>' + E.icon('image', 16) + '<span>Galeria da comunidade</span></h4>' +
      '<p>Decks que outros criadores publicaram — compartilhe o seu pelo botão Compartilhar do canvas e marque "exibir na galeria".</p>';
    const a = document.createElement('a');
    a.className = 'btn';
    a.href = 'https://louisluix.github.io/livrai/galeria/';
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = E.icon('arrow-up-right', 14) + '<span>Abrir a galeria</span>';
    gal.appendChild(a);
    content.appendChild(gal);
  }

  E.news = { check, renderSection, hasUnread };
})();
