/* Exportação: pranchas → PNG, sequência PNG ou apresentação HTML (arquivo único) */
(function () {
  const E = window.Estudio;
  E.exporter = {};

  const FONT = "-apple-system, 'Helvetica Neue', Arial, sans-serif";

  /* ---------- helpers de desenho ---------- */

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxY) {
    const paragraphs = String(text || '').split('\n');
    let cy = y;
    for (const para of paragraphs) {
      const words = para.split(' ');
      let line = '';
      for (const word of words) {
        const test = line ? line + ' ' + word : word;
        if (ctx.measureText(test).width > maxWidth && line) {
          ctx.fillText(line, x, cy);
          cy += lineHeight;
          if (cy > maxY) return;
          line = word;
        } else {
          line = test;
        }
      }
      ctx.fillText(line, x, cy);
      cy += lineHeight;
      if (cy > maxY) return;
    }
  }

  function loadImage(url) {
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = url;
    });
  }

  function intersects(it, fr) {
    return it.x < fr.x + fr.w && it.x + it.w > fr.x && it.y < fr.y + fr.h && it.y + it.h > fr.y;
  }

  /* ---------- desenho de cada tipo de item ---------- */

  async function drawItem(ctx, it) {
    const c = it.content || {};
    if (it.kind === 'image') {
      const url = await E.db.blobUrl(c.blobId);
      const img = url ? await loadImage(url) : null;
      ctx.save();
      roundRectPath(ctx, it.x, it.y, it.w, it.h, 10);
      ctx.clip();
      if (img) {
        // object-fit: cover
        const scale = Math.max(it.w / img.width, it.h / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, it.x + (it.w - dw) / 2, it.y + (it.h - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = '#1b1b22';
        ctx.fillRect(it.x, it.y, it.w, it.h);
      }
      ctx.restore();
    } else if (it.kind === 'note') {
      roundRectPath(ctx, it.x, it.y, it.w, it.h, 10);
      ctx.fillStyle = '#f5e482';
      ctx.fill();
      ctx.save();
      roundRectPath(ctx, it.x, it.y, it.w, it.h, 10);
      ctx.clip();
      ctx.fillStyle = '#221d05';
      ctx.font = '14px ' + FONT;
      ctx.textBaseline = 'top';
      wrapText(ctx, c.text, it.x + 14, it.y + 13, it.w - 28, 21, it.y + it.h - 18);
      ctx.restore();
    } else if (it.kind === 'color') {
      roundRectPath(ctx, it.x, it.y, it.w, it.h, 10);
      ctx.fillStyle = c.hex || '#a78bfa';
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const tagW = 70;
      roundRectPath(ctx, it.x + it.w / 2 - tagW / 2, it.y + it.h - 30, tagW, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 11px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(c.hex || '', it.x + it.w / 2, it.y + it.h - 20);
      ctx.textAlign = 'left';
    } else if (it.kind === 'label') {
      ctx.fillStyle = '#ececf1';
      ctx.font = '800 ' + Math.max(14, Math.round(it.h * 0.55)) + 'px ' + FONT;
      ctx.textBaseline = 'middle';
      ctx.fillText(c.text || '', it.x, it.y + it.h / 2);
    } else if (it.kind === 'link') {
      drawPanel(ctx, it);
      ctx.fillStyle = '#ececf1';
      ctx.font = '600 14px ' + FONT;
      ctx.textBaseline = 'top';
      let host = '';
      try {
        host = new URL(c.url).hostname.replace(/^www\./, '');
      } catch (_) {}
      wrapText(ctx, c.title || host || c.url || 'Link', it.x + 14, it.y + 14, it.w - 28, 19, it.y + 52);
      ctx.fillStyle = '#8b8b96';
      ctx.font = '12px ' + FONT;
      ctx.fillText('' + (host || ''), it.x + 14, it.y + it.h - 26);
    } else if (it.kind === 'post') {
      drawPanel(ctx, it);
      const status = E.postStatusById(c.status);
      ctx.fillStyle = '#8b8b96';
      ctx.font = '12px ' + FONT;
      ctx.textBaseline = 'top';
      ctx.fillText(c.date ? '' + c.date.split('-').reverse().slice(0, 2).join('/') : 'sem data', it.x + 12, it.y + 12);
      ctx.fillStyle = status.color;
      const pillW = ctx.measureText(status.label).width + 22;
      roundRectPath(ctx, it.x + it.w - pillW - 12, it.y + 8, pillW, 20, 10);
      ctx.fill();
      ctx.fillStyle = '#14120a';
      ctx.font = '700 11px ' + FONT;
      ctx.fillText(status.label, it.x + it.w - pillW - 1, it.y + 13);
      let textY = it.y + 40;
      const media = E.items.postMedia(c);
      if (media.length) {
        const m0 = media[0];
        const ih = Math.max(40, Math.min(it.h * 0.45, it.h - 90));
        ctx.save();
        roundRectPath(ctx, it.x + 8, it.y + 36, it.w - 16, ih, 8);
        ctx.clip();
        if (m0.kind === 'video') {
          ctx.fillStyle = '#0b0b0e';
          ctx.fillRect(it.x + 8, it.y + 36, it.w - 16, ih);
          ctx.fillStyle = '#ececf1';
          ctx.font = '22px ' + FONT;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('▶', it.x + it.w / 2, it.y + 36 + ih / 2);
          ctx.textAlign = 'left';
        } else {
          const url = await E.db.blobUrl(m0.blobId);
          const img = url ? await loadImage(url) : null;
          if (img) {
            const sc = Math.max((it.w - 16) / img.width, ih / img.height);
            const dw = img.width * sc;
            const dh = img.height * sc;
            ctx.drawImage(img, it.x + 8 + (it.w - 16 - dw) / 2, it.y + 36 + (ih - dh) / 2, dw, dh);
          }
        }
        ctx.restore();
        if (media.length > 1) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          roundRectPath(ctx, it.x + it.w - 52, it.y + 42, 38, 20, 10);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = '700 11px ' + FONT;
          ctx.textBaseline = 'middle';
          ctx.fillText('x' + media.length, it.x + it.w - 44, it.y + 52);
          ctx.textBaseline = 'top';
        }
        textY = it.y + 36 + ih + 12;
      }
      ctx.fillStyle = '#ececf1';
      ctx.font = '14px ' + FONT;
      wrapText(ctx, c.text, it.x + 13, textY, it.w - 26, 21, it.y + it.h - 18);
    } else if (it.kind === 'video' || it.kind === 'audio') {
      drawPanel(ctx, it);
      ctx.fillStyle = '#ececf1';
      ctx.font = '600 14px ' + FONT;
      ctx.textBaseline = 'middle';
      const icon = it.kind === 'video' ? 'VÍDEO' : 'ÁUDIO';
      ctx.fillText(icon + '  ' + (c.title || (it.kind === 'video' ? 'Vídeo' : 'Áudio')), it.x + 16, it.y + it.h / 2);
    }
  }

  function drawPanel(ctx, it) {
    roundRectPath(ctx, it.x, it.y, it.w, it.h, 10);
    ctx.fillStyle = '#1b1b22';
    ctx.fill();
    ctx.strokeStyle = '#2c2c36';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  /* ---------- renderizar uma prancha ---------- */

  async function renderFrame(frame, allItems) {
    const preset = E.framePresetById(frame.content && frame.content.preset);
    const scale = preset.exportW / frame.w;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(frame.w * scale);
    canvas.height = Math.round(frame.h * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0e0e11';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const inside = allItems
      .filter((it) => it.kind !== 'frame' && intersects(it, frame))
      .sort((a, b) => (a.z || 0) - (b.z || 0));

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-frame.x, -frame.y);
    for (const it of inside) {
      await drawItem(ctx, it);
    }
    ctx.restore();
    return canvas;
  }

  /* ---------- downloads ---------- */

  function safeName(s) {
    return String(s || 'estudio').replace(/[\\/:*?"<>|]+/g, '-').trim();
  }

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  function sortedFrames(items) {
    return items
      .filter((it) => it.kind === 'frame')
      .sort((a, b) => a.y - b.y || a.x - b.x);
  }

  async function exportFramePng(frame, state) {
    const canvas = await renderFrame(frame, state.items);
    const blob = await canvasToBlob(canvas, 'image/png');
    downloadBlob(safeName(state.project.name) + ' — ' + safeName(frame.content.text || 'prancha') + '.png', blob);
  }

  async function exportSequence(frames, state) {
    for (let i = 0; i < frames.length; i++) {
      const canvas = await renderFrame(frames[i], state.items);
      const blob = await canvasToBlob(canvas, 'image/png');
      const num = String(i + 1).padStart(2, '0');
      downloadBlob(num + ' — ' + safeName(frames[i].content.text || 'prancha') + '.png', blob);
      await new Promise((r) => setTimeout(r, 350));
    }
    E.ui.toast(frames.length + ' PNGs exportados (veja sua pasta de Downloads)');
  }

  async function exportPresentation(frames, state) {
    const slides = [];
    for (const frame of frames) {
      const canvas = await renderFrame(frame, state.items);
      slides.push(canvas.toDataURL('image/jpeg', 0.92));
    }
    const title = state.project.name || 'Apresentação';
    const html =
      '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
      '<title>' + E.escapeHtml(title) + '</title>' +
      '<style>html,body{margin:0;height:100%;background:#000;font-family:-apple-system,Arial,sans-serif}' +
      '.slide{display:none;position:fixed;inset:0;background-position:center;background-size:contain;background-repeat:no-repeat}' +
      '.slide.on{display:block}' +
      '#hud{position:fixed;bottom:14px;left:50%;transform:translateX(-50%);color:#888;background:rgba(0,0,0,.6);' +
      'padding:6px 14px;border-radius:8px;font-size:13px;transition:opacity .4s}</style></head><body>' +
      slides.map((s, i) => '<div class="slide' + (i === 0 ? ' on' : '') + '" style="background-image:url(' + s + ')"></div>').join('') +
      '<div id="hud"></div>' +
      '<script>var i=0,n=' + slides.length + ',s=document.querySelectorAll(".slide"),h=document.getElementById("hud");' +
      'function up(){s.forEach(function(e,j){e.classList.toggle("on",j===i)});h.textContent=(i+1)+" / "+n+" — \\u2190 \\u2192 navegam, F = tela cheia";' +
      'clearTimeout(window._t);h.style.opacity=1;window._t=setTimeout(function(){h.style.opacity=0},2500)}' +
      'document.addEventListener("keydown",function(e){' +
      'if(e.key==="ArrowRight"||e.key===" "||e.key==="PageDown"){i=Math.min(n-1,i+1);up()}' +
      'if(e.key==="ArrowLeft"||e.key==="PageUp"){i=Math.max(0,i-1);up()}' +
      'if(e.key==="f"||e.key==="F"){document.documentElement.requestFullscreen&&document.documentElement.requestFullscreen()}});' +
      'document.addEventListener("click",function(){i=(i+1)%n;up()});up();<\/script></body></html>';
    downloadBlob(safeName(title) + ' — apresentação.html', new Blob([html], { type: 'text/html' }));
    E.ui.toast('Apresentação exportada — abra o arquivo e use ← → pra navegar');
  }

  /* ---------- modal de exportação ---------- */

  E.exporter.openExportModal = function () {
    const state = E.canvas.getState();
    if (!state.project) return;
    const frames = sortedFrames(state.items);

    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal modal-export';

    const h = document.createElement('h3');
    h.innerHTML = E.icon('download', 17) + '<span> Exportar — ' + E.escapeHtml(state.project.name || '') + '</span>';
    box.appendChild(h);

    if (!frames.length) {
      const p = document.createElement('p');
      p.className = 'modal-msg';
      p.textContent =
        'Você ainda não tem pranchas neste projeto. Crie uma com Criar > Prancha, monte sua arte dentro dela e volte aqui pra exportar.';
      box.appendChild(p);
    } else {
      const p = document.createElement('p');
      p.className = 'modal-msg';
      p.textContent =
        frames.length + (frames.length > 1 ? ' pranchas' : ' prancha') +
        ' — a ordem segue a posição no canvas (de cima pra baixo, da esquerda pra direita).';
      box.appendChild(p);

      const list = document.createElement('div');
      list.className = 'export-list';
      frames.forEach((frame, i) => {
        const row = document.createElement('div');
        row.className = 'export-row';
        const name = document.createElement('span');
        name.textContent = (i + 1) + '. ' + (frame.content.text || 'Prancha') + '  ·  ' + (frame.content.preset || '');
        const btn = document.createElement('button');
        btn.className = 'btn ghost';
        btn.textContent = 'PNG';
        btn.addEventListener('click', async () => {
          btn.disabled = true;
          await exportFramePng(frame, state);
          btn.disabled = false;
          E.ui.toast('PNG exportado');
        });
        row.appendChild(name);
        row.appendChild(btn);
        list.appendChild(row);
      });
      box.appendChild(list);

      const actions = document.createElement('div');
      actions.className = 'modal-actions';
      const seqBtn = document.createElement('button');
      seqBtn.className = 'btn';
      seqBtn.textContent = 'Sequência PNG (todas)';
      seqBtn.addEventListener('click', async () => {
        seqBtn.disabled = true;
        await exportSequence(frames, state);
        seqBtn.disabled = false;
      });
      const presBtn = document.createElement('button');
      presBtn.className = 'btn primary';
      presBtn.textContent = 'Apresentação (arquivo único)';
      presBtn.addEventListener('click', async () => {
        presBtn.disabled = true;
        await exportPresentation(frames, state);
        presBtn.disabled = false;
      });
      actions.appendChild(seqBtn);
      actions.appendChild(presBtn);
      box.appendChild(actions);
    }

    const closeRow = document.createElement('div');
    closeRow.className = 'modal-actions';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn ghost';
    closeBtn.textContent = 'Fechar';
    closeBtn.addEventListener('click', close);
    closeRow.appendChild(closeBtn);
    box.appendChild(closeRow);

    overlay.appendChild(box);
    root.appendChild(overlay);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close();
    });
    function close() {
      root.innerHTML = '';
    }
  };

  E.exporter.renderFrame = renderFrame;
  E.exporter.downloadBlob = downloadBlob;
})();
