/* Cronograma: calendário lateral com os posts do projeto organizados por data.
   Clicar num post leva até ele no canvas (trocando de aba se precisar). */
(function () {
  const E = window.Estudio;
  const panel = document.getElementById('schedule-panel');
  const content = panel.querySelector('.panel-content');
  E.ui.initPanelResize(panel, 'estudio-sched-w');

  const MONTHS = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

  let current = null; // { y, m } do mês exibido

  function isOpen() {
    return !panel.classList.contains('hidden');
  }

  function toggle() {
    if (isOpen()) {
      close();
    } else {
      if (!current) {
        const now = new Date();
        current = { y: now.getFullYear(), m: now.getMonth() };
      }
      if (E.brand && E.brand.isOpen()) E.brand.close();
      if (E.notes && E.notes.isOpen()) E.notes.close();
      panel.classList.remove('hidden');
      E.ui.applyPanelWidth(panel, 'estudio-sched-w');
      document.getElementById('tool-schedule').classList.add('active');
      render();
    }
  }

  function close() {
    panel.classList.add('hidden');
    document.getElementById('tool-schedule').classList.remove('active');
  }

  const refreshSoon = E.debounce(() => {
    if (isOpen()) render();
  }, 250);

  function iso(y, m, d) {
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  function postChip(it) {
    const status = E.postStatusById(it.content.status);
    const chip = document.createElement('button');
    chip.className = 'sched-chip';
    chip.style.borderLeftColor = status.color;
    chip.title = (it.content.text || 'Post sem texto') + ' — ' + status.label + ' (clique pra ir até ele)';

    const media = E.items.postMedia(it.content);
    if (media.length) {
      const img = document.createElement('img');
      img.className = 'sched-thumb';
      img.alt = '';
      img.draggable = false;
      E.db.blobUrl(media[0].blobId).then((u) => {
        if (u) img.src = u;
      });
      chip.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = it.content.text
      ? it.content.text
      : media.length > 1
        ? 'Carrossel (' + media.length + ')'
        : media.length
          ? 'Post com imagem'
          : 'Post';
    chip.appendChild(span);
    chip.addEventListener('click', () => E.canvas.focusItem(it.id));
    // arrastável: solte num dia do calendário pra remarcar
    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/estudio-post', it.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    return chip;
  }

  function makeDropTarget(elTarget, dateIso) {
    elTarget.addEventListener('dragover', (e) => {
      if ([...e.dataTransfer.types].indexOf('text/estudio-post') >= 0) {
        e.preventDefault();
        elTarget.classList.add('drop');
      }
    });
    elTarget.addEventListener('dragleave', () => elTarget.classList.remove('drop'));
    elTarget.addEventListener('drop', (e) => {
      e.preventDefault();
      elTarget.classList.remove('drop');
      const id = e.dataTransfer.getData('text/estudio-post');
      const it = E.canvas.getAllItems().find((x) => x.id === id);
      if (!it) return;
      it.content.date = dateIso;
      E.canvas.refreshItem(it);
      render();
      E.ui.toast(dateIso ? 'Post remarcado' : 'Data removida do post');
    });
  }

  function render() {
    const posts = E.canvas.getAllItems().filter((it) => it.kind === 'post');
    const byDate = {};
    posts.forEach((p) => {
      const d = (p.content && p.content.date) || '';
      (byDate[d] = byDate[d] || []).push(p);
    });

    content.innerHTML = '';

    // cabeçalho do mês
    const head = document.createElement('div');
    head.className = 'sched-head';
    const prev = document.createElement('button');
    prev.className = 'btn ghost';
    prev.innerHTML = E.icon('chevron-left', 16);
    const label = document.createElement('span');
    label.className = 'sched-month';
    label.textContent = MONTHS[current.m] + ' ' + current.y;
    const next = document.createElement('button');
    next.className = 'btn ghost';
    next.innerHTML = E.icon('chevron-right', 16);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost';
    closeBtn.innerHTML = E.icon('close', 16);
    closeBtn.title = 'Fechar cronograma';
    prev.addEventListener('click', () => {
      current.m--;
      if (current.m < 0) {
        current.m = 11;
        current.y--;
      }
      render();
    });
    next.addEventListener('click', () => {
      current.m++;
      if (current.m > 11) {
        current.m = 0;
        current.y++;
      }
      render();
    });
    closeBtn.addEventListener('click', close);
    head.appendChild(prev);
    head.appendChild(label);
    head.appendChild(next);
    head.appendChild(spacer);
    head.appendChild(closeBtn);
    content.appendChild(head);

    // grade do mês
    const grid = document.createElement('div');
    grid.className = 'sched-grid';
    WEEKDAYS.forEach((w) => {
      const h = document.createElement('div');
      h.className = 'sched-weekday';
      h.textContent = w;
      grid.appendChild(h);
    });

    const firstDay = new Date(current.y, current.m, 1).getDay();
    const daysInMonth = new Date(current.y, current.m + 1, 0).getDate();
    const today = new Date();
    const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

    for (let i = 0; i < firstDay; i++) {
      const empty = document.createElement('div');
      empty.className = 'sched-day empty';
      grid.appendChild(empty);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const dayIso = iso(current.y, current.m, d);
      const cell = document.createElement('div');
      cell.className = 'sched-day' + (dayIso === todayIso ? ' today' : '');
      const num = document.createElement('div');
      num.className = 'sched-day-num';
      num.textContent = d;
      cell.appendChild(num);
      (byDate[dayIso] || []).forEach((p) => cell.appendChild(postChip(p)));
      makeDropTarget(cell, dayIso);
      grid.appendChild(cell);
    }
    content.appendChild(grid);

    // posts sem data (também aceita soltar um post pra tirar a data)
    const undated = byDate[''] || [];
    if (undated.length || posts.length) {
      const sec = document.createElement('div');
      sec.className = 'sched-undated';
      const h = document.createElement('div');
      h.className = 'sched-undated-title';
      h.innerHTML = E.icon('pin', 14) + '<span>Sem data (' + undated.length + ') — solte aqui pra tirar a data</span>';
      sec.appendChild(h);
      undated.forEach((p) => sec.appendChild(postChip(p)));
      makeDropTarget(sec, '');
      content.appendChild(sec);
    }

    if (!posts.length) {
      const empty = document.createElement('p');
      empty.className = 'sched-empty';
      empty.textContent =
        'Nenhum post neste projeto ainda. Crie com Criar > Post, ou clique com o botão direito numa imagem e escolha "Transformar em post".';
      content.appendChild(empty);
    }
  }

  E.schedule = { toggle, close, isOpen, refreshSoon };
})();
