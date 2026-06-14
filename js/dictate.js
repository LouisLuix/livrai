/* Ditado por voz (Whisper). Push-to-talk: SEGURE Cmd/Ctrl+Shift+D e fale;
   ao soltar, grava → transcreve (OpenAI) → insere o texto onde o cursor
   estava: campo de texto, nota (contenteditable) ou terminal. */
(function () {
  const E = window.Estudio;
  E.dictate = {};

  let recording = false;
  let starting = false;
  let stream = null;
  let recorder = null;
  let chunks = [];
  let target = null;
  let pill = null;

  function micBtnState(state) {
    const btn = document.getElementById('btn-mic');
    if (!btn) return;
    btn.classList.toggle('mic-rec', state === 'rec');
    btn.classList.toggle('mic-busy', state === 'busy');
  }

  function setPill(state, text) {
    micBtnState(state === 'hide' ? 'idle' : state);
    if (state === 'hide') {
      if (pill) pill.classList.remove('show');
      return;
    }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'dictate-pill';
      document.body.appendChild(pill);
    }
    pill.className = 'show ' + state;
    pill.innerHTML = E.icon(state === 'rec' ? 'mic' : 'sparkles', 16) + '<span>' + text + '</span>';
  }

  function editable(el) {
    if (!el) return false;
    const t = el.tagName;
    return t === 'TEXTAREA' || t === 'INPUT' || el.isContentEditable;
  }
  function editableOrTerm(el) {
    return editable(el) || !!(el && el.closest && el.closest('.xterm'));
  }
  // guarda o último campo editável focado — clicar no botão do mic rouba o foco
  let lastEditable = null;
  window.addEventListener('focusin', (e) => {
    if (editableOrTerm(e.target)) lastEditable = e.target;
  }, true);

  function insertInto(el, text) {
    // terminal: manda como entrada da sessão ativa
    if (el && el.closest && el.closest('.xterm')) {
      if (E.terminal && E.terminal.sendText && E.terminal.sendText(text)) return true;
    }
    if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) {
      el.focus();
      const s = el.selectionStart == null ? el.value.length : el.selectionStart;
      const e = el.selectionEnd == null ? el.value.length : el.selectionEnd;
      el.value = el.value.slice(0, s) + text + el.value.slice(e);
      const pos = s + text.length;
      try { el.selectionStart = el.selectionEnd = pos; } catch (_) {}
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    if (el && el.isContentEditable) {
      el.focus();
      document.execCommand('insertText', false, text);
      return true;
    }
    // nada editável focado: tenta terminal aberto, senão copia
    if (E.terminal && E.terminal.sendText && E.terminal.sendText(text)) return true;
    return false;
  }

  async function start() {
    if (recording || starting) return;
    if (!(E.ai && E.ai.settings && E.ai.settings().keys.openai)) {
      E.ui.toast('Pro ditado, configure a chave da OpenAI em Configurações → IA');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      E.ui.toast('Este dispositivo não permite captura de microfone');
      return;
    }
    starting = true;
    // onde o texto cai: o campo focado agora, ou o último focado (botão rouba foco)
    const a = document.activeElement;
    target = editableOrTerm(a) ? a : lastEditable;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (_) {
      starting = false;
      E.ui.toast('Não consegui acessar o microfone (permissão negada?)');
      return;
    }
    chunks = [];
    try {
      recorder = new MediaRecorder(stream);
    } catch (_) {
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    }
    recorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    });
    recorder.addEventListener('stop', onStop);
    recorder.start();
    recording = true;
    starting = false;
    setPill('rec', 'Ouvindo… (solte pra inserir)');
  }

  function stop() {
    if (!recording) return;
    recording = false;
    try { recorder.stop(); } catch (_) {}
    if (stream) stream.getTracks().forEach((t) => t.stop()); // libera o microfone
  }

  async function onStop() {
    const blob = new Blob(chunks, { type: (recorder && recorder.mimeType) || 'audio/webm' });
    chunks = [];
    if (blob.size < 1200) {
      setPill('hide');
      return; // áudio curto demais
    }
    setPill('busy', 'Transcrevendo…');
    try {
      const text = await E.ai.transcribe(blob, 'pt');
      setPill('hide');
      if (!text) {
        E.ui.toast('Não entendi o áudio — tente de novo');
        return;
      }
      const ok = insertInto(target, text);
      if (!ok) {
        try { await navigator.clipboard.writeText(text); } catch (_) {}
        E.ui.toast('Ditado copiado (nenhum campo focado): ' + text.slice(0, 50));
      }
    } catch (err) {
      setPill('hide');
      if (err && err.code === 'no-key') E.ui.toast('Configure a chave da OpenAI em Configurações → IA');
      else E.ui.toast('Falha na transcrição — confira a internet e a chave da OpenAI');
    }
  }

  E.dictate.start = start;
  E.dictate.stop = stop;
  E.dictate.toggle = function () { recording ? stop() : start(); };
  E.dictate.isRecording = function () { return recording; };

  /* ---------- push-to-talk: segura Cmd/Ctrl+Shift+D ---------- */
  function isCombo(e) {
    return (e.metaKey || e.ctrlKey) && e.shiftKey && e.code === 'KeyD';
  }
  window.addEventListener('keydown', (e) => {
    if (isCombo(e) && !recording && !starting && !e.repeat) {
      e.preventDefault();
      e.stopPropagation();
      start();
    }
  }, true);
  window.addEventListener('keyup', (e) => {
    // soltar a tecla principal OU qualquer modificador encerra o ditado
    if (recording && (e.code === 'KeyD' || e.key === 'Meta' || e.key === 'Control' || e.key === 'Shift')) {
      e.preventDefault();
      stop();
    }
  }, true);

  /* ---------- botão de microfone (clique = liga/desliga) ---------- */
  const micBtn = document.getElementById('btn-mic');
  if (micBtn) {
    // mousedown sem foco: não rouba o cursor do campo onde o texto vai cair
    micBtn.addEventListener('mousedown', (e) => e.preventDefault());
    micBtn.addEventListener('click', (e) => {
      e.preventDefault();
      E.dictate.toggle();
    });
  }
})();
