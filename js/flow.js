/* Fluxograma: camada de setas entre itens do canvas, conexões e rótulos.
   As conexões ficam no item de origem: content.next = [{ to, label }] */
(function () {
  const E = window.Estudio;
  const NS = 'http://www.w3.org/2000/svg';
  const EDGE_COLOR = '#85858d';

  let ctx = null; // { items(), els(), save(item) } — fornecido pelo canvas
  let svg = null; // camada dentro do #world (acompanha pan/zoom de graça)
  let tempEl = null; // seta provisória enquanto o usuário arrasta do pontinho

  E.flow = {};

  E.flow.PALETTE = ['#ff5c26', '#a78bfa', '#60a5fa', '#34d399', '#fbbf24', '#fb7185'];
  E.flow.SHAPES = ['step', 'decision', 'startend'];
  E.flow.shapeLabel = function (s) {
    return s === 'decision' ? 'Decisão' : s === 'startend' ? 'Início / Fim' : 'Etapa';
  };

  E.flow.bind = function (c) {
    ctx = c;
  };

  /* Recria a camada SVG — o canvas limpa o #world a cada troca de aba */
  E.flow.mountLayer = function (world) {
    svg = document.createElementNS(NS, 'svg');
    svg.id = 'flow-svg';
    world.appendChild(svg);
    tempEl = null;
  };

  /* ---------- geometria ---------- */

  function center(it) {
    return { x: it.x + it.w / 2, y: it.y + it.h / 2 };
  }

  /* Lados de saída/chegada conforme a posição relativa dos itens */
  function pickSides(a, b) {
    const ca = center(a);
    const cb = center(b);
    if (Math.abs(cb.x - ca.x) >= Math.abs(cb.y - ca.y)) {
      return cb.x >= ca.x ? ['r', 'l'] : ['l', 'r'];
    }
    return cb.y >= ca.y ? ['b', 't'] : ['t', 'b'];
  }

  function anchor(it, side) {
    if (side === 'l') return { x: it.x, y: it.y + it.h / 2 };
    if (side === 'r') return { x: it.x + it.w, y: it.y + it.h / 2 };
    if (side === 't') return { x: it.x + it.w / 2, y: it.y };
    return { x: it.x + it.w / 2, y: it.y + it.h };
  }

  function normal(side) {
    if (side === 'r') return { x: 1, y: 0 };
    if (side === 'l') return { x: -1, y: 0 };
    if (side === 'b') return { x: 0, y: 1 };
    return { x: 0, y: -1 };
  }

  /* Curva bézier entre dois pontos com saída perpendicular aos lados */
  function curve(p1, n1, p2, n2) {
    const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const k = E.clamp(dist * 0.4, 36, 170);
    const c1 = { x: p1.x + n1.x * k, y: p1.y + n1.y * k };
    const c2 = { x: p2.x + n2.x * k, y: p2.y + n2.y * k };
    const d =
      'M' + p1.x + ' ' + p1.y +
      ' C' + c1.x + ' ' + c1.y + ' ' + c2.x + ' ' + c2.y + ' ' + p2.x + ' ' + p2.y;
    const mid = {
      x: (p1.x + 3 * c1.x + 3 * c2.x + p2.x) / 8,
      y: (p1.y + 3 * c1.y + 3 * c2.y + p2.y) / 8,
    };
    let dir = { x: p2.x - c2.x, y: p2.y - c2.y };
    const len = Math.hypot(dir.x, dir.y) || 1;
    dir = { x: dir.x / len, y: dir.y / len };
    return { d, mid, dir };
  }

  /* Ponta da seta: triângulo no destino, alinhado à direção final da curva */
  function arrowD(p, dir) {
    const L = 11;
    const W = 4.5;
    const bx = p.x - dir.x * L;
    const by = p.y - dir.y * L;
    const px = -dir.y;
    const py = dir.x;
    return (
      'M' + p.x + ' ' + p.y +
      ' L' + (bx + px * W) + ' ' + (by + py * W) +
      ' L' + (bx - px * W) + ' ' + (by - py * W) + ' Z'
    );
  }

  function el(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  function edgeColor(from) {
    return (from.kind === 'flownode' && from.content && from.content.color) || EDGE_COLOR;
  }

  /* ---------- desenho ---------- */

  E.flow.refresh = function () {
    if (!svg || !ctx) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    if (tempEl) svg.appendChild(tempEl);
    const items = ctx.items();
    items.forEach((it) => {
      const edges = it.content && Array.isArray(it.content.next) ? it.content.next : [];
      edges.forEach((edge) => {
        const target = items.get(edge.to);
        if (!target || edge.to === it.id) return; // alvo em outra aba, excluído ou inválido
        drawEdge(it, target, edge);
      });
    });
  };

  function drawEdge(from, to, edge) {
    const sides = pickSides(from, to);
    const p1 = anchor(from, sides[0]);
    const p2 = anchor(to, sides[1]);
    const c = curve(p1, normal(sides[0]), p2, normal(sides[1]));
    const color = edgeColor(from);

    const g = el('g', { class: 'flow-edge' });
    g.appendChild(el('path', { class: 'flow-hit', d: c.d }));
    g.appendChild(el('path', { class: 'flow-line', d: c.d, stroke: color }));
    g.appendChild(el('path', { d: arrowD(p2, c.dir), fill: color }));
    if (edge.label) {
      const t = el('text', {
        class: 'flow-edge-label',
        x: c.mid.x,
        y: c.mid.y - 7,
        'text-anchor': 'middle',
        fill: '#cfcdc5',
        stroke: '#0a0a0b',
        'stroke-width': 4,
        'paint-order': 'stroke',
      });
      t.textContent = edge.label;
      g.appendChild(t);
    }
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
    const openMenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      edgeMenu(e.clientX, e.clientY, from, edge);
    };
    g.addEventListener('click', openMenu);
    g.addEventListener('contextmenu', openMenu);
    svg.appendChild(g);
  }

  /* Seta provisória do pontinho até o cursor, durante o arrasto de conexão */
  E.flow.temp = function (fromId, point) {
    if (!svg || !ctx) return;
    const from = ctx.items().get(fromId);
    if (!from) return;
    const fake = { x: point.x, y: point.y, w: 0, h: 0 };
    const sides = pickSides(from, fake);
    const p1 = anchor(from, sides[0]);
    const c = curve(p1, normal(sides[0]), point, normal(sides[1]));
    if (!tempEl) {
      tempEl = el('g', { class: 'flow-temp' });
      tempEl.appendChild(el('path', { class: 'flow-line flow-dash' }));
      tempEl.appendChild(el('path', { class: 'flow-temp-arrow' }));
      svg.appendChild(tempEl);
    }
    const color = edgeColor(from);
    const line = tempEl.children[0];
    line.setAttribute('d', c.d);
    line.setAttribute('stroke', color);
    const head = tempEl.children[1];
    head.setAttribute('d', arrowD(point, c.dir));
    head.setAttribute('fill', color);
  };

  E.flow.clearTemp = function () {
    if (tempEl) tempEl.remove();
    tempEl = null;
  };

  /* ---------- conexões ---------- */

  E.flow.connect = function (fromId, toId) {
    if (!ctx) return false;
    const items = ctx.items();
    const from = items.get(fromId);
    const to = items.get(toId);
    if (!from || !to || fromId === toId) return false;
    if (!from.content) from.content = {};
    if (!Array.isArray(from.content.next)) from.content.next = [];
    const already =
      from.content.next.some((e) => e.to === toId) ||
      (to.content && Array.isArray(to.content.next) && to.content.next.some((e) => e.to === fromId));
    if (already) {
      E.ui.toast('Esses itens já estão conectados');
      return false;
    }
    from.content.next.push({ to: toId, label: '' });
    ctx.save(from);
    E.flow.refresh();
    return true;
  };

  function edgeMenu(x, y, from, edge) {
    E.ui.menu(x, y, [
      {
        label: edge.label ? 'Editar rótulo' : 'Dar um rótulo (sim, não, depois…)',
        icon: 'pencil',
        onClick: () => renameEdge(from, edge),
      },
      { label: 'Inverter direção', icon: 'refresh', onClick: () => invertEdge(from, edge) },
      { label: 'Remover conexão', icon: 'trash', danger: true, onClick: () => removeEdge(from, edge) },
    ]);
  }

  async function renameEdge(from, edge) {
    const vals = await E.ui.modal({
      title: 'Rótulo da seta',
      fields: [{ name: 'label', label: 'Texto', value: edge.label || '', placeholder: 'sim, não, depois…' }],
    });
    if (vals === null) return;
    edge.label = vals.label.trim();
    ctx.save(from);
    E.flow.refresh();
  }

  function invertEdge(from, edge) {
    const to = ctx.items().get(edge.to);
    if (!to) return;
    from.content.next = from.content.next.filter((e) => e !== edge);
    if (!to.content) to.content = {};
    if (!Array.isArray(to.content.next)) to.content.next = [];
    to.content.next.push({ to: from.id, label: edge.label || '' });
    ctx.save(from);
    ctx.save(to);
    E.flow.refresh();
  }

  function removeEdge(from, edge) {
    from.content.next = from.content.next.filter((e) => e !== edge);
    ctx.save(from);
    E.flow.refresh();
    E.ui.toast('Conexão removida');
  }
})();
