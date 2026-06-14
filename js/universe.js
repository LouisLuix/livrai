/* Universo: galeria 360° — projetos numa parede cilíndrica em volta da câmera.
   Arraste pra girar, role pra navegar, busque no centro pra voar até o projeto. */
(function () {
  const E = window.Estudio;

  const CARD_W = 300;
  const CARD_H = 220;
  const GAP = 26;
  const MIN_COLS = 10;
  const DRAG_THRESHOLD = 6;
  const IDLE_SPIN = 0.028; // graus por frame quando ninguém mexe
  const BILLBOARD = 0.55;  // quanto os cards se viram pra câmera ao se afastarem do centro
  const FADE_START = 94;   // graus do centro onde o fade de saída começa…
  const FADE_END = 110;    // …e onde o card é ocultado de vez (zona de espelhamento)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let raf = null;
  let scene = null;
  let cells = [];
  let rot = 0;
  let tilt = -4;
  let vel = 0;
  let rotTarget = null; // quando definido, anima até esse ângulo (busca)
  let lastInteraction = 0;
  let query = '';
  let period = 'all'; // all | dia | semana | mes | ano (recência do projeto)
  let focus = null;     // célula em destaque (1º clique aproxima, 2º entra)
  let zoom = 0;
  let zoomTarget = 0;
  let cam = 0;        // zoom de navegação: negativo afasta (vê mais), positivo aproxima (vê menos)
  let camTarget = 0;
  let oy = 0;
  let oyTarget = 0;
  let escHandler = null;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    scene = null;
    cells = [];
    rotTarget = null;
    focus = null;
    zoom = 0;
    zoomTarget = 0;
    cam = 0;
    camTarget = 0;
    oy = 0;
    oyTarget = 0;
    if (escHandler) {
      window.removeEventListener('keydown', escHandler, true);
      escHandler = null;
    }
  }

  const PERIODS = [
    { id: 'all', label: 'Qualquer época', ms: 0 },
    { id: 'dia', label: 'Último dia', ms: 864e5 },
    { id: 'semana', label: 'Última semana', ms: 7 * 864e5 },
    { id: 'mes', label: 'Último mês', ms: 30 * 864e5 },
    { id: 'ano', label: 'Último ano', ms: 365 * 864e5 },
  ];

  function inPeriod(p) {
    if (period === 'all') return true;
    const def = PERIODS.find((x) => x.id === period);
    const when = p.updatedAt || p.createdAt || 0;
    return Date.now() - when <= def.ms;
  }

  function matches(p, q) {
    if (!q) return true;
    const client = E.clients.byId(p.clientId);
    const hay = (
      p.name + ' ' +
      E.typeById(p.type).label + ' ' +
      E.stageById(p.stage).label + ' ' +
      (client ? client.name : '')
    ).toLowerCase();
    return q
      .toLowerCase()
      .split(/\s+/)
      .every((w) => hay.indexOf(w) >= 0);
  }

  function render(container, projects) {
    stop();
    container.innerHTML = '';
    // estado de foco não pode sobreviver à ida e volta do projeto
    container.classList.remove('uni-focus');
    query = '';
    period = 'all';

    if (!projects.length) {
      const empty = document.createElement('div');
      empty.className = 'uni-empty';
      empty.innerHTML =
        '<p class="hint-big">Universo vazio</p><p>Crie seu primeiro projeto pra ele orbitar por aqui.</p>';
      const actions = document.createElement('div');
      actions.className = 'uni-empty-actions';
      const btn = document.createElement('button');
      btn.className = 'btn primary';
      E.setLabel(btn, 'plus', 'Novo projeto');
      btn.addEventListener('click', () => E.gallery.createProject());
      const imp = document.createElement('button');
      imp.className = 'btn ghost';
      E.setLabel(imp, 'folder', 'Importar pasta');
      imp.title = 'Escolha uma pasta do computador — vira um projeto vinculado, sem copiar nada';
      imp.addEventListener('click', () => E.gallery.importFolder());
      actions.appendChild(btn);
      actions.appendChild(imp);
      empty.appendChild(actions);
      container.appendChild(empty);
      return;
    }

    /* ----- geometria do cilindro (embaralhada de propósito) ----- */
    const rows = projects.length > 14 ? 3 : projects.length > 4 ? 3 : 2;
    const cols = Math.max(MIN_COLS, Math.ceil(projects.length / rows));
    const total = cols * rows;
    const step = 360 / cols;
    const radius = Math.round(((CARD_W + GAP) * cols) / (2 * Math.PI));

    const viewportEl = document.createElement('div');
    viewportEl.className = 'uni-viewport';
    viewportEl.style.perspective = Math.round(radius * 1.15) + 'px';

    scene = document.createElement('div');
    scene.className = 'uni-scene';
    viewportEl.appendChild(scene);
    container.appendChild(viewportEl);

    // baralho: repete os projetos até encher e embaralha a ordem das células
    const deck = [];
    while (deck.length < total) {
      const lot = projects.slice();
      for (let i = lot.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const t = lot[i];
        lot[i] = lot[j];
        lot[j] = t;
      }
      deck.push(...lot);
    }

    cells = [];
    for (let i = 0; i < total; i++) {
      const p = deck[i];
      const row = Math.floor(i / cols);
      const col = i % cols;
      // base em tijolos + ruído orgânico por célula (ângulo, altura, profundidade,
      // escala e leve giro) — perde a cara de grade perfeita
      const angle =
        col * step + (row % 2 ? step / 2 : 0) + (Math.random() - 0.5) * step * 0.3;
      const y =
        (row - (rows - 1) / 2) * (CARD_H + GAP) + (Math.random() - 0.5) * 56;
      const r = radius * (0.92 + Math.random() * 0.18);
      const scale = 0.86 + Math.random() * 0.26;
      const spin = (Math.random() - 0.5) * 4.5;
      const cell = card(p, angle, y, r, scale, spin);
      cells.push({ el: cell, angle, project: p, r, y, scale, spin });
      scene.appendChild(cell);
    }

    /* ----- busca centralizada ----- */
    const search = document.createElement('div');
    search.className = 'uni-search';
    search.innerHTML = E.icon('zoom-in', 18);
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Buscar projeto, cliente, fase…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    const count = document.createElement('span');
    count.className = 'uni-count mono';
    count.textContent = projects.length + ' projetos';
    const filterBtn = document.createElement('button');
    filterBtn.className = 'uni-filter-btn';
    filterBtn.innerHTML = E.icon('filter', 15);
    filterBtn.title = 'Filtrar por época: dia, semana, mês ou ano';
    filterBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const r = filterBtn.getBoundingClientRect();
      E.ui.menu(
        r.right - 200,
        r.top - 6 - 5 * 38,
        PERIODS.map((pd) => ({
          label: pd.label,
          icon: pd.id === period ? 'check' : pd.id === 'all' ? 'star' : 'calendar',
          onClick: () => {
            period = pd.id;
            filterBtn.classList.toggle('active', period !== 'all');
            applyFilter(true);
          },
        }))
      );
    });
    const importBtn = document.createElement('button');
    importBtn.className = 'uni-filter-btn';
    importBtn.innerHTML = E.icon('folder', 15);
    importBtn.title = 'Importar pasta do computador — vira um projeto vinculado, como se fosse arrastada';
    importBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      E.gallery.importFolder();
    });
    search.appendChild(input);
    search.appendChild(filterBtn);
    search.appendChild(importBtn);
    search.appendChild(count);
    container.appendChild(search);

    const hint = document.createElement('p');
    hint.className = 'uni-hint mono';
    const HINT_ORBIT = 'Arraste pra girar — clique aproxima, clique de novo entra';
    const HINT_FOCUS = 'Clique pra entrar — Esc volta pra órbita';
    hint.textContent = HINT_ORBIT;
    container.appendChild(hint);

    /* ----- foco: 1º clique aproxima a câmera, 2º clique entra ----- */
    const perspective = radius * 1.15;

    function setFocus(cellObj) {
      if (focus && focus.el !== cellObj.el) blurFocus(true);
      focus = cellObj;
      container.classList.add('uni-focus');
      cellObj.el.classList.add('focused');
      // endireita e amplia levemente o card escolhido
      cellObj.el.classList.add('tween');
      cellObj.el.dataset.orbitTransform = cellObj.el.style.transform;
      cellObj.el.style.transform =
        'translate(-50%, -50%) rotateY(' + cellObj.angle + 'deg) translateZ(' + -cellObj.r +
        'px) translateY(' + cellObj.y + 'px) rotateZ(0deg) scale(1.5)';
      rotTarget = rot + wrap180(-cellObj.angle - rot);
      camTarget = 0;
      zoomTarget = cellObj.r * 0.94;
      oyTarget = -cellObj.y * (perspective / (perspective + cellObj.r - zoomTarget));
      vel = 0;
      hint.textContent = HINT_FOCUS;
    }

    function blurFocus(keepClass) {
      if (!focus) return;
      const el = focus.el;
      el.classList.remove('focused');
      if (el.dataset.orbitTransform) {
        el.style.transform = el.dataset.orbitTransform;
        delete el.dataset.orbitTransform;
      }
      // segura a transição de volta e depois devolve o card ao loop do billboard
      setTimeout(() => el.classList.remove('tween'), 720);
      focus = null;
      zoomTarget = 0;
      oyTarget = 0;
      if (!keepClass) container.classList.remove('uni-focus');
      hint.textContent = HINT_ORBIT;
    }

    escHandler = function (ev) {
      if (ev.key === 'Escape' && focus) {
        ev.stopPropagation();
        blurFocus();
      }
    };
    window.addEventListener('keydown', escHandler, true);

    function passes(p) {
      return matches(p, query) && inPeriod(p);
    }

    function applyFilter(fly) {
      const filtering = !!query || period !== 'all';
      let n = 0;
      const seen = new Set();
      cells.forEach((c) => {
        const ok = passes(c.project);
        c.el.classList.toggle('dim', filtering && !ok);
        if (ok && !seen.has(c.project.id)) {
          seen.add(c.project.id);
          n++;
        }
      });
      count.textContent = filtering ? n + ' de ' + projects.length : projects.length + ' projetos';
      if (filtering && fly) {
        const first = nearestMatch();
        if (first) flyTo(first.angle);
      }
    }

    input.addEventListener('input', () => {
      query = input.value.trim();
      applyFilter(!!query);
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const first = nearestMatch();
        if (first) flyTo(first.angle);
      } else if (ev.key === 'Escape') {
        input.value = '';
        input.dispatchEvent(new Event('input'));
        input.blur();
      }
    });

    function nearestMatch() {
      const hits = cells.filter((c) => passes(c.project));
      if (!hits.length) return null;
      // a célula correspondente mais perto da frente atual
      let best = hits[0];
      let bestDist = 361;
      hits.forEach((c) => {
        const d = Math.abs(wrap180(-c.angle - rot));
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      });
      return best;
    }

    /* ----- navegação: arrasto + roda ----- */
    let dragging = false;
    viewportEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.uni-search')) return;
      e.preventDefault(); // bloqueia a seleção nativa durante o arrasto
      const sx = e.clientX;
      const sy = e.clientY;
      const startRot = rot;
      const startTilt = tilt;
      let moved = false;
      dragging = true;
      rotTarget = null;
      let lastX = sx;
      let lastT = performance.now();

      function onMove(ev) {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        moved = true;
        viewportEl.classList.add('grabbing');
        rot = startRot + dx * 0.16;
        tilt = E.clamp(startTilt - dy * 0.05, -16, 14);
        const now = performance.now();
        vel = ((ev.clientX - lastX) / Math.max(1, now - lastT)) * 2.6;
        lastX = ev.clientX;
        lastT = now;
        lastInteraction = now;
      }
      function onUp(ev) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        dragging = false;
        viewportEl.classList.remove('grabbing');
        lastInteraction = performance.now();
        if (!moved) {
          if (focus) {
            // 2º clique (em qualquer lugar): entra no projeto em destaque
            const id = focus.el.dataset.id;
            stop();
            E.app.openProject(id);
          } else {
            const cardEl = ev.target.closest('.uni-card');
            if (cardEl) {
              const cellObj = cells.find((c) => c.el === cardEl);
              if (cellObj) setFocus(cellObj);
            }
          }
        } else if (focus) {
          blurFocus();
        }
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    const CAM_OUT = -radius * 1.7; // limite afastado
    const CAM_IN = radius * 0.72;  // limite aproximado

    function setCam(target) {
      camTarget = E.clamp(target, CAM_OUT, CAM_IN);
      lastInteraction = performance.now();
    }

    viewportEl.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        rotTarget = null;
        if (focus) blurFocus();
        if (e.ctrlKey || e.metaKey) {
          // pinça do trackpad (ctrlKey) ou Cmd+scroll = zoom da câmera
          setCam(camTarget - e.deltaY * (radius / 320));
        } else {
          const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          rot -= d * 0.09;
          lastInteraction = performance.now();
        }
      },
      { passive: false }
    );

    /* botões de zoom na tela */
    const zoomUi = document.createElement('div');
    zoomUi.className = 'uni-zoom';
    const mkZoomBtn = (icon, title, fn) => {
      const b = document.createElement('button');
      b.className = 'uni-zoom-btn';
      b.innerHTML = E.icon(icon, 16);
      b.title = title;
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (focus) blurFocus();
        fn();
      });
      zoomUi.appendChild(b);
      return b;
    };
    mkZoomBtn('zoom-out', 'Afastar — vê mais projetos (pinça ou Cmd+scroll)', () => setCam(camTarget - radius * 0.5));
    mkZoomBtn('maximize', 'Voltar ao enquadramento padrão', () => setCam(0));
    mkZoomBtn('zoom-in', 'Aproximar — vê menos projetos', () => setCam(camTarget + radius * 0.5));
    container.appendChild(zoomUi);

    /* ----- loop ----- */
    lastInteraction = performance.now();
    const born = performance.now();
    function tick() {
      if (!scene) return;
      const now = performance.now();
      const t = (now - born) / 1000;
      if (rotTarget != null) {
        const diff = wrap180(rotTarget - rot);
        rot += diff * 0.085;
        if (Math.abs(diff) < 0.05) rotTarget = null;
      } else if (!dragging) {
        rot += vel;
        vel *= 0.94;
        if (Math.abs(vel) < 0.002) vel = 0;
        // a câmera nunca fica parada: deriva contínua no próprio eixo
        if (!reducedMotion && !query && period === 'all' && !focus) {
          const settled = now - lastInteraction > 1600 ? 1 : 0.25;
          rot += IDLE_SPIN * settled;
        }
      }
      // aproximação da câmera (foco) + zoom de navegação, com easing
      zoom += (zoomTarget - zoom) * 0.075;
      cam += (camTarget - cam) * 0.075;
      oy += (oyTarget - oy) * 0.075;
      const camZ = zoom + cam;
      const dolly =
        'translateY(' + oy.toFixed(2) + 'px) translateZ(' + camZ.toFixed(2) + 'px) ';
      // respiração da câmera: balanço senoidal sutil (quase parado durante o foco)
      if (!reducedMotion) {
        const calm = focus ? 0.07 : 1;
        const bobX = Math.sin(t * 0.31) * 2.2 * calm;
        const rollZ = Math.sin(t * 0.21 + 1.4) * 1.1 * calm;
        const tiltNow = focus ? tilt * 0.1 + bobX : tilt + bobX;
        scene.style.transform =
          dolly + 'rotateZ(' + rollZ.toFixed(3) + 'deg) rotateX(' + tiltNow.toFixed(3) +
          'deg) rotateY(' + rot.toFixed(3) + 'deg)';
      } else {
        scene.style.transform = dolly + 'rotateX(' + tilt + 'deg) rotateY(' + rot + 'deg)';
      }
      // cards sempre visíveis no trajeto: cada um se vira parcialmente pra
      // câmera conforme sai do centro (nunca fica de perfil) e some com fade
      // suave já depois da borda — a zona de espelhamento continua oculta.
      // Com zoom out a janela abre (vê mais do anel, billboard total);
      // com zoom in o fade por profundidade esconde quem chega perto demais do olho.
      const perspPx = radius * 1.15;
      const outNorm = E.clamp(-cam / (radius * 1.7), 0, 1);
      const fadeStart = FADE_START + 62 * outNorm;
      const fadeEnd = FADE_END + 68 * outNorm;
      const bb = BILLBOARD + 0.45 * outNorm;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (focus && c.el === focus.el) continue;
        if (c.el.classList.contains('tween')) continue;
        const eff = wrap180(c.angle + rot);
        const a = Math.abs(eff);
        const visAngle = a >= fadeEnd ? 0 : a <= fadeStart ? 1 : (fadeEnd - a) / (fadeEnd - fadeStart);
        // profundidade: posição z do card em relação ao olho (que fica em +perspPx)
        const depth = camZ - c.r * Math.cos((eff * Math.PI) / 180);
        const visDepth = E.clamp((perspPx * 0.45 - depth) / (perspPx * 0.25), 0, 1);
        const vis = Math.min(visAngle, visDepth);
        const hidden = vis <= 0 ? 'hidden' : '';
        if (c.el.style.visibility !== hidden) c.el.style.visibility = hidden;
        if (vis > 0) {
          c.el.style.setProperty('--vis', vis.toFixed(3));
          c.el.style.transform =
            'translate(-50%, -50%) rotateY(' + c.angle + 'deg) translateZ(' + -c.r +
            'px) translateY(' + c.y + 'px) rotateZ(' + c.spin + 'deg) scale(' + c.scale +
            ') rotateY(' + (-eff * bb).toFixed(2) + 'deg)';
        }
      }
      raf = requestAnimationFrame(tick);
    }
    tick();

    setTimeout(() => input.focus({ preventScroll: true }), 350);

    function flyTo(angle) {
      rotTarget = rot + wrap180(-angle - rot);
      vel = 0;
    }
  }

  function wrap180(deg) {
    return ((((deg + 180) % 360) + 360) % 360) - 180;
  }

  function card(p, angle, y, radius, scale, spin) {
    const type = E.typeById(p.type);
    const stage = E.stageById(p.stage);
    const el = document.createElement('div');
    el.className = 'uni-card';
    el.dataset.id = p.id;
    el.style.transform =
      'translate(-50%, -50%) rotateY(' + angle + 'deg) translateZ(' + -radius + 'px) translateY(' + y + 'px)' +
      ' rotateZ(' + (spin || 0) + 'deg) scale(' + (scale || 1) + ')';

    const cover = document.createElement('div');
    cover.className = 'uni-cover';
    cover.style.background = 'linear-gradient(150deg, ' + stage.color + '1c, #141416 70%)';
    const mark = document.createElement('span');
    mark.className = 'cover-mark';
    mark.innerHTML = E.icon(type.icon, 34);
    cover.appendChild(mark);
    if (p.coverBlobId) {
      E.db.blobUrl(p.coverBlobId).then((u) => {
        if (!u) return;
        const img = document.createElement('img');
        img.src = u;
        img.alt = '';
        img.draggable = false;
        cover.innerHTML = '';
        cover.appendChild(img);
      });
    }
    el.appendChild(cover);

    const info = document.createElement('div');
    info.className = 'uni-info';
    const name = document.createElement('div');
    name.className = 'uni-name';
    name.textContent = p.name;
    info.appendChild(name);
    const meta = document.createElement('div');
    meta.className = 'uni-meta mono';
    const dot = document.createElement('span');
    dot.className = 'stage-dot';
    dot.style.background = stage.color;
    meta.appendChild(dot);
    const client = E.clients.byId(p.clientId);
    const label = document.createElement('span');
    label.textContent = stage.label + (client ? ' · ' + client.name : '');
    meta.appendChild(label);
    info.appendChild(meta);
    el.appendChild(info);
    return el;
  }

  E.universe = { render, stop };
})();
