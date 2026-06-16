/* Ping de abertura: conta quantas instalações abrem o app, sem coletar nada
   pessoal. Grava só versão, sistema, canal e contadores num doc por máquina
   (installs/{uid}). No máximo 1x por dia, sob demanda, offline-safe e silencioso.
   Opt-out: localStorage 'livrai-no-ping' = '1'. */
(function () {
  const E = window.Estudio;
  const PING_EVERY = 22 * 3600e3; // ~1x por dia
  const SINCE_KEY = 'livrai-install-since';
  const TS_KEY = 'livrai-ping-ts';

  function osTag() {
    const p =
      (navigator.userAgentData && navigator.userAgentData.platform) ||
      navigator.platform ||
      '';
    const ua = navigator.userAgent || '';
    if (/win/i.test(p) || /windows/i.test(ua)) return 'windows';
    if (/mac/i.test(p) || /mac os x/i.test(ua)) return 'mac';
    if (/linux/i.test(p)) return 'linux';
    return 'other';
  }

  function channelTag() {
    return location.origin === 'http://localhost:8788' ? 'desktop' : 'web';
  }

  /* primeira vez que esta máquina abriu — fixado uma vez, no relógio local */
  function installSince() {
    let v = localStorage.getItem(SINCE_KEY);
    if (!v) {
      v = new Date().toISOString().slice(0, 10);
      localStorage.setItem(SINCE_KEY, v);
    }
    return v;
  }

  async function send() {
    if (localStorage.getItem('livrai-no-ping') === '1') return;

    const last = parseInt(localStorage.getItem(TS_KEY), 10) || 0;
    if (Date.now() - last < PING_EVERY) return;

    try {
      const fb = await E.account.loadFirebase();

      // sem conta? entra anônimo só pra ter um identificador estável da máquina
      let u = fb.auth().currentUser;
      if (!u) {
        const cred = await fb.auth().signInAnonymously();
        u = cred && cred.user;
      }
      if (!u) return;

      const db = await E.cloud.db();
      const FieldValue = fb.firestore.FieldValue;

      await db
        .collection('installs')
        .doc(u.uid)
        .set(
          {
            version: E.APP_VERSION,
            os: osTag(),
            channel: channelTag(),
            firstSeen: installSince(),
            lastSeen: FieldValue.serverTimestamp(),
            opens: FieldValue.increment(1),
          },
          { merge: true }
        );

      localStorage.setItem(TS_KEY, String(Date.now()));
    } catch (_) {
      /* offline, bloqueado ou provedor anônimo desativado — tenta na próxima */
    }
  }

  E.ping = { send };

  /* dispara depois que o app já está de pé, sem nunca atrasar a abertura */
  function schedule() {
    setTimeout(() => {
      send();
    }, 8000);
  }
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
