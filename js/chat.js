/* Chat: espaço criativo com qualquer LLM, sem sair do LIVRAI.
   — Provedores: Claude, OpenAI (via ponte local), Gemini e modelos locais
     (Ollama). Ponte DIRETA com streaming: o texto pinga na tela em tempo real.
   — Histórico: cada conversa fica no IndexedDB (store 'chats').
   — Projeto como base: vincule um projeto e a IA conversa sabendo das notas,
     posts e marca dele.
   — Selecionou um trecho de resposta? "Guardar num projeto" vira nota no canvas. */
(function () {
  const E = window.Estudio;
  E.chat = {};

  const LAST_KEY = 'livrai-chat-last';
  const OLLAMA_KEY = 'livrai-chat-ollama'; // { url, model }
  const MAX_TURNS = 30; // mensagens enviadas por requisição

  let chats = [];
  let current = null;
  let streaming = false;
  let container = null;

  /* ---------- dados ---------- */

  function mkChat() {
    return {
      id: E.uid(),
      title: 'Novo chat',
      provider: defaultProvider(),
      projectId: null,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  function persist(chat) {
    chat.updatedAt = Date.now();
    E.db.put('chats', chat);
  }

  function ollamaCfg() {
    try {
      return Object.assign({ url: 'http://127.0.0.1:11434', model: 'llama3.2' }, JSON.parse(localStorage.getItem(OLLAMA_KEY)) || {});
    } catch (_) {
      return { url: 'http://127.0.0.1:11434', model: 'llama3.2' };
    }
  }

  function providers() {
    const s = E.ai.settings();
    return [
      { id: 'anthropic', label: 'Claude', ok: !!s.keys.anthropic },
      { id: 'openai', label: 'OpenAI', ok: !!s.keys.openai },
      { id: 'gemini', label: 'Gemini', ok: !!s.keys.gemini },
      { id: 'ollama', label: 'Local (Ollama)', ok: true },
    ];
  }

  function defaultProvider() {
    const av = providers().filter((p) => p.ok);
    return av.length ? av[0].id : 'ollama';
  }

  /* ---------- contexto do projeto vinculado ---------- */

  async function projectContext(projectId) {
    if (!projectId) return '';
    const p = await E.db.get('projects', projectId);
    if (!p) return '';
    const items = await E.db.itemsByProject(projectId);
    const bits = ['CONTEXTO DO PROJETO "' + (p.name || '') + '" (use como base da conversa):'];
    bits.push('Tipo: ' + (E.typeById(p.type) || {}).label + ' · fase: ' + (E.stageById(p.stage) || {}).label);
    const client = E.clients && E.clients.byId ? E.clients.byId(p.clientId) : null;
    if (client) bits.push('Cliente: ' + client.name);
    const b = p.brand || {};
    if (b.notes) bits.push('Marca — combina: ' + b.notes);
    if (b.negative) bits.push('Marca — NÃO combina: ' + b.negative);
    if (b.colors && b.colors.length) bits.push('Cores: ' + b.colors.join(', '));
    const pages = (p.notes && p.notes.pages) || [];
    pages.slice(0, 6).forEach((pg) => {
      const txt = E.notes.pageToText(pg);
      if (txt.trim()) bits.push('Nota "' + (pg.title || 'sem título') + '":\n' + txt.slice(0, 900));
    });
    const posts = items.filter((it) => it.kind === 'post' && it.content && it.content.text);
    if (posts.length) {
      bits.push('Posts planejados: ' + posts.slice(0, 12).map((it) =>
        '[' + (it.content.date || 'sem data') + '] ' + it.content.text.replace(/\n/g, ' ').slice(0, 110)
      ).join(' · '));
    }
    const noteCards = items.filter((it) => it.kind === 'note' && it.content && it.content.text && !it.content.pageId);
    noteCards.slice(0, 8).forEach((it) => bits.push('Card de nota: ' + it.content.text.replace(/\n/g, ' ').slice(0, 250)));
    return bits.join('\n').slice(0, 9000);
  }

  async function systemPrompt(chat) {
    let sys =
      'Você é o parceiro criativo dentro do LIVRAI, o estúdio visual de um diretor criativo brasileiro. ' +
      'Responda em português do Brasil, direto e com repertório de direção de arte quando fizer sentido.';
    const ctx = await projectContext(chat.projectId);
    if (ctx) sys += '\n\n' + ctx;
    return sys;
  }

  /* ---------- streaming por provedor (ponte direta) ---------- */

  async function readSse(res, onData) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) onData(line);
    }
    if (buf) onData(buf);
  }

  async function streamChat(chat, history, sys, onDelta) {
    const s = E.ai.settings();

    if (chat.provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': s.keys.anthropic,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: s.models.anthropic,
          max_tokens: 8000,
          system: sys,
          stream: true,
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await readSse(res, (line) => {
        if (line.indexOf('data: ') !== 0) return;
        try {
          const d = JSON.parse(line.slice(6));
          if (d.type === 'content_block_delta' && d.delta && d.delta.text) onDelta(d.delta.text);
        } catch (_) {}
      });
      return;
    }

    if (chat.provider === 'openai') {
      const res = await fetch('http://127.0.0.1:8787/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.keys.openai },
        body: JSON.stringify({
          model: s.models.openai || 'gpt-4.1',
          stream: true,
          messages: [{ role: 'system', content: sys }].concat(
            history.map((m) => ({ role: m.role, content: m.content }))
          ),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      await readSse(res, (line) => {
        if (line.indexOf('data: ') !== 0 || line.indexOf('[DONE]') >= 0) return;
        try {
          const d = JSON.parse(line.slice(6));
          const t = d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content;
          if (t) onDelta(t);
        } catch (_) {}
      });
      return;
    }

    if (chat.provider === 'gemini') {
      const res = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' +
          encodeURIComponent(s.models.gemini) +
          ':streamGenerateContent?alt=sse&key=' +
          encodeURIComponent(s.keys.gemini),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: sys }] },
            contents: history.map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          }),
        }
      );
      if (!res.ok) throw new Error(await res.text());
      await readSse(res, (line) => {
        if (line.indexOf('data: ') !== 0) return;
        try {
          const d = JSON.parse(line.slice(6));
          const parts = d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts;
          (parts || []).forEach((pt) => pt.text && onDelta(pt.text));
        } catch (_) {}
      });
      return;
    }

    // Ollama (modelos locais) — NDJSON
    const cfg = ollamaCfg();
    const res = await fetch(cfg.url.replace(/\/$/, '') + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        messages: [{ role: 'system', content: sys }].concat(
          history.map((m) => ({ role: m.role, content: m.content }))
        ),
      }),
    });
    if (!res.ok) throw new Error('Ollama não respondeu — ele está rodando? (' + cfg.url + ')');
    await readSse(res, (line) => {
      if (!line.trim()) return;
      try {
        const d = JSON.parse(line);
        if (d.message && d.message.content) onDelta(d.message.content);
      } catch (_) {}
    });
  }

  /* ---------- markdown leve das respostas ---------- */

  function mdInline(s) {
    return E.escapeHtml(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }

  function mdRender(text) {
    const out = [];
    const blocks = String(text || '').split(/```/);
    blocks.forEach((blk, i) => {
      if (i % 2 === 1) {
        const code = blk.replace(/^[a-z]*\n/, '');
        out.push('<pre>' + E.escapeHtml(code) + '</pre>');
        return;
      }
      blk.split('\n').forEach((line) => {
        if (/^###?\s/.test(line)) out.push('<h4>' + mdInline(line.replace(/^###?\s/, '')) + '</h4>');
        else if (/^[-*]\s/.test(line)) out.push('<div class="chat-li">' + mdInline(line.slice(2)) + '</div>');
        else if (/^\d+\.\s/.test(line)) out.push('<div class="chat-li">' + mdInline(line) + '</div>');
        else if (line.trim()) out.push('<p>' + mdInline(line) + '</p>');
      });
    });
    return out.join('');
  }

  /* ---------- envio ---------- */

  async function send(text) {
    if (!current || streaming || !text.trim()) return;
    const chat = current;
    chat.messages.push({ role: 'user', content: text.trim(), at: Date.now() });
    if (chat.title === 'Novo chat') chat.title = text.trim().replace(/\n/g, ' ').slice(0, 44);
    persist(chat);
    renderThread();
    renderSidebar();

    streaming = true;
    const holder = document.createElement('div');
    holder.className = 'chat-msg assistant streaming';
    holder.innerHTML = '<div class="chat-bubble"><span class="chat-cursor"></span></div>';
    const threadEl = container.querySelector('.chat-thread');
    threadEl.appendChild(holder);
    threadEl.scrollTop = threadEl.scrollHeight;

    let acc = '';
    const bubble = holder.querySelector('.chat-bubble');
    try {
      const sys = await systemPrompt(chat);
      const history = chat.messages.slice(-MAX_TURNS);
      await streamChat(chat, history, sys, (delta) => {
        acc += delta;
        bubble.innerHTML = mdRender(acc) + '<span class="chat-cursor"></span>';
        const nearBottom = threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 160;
        if (nearBottom) threadEl.scrollTop = threadEl.scrollHeight;
      });
      chat.messages.push({ role: 'assistant', content: acc, at: Date.now() });
      persist(chat);
    } catch (err) {
      console.error('chat', err);
      const msg = String((err && err.message) || err).slice(0, 200);
      E.ui.toast('⚠️ ' + (msg || 'a IA não respondeu'));
      if (!acc) holder.remove();
      else {
        chat.messages.push({ role: 'assistant', content: acc, at: Date.now() });
        persist(chat);
      }
    } finally {
      streaming = false;
      renderThread();
    }
  }

  /* ---------- seleção → nota num projeto ---------- */

  let selChip = null;

  function hideSelChip() {
    if (selChip) {
      selChip.remove();
      selChip = null;
    }
  }

  async function saveSelectionToProject(text, projectId) {
    const p = await E.db.get('projects', projectId);
    if (!p) {
      E.ui.toast('Projeto não encontrado');
      return;
    }
    const board = p.lastBoard || (p.boards && p.boards[0] && p.boards[0].id);
    const item = {
      id: E.uid(),
      projectId: p.id,
      board: board,
      kind: 'note',
      x: Math.round(Math.random() * 80),
      y: Math.round(Math.random() * 80),
      w: 300,
      h: 220,
      z: 1,
      content: { text: text },
    };
    await E.db.put('items', item);
    p.updatedAt = Date.now();
    await E.db.put('projects', p);
    E.ui.toast('Nota criada em "' + (p.name || 'Projeto') + '"');
  }

  function watchSelection(threadEl) {
    threadEl.addEventListener('mouseup', () => {
      setTimeout(async () => {
        hideSelChip();
        const sel = window.getSelection();
        const text = sel ? String(sel).trim() : '';
        if (!text || text.length < 3 || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        if (!threadEl.contains(range.commonAncestorContainer)) return;
        const rect = range.getBoundingClientRect();
        selChip = document.createElement('button');
        selChip.className = 'chat-sel-chip';
        selChip.innerHTML = E.icon('note', 13) + '<span>Guardar num projeto</span>';
        selChip.style.left = Math.min(window.innerWidth - 190, Math.max(8, rect.left + rect.width / 2 - 88)) + 'px';
        selChip.style.top = Math.max(8, rect.top - 40) + 'px';
        selChip.addEventListener('pointerdown', (e) => e.stopPropagation());
        selChip.addEventListener('click', async (e) => {
          const snippet = text;
          const projects = (await E.db.getAll('projects')).filter((p) => !p.archived)
            .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
          const entries = [];
          if (current && current.projectId) {
            const linked = projects.find((p) => p.id === current.projectId);
            if (linked) {
              entries.push({
                label: linked.name + ' (vinculado)',
                icon: 'pin',
                onClick: () => saveSelectionToProject(snippet, linked.id),
              });
            }
          }
          projects.slice(0, 12).forEach((p) => {
            if (current && p.id === current.projectId) return;
            entries.push({ label: p.name, icon: 'folder', onClick: () => saveSelectionToProject(snippet, p.id) });
          });
          if (!entries.length) {
            E.ui.toast('Crie um projeto primeiro');
            return;
          }
          E.ui.menu(e.clientX, e.clientY, entries);
          hideSelChip();
        });
        document.body.appendChild(selChip);
      }, 10);
    });
    window.addEventListener('pointerdown', (e) => {
      if (selChip && !selChip.contains(e.target)) hideSelChip();
    }, true);
  }

  /* ---------- render ---------- */

  function renderSidebar() {
    const side = container.querySelector('.chat-side-list');
    if (!side) return;
    side.innerHTML = '';
    chats.forEach((c) => {
      const row = document.createElement('button');
      row.className = 'chat-row' + (current && c.id === current.id ? ' active' : '');
      row.innerHTML =
        '<span class="chat-row-title">' + E.escapeHtml(c.title || 'Chat') + '</span>' +
        '<span class="chat-row-meta mono">' +
        new Date(c.updatedAt || 0).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) +
        '</span>';
      row.addEventListener('click', () => {
        current = c;
        localStorage.setItem(LAST_KEY, c.id);
        renderAll();
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        E.ui.menu(e.clientX, e.clientY, [
          {
            label: 'Renomear',
            icon: 'pencil',
            onClick: async () => {
              const vals = await E.ui.modal({ title: 'Renomear chat', fields: [{ name: 'name', label: 'Nome', value: c.title }] });
              if (vals === null || !vals.name.trim()) return;
              c.title = vals.name.trim();
              persist(c);
              renderSidebar();
            },
          },
          {
            label: 'Excluir chat',
            icon: 'trash',
            danger: true,
            onClick: async () => {
              const ok = await E.ui.confirm('Excluir "' + c.title + '"?', 'A conversa toda será apagada.', 'Excluir');
              if (!ok) return;
              await E.db.del('chats', c.id);
              chats = chats.filter((x) => x.id !== c.id);
              if (current && current.id === c.id) current = chats[0] || null;
              renderAll();
            },
          },
        ]);
      });
      side.appendChild(row);
    });
  }

  async function renderHead() {
    const head = container.querySelector('.chat-head');
    if (!head || !current) return;
    head.innerHTML = '';

    const provSel = document.createElement('select');
    provSel.className = 'chat-select';
    provSel.title = 'Qual IA responde neste chat';
    providers().forEach((p) => {
      const op = document.createElement('option');
      op.value = p.id;
      op.textContent = p.label + (p.ok ? '' : ' — sem chave');
      op.disabled = !p.ok;
      provSel.appendChild(op);
    });
    provSel.value = current.provider;
    provSel.addEventListener('change', () => {
      current.provider = provSel.value;
      persist(current);
      renderHead();
    });
    head.appendChild(provSel);

    if (current.provider === 'ollama') {
      const cfg = ollamaCfg();
      const modelInput = document.createElement('input');
      modelInput.className = 'chat-select chat-ollama';
      modelInput.value = cfg.model;
      modelInput.spellcheck = false;
      modelInput.title = 'Modelo local do Ollama (ex.: llama3.2, mistral, qwen2.5)';
      modelInput.addEventListener('change', () => {
        localStorage.setItem(OLLAMA_KEY, JSON.stringify({ url: cfg.url, model: modelInput.value.trim() }));
      });
      modelInput.addEventListener('keydown', (e) => e.stopPropagation());
      head.appendChild(modelInput);
    }

    const projSel = document.createElement('select');
    projSel.className = 'chat-select';
    projSel.title = 'Projeto como base: a IA conversa sabendo das notas, posts e marca dele';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Sem projeto vinculado';
    projSel.appendChild(none);
    const projects = (await E.db.getAll('projects')).filter((p) => !p.archived)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    projects.forEach((p) => {
      const op = document.createElement('option');
      op.value = p.id;
      op.textContent = 'Base: ' + p.name;
      projSel.appendChild(op);
    });
    projSel.value = current.projectId || '';
    projSel.addEventListener('change', () => {
      current.projectId = projSel.value || null;
      persist(current);
      E.ui.toast(current.projectId ? 'A IA agora conversa com esse projeto como base' : 'Vínculo removido');
    });
    head.appendChild(projSel);
  }

  function renderThread() {
    const threadEl = container.querySelector('.chat-thread');
    if (!threadEl) return;
    threadEl.innerHTML = '';
    if (!current || !current.messages.length) {
      threadEl.innerHTML =
        '<div class="chat-empty"><p class="hint-big">Espaço criativo</p>' +
        '<p>Converse com a IA que você quiser — Claude, OpenAI, Gemini ou um modelo local.<br>' +
        'Vincule um projeto pra ela conhecer suas notas e posts, e selecione qualquer trecho<br>de resposta pra guardar como nota no canvas.</p></div>';
      return;
    }
    current.messages.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'chat-msg ' + m.role;
      const bubble = document.createElement('div');
      bubble.className = 'chat-bubble';
      if (m.role === 'assistant') bubble.innerHTML = mdRender(m.content);
      else bubble.textContent = m.content;
      el.appendChild(bubble);
      threadEl.appendChild(el);
    });
    threadEl.scrollTop = threadEl.scrollHeight;
  }

  function renderAll() {
    renderSidebar();
    renderHead();
    renderThread();
  }

  /* Monta a view (chamada pela galeria quando a visão Chat é ativada) */
  E.chat.render = async function (root) {
    container = root;
    if (!root.querySelector('.chat-side')) {
      root.innerHTML =
        '<aside class="chat-side">' +
        '<button class="btn primary chat-new">' + E.icon('plus', 15) + '<span>Novo chat</span></button>' +
        '<div class="chat-side-list"></div>' +
        '</aside>' +
        '<section class="chat-main">' +
        '<div class="chat-head"></div>' +
        '<div class="chat-thread"></div>' +
        '<div class="chat-composer">' +
        '<textarea class="chat-input" rows="1" placeholder="Escreva… (Enter envia · Shift+Enter quebra linha)"></textarea>' +
        '<button class="btn primary chat-send">' + E.icon('arrow-up-right', 16) + '</button>' +
        '</div>' +
        '</section>';

      root.querySelector('.chat-new').addEventListener('click', () => {
        const c = mkChat();
        chats.unshift(c);
        current = c;
        persist(c);
        localStorage.setItem(LAST_KEY, c.id);
        renderAll();
        root.querySelector('.chat-input').focus();
      });

      const input = root.querySelector('.chat-input');
      const sendBtn = root.querySelector('.chat-send');
      const doSend = () => {
        const text = input.value;
        input.value = '';
        input.style.height = 'auto';
        send(text);
      };
      sendBtn.addEventListener('click', doSend);
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          doSend();
        }
      });
      input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(180, input.scrollHeight) + 'px';
      });

      watchSelection(root.querySelector('.chat-thread'));
    }

    chats = (await E.db.getAll('chats')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (!chats.length) {
      const c = mkChat();
      chats = [c];
      persist(c);
    }
    const lastId = localStorage.getItem(LAST_KEY);
    current = chats.find((c) => c.id === lastId) || chats[0];
    renderAll();
  };

  /* ---------- painel lateral: chat AO LADO do canvas ---------- */

  const panel = document.getElementById('chat-panel');
  const panelContent = panel ? panel.querySelector('.panel-content') : null;
  if (panel) E.ui.initPanelResize(panel, 'estudio-chat-w');

  E.chat.isOpen = function () {
    return !!panel && !panel.classList.contains('hidden');
  };

  E.chat.close = function () {
    if (!E.chat.isOpen()) return;
    panel.classList.add('hidden');
    const b = document.getElementById('tool-chat');
    if (b) b.classList.remove('active');
  };

  E.chat.togglePanel = async function () {
    if (!panel) return;
    if (E.chat.isOpen()) {
      E.chat.close();
      return;
    }
    const st = E.canvas.getState();
    if (!st.project) return;
    [E.schedule, E.brand, E.notes, E.browser].forEach((m) => {
      if (m && m.isOpen && m.isOpen() && m.close) m.close();
    });
    panel.classList.remove('hidden');
    E.ui.applyPanelWidth(panel, 'estudio-chat-w');
    const b = document.getElementById('tool-chat');
    if (b) b.classList.add('active');
    await E.chat.render(panelContent);
    // o projeto aberto entra como base da conversa (se o chat estava solto)
    if (current && !current.projectId) {
      current.projectId = st.project.id;
      persist(current);
      renderHead();
      E.ui.toast('A IA agora conversa com "' + (st.project.name || 'o projeto') + '" como base');
    }
  };

  const toolChatBtn = document.getElementById('tool-chat');
  if (toolChatBtn) toolChatBtn.addEventListener('click', E.chat.togglePanel);
})();
