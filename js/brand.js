/* Painel Marca & Produto — 3 sub-abas:
   Identidade (logo, cores, fonte) · Diretrizes (combina / não combina) ·
   Referências (entidades: produtos, personagens, cenários — cada uma com
   fotos de vários ângulos + identidade própria, usadas pela IA). */
(function () {
  const E = window.Estudio;
  const panel = document.getElementById('brand-panel');
  const content = panel.querySelector('.panel-content');
  E.ui.initPanelResize(panel, 'estudio-brand-w');

  const FONTS = [
    'Helvetica Neue', 'Arial', 'Inter', 'Montserrat', 'Poppins', 'Roboto',
    'Futura', 'Bebas Neue', 'Druk Wide', 'DIN Condensed', 'Georgia',
    'Playfair Display', 'Times New Roman',
  ];
  const ENTITY_KINDS = [
    ['produto', 'Produto'],
    ['personagem', 'Personagem'],
    ['cenario', 'Cenário / Lugar'],
    ['variacao', 'Variação'],
    ['outro', 'Outro'],
  ];

  let project = null;
  let tab = 'id'; // 'id' | 'dir' | 'ref'

  const save = E.debounce(async () => {
    if (!project) return;
    project.updatedAt = Date.now();
    await E.db.put('projects', project);
    // os cards Gerador mostram as referências ao vivo
    if (E.canvas.isOpen()) E.canvas.refreshGenCards();
  }, 400);

  function isOpen() {
    return !panel.classList.contains('hidden');
  }

  function toggle() {
    if (isOpen()) close();
    else open();
  }

  function open() {
    const st = E.canvas.isOpen() ? E.canvas.getState() : null;
    if (!st || !st.project) return;
    project = st.project;
    if (!project.brand) project.brand = {};
    const b = project.brand;
    if (!b.colors) b.colors = [];
    if (b.fonts === undefined) b.fonts = '';
    if (b.notes === undefined) b.notes = '';
    if (b.negative === undefined) b.negative = '';
    // migração: as fotos de produto antigas viram a primeira entidade
    if (!Array.isArray(b.entities)) {
      b.entities = [];
      if (Array.isArray(b.productRefs) && b.productRefs.length) {
        b.entities.push({
          id: 'en-' + E.uid().slice(0, 8),
          name: 'Produto',
          kind: 'produto',
          desc: '',
          refs: b.productRefs.slice(),
        });
        delete b.productRefs;
        save();
      }
    }
    if (E.schedule && E.schedule.isOpen()) E.schedule.close();
    if (E.notes && E.notes.isOpen()) E.notes.close();
    panel.classList.remove('hidden');
    E.ui.applyPanelWidth(panel, 'estudio-brand-w');
    document.getElementById('tool-brand').classList.add('active');
    render();
  }

  function close() {
    panel.classList.add('hidden');
    document.getElementById('tool-brand').classList.remove('active');
    project = null;
  }

  /* ---------- helpers de UI ---------- */

  function section(title, hint) {
    const sec = document.createElement('div');
    sec.className = 'brand-section';
    if (title) {
      const h = document.createElement('div');
      h.className = 'brand-section-title';
      h.textContent = title;
      sec.appendChild(h);
    }
    if (hint) {
      const p = document.createElement('p');
      p.className = 'brand-hint';
      p.textContent = hint;
      sec.appendChild(p);
    }
    return sec;
  }

  function pickFiles(accept, multiple, onPick) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = !!multiple;
    input.addEventListener('change', () => {
      const files = [...input.files];
      if (files.length) onPick(files);
    });
    input.click();
  }

  function refsGrid(refList, onChanged) {
    const grid = document.createElement('div');
    grid.className = 'brand-refs';
    refList.forEach((blobId, i) => {
      const thumb = document.createElement('button');
      thumb.className = 'brand-ref';
      thumb.title = 'Clique pra remover esta foto';
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      E.db.blobUrl(blobId).then((u) => {
        if (u) img.src = u;
      });
      thumb.appendChild(img);
      thumb.addEventListener('click', async () => {
        const ok = await E.ui.confirm('Remover esta foto?', '', 'Remover');
        if (!ok) return;
        refList.splice(i, 1);
        onChanged();
      });
      grid.appendChild(thumb);
    });
    const add = document.createElement('button');
    add.className = 'brand-ref brand-ref-add';
    add.textContent = '+';
    add.title = 'Adicionar fotos (vários ângulos ajudam a consistência)';
    add.addEventListener('click', () =>
      pickFiles('image/*', true, async (files) => {
        for (const f of files) refList.push(await E.db.saveBlob(f));
        onChanged();
      })
    );
    grid.appendChild(add);
    return grid;
  }

  /* ---------- render ---------- */

  function render() {
    const b = project.brand;
    content.innerHTML = '';

    // cabeçalho
    const head = document.createElement('div');
    head.className = 'sched-head';
    const title = document.createElement('span');
    title.className = 'panel-title';
    title.innerHTML = E.icon('palette', 17) + '<span>Marca &amp; Produto</span>';
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost';
    closeBtn.innerHTML = E.icon('close', 16);
    closeBtn.addEventListener('click', close);
    head.appendChild(title);
    head.appendChild(spacer);
    head.appendChild(closeBtn);
    content.appendChild(head);

    // sub-abas
    const tabs = document.createElement('div');
    tabs.className = 'brand-tabs';
    [
      ['id', 'Identidade'],
      ['dir', 'Diretrizes'],
      ['ref', 'Referências'],
    ].forEach(([id, label]) => {
      const t = document.createElement('button');
      t.className = 'brand-tab' + (tab === id ? ' active' : '');
      t.textContent = label;
      t.addEventListener('click', () => {
        tab = id;
        render();
      });
      tabs.appendChild(t);
    });
    content.appendChild(tabs);

    if (tab === 'id') renderIdentity(b);
    else if (tab === 'dir') renderGuidelines(b);
    else renderEntities(b);
  }

  /* ---------- aba Identidade ---------- */

  function renderIdentity(b) {
    const secLogo = section('Logo');
    const logoRow = document.createElement('div');
    logoRow.className = 'brand-logo-row';
    const logoImg = document.createElement('img');
    logoImg.className = 'brand-logo-thumb';
    logoImg.alt = '';
    if (b.logoBlobId) {
      E.db.blobUrl(b.logoBlobId).then((u) => {
        if (u) logoImg.src = u;
      });
    } else {
      logoImg.classList.add('hidden');
    }
    const logoBtn = document.createElement('button');
    logoBtn.className = 'btn';
    logoBtn.textContent = b.logoBlobId ? 'Trocar logo' : 'Escolher logo';
    logoBtn.addEventListener('click', () =>
      pickFiles('image/*', false, async (files) => {
        b.logoBlobId = await E.db.saveBlob(files[0]);
        save();
        render();
      })
    );
    logoRow.appendChild(logoImg);
    logoRow.appendChild(logoBtn);
    secLogo.appendChild(logoRow);
    content.appendChild(secLogo);

    const secColors = section('Cores da marca', 'Clique numa cor pra remover.');
    const colorsRow = document.createElement('div');
    colorsRow.className = 'brand-colors';
    b.colors.forEach((hex, i) => {
      const sw = document.createElement('button');
      sw.className = 'brand-swatch';
      sw.style.background = hex;
      sw.title = hex + ' — clique pra remover';
      sw.addEventListener('click', () => {
        b.colors.splice(i, 1);
        save();
        render();
      });
      colorsRow.appendChild(sw);
    });
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'brand-color-add';
    picker.title = 'Adicionar cor';
    picker.value = '#a78bfa';
    picker.addEventListener('change', () => {
      b.colors.push(picker.value);
      save();
      render();
    });
    colorsRow.appendChild(picker);
    secColors.appendChild(colorsRow);
    content.appendChild(secColors);

    const secFonts = section('Tipografia');
    const fsel = document.createElement('select');
    fsel.className = 'brand-input';
    const op0 = document.createElement('option');
    op0.value = '';
    op0.textContent = '— escolher uma fonte padrão —';
    fsel.appendChild(op0);
    FONTS.forEach((f) => {
      const op = document.createElement('option');
      op.value = f;
      op.textContent = f;
      fsel.appendChild(op);
    });
    const fontsInput = document.createElement('input');
    fontsInput.type = 'text';
    fontsInput.className = 'brand-input';
    fontsInput.placeholder = 'Ou descreva: Títulos em Druk Wide bold, corpo em Helvetica…';
    fontsInput.value = b.fonts;
    fontsInput.style.marginTop = '7px';
    fontsInput.addEventListener('input', () => {
      b.fonts = fontsInput.value;
      save();
    });
    fsel.addEventListener('change', () => {
      if (!fsel.value) return;
      b.fonts = b.fonts ? b.fonts + ', ' + fsel.value : fsel.value;
      fontsInput.value = b.fonts;
      fsel.value = '';
      save();
    });
    secFonts.appendChild(fsel);
    secFonts.appendChild(fontsInput);

    const fontRow = document.createElement('div');
    fontRow.className = 'brand-logo-row';
    fontRow.style.marginTop = '8px';
    const fontBtn = document.createElement('button');
    fontBtn.className = 'btn ghost';
    E.setLabel(fontBtn, 'upload', b.fontName ? b.fontName + '  ·  trocar' : 'Subir arquivo da fonte (.ttf/.otf)');
    fontBtn.addEventListener('click', () =>
      pickFiles('.ttf,.otf,.woff,.woff2', false, async (files) => {
        b.fontBlobId = await E.db.saveBlob(files[0]);
        b.fontName = files[0].name;
        save();
        render();
      })
    );
    fontRow.appendChild(fontBtn);
    if (b.fontName) {
      const rm = document.createElement('button');
      rm.className = 'btn ghost';
      rm.innerHTML = E.icon('close', 12);
      rm.title = 'Remover arquivo da fonte';
      rm.addEventListener('click', () => {
        delete b.fontBlobId;
        delete b.fontName;
        save();
        render();
      });
      fontRow.appendChild(rm);
    }
    secFonts.appendChild(fontRow);
    content.appendChild(secFonts);
  }

  /* ---------- aba Diretrizes ---------- */

  function renderGuidelines(b) {
    const secYes = section(
      'Combina com a marca',
      'Estética, tom, clima, elementos que SEMPRE funcionam.'
    );
    const yes = document.createElement('textarea');
    yes.className = 'brand-input';
    yes.rows = 6;
    yes.placeholder =
      'Ex.: Tom popular e direto, sempre "na brasa", fotos com fundo escuro, comida em close, luz quente de fim de tarde, brasa aparecendo…';
    yes.value = b.notes;
    yes.addEventListener('input', () => {
      b.notes = yes.value;
      save();
    });
    secYes.appendChild(yes);
    content.appendChild(secYes);

    const secNo = section(
      'NÃO combina (negativo)',
      'O que a IA deve evitar SEMPRE — estética, cores, clima, elementos proibidos.'
    );
    const no = document.createElement('textarea');
    no.className = 'brand-input';
    no.rows = 6;
    no.placeholder =
      'Ex.: Nunca usar roxo, nada de visual "gourmet frio", sem fundo branco estourado, sem letras serifadas, sem clima corporativo…';
    no.value = b.negative;
    no.addEventListener('input', () => {
      b.negative = no.value;
      save();
    });
    secNo.appendChild(no);
    content.appendChild(secNo);
  }

  /* ---------- aba Referências (entidades) ---------- */

  function renderEntities(b) {
    const intro = section(
      null,
      'Cada item aqui é uma referência viva: produto, personagem, cenário… Suba fotos de VÁRIOS ângulos e descreva a identidade dele. No card Gerador você escolhe quais entram em cada geração — a IA mantém o item idêntico ao real.'
    );
    content.appendChild(intro);

    b.entities.forEach((en, idx) => {
      const card = document.createElement('div');
      card.className = 'brand-entity';

      const top = document.createElement('div');
      top.className = 'brand-entity-top';
      const name = document.createElement('input');
      name.type = 'text';
      name.className = 'brand-input';
      name.placeholder = 'Nome (ex.: Pão de alho tradicional)';
      name.value = en.name || '';
      name.addEventListener('input', () => {
        en.name = name.value;
        save();
      });
      const kind = document.createElement('select');
      kind.className = 'brand-input brand-entity-kind';
      ENTITY_KINDS.forEach(([v, l]) => {
        const op = document.createElement('option');
        op.value = v;
        op.textContent = l;
        kind.appendChild(op);
      });
      kind.value = en.kind || 'produto';
      kind.addEventListener('change', () => {
        en.kind = kind.value;
        save();
      });
      const del = document.createElement('button');
      del.className = 'btn ghost';
      del.innerHTML = E.icon('trash', 14);
      del.title = 'Excluir este item';
      del.addEventListener('click', async () => {
        const ok = await E.ui.confirm(
          'Excluir "' + (en.name || 'item') + '"?',
          'As fotos de referência dele saem junto.',
          'Excluir'
        );
        if (!ok) return;
        b.entities.splice(idx, 1);
        save();
        render();
      });
      top.appendChild(name);
      top.appendChild(kind);
      top.appendChild(del);
      card.appendChild(top);

      const desc = document.createElement('textarea');
      desc.className = 'brand-input';
      desc.rows = 2;
      desc.placeholder =
        'Identidade do item — o que NUNCA muda (formato, cores, textura, traços, embalagem…)';
      desc.value = en.desc || '';
      desc.addEventListener('input', () => {
        en.desc = desc.value;
        save();
      });
      card.appendChild(desc);

      if (!Array.isArray(en.refs)) en.refs = [];
      card.appendChild(
        refsGrid(en.refs, () => {
          save();
          render();
        })
      );
      content.appendChild(card);
    });

    const add = document.createElement('button');
    add.className = 'btn brand-entity-add';
    add.textContent = '+ Novo item de referência';
    add.addEventListener('click', () => {
      b.entities.push({
        id: 'en-' + E.uid().slice(0, 8),
        name: '',
        kind: 'produto',
        desc: '',
        refs: [],
      });
      save();
      render();
    });
    content.appendChild(add);
  }

  E.brand = { toggle, close, isOpen };
})();
