/* Verificação de atualização: compara a versão local com o version.json
   publicado no GitHub. Silencioso, no máximo 1x a cada 6 horas, offline-safe. */
(function () {
  const E = window.Estudio;
  const CHECK_EVERY = 6 * 3600e3;
  const URL =
    localStorage.getItem('livrai-update-url') ||
    'https://raw.githubusercontent.com/LouisLuix/livrai/main/version.json';

  let latest = null;
  try {
    latest = JSON.parse(localStorage.getItem('livrai-latest') || 'null');
  } catch (_) {}

  function newer(a, b) {
    // true se a > b (comparação de versões "1.2.3")
    const pa = String(a).split('.').map(Number);
    const pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) > (pb[i] || 0)) return true;
      if ((pa[i] || 0) < (pb[i] || 0)) return false;
    }
    return false;
  }

  function available() {
    return !!(latest && latest.version && newer(latest.version, E.APP_VERSION));
  }

  function info() {
    return available() ? latest : null;
  }

  function showBadge() {
    const btn = document.getElementById('btn-settings');
    if (!btn || btn.querySelector('.update-dot')) return;
    const dot = document.createElement('span');
    dot.className = 'update-dot';
    dot.title = 'Atualização disponível';
    btn.appendChild(dot);
  }

  async function check(force) {
    const last = parseInt(localStorage.getItem('livrai-update-checked'), 10) || 0;
    if (!force && Date.now() - last < CHECK_EVERY) {
      if (available()) showBadge();
      return;
    }
    try {
      const r = await fetch(URL + (URL.indexOf('?') < 0 ? '?t=' + Date.now() : ''), {
        cache: 'no-store',
      });
      if (!r.ok) return;
      const data = await r.json();
      if (!data || !data.version) return;
      latest = data;
      localStorage.setItem('livrai-latest', JSON.stringify(data));
      localStorage.setItem('livrai-update-checked', String(Date.now()));
      if (available()) showBadge();
    } catch (_) {
      /* offline ou bloqueado — tenta de novo na próxima */
    }
  }

  E.updates = { check, available, info };
})();
