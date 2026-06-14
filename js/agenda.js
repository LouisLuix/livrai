/* Agenda geral do estúdio: todos os posts com data, de TODOS os projetos
   e clientes, num calendário só — a visão "minha semana". */
(function () {
  const E = window.Estudio;
  E.agenda = {};

  let month = null; // { y, m }
  let cal = { unavailable: true, connected: false, email: '' };
  let calByDate = {}; // eventos do Google agrupados por YYYY-MM-DD do mês visível

  function overlayRoot() {
    let el = document.getElementById('agenda-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'agenda-root';
      document.body.appendChild(el);
    }
    return el;
  }

  function close() {
    window.removeEventListener('keydown', onEsc, true);
    overlayRoot().innerHTML = '';
  }
  function onEsc(e) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  }

  E.agenda.open = async function () {
    const now = new Date();
    if (!month) month = { y: now.getFullYear(), m: now.getMonth() };
    window.addEventListener('keydown', onEsc, true);
    if (E.calendar) cal = await E.calendar.status();
    render();
  };

  async function loadPosts() {
    const [projects, items] = await Promise.all([E.db.getAll('projects'), E.db.getAll('items')]);
    const projById = new Map(projects.map((p) => [p.id, p]));
    const byDate = {};
    items.forEach((it) => {
      if (it.kind !== 'post' || !it.content || !it.content.date) return;
      const p = projById.get(it.projectId);
      if (!p || p.archived) return;
      (byDate[it.content.date] = byDate[it.content.date] || []).push({ post: it, project: p });
    });
    return byDate;
  }

  /* eventos do Google Calendar do mês visível, agrupados por dia */
  async function loadCalendar() {
    calByDate = {};
    if (!E.calendar || !cal.connected) return;
    const from = new Date(month.y, month.m, 1, 0, 0, 0);
    const to = new Date(month.y, month.m + 1, 0, 23, 59, 59);
    const events = await E.calendar.events(from.toISOString(), to.toISOString());
    events.forEach((ev) => {
      const key = E.calendar.dateKey(ev);
      if (!key) return;
      (calByDate[key] = calByDate[key] || []).push(ev);
    });
  }

  async function render() {
    const [byDate] = await Promise.all([loadPosts(), loadCalendar()]);
    const root = overlayRoot();
    root.innerHTML = '';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal agenda-modal';
    overlay.appendChild(box);
    root.appendChild(overlay);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close();
    });

    const head = document.createElement('div');
    head.className = 'agenda-head';
    const title = document.createElement('h3');
    title.textContent = new Date(month.y, month.m, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      .replace(/^./, (s) => s.toUpperCase());
    const prev = document.createElement('button');
    prev.className = 'btn ghost icon-only';
    prev.textContent = '‹';
    prev.addEventListener('click', () => {
      month.m--;
      if (month.m < 0) {
        month.m = 11;
        month.y--;
      }
      render();
    });
    const next = document.createElement('button');
    next.className = 'btn ghost icon-only';
    next.textContent = '›';
    next.addEventListener('click', () => {
      month.m++;
      if (month.m > 11) {
        month.m = 0;
        month.y++;
      }
      render();
    });
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost icon-only';
    closeBtn.innerHTML = E.icon('close', 16);
    closeBtn.title = 'Fechar (Esc)';
    closeBtn.addEventListener('click', close);
    head.appendChild(prev);
    head.appendChild(title);
    head.appendChild(next);
    head.appendChild(spacer);
    head.appendChild(calControl());
    head.appendChild(closeBtn);
    box.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'agenda-grid';
    ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].forEach((d) => {
      const h = document.createElement('div');
      h.className = 'agenda-dow mono';
      h.textContent = d;
      grid.appendChild(h);
    });

    const first = new Date(month.y, month.m, 1);
    const days = new Date(month.y, month.m + 1, 0).getDate();
    const today = new Date();
    const todayIso =
      today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    for (let i = 0; i < first.getDay(); i++) {
      grid.appendChild(document.createElement('div'));
    }
    for (let d = 1; d <= days; d++) {
      const iso = month.y + '-' + String(month.m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      const cell = document.createElement('div');
      cell.className = 'agenda-day' + (iso === todayIso ? ' today' : '');
      const num = document.createElement('span');
      num.className = 'agenda-num mono';
      num.textContent = d;
      cell.appendChild(num);
      (byDate[iso] || []).forEach((entry) => {
        const status = E.postStatusById(entry.post.content.status);
        const chip = document.createElement('button');
        chip.className = 'agenda-chip';
        chip.style.setProperty('--c', status.color);
        chip.title = entry.project.name + ' — ' + (entry.post.content.text || 'post') + ' · ' + status.label;
        chip.innerHTML =
          '<strong>' + E.escapeHtml(entry.project.name) + '</strong>' +
          '<span>' + E.escapeHtml((entry.post.content.text || 'post').replace(/\n/g, ' ').slice(0, 34)) + '</span>';
        chip.addEventListener('click', async () => {
          close();
          await E.app.openProject(entry.project.id);
          E.canvas.focusItem(entry.post.id);
        });
        cell.appendChild(chip);
      });
      (calByDate[iso] || []).forEach((ev) => {
        const time = E.calendar.timeLabel(ev);
        const chip = document.createElement('button');
        chip.className = 'agenda-chip ext';
        chip.style.setProperty('--c', ev.color || '#7aa2f7');
        chip.title = ev.title + (ev.calendar ? ' · ' + ev.calendar : '') + (time ? ' · ' + time : ' · dia inteiro');
        chip.innerHTML =
          '<strong>' + (time ? E.escapeHtml(time) + ' ' : '') + E.escapeHtml(ev.title) + '</strong>' +
          '<span>' + E.escapeHtml(ev.calendar || 'Google Calendar') + '</span>';
        chip.addEventListener('click', () => {
          if (ev.link) window.open(ev.link, '_blank');
        });
        cell.appendChild(chip);
      });
      grid.appendChild(cell);
    }
    box.appendChild(grid);
  }

  /* controle de conexão com o Google Calendar (cabeçalho da agenda) */
  function calControl() {
    if (cal.unavailable) {
      const span = document.createElement('span');
      return span; // navegador comum: integração só existe no app desktop
    }
    if (cal.connected) {
      const wrap = document.createElement('span');
      wrap.className = 'agenda-cal on';
      wrap.innerHTML = E.icon('calendar', 14);
      const lbl = document.createElement('span');
      lbl.textContent = cal.email || 'Google Calendar';
      wrap.appendChild(lbl);
      const off = document.createElement('button');
      off.className = 'agenda-cal-off';
      off.innerHTML = E.icon('close', 11);
      off.title = 'Desconectar o Google Calendar deste computador';
      off.addEventListener('click', async () => {
        await E.calendar.disconnect();
        cal = { unavailable: false, connected: false, email: '' };
        E.ui.toast('Google Calendar desconectado');
        render();
      });
      wrap.appendChild(off);
      return wrap;
    }
    const btn = document.createElement('button');
    btn.className = 'btn ghost agenda-cal-connect';
    E.setLabel(btn, 'calendar', 'Conectar Google Calendar');
    btn.addEventListener('click', async () => {
      await E.calendar.connect();
      E.ui.toast('Autorize na janela do navegador — eu espero aqui');
      const deadline = Date.now() + 180000;
      const poll = setInterval(async () => {
        const now = await E.calendar.status();
        if (now.connected) {
          clearInterval(poll);
          cal = now;
          E.ui.toast('Google Calendar conectado!');
          render();
        } else if (Date.now() > deadline) {
          clearInterval(poll);
        }
      }, 2000);
    });
    return btn;
  }

  const btn = document.getElementById('btn-agenda');
  if (btn) btn.addEventListener('click', E.agenda.open);
})();
