/* Conta LIVRAI (opcional): login com Google ou e-mail/senha via Firebase Auth.
   O app continua 100% funcional sem conta e sem internet — o SDK só é
   carregado sob demanda, e qualquer falha degrada em silêncio. */
(function () {
  const E = window.Estudio;

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCV3zo_rMbu0yTbT51NsHFr3Jyx438J-eY',
    authDomain: 'livrai-e97aa.firebaseapp.com',
    projectId: 'livrai-e97aa',
    storageBucket: 'livrai-e97aa.firebasestorage.app',
    messagingSenderId: '801998511410',
    appId: '1:801998511410:web:579a566580c6377abc0b2b',
  };
  const SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

  // app desktop: o login Google acontece no NAVEGADOR (o Google bloqueia
  // janelas de aplicativo) e a credencial volta pelo servidor local
  const IS_DESKTOP = location.origin === 'http://localhost:8788';
  const LOGIN_PAGE = 'https://louisluix.github.io/livrai/login.html';

  let fbPromise = null;
  let user = null;
  const listeners = [];

  async function googleViaBrowser() {
    const state = E.uid() + '-' + E.uid();
    window.open(LOGIN_PAGE + '?state=' + encodeURIComponent(state), '_blank', 'noopener');
    E.ui.toast('Continue no navegador que abriu — eu espero aqui');
    const deadline = Date.now() + 180000; // 3 minutos
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const r = await fetch('/__auth?state=' + encodeURIComponent(state), { cache: 'no-store' });
        if (r.status === 200) {
          const data = await r.json();
          const fb = await loadFirebase();
          const cred = fb.auth.GoogleAuthProvider.credential(data.idToken);
          await fb.auth().signInWithCredential(cred);
          return;
        }
      } catch (_) {}
    }
    throw { code: 'auth/browser-timeout' };
  }

  function loadFirebase() {
    if (fbPromise) return fbPromise;
    fbPromise = new Promise((resolve, reject) => {
      const urls = [SDK + 'firebase-app-compat.js', SDK + 'firebase-auth-compat.js'];
      let i = 0;
      function next() {
        if (i >= urls.length) {
          try {
            if (!window.firebase.apps.length) window.firebase.initializeApp(FIREBASE_CONFIG);
            window.firebase.auth().onAuthStateChanged((u) => {
              user = u;
              localStorage.setItem('livrai-account', u ? '1' : '0');
              updateTopbar();
              listeners.forEach((fn) => fn(u));
            });
            resolve(window.firebase);
          } catch (e) {
            reject(e);
          }
          return;
        }
        const s = document.createElement('script');
        s.src = urls[i++];
        s.onload = next;
        s.onerror = () => {
          fbPromise = null;
          reject(new Error('offline'));
        };
        document.head.appendChild(s);
      }
      next();
    });
    return fbPromise;
  }

  function friendly(err) {
    const code = (err && err.code) || '';
    if (code.indexOf('email-already-in-use') >= 0) return 'Esse e-mail já tem conta — tente entrar.';
    if (
      code.indexOf('wrong-password') >= 0 ||
      code.indexOf('user-not-found') >= 0 ||
      code.indexOf('invalid-credential') >= 0
    )
      return 'E-mail ou senha incorretos.';
    if (code.indexOf('weak-password') >= 0) return 'Senha fraca — use pelo menos 6 caracteres.';
    if (code.indexOf('invalid-email') >= 0) return 'Esse e-mail não parece válido.';
    if (code.indexOf('too-many-requests') >= 0) return 'Muitas tentativas — espere um pouco.';
    if (code.indexOf('network-request-failed') >= 0) return 'Sem internet — tente de novo depois.';
    if (
      code.indexOf('operation-not-supported') >= 0 ||
      code.indexOf('unauthorized-domain') >= 0 ||
      code.indexOf('popup-blocked') >= 0
    )
      return 'O login com Google não funciona neste ambiente — use e-mail e senha.';
    if (code.indexOf('browser-timeout') >= 0)
      return 'O login no navegador não chegou — tente de novo.';
    if (code.indexOf('popup-closed-by-user') >= 0) return null; // usuário desistiu, sem alarde
    return 'Algo deu errado: ' + (err && err.message ? err.message : 'erro desconhecido');
  }

  /* ---------- topo: estado da conta ---------- */

  function firstName(u) {
    const n = (u.displayName || u.email || '').trim();
    return n.split(/[\s@]/)[0] || 'Conta';
  }

  function updateTopbar() {
    const btn = document.getElementById('btn-account');
    if (!btn) return;
    if (user) {
      const initial = firstName(user).charAt(0).toUpperCase();
      btn.innerHTML =
        '<span class="account-avatar">' + E.escapeHtml(initial) + '</span><span>' +
        E.escapeHtml(firstName(user)) + '</span>';
    } else {
      E.setLabel(btn, 'user', 'Conta');
    }
  }

  /* ---------- seção Conta nas Configurações ---------- */

  function renderSection(content) {
    content.innerHTML = '<p class="settings-section-title">Conta</p>';

    if (user) {
      renderLogged(content);
      return;
    }

    const desc = document.createElement('p');
    desc.className = 'settings-desc';
    desc.textContent =
      'A conta é opcional — o LIVRAI funciona inteiro sem ela. ' +
      'Criando uma, você garante acesso às funções conectadas que estão chegando.';
    content.appendChild(desc);

    const block = document.createElement('div');
    block.className = 'settings-block';

    const googleBtn = document.createElement('button');
    googleBtn.className = 'btn account-google';
    E.setLabel(googleBtn, 'sparkles', 'Entrar com Google');
    googleBtn.addEventListener('click', async () => {
      googleBtn.disabled = true;
      E.setLabel(googleBtn, 'sparkles', 'Aguardando o navegador…');
      try {
        if (IS_DESKTOP) await googleViaBrowser();
        else {
          const fb = await loadFirebase();
          await fb.auth().signInWithPopup(new fb.auth.GoogleAuthProvider());
        }
        E.ui.toast('Bem-vindo ao LIVRAI!');
        renderSection(content);
      } catch (err) {
        const msg = friendly(err);
        if (msg) E.ui.toast('⚠️ ' + msg);
        googleBtn.disabled = false;
        E.setLabel(googleBtn, 'sparkles', 'Entrar com Google');
      }
    });
    block.appendChild(googleBtn);

    const divider = document.createElement('p');
    divider.className = 'account-divider mono';
    divider.textContent = 'ou com e-mail';
    block.appendChild(divider);

    let mode = 'signup'; // 'signup' | 'login'
    const form = document.createElement('form');
    form.className = 'account-form';

    const nameInput = mkInput('Seu nome', 'text');
    const emailInput = mkInput('E-mail', 'email');
    const passInput = mkInput('Senha (mínimo 6 caracteres)', 'password');
    form.appendChild(nameInput);
    form.appendChild(emailInput);
    form.appendChild(passInput);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn primary';
    form.appendChild(submit);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'btn ghost';
    form.appendChild(toggle);

    function syncMode() {
      nameInput.classList.toggle('hidden', mode === 'login');
      E.setLabel(submit, 'check', mode === 'signup' ? 'Criar conta' : 'Entrar');
      toggle.textContent = mode === 'signup' ? 'Já tenho conta' : 'Quero criar uma conta';
    }
    syncMode();
    toggle.addEventListener('click', () => {
      mode = mode === 'signup' ? 'login' : 'signup';
      syncMode();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      const pass = passInput.value;
      const name = nameInput.value.trim();
      if (!email || !pass) return;
      if (mode === 'signup' && !name) {
        E.ui.toast('Conta nova precisa de um nome');
        return;
      }
      submit.disabled = true;
      try {
        const fb = await loadFirebase();
        if (mode === 'signup') {
          const cred = await fb.auth().createUserWithEmailAndPassword(email, pass);
          await cred.user.updateProfile({ displayName: name });
          user = fb.auth().currentUser;
          E.ui.toast('Conta criada — bem-vindo ao LIVRAI!');
        } else {
          await fb.auth().signInWithEmailAndPassword(email, pass);
          E.ui.toast('Bem-vindo de volta!');
        }
        updateTopbar();
        renderSection(content);
      } catch (err) {
        const msg = friendly(err);
        if (msg) E.ui.toast('⚠️ ' + msg);
      } finally {
        submit.disabled = false;
      }
    });

    block.appendChild(form);
    content.appendChild(block);

    content.appendChild(perksBlock());
  }

  function renderLogged(content) {
    const card = document.createElement('div');
    card.className = 'settings-block account-card';
    const initial = firstName(user).charAt(0).toUpperCase();
    card.innerHTML =
      '<span class="account-avatar account-avatar-big">' + E.escapeHtml(initial) + '</span>' +
      '<div class="account-meta"><strong>' + E.escapeHtml(user.displayName || firstName(user)) +
      '</strong><p class="mono">' + E.escapeHtml(user.email || '') + '</p></div>';
    const out = document.createElement('button');
    out.className = 'btn ghost danger';
    E.setLabel(out, 'close', 'Sair');
    out.addEventListener('click', async () => {
      const fb = await loadFirebase();
      await fb.auth().signOut();
      E.ui.toast('Até logo!');
      renderSection(content);
    });
    card.appendChild(out);
    content.appendChild(card);

    if (E.cloudsync && E.cloudsync.renderBlock) E.cloudsync.renderBlock(content);
    if (E.share && E.share.renderLinksBlock) E.share.renderLinksBlock(content);
    content.appendChild(perksBlock());
  }

  function perksBlock() {
    const perks = document.createElement('div');
    perks.className = 'settings-block';
    perks.innerHTML =
      '<h4>' + E.icon('star', 16) + '<span>O que a conta libera</span></h4>' +
      '<ul class="account-perks">' +
      '<li>' + E.icon('refresh', 14) + '<span>Sincronização dos projetos na nuvem — ligue aqui em cima</span></li>' +
      '<li>' + E.icon('arrow-up-right', 14) + '<span>Compartilhar decks por link — botão Compartilhar, no canvas</span></li>' +
      '<li>' + E.icon('users', 14) + '<span>Comunidade e novidades em primeira mão — Configurações → Novidades</span></li>' +
      '</ul>';
    return perks;
  }

  function mkInput(placeholder, type) {
    const input = document.createElement('input');
    input.type = type;
    input.placeholder = placeholder;
    input.autocomplete = type === 'password' ? 'current-password' : 'on';
    input.spellcheck = false;
    return input;
  }

  /* ---------- painel próprio (separado das Configurações) ---------- */

  const panelRoot = document.getElementById('account-root');
  let panelEl = null;

  function closePanel(instant) {
    if (!panelEl) return;
    const p = panelEl;
    panelEl = null;
    window.removeEventListener('keydown', onPanelEsc, true);
    if (instant) {
      panelRoot.innerHTML = '';
      return;
    }
    p.panel.classList.add('closing');
    p.backdrop.style.opacity = '0';
    setTimeout(() => {
      panelRoot.innerHTML = '';
    }, 280);
  }

  function onPanelEsc(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      closePanel();
    }
  }

  function openPanel() {
    if (E.settings && E.settings.close) E.settings.close();
    panelRoot.innerHTML = '';

    const backdrop = document.createElement('div');
    backdrop.className = 'settings-backdrop';
    backdrop.style.transition = 'opacity 0.25s';
    backdrop.addEventListener('pointerdown', () => closePanel());

    const panel = document.createElement('div');
    panel.className = 'settings-panel account-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Conta');

    const head = document.createElement('div');
    head.className = 'settings-head';
    const h = document.createElement('h2');
    h.textContent = 'Conta';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost icon-only';
    closeBtn.innerHTML = E.icon('close', 18);
    closeBtn.title = 'Fechar (Esc)';
    closeBtn.addEventListener('click', () => closePanel());
    head.appendChild(h);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const content = document.createElement('div');
    content.className = 'settings-content';
    panel.appendChild(content);

    panelRoot.appendChild(backdrop);
    panelRoot.appendChild(panel);
    panelEl = { panel, backdrop };
    window.addEventListener('keydown', onPanelEsc, true);
    renderSection(content);
  }

  /* ---------- boot ---------- */

  function init() {
    // só carrega o SDK sozinho se a pessoa já tinha conta conectada
    if (localStorage.getItem('livrai-account') === '1' && navigator.onLine) {
      loadFirebase().catch(() => {});
    }
    const btn = document.getElementById('btn-account');
    if (btn) btn.addEventListener('click', openPanel);
  }

  function onChange(fn) {
    listeners.push(fn);
  }

  E.account = { init, renderSection, openPanel, closePanel, onChange, current: () => user, loadFirebase };
})();
