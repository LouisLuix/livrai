/* Renderização e edição dos itens do canvas: nota, imagem, link, cor, título e post */
(function () {
  const E = window.Estudio;
  E.items = {};

  /* Mídias de um post (carrossel) — compatível com posts antigos de imagem única */
  E.items.postMedia = function (c) {
    if (c && Array.isArray(c.media) && c.media.length) return c.media;
    if (c && c.blobId) return [{ blobId: c.blobId, kind: 'image' }];
    return [];
  };

  E.items.position = function (el, item) {
    el.style.left = item.x + 'px';
    el.style.top = item.y + 'px';
    el.style.width = item.w + 'px';
    el.style.height = item.h + 'px';
    el.style.zIndex = item.z || 1;
    if (item.kind === 'label') {
      el.style.fontSize = Math.max(14, Math.round(item.h * 0.55)) + 'px';
    }
  };

  E.items.render = function (item, onChange) {
    const el = document.createElement('div');
    el.className = 'item item-' + item.kind;
    el.dataset.id = item.id;

    const body = document.createElement('div');
    body.className = 'item-body';
    el.appendChild(body);

    const handle = document.createElement('div');
    handle.className = 'handle';
    el.appendChild(handle);

    E.items.refreshBody(item, el, onChange);
    E.items.position(el, item);
    return el;
  };

  E.items.refreshBody = function (item, el, onChange) {
    const body = el.querySelector('.item-body');
    body.innerHTML = '';
    body.className = 'item-body';
    body.style.background = '';
    const c = item.content || {};

    if (item.kind === 'note') {
      if (c.pageId) {
        renderLinkedNote(item, body, el, onChange);
      } else {
        const t = document.createElement('div');
        t.className = 'note-text note-rich';
        renderNoteRich(item, t, el, onChange);
        body.appendChild(t);
      }
    } else if (item.kind === 'label') {
      const t = document.createElement('span');
      t.className = 'label-text';
      t.textContent = c.text || 'Título';
      body.appendChild(t);
    } else if (item.kind === 'flownode') {
      const shape = c.shape || 'step';
      body.classList.add('flow-body', 'flow-shape-' + shape);
      el.style.setProperty('--flow-c', c.color || '#ff5c26');
      const t = document.createElement('span');
      t.className = 'flow-text';
      t.textContent = c.text || '';
      body.appendChild(t);
    } else if (item.kind === 'image') {
      const img = document.createElement('img');
      img.draggable = false;
      img.alt = '';
      E.db.blobUrl(c.blobId).then((u) => {
        if (u) img.src = u;
      });
      body.appendChild(img);
      applyAlphaLook(item, el, img);
    } else if (item.kind === 'link') {
      if (item._edit || !c.url) {
        // edição dentro do próprio card — sem popup
        body.classList.add('link-editing');
        const ti = document.createElement('input');
        ti.type = 'text';
        ti.className = 'link-input';
        ti.placeholder = 'Nome (opcional)';
        ti.value = c.title || '';
        const ui = document.createElement('input');
        ui.type = 'text';
        ui.className = 'link-input link-url-input';
        ui.placeholder = 'Cole o link: https://…';
        ui.value = c.url || '';
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn primary link-ok';
        ok.textContent = 'OK';
        const commit = () => {
          item.content.title = ti.value.trim();
          item.content.url = normalizeUrl(ui.value.trim());
          delete item._edit;
          E.items.refreshBody(item, el, onChange);
          if (onChange) onChange(item);
        };
        ok.addEventListener('click', commit);
        [ti, ui].forEach((inp) => {
          inp.spellcheck = false;
          inp.addEventListener('keydown', (ev) => {
            ev.stopPropagation();
            if (ev.key === 'Enter') commit();
          });
        });
        body.appendChild(ti);
        body.appendChild(ui);
        body.appendChild(ok);
      } else {
        renderLinkPreview(item, body, el, onChange);
      }
    } else if (item.kind === 'color') {
      const hex = c.hex || '#a78bfa';
      body.style.background = hex;
      const tag = document.createElement('span');
      tag.className = 'color-hex';
      tag.textContent = hex;
      const input = document.createElement('input');
      input.type = 'color';
      input.className = 'color-input';
      input.value = hex;
      input.addEventListener('input', () => {
        item.content.hex = input.value;
        body.style.background = input.value;
        tag.textContent = input.value;
        if (onChange) onChange(item);
      });
      body.appendChild(tag);
      body.appendChild(input);
    } else if (item.kind === 'gen') {
      body.classList.add('gen-body');
      const bar = document.createElement('div');
      bar.className = 'media-bar';
      E.setLabel(bar, 'sparkles', 'Gerador de IA');
      body.appendChild(bar);

      const mkSelect = (options, value, fn) => {
        const sel = document.createElement('select');
        sel.className = 'gen-select';
        options.forEach(([v, l]) => {
          const op = document.createElement('option');
          op.value = v;
          op.textContent = l;
          sel.appendChild(op);
        });
        sel.value = value;
        sel.addEventListener('change', () => fn(sel.value));
        return sel;
      };
      const mkRow = (labelText, ctrl) => {
        const row = document.createElement('div');
        row.className = 'gen-row';
        const sp = document.createElement('span');
        sp.textContent = labelText;
        row.appendChild(sp);
        row.appendChild(ctrl);
        body.appendChild(row);
      };
      const mkCheck = (labelText, checked, fn) => {
        const lab = document.createElement('label');
        lab.className = 'gen-check';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = checked !== false;
        input.addEventListener('change', () => fn(input.checked));
        lab.appendChild(input);
        lab.appendChild(document.createTextNode(labelText));
        body.appendChild(lab);
      };
      const set = (key) => (v) => {
        item.content[key] = v;
        if (onChange) onChange(item);
      };
      const setAndRefresh = (key) => (v) => {
        item.content[key] = v;
        if (onChange) onChange(item);
        E.items.refreshBody(item, el, onChange);
      };

      mkRow('Tipo', mkSelect(
        [['imagem', 'Imagem'], ['texto', 'Texto'], ['video', 'Vídeo'], ['audio', 'Áudio']],
        c.type || 'imagem', setAndRefresh('type')
      ));
      const tp = c.type || 'imagem';
      if (tp === 'imagem') {
        mkRow('Modelo', mkSelect(
          E.ai.imageModels().map((m) => [m.id, m.label]),
          c.imageModel || 'gemini', setAndRefresh('imageModel')
        ));
      }
      if (tp === 'imagem' || tp === 'video') {
        mkRow('Formato', mkSelect(
          [['1:1', '1:1 Feed'], ['4:5', '4:5 Feed'], ['9:16', '9:16 Reels'], ['16:9', '16:9 Wide']],
          c.aspect || '1:1', set('aspect')
        ));
      }
      if (tp === 'imagem') {
        mkRow('Qualidade', mkSelect(
          [['alta', 'Alta'], ['padrao', 'Padrão']],
          c.quality || 'alta', set('quality')
        ));
      }
      if (tp === 'video') {
        mkRow('Modelo', mkSelect(
          E.ai.videoModels().map((m) => [m.id, m.label]),
          c.videoModel || E.ai.videoModels()[0].id, set('videoModel')
        ));
      }
      if (tp !== 'audio') {
        mkCheck('Minha identidade', c.useIdentity, set('useIdentity'));
        mkCheck('Marca do projeto', c.useBrand, set('useBrand'));
        if (tp === 'imagem') {
          const ents = E.ai.brandEntities();
          if (ents.length) {
            const selCount = ents.filter((en) =>
              Array.isArray(c.entityIds) ? c.entityIds.indexOf(en.id) >= 0 : c.useProduct !== false
            ).length;
            const head = document.createElement('div');
            head.className = 'gen-row gen-ents-head';
            const sp = document.createElement('span');
            sp.textContent = 'Referências do projeto (' + selCount + '/' + ents.length + ')';
            head.appendChild(sp);
            body.appendChild(head);
            const box = document.createElement('div');
            box.className = 'gen-ents';
            ents.forEach((en) => {
              const on = Array.isArray(c.entityIds)
                ? c.entityIds.indexOf(en.id) >= 0
                : c.useProduct !== false;
              const lab = document.createElement('label');
              lab.className = 'gen-check';
              const input = document.createElement('input');
              input.type = 'checkbox';
              input.checked = on;
              input.addEventListener('change', () => {
                const cur = new Set(
                  Array.isArray(c.entityIds)
                    ? c.entityIds
                    : c.useProduct !== false
                      ? ents.map((x) => x.id)
                      : []
                );
                if (input.checked) cur.add(en.id);
                else cur.delete(en.id);
                item.content.entityIds = [...cur];
                if (onChange) onChange(item);
                E.items.refreshBody(item, el, onChange);
              });
              lab.appendChild(input);
              lab.appendChild(document.createTextNode(en.name || 'Referência'));
              box.appendChild(lab);
            });
            body.appendChild(box);
          } else {
            const hint = document.createElement('div');
            hint.className = 'gen-row';
            const sp = document.createElement('span');
            sp.textContent = 'Crie produtos/referências em Marca → Referências';
            hint.appendChild(sp);
            body.appendChild(hint);
          }
        }
      }

      if (tp === 'imagem') {
        // imagem de cena/base: a IA compõe o resultado DENTRO desta foto
        const sceneRow = document.createElement('div');
        sceneRow.className = 'gen-row';
        const sLabel = document.createElement('span');
        sLabel.textContent = 'Cena/base';
        sLabel.title = 'Ex.: foto da sala com a mesa vazia — a IA ambienta o produto nela';
        sceneRow.appendChild(sLabel);
        if (c.sceneBlobId) {
          const holder = document.createElement('span');
          holder.className = 'gen-scene';
          const thumb = document.createElement('img');
          thumb.className = 'gen-scene-thumb';
          thumb.alt = '';
          E.db.blobUrl(c.sceneBlobId).then((u) => {
            if (u) thumb.src = u;
          });
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'item-action gen-scene-rm';
          rm.innerHTML = E.icon('close', 12);
          rm.title = 'Remover a cena';
          rm.addEventListener('click', () => {
            delete item.content.sceneBlobId;
            if (onChange) onChange(item);
            E.items.refreshBody(item, el, onChange);
          });
          holder.appendChild(thumb);
          holder.appendChild(rm);
          sceneRow.appendChild(holder);
        } else {
          const attach = document.createElement('button');
          attach.type = 'button';
          attach.className = 'item-action gen-scene-add';
          attach.textContent = 'Anexar imagem';
          attach.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.addEventListener('change', async () => {
              const f = input.files[0];
              if (!f) return;
              item.content.sceneBlobId = await E.db.saveBlob(f);
              if (onChange) onChange(item);
              E.items.refreshBody(item, el, onChange);
            });
            input.click();
          });
          sceneRow.appendChild(attach);
        }
        body.appendChild(sceneRow);

        // ajustes finos: direção de arte precisa transferida pro prompt
        const det = document.createElement('details');
        det.className = 'gen-fine';
        const sum = document.createElement('summary');
        sum.textContent = 'Ajustes finos (cores, atmosfera, textura)';
        det.appendChild(sum);
        const mkFine = (label, key, placeholder) => {
          const row = document.createElement('div');
          row.className = 'gen-fine-row';
          const sp = document.createElement('span');
          sp.textContent = label;
          const input = document.createElement('input');
          input.type = 'text';
          input.placeholder = placeholder;
          input.value = c[key] || '';
          input.spellcheck = false;
          input.addEventListener('keydown', (ev) => ev.stopPropagation());
          input.addEventListener('change', () => {
            item.content[key] = input.value.trim();
            if (onChange) onChange(item);
          });
          row.appendChild(sp);
          row.appendChild(input);
          det.appendChild(row);
        };
        mkFine('Cores', 'tuneColors', 'tons quentes, terrosos, contraste alto…');
        mkFine('Atmosfera', 'tuneMood', 'fim de tarde, vapor subindo, aconchego…');
        mkFine('Textura', 'tuneTexture', 'grão de filme, crocância visível, brilho…');
        body.appendChild(det);
      }

      const ta = document.createElement('textarea');
      ta.className = 'gen-prompt';
      ta.placeholder =
        tp === 'audio' ? 'Texto que vira locução…' : 'Descreva o que você quer criar…';
      ta.value = c.prompt || '';
      ta.spellcheck = false;
      ta.addEventListener('change', () => {
        item.content.prompt = ta.value;
        if (onChange) onChange(item);
      });
      ta.addEventListener('keydown', (ev) => ev.stopPropagation());
      body.appendChild(ta);

      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary gen-go';
      E.setLabel(go, 'sparkles', 'Gerar');
      go.addEventListener('click', () => {
        item.content.prompt = ta.value;
        if (onChange) onChange(item);
        E.ai.runFromGenItem(item);
      });
      body.appendChild(go);
    } else if (item.kind === 'frame') {
      let bar = el.querySelector('.frame-title');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'frame-title';
        el.appendChild(bar);
      }
      bar.innerHTML = '';
      const nameSpan = document.createElement('span');
      nameSpan.textContent = c.text || 'Prancha';
      nameSpan.title = 'Arraste pra mover · duplo clique pra renomear';
      const sel = document.createElement('select');
      sel.className = 'frame-preset';
      E.FRAME_PRESETS.forEach((p) => {
        const op = document.createElement('option');
        op.value = p.id;
        op.textContent = p.id;
        sel.appendChild(op);
      });
      sel.value = c.preset || '1:1';
      sel.title = 'Formato da prancha';
      sel.addEventListener('change', () => {
        const pr = E.framePresetById(sel.value);
        item.content.preset = pr.id;
        item.w = pr.w;
        item.h = pr.h;
        E.items.position(el, item);
        if (onChange) onChange(item);
      });
      bar.appendChild(nameSpan);
      bar.appendChild(sel);
    } else if (item.kind === 'video') {
      body.classList.add('media-body');
      const bar = document.createElement('div');
      bar.className = 'media-bar';
      E.setLabel(bar, 'film', c.title || 'Vídeo');
      const video = document.createElement('video');
      video.controls = true;
      video.playsInline = true;
      video.preload = 'metadata';
      E.db.blobUrl(c.blobId).then((u) => {
        if (u) video.src = u;
      });
      body.appendChild(bar);
      body.appendChild(video);
    } else if (item.kind === 'audio') {
      body.classList.add('media-body');
      const bar = document.createElement('div');
      bar.className = 'media-bar';
      E.setLabel(bar, 'audio', c.title || 'Áudio');
      const audio = document.createElement('audio');
      audio.controls = true;
      audio.preload = 'metadata';
      E.db.blobUrl(c.blobId).then((u) => {
        if (u) audio.src = u;
      });
      body.appendChild(bar);
      body.appendChild(audio);
    } else if (item.kind === 'post') {
      const status = E.postStatusById(c.status);
      const top = document.createElement('div');
      top.className = 'post-top';
      const date = document.createElement('input');
      date.type = 'date';
      date.className = 'item-action post-date';
      date.value = c.date || '';
      date.title = 'Data do post — clique e escolha no calendário';
      date.addEventListener('keydown', (ev) => ev.stopPropagation());
      date.addEventListener('change', () => {
        item.content.date = date.value;
        if (onChange) onChange(item);
      });
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'item-action post-status';
      chip.textContent = status.label;
      chip.style.background = status.color;
      chip.title = 'Clique pra avançar o status';
      chip.addEventListener('click', () => {
        const i = E.POST_STATUS.findIndex((s) => s.id === (item.content.status || 'ideia'));
        const next = E.POST_STATUS[(i + 1) % E.POST_STATUS.length];
        item.content.status = next.id;
        E.items.refreshBody(item, el, onChange);
        if (onChange) onChange(item);
      });
      top.appendChild(date);
      top.appendChild(chip);
      body.appendChild(top);
      const media = E.items.postMedia(c);
      if (media.length) {
        const idx = Math.min(c.mediaIndex || 0, media.length - 1);
        const m = media[idx];
        const wrap = document.createElement('div');
        wrap.className = 'post-carousel';
        if (m.kind === 'video') {
          const video = document.createElement('video');
          video.controls = true;
          video.playsInline = true;
          video.preload = 'metadata';
          E.db.blobUrl(m.blobId).then((u) => {
            if (u) video.src = u;
          });
          wrap.appendChild(video);
        } else {
          const img = document.createElement('img');
          img.draggable = false;
          img.alt = '';
          E.db.blobUrl(m.blobId).then((u) => {
            if (u) img.src = u;
          });
          wrap.appendChild(img);
        }
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'item-action post-media-del';
        del.innerHTML = E.icon('close', 12);
        del.title = 'Tirar este item do post';
        del.addEventListener('click', () => {
          const list = media.slice();
          list.splice(idx, 1);
          item.content.media = list;
          delete item.content.blobId;
          item.content.mediaIndex = Math.max(0, idx - 1);
          E.items.refreshBody(item, el, onChange);
          if (onChange) onChange(item);
        });
        wrap.appendChild(del);
        if (media.length > 1) {
          const nav = document.createElement('div');
          nav.className = 'post-nav';
          const prev = document.createElement('button');
          prev.type = 'button';
          prev.className = 'item-action';
          prev.textContent = '‹';
          const count = document.createElement('span');
          count.textContent = idx + 1 + '/' + media.length;
          const next = document.createElement('button');
          next.type = 'button';
          next.className = 'item-action';
          next.textContent = '›';
          const go = (d) => {
            item.content.media = media;
            item.content.mediaIndex = (idx + d + media.length) % media.length;
            E.items.refreshBody(item, el, onChange);
            if (onChange) onChange(item);
          };
          prev.addEventListener('click', () => go(-1));
          next.addEventListener('click', () => go(1));
          nav.appendChild(prev);
          nav.appendChild(count);
          nav.appendChild(next);
          wrap.appendChild(nav);
        }
        body.appendChild(wrap);
      }
      const t = document.createElement('div');
      t.className = 'note-text post-text';
      t.textContent = c.text || '';
      body.appendChild(t);
    } else if (item.kind === 'file') {
      body.classList.add('file-body');
      const meta = E.items.fileMeta(c.name);
      const ic = document.createElement('div');
      ic.className = 'file-icon';
      ic.innerHTML = E.icon(meta.icon, 26);
      const nm = document.createElement('div');
      nm.className = 'file-name';
      nm.textContent = c.name || 'Arquivo';
      nm.title = c.name || '';
      const inf = document.createElement('div');
      inf.className = 'file-info mono';
      inf.textContent = meta.label + (c.size ? ' · ' + humanSize(c.size) : '');
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'item-action file-open';
      E.setLabel(open, 'arrow-up-right', 'Abrir');
      open.title = 'Abrir no aplicativo do arquivo';
      open.addEventListener('click', () => E.files.openFileItem(item));
      body.appendChild(ic);
      body.appendChild(nm);
      body.appendChild(inf);
      body.appendChild(open);
    } else if (item.kind === 'folder') {
      body.classList.add('folder-body');
      const ic = document.createElement('div');
      ic.className = 'file-icon';
      ic.innerHTML = E.icon('folder', 26);
      const nm = document.createElement('div');
      nm.className = 'file-name';
      nm.textContent = c.name || 'Pasta';
      nm.title = c.path || '';
      const inf = document.createElement('div');
      inf.className = 'file-info mono';
      inf.textContent = shortPath(c.path);
      inf.title = c.path || '';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'item-action file-open';
      E.setLabel(open, 'eye', 'Explorar');
      open.title = 'Ver o conteúdo da pasta — duplo clique no card abre o explorador completo';
      open.addEventListener('click', (e) => {
        e.stopPropagation();
        E.explorer.dropdown(open, c.path, c.name);
      });
      body.appendChild(ic);
      body.appendChild(nm);
      body.appendChild(inf);
      body.appendChild(open);
    }

    // Fluxograma universal: pontinhos de conexão nas 4 bordas de QUALQUER
    // card (menos pranchas) — uma imagem pode puxar seta pra uma nota, etc.
    // Ficam no el (não no body) pra escapar do clip/overflow do card.
    if (item.kind !== 'frame') {
      ['t', 'r', 'b', 'l'].forEach((side) => {
        if (el.querySelector('.flow-port[data-side="' + side + '"]')) return;
        const port = document.createElement('div');
        port.className = 'flow-port';
        port.dataset.side = side;
        port.title = 'Arraste até outro item pra criar a seta';
        el.appendChild(port);
      });
    }
  };

  /* PNG/WebP com recorte ficam SEM fundo nem sombra no canvas — a
     transparência aparece de verdade. Detecta o alpha uma vez e guarda. */
  function applyAlphaLook(item, el, img) {
    const c = item.content || {};
    if (c.hasAlpha === true) {
      el.classList.add('item-transparent');
      return;
    }
    if (c.hasAlpha === false) return;
    img.addEventListener('load', function once() {
      img.removeEventListener('load', once);
      try {
        const cv = document.createElement('canvas');
        cv.width = 64;
        cv.height = 64;
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0, 64, 64);
        const d = g.getImageData(0, 0, 64, 64).data;
        let alpha = false;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] < 250) {
            alpha = true;
            break;
          }
        }
        item.content.hasAlpha = alpha;
        E.db.put('items', item);
        if (alpha) el.classList.add('item-transparent');
      } catch (_) {
        /* imagem indecodificável — mantém o card normal */
      }
    });
  }

  /* ---------- arquivos genéricos (PDF, Office…) ---------- */

  const FILE_KINDS = [
    { exts: ['pdf'], icon: 'note', label: 'PDF' },
    { exts: ['doc', 'docx', 'odt', 'rtf', 'pages'], icon: 'type', label: 'Documento' },
    { exts: ['xls', 'xlsx', 'csv', 'ods', 'numbers'], icon: 'grid', label: 'Planilha' },
    { exts: ['ppt', 'pptx', 'odp', 'key'], icon: 'monitor', label: 'Apresentação' },
    { exts: ['psd', 'psb', 'ai', 'indd', 'xd', 'fig', 'sketch'], icon: 'brush', label: 'Design' },
    { exts: ['zip', 'rar', '7z', 'tar', 'gz'], icon: 'archive', label: 'Compactado' },
    { exts: ['txt', 'md'], icon: 'type', label: 'Texto' },
    { exts: ['ttf', 'otf', 'woff', 'woff2'], icon: 'type', label: 'Fonte' },
  ];

  E.items.fileMeta = function (name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    for (const k of FILE_KINDS) {
      if (k.exts.indexOf(ext) >= 0) return { icon: k.icon, label: k.label, ext: ext };
    }
    return { icon: 'copy', label: ext && ext !== name ? ext.toUpperCase() : 'Arquivo', ext: ext };
  };

  function humanSize(n) {
    if (!n) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return Math.round(n / 1024) + ' KB';
    if (n < 1073741824) return (n / 1048576).toFixed(1).replace('.0', '') + ' MB';
    return (n / 1073741824).toFixed(1) + ' GB';
  }
  E.items.humanSize = humanSize;

  function shortPath(p) {
    const parts = String(p || '').split('/').filter(Boolean);
    return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : '/' + parts.join('/');
  }

  /* ---------- nota smart: título, formatação e checklist no próprio card ----------
     Sintaxe (a mesma das Notas do projeto): "# " título · "## " subtítulo ·
     "- " lista · "[] " / "[x] " tarefa · "---" divisor · **negrito** · *itálico* */

  function inlineFmt(s) {
    return E.escapeHtml(s)
      .replace(/\[([^\]]+)\]\((https?:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/__([^_]+)__/g, '<u>$1</u>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }
  E.inlineFmt = inlineFmt;

  const TODO_RE = /^\[(x|X| )?\]\s?(.*)$/;

  function noteRow(cls, html) {
    const row = document.createElement('div');
    row.className = cls;
    if (html !== undefined) row.innerHTML = html;
    return row;
  }

  function noteBullet(html) {
    const row = noteRow('note-li');
    row.innerHTML = '<span class="note-bullet"></span><span>' + html + '</span>';
    return row;
  }

  function noteTodo(html, done, onToggle) {
    const row = noteRow('note-todo' + (done ? ' done' : ''));
    const cb = document.createElement('button');
    cb.type = 'button';
    cb.className = 'note-check';
    cb.innerHTML = done ? E.icon('check', 11) : '';
    cb.title = done ? 'Reabrir tarefa' : 'Concluir tarefa';
    cb.addEventListener('click', onToggle);
    const sp = document.createElement('span');
    sp.innerHTML = html;
    row.appendChild(cb);
    row.appendChild(sp);
    return row;
  }

  function renderNoteRich(item, holder, el, onChange) {
    const lines = String((item.content && item.content.text) || '').split('\n');
    lines.forEach((line, idx) => {
      const todo = line.match(TODO_RE);
      if (/^---+\s*$/.test(line)) {
        holder.appendChild(noteRow('note-hr'));
      } else if (line.indexOf('## ') === 0) {
        holder.appendChild(noteRow('note-h2', inlineFmt(line.slice(3))));
      } else if (line.indexOf('# ') === 0) {
        holder.appendChild(noteRow('note-h1', inlineFmt(line.slice(2))));
      } else if (line.indexOf('- ') === 0) {
        holder.appendChild(noteBullet(inlineFmt(line.slice(2))));
      } else if (todo) {
        const done = (todo[1] || '').toLowerCase() === 'x';
        holder.appendChild(
          noteTodo(inlineFmt(todo[2]), done, () => {
            const ls = String(item.content.text || '').split('\n');
            ls[idx] = (done ? '[] ' : '[x] ') + todo[2];
            item.content.text = ls.join('\n');
            E.items.refreshBody(item, el, onChange);
            if (onChange) onChange(item);
          })
        );
      } else {
        holder.appendChild(noteRow('note-p', line.trim() ? inlineFmt(line) : '&nbsp;'));
      }
    });
  }

  /* ---------- nota vinculada às Notas do projeto ----------
     A página do painel lateral é a fonte da verdade: o card mostra um
     espelho vivo dela; dois cliques abrem a página no painel. */

  function renderLinkedNote(item, body, el, onChange) {
    const c = item.content || {};
    body.classList.add('note-linked');
    const proj = E.canvas && E.canvas.isOpen && E.canvas.isOpen() ? E.canvas.getState().project : null;
    const page =
      proj && proj.notes && Array.isArray(proj.notes.pages)
        ? proj.notes.pages.find((p) => p.id === c.pageId)
        : null;

    const head = document.createElement('div');
    head.className = 'note-link-head';
    head.title = 'Vinculada às Notas do projeto — dois cliques abrem a página';
    head.innerHTML =
      E.icon('note', 12) +
      '<span>' + E.escapeHtml(page ? page.title || 'Sem título' : 'Página excluída') + '</span>';
    body.appendChild(head);

    const holder = document.createElement('div');
    holder.className = 'note-text note-rich';
    if (!page) {
      holder.textContent =
        'A página desta nota foi excluída das Notas. Botão direito → Desvincular pra editar aqui.';
    } else {
      (page.blocks || []).forEach((b) => {
        if (b.type === 'image') {
          const fig = document.createElement('div');
          fig.className = 'note-img' + (b.w ? ' w-' + b.w : '');
          const im = document.createElement('img');
          im.alt = '';
          im.draggable = false;
          if (b.blobId) E.db.blobUrl(b.blobId).then((u) => { if (u) im.src = u; });
          fig.appendChild(im);
          holder.appendChild(fig);
        } else if (b.type === 'divider') holder.appendChild(noteRow('note-hr'));
        else if (b.type === 'h1') holder.appendChild(noteRow('note-h1', inlineFmt(b.text)));
        else if (b.type === 'h2') holder.appendChild(noteRow('note-h2', inlineFmt(b.text)));
        else if (b.type === 'h3') holder.appendChild(noteRow('note-h3', inlineFmt(b.text)));
        else if (b.type === 'quote') holder.appendChild(noteRow('note-quote', inlineFmt(b.text)));
        else if (b.type === 'callout') holder.appendChild(noteRow('note-callout', inlineFmt(b.text)));
        else if (b.type === 'code') holder.appendChild(noteRow('note-code', E.escapeHtml(b.text)));
        else if (b.type === 'li') holder.appendChild(noteBullet(inlineFmt(b.text)));
        else if (b.type === 'todo') {
          holder.appendChild(
            noteTodo(inlineFmt(b.text), !!b.checked, () => {
              b.checked = !b.checked;
              proj.updatedAt = Date.now();
              E.db.put('projects', proj);
              E.items.refreshBody(item, el, onChange);
              if (E.notes && E.notes.refreshPage) E.notes.refreshPage(page.id);
            })
          );
        } else {
          holder.appendChild(noteRow('note-p', b.text.trim() ? inlineFmt(b.text) : '&nbsp;'));
        }
      });
    }
    body.appendChild(holder);
  }

  function formatDate(iso) {
    const parts = String(iso).split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '/' + parts[1];
  }

  /** Edição conforme o tipo do item (acionada por duplo clique) */
  E.items.beginEdit = function (item, el, onChange) {
    if (item.kind === 'note' && item.content && item.content.pageId) {
      // nota vinculada: quem edita é a página, no painel de Notas
      if (E.notes && E.notes.openPage) E.notes.openPage(item.content.pageId);
      return;
    }
    if (item.kind === 'file') {
      E.files.openFileItem(item);
      return;
    }
    if (item.kind === 'folder') {
      E.explorer.open(item.content.path, item.content.name);
      return;
    }
    if (item.kind === 'note' || item.kind === 'label' || item.kind === 'post' || item.kind === 'frame' || item.kind === 'flownode') {
      textEdit(item, el, onChange);
    } else if (item.kind === 'color') {
      const input = el.querySelector('input[type=color]');
      if (input) input.click();
    } else if (item.kind === 'link') {
      item._edit = true;
      E.items.refreshBody(item, el, onChange);
      const inp = el.querySelector('.link-url-input');
      if (inp) inp.focus();
    } else if (item.kind === 'gen') {
      const ta = el.querySelector('.gen-prompt');
      if (ta) ta.focus();
    }
  };

  function textEdit(item, el, onChange) {
    if (E.state.editing) return;
    if (item.kind === 'post') {
      postTextEdit(item, el, onChange);
      return;
    }
    E.state.editing = true;
    const body = el.querySelector('.item-body');
    const ta = document.createElement('textarea');
    ta.className =
      'item-editor' +
      (item.kind === 'label' ? ' editor-label' : '') +
      (item.kind === 'frame' ? ' editor-frame' : '');
    ta.value = (item.content && item.content.text) || '';
    if (item.kind === 'note') {
      ta.placeholder = '# título · ## subtítulo · - lista · [] tarefa · **negrito** · *itálico* · ---';
    }
    ta.spellcheck = false;
    el.appendChild(ta);
    body.style.visibility = 'hidden';
    ta.focus();
    ta.select();

    let cancelled = false;
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        cancelled = true;
        ta.blur();
      } else if ((item.kind === 'label' || item.kind === 'frame') && ev.key === 'Enter') {
        ev.preventDefault();
        ta.blur();
      }
    });
    ta.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    ta.addEventListener('blur', () => {
      E.state.editing = false;
      if (!cancelled) item.content.text = ta.value;
      ta.remove();
      body.style.visibility = '';
      E.items.refreshBody(item, el, onChange);
      if (!cancelled && onChange) onChange(item);
    });
  }

  /* Post: edita SÓ a área da legenda — a mídia continua visível em cima,
     o editor ocupa exatamente o espaço do texto (nada sobrepõe a imagem) */
  function postTextEdit(item, el, onChange) {
    E.state.editing = true;
    // card baixinho com mídia: cresce pra legenda ter espaço próprio
    if (E.items.postMedia(item.content || {}).length && item.h < 320) {
      item.h = 360;
      E.items.position(el, item);
      if (onChange) onChange(item);
    }
    const body = el.querySelector('.item-body');
    const textEl = body.querySelector('.post-text');
    const ta = document.createElement('textarea');
    ta.className = 'item-editor editor-post';
    ta.value = (item.content && item.content.text) || '';
    ta.placeholder = 'Legenda do post… (botão direito → Gerar texto com IA)';
    ta.spellcheck = false;
    if (textEl) textEl.style.display = 'none';
    body.appendChild(ta);
    ta.focus();
    ta.select();

    let cancelled = false;
    ta.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        cancelled = true;
        ta.blur();
      }
    });
    ta.addEventListener('pointerdown', (ev) => ev.stopPropagation());
    ta.addEventListener('blur', () => {
      E.state.editing = false;
      if (!cancelled) item.content.text = ta.value;
      ta.remove();
      if (textEl) textEl.style.display = '';
      E.items.refreshBody(item, el, onChange);
      if (!cancelled && onChange) onChange(item);
    });
  }

  function normalizeUrl(u) {
    if (!u) return u;
    u = u.trim();
    if (/^(javascript|data|vbscript|file):/i.test(u)) return '';
    if (!/^https?:\/\//i.test(u)) return 'https://' + u;
    return u;
  }
  E.items.normalizeUrl = normalizeUrl;

  /* ---------- preview de link (Open Graph + player do YouTube) ---------- */

  function youtubeId(url) {
    try {
      const u = new URL(url);
      const h = u.hostname.replace(/^www\./, '');
      if (h === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
      if (h === 'youtube.com' || h === 'm.youtube.com' || h.endsWith('.youtube.com')) {
        if (u.pathname === '/watch') return u.searchParams.get('v');
        const m = u.pathname.match(/^\/(embed|shorts|live|v)\/([^/?]+)/);
        if (m) return m[2];
      }
    } catch (_) {}
    return null;
  }

  function renderLinkPreview(item, body, el, onChange) {
    const c = item.content || {};
    body.classList.add('link-rich');
    let host = '';
    try { host = new URL(c.url).hostname.replace(/^www\./, ''); } catch (_) {}
    const yt = youtubeId(c.url);
    const p = c.preview || {};

    // card pequeno (padrão) ganha tamanho de preview quando há mídia
    if ((yt || p.image) && item.w <= 240 && item.h <= 130) {
      item.w = 320;
      item.h = 300;
      E.items.position(el, item);
      if (onChange) onChange(item);
    }

    // área visual: player do YouTube (facade) ou thumbnail Open Graph
    if (yt) {
      const media = document.createElement('div');
      media.className = 'link-media link-yt';
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = 'https://i.ytimg.com/vi/' + yt + '/hqdefault.jpg';
      img.addEventListener('error', () => { img.src = 'https://i.ytimg.com/vi/' + yt + '/mqdefault.jpg'; });
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'link-play';
      play.innerHTML = E.icon('film', 22);
      play.title = 'Reproduzir aqui';
      play.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const f = document.createElement('iframe');
        f.className = 'link-iframe';
        f.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen');
        f.setAttribute('allowfullscreen', '');
        f.src = 'https://www.youtube-nocookie.com/embed/' + yt + '?autoplay=1&rel=0';
        media.innerHTML = '';
        media.appendChild(f);
      });
      media.appendChild(img);
      media.appendChild(play);
      body.appendChild(media);
    } else if (p.image) {
      const media = document.createElement('div');
      media.className = 'link-media';
      const img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.src = p.image;
      img.addEventListener('error', () => media.remove());
      media.appendChild(img);
      body.appendChild(media);
    }

    // texto: título, domínio, descrição
    const meta = document.createElement('div');
    meta.className = 'link-meta';
    const title = document.createElement('div');
    title.className = 'link-title';
    title.textContent = c.title || p.title || host || c.url || 'Link';
    meta.appendChild(title);
    const dom = document.createElement('div');
    dom.className = 'link-domain';
    dom.textContent = (p.siteName ? p.siteName + ' · ' : '') + (host || c.url || '');
    meta.appendChild(dom);
    if (p.description) {
      const desc = document.createElement('div');
      desc.className = 'link-desc';
      desc.textContent = p.description;
      meta.appendChild(desc);
    }
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'item-action link-open';
    E.setLabel(open, 'arrow-up-right', 'Abrir');
    open.addEventListener('click', () => { if (c.url) window.open(c.url, '_blank', 'noopener'); });
    meta.appendChild(open);
    body.appendChild(meta);

    // busca os metadados uma vez (desktop) e re-renderiza
    if (!c.preview && !item._unfurling && c.url && E.files && E.files.unfurl) {
      item._unfurling = true;
      (async () => {
        try {
          if (!(await E.files.isDesktop())) { item._unfurling = false; return; }
          const m = await E.files.unfurl(c.url);
          item.content.preview = m
            ? { title: m.title || '', description: m.description || '', image: m.image || '', siteName: m.siteName || '', type: m.type || '' }
            : {};
          if (!item.content.title && m && m.title) item.content.title = m.title;
          item._unfurling = false;
          if (onChange) onChange(item);
          E.items.refreshBody(item, el, onChange);
        } catch (_) {
          item._unfurling = false;
        }
      })();
    }
  }
})();
