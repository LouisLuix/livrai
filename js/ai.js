/* Central de IA: texto (Claude/GPT/Gemini), imagem (Gemini), áudio (ElevenLabs)
   e vídeo (fal.ai → Veo 3, Kling, Seedance). Chaves ficam só no seu navegador. */
(function () {
  const E = window.Estudio;
  E.ai = {};

  const SKEY = 'estudio-ai-settings';

  const DEFAULTS = {
    identity: '',
    keys: { anthropic: '', openai: '', gemini: '', eleven: '', fal: '' },
    models: {
      anthropic: 'claude-opus-4-8',
      openai: 'gpt-5.1',
      gemini: 'gemini-2.5-flash',
      geminiImage: 'gemini-2.5-flash-image',
      elevenVoice: '21m00Tcm4TlvDq8ikWAM',
      elevenModel: 'eleven_multilingual_v2',
      falCustom: '',
    },
  };

  const FAL_VIDEO_MODELS = [
    { id: 'fal-ai/veo3/fast', label: 'Veo 3 Fast (Google)' },
    { id: 'fal-ai/veo3', label: 'Veo 3 (Google)' },
    { id: 'fal-ai/kling-video/v2.1/standard/text-to-video', label: 'Kling 2.1 (Kuaishou)' },
    { id: 'fal-ai/bytedance/seedance/v1/lite/text-to-video', label: 'Seedance 1.0 (ByteDance)' },
  ];

  const IMAGE_MODELS = [
    { id: 'gemini', label: 'Gemini Image (Google)', key: 'gemini' },
    { id: 'openai', label: 'GPT Image (OpenAI)', key: 'openai' },
    { id: 'seedream', label: 'Seedream 4 (ByteDance)', key: 'fal' },
  ];
  const SEEDREAM_MODEL = 'fal-ai/bytedance/seedream/v4/text-to-image';

  /* Cofre de chaves: no app desktop as chaves moram cifradas pelo sistema
     (safeStorage/Keychain) — o localStorage é só o fallback do navegador. */
  let mem = null; // cache em memória da sessão
  let vault = false; // true quando o cofre do desktop está disponível

  async function persistSecrets() {
    if (vault) {
      await fetch('/__studio/secrets', {
        method: 'POST',
        headers: { 'X-Livrai': '1' },
        body: JSON.stringify({ data: JSON.stringify(mem || {}) }),
      });
    } else {
      localStorage.setItem(SKEY, JSON.stringify(mem || {}));
    }
  }

  E.ai.initSecrets = async function () {
    try {
      const r = await fetch('/__studio/secrets', { headers: { 'X-Livrai': '1' } });
      if (r.status === 404) vault = true;
      else if (r.ok) {
        vault = true;
        const d = await r.json();
        mem = JSON.parse(d.data || '{}');
      }
    } catch (_) {
      /* navegador — segue no localStorage */
    }
    if (mem === null) {
      try {
        mem = JSON.parse(localStorage.getItem(SKEY)) || {};
      } catch (_) {
        mem = {};
      }
    }
    // migração única: chaves que estavam no localStorage entram no cofre
    if (vault && localStorage.getItem(SKEY)) {
      try {
        await persistSecrets();
        localStorage.removeItem(SKEY);
      } catch (_) {}
    }
  };

  function settings() {
    let s = mem;
    if (s === null) {
      try {
        s = JSON.parse(localStorage.getItem(SKEY)) || {};
      } catch (_) {
        s = {};
      }
    }
    return {
      identity: s.identity || DEFAULTS.identity,
      keys: Object.assign({}, DEFAULTS.keys, s.keys || {}),
      models: Object.assign({}, DEFAULTS.models, s.models || {}),
    };
  }
  function saveSettings(s) {
    mem = s;
    persistSecrets().catch(() => {
      localStorage.setItem(SKEY, JSON.stringify(s));
    });
  }
  E.ai.settings = settings;

  /* ---------- indicador de gerações em andamento ---------- */

  function jobStart(label) {
    const jobs = document.getElementById('jobs');
    const el = document.createElement('div');
    el.className = 'job';
    el.innerHTML = '<span class="job-spin"></span><span></span>';
    el.querySelector('span:last-child').textContent = label;
    jobs.appendChild(el);
    return {
      update(msg) {
        el.querySelector('span:last-child').textContent = msg;
      },
      done() {
        el.remove();
      },
    };
  }

  async function errText(r) {
    let detail = '';
    try {
      const data = await r.json();
      detail =
        (data.error && (data.error.message || data.error.type)) ||
        data.message ||
        data.detail ||
        JSON.stringify(data).slice(0, 200);
    } catch (_) {
      detail = r.statusText;
    }
    if (r.status === 401 || r.status === 403) return 'Chave de API inválida ou sem permissão. Confira em Configurações.';
    return 'Erro ' + r.status + ': ' + String(detail).slice(0, 220);
  }

  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || 'application/octet-stream' });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* A OpenAI não aceita chamadas diretas do navegador (CORS) — passa pela
     ponte local iniciada pelo "ABRIR ESTUDIO.command" (proxy.py) */
  const OPENAI_BASE = 'http://127.0.0.1:8787/openai';
  async function openaiFetch(path, opts) {
    try {
      return await fetch(OPENAI_BASE + path, opts);
    } catch (_) {
      throw new Error(
        'A ponte local não está rodando. Feche e abra o Estúdio pelo "ABRIR ESTUDIO.command" pra usar a OpenAI.'
      );
    }
  }

  /* ---------- TRANSCRIÇÃO (ditado por voz, Whisper) ---------- */
  E.ai.transcribe = async function (blob, lang) {
    const s = settings();
    if (!s.keys.openai) {
      const err = new Error('sem-chave');
      err.code = 'no-key';
      throw err;
    }
    const fd = new FormData();
    fd.append('file', blob, 'ditado.webm');
    fd.append('model', 'whisper-1');
    if (lang) fd.append('language', lang);
    // sem Content-Type manual: o FormData define o boundary sozinho
    const r = await openaiFetch('/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + s.keys.openai },
      body: fd,
    });
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    return String(data.text || '').trim();
  };

  /* ---------- TEXTO ---------- */

  async function genTextAnthropic(prompt, system) {
    const s = settings();
    const r = await fetch('https://api.anthropic.com/v1/messages', {
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
        system: system || undefined,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    return data.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }

  async function genTextOpenAI(prompt, system) {
    const s = settings();
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });
    const r = await openaiFetch('/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + s.keys.openai,
      },
      body: JSON.stringify({ model: s.models.openai, messages: messages }),
    });
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    return (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
  }

  async function genTextGemini(prompt, system) {
    const s = settings();
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(s.models.gemini) +
        ':generateContent?key=' +
        encodeURIComponent(s.keys.gemini),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content.parts) || [];
    return parts.map((p) => p.text || '').join('').trim();
  }

  async function genText(provider, prompt, system) {
    if (provider === 'anthropic') return genTextAnthropic(prompt, system);
    if (provider === 'openai') return genTextOpenAI(prompt, system);
    return genTextGemini(prompt, system);
  }

  /* ---------- IMAGEM (Gemini) ---------- */

  async function genImageGemini(prompt, refBlobs, aspect) {
    const s = settings();
    const reqParts = [];
    for (const blob of refBlobs || []) {
      reqParts.push({ inlineData: { mimeType: blob.type || 'image/png', data: await blobToB64(blob) } });
    }
    reqParts.push({ text: prompt });
    const genConfig = { responseModalities: ['IMAGE', 'TEXT'] };
    if (aspect) genConfig.imageConfig = { aspectRatio: aspect };
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(s.models.geminiImage) +
        ':generateContent?key=' +
        encodeURIComponent(s.keys.gemini),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: reqParts }],
          generationConfig: genConfig,
        }),
      }
    );
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content.parts) || [];
    for (const p of parts) {
      const inline = p.inlineData || p.inline_data;
      if (inline && inline.data) {
        return b64ToBlob(inline.data, inline.mimeType || inline.mime_type || 'image/png');
      }
    }
    throw new Error('A IA não retornou uma imagem. Tente reformular o pedido.');
  }

  function blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  /* Edição de imagem existente: manda a imagem + instrução, recebe a versão editada */
  async function genImageEditGemini(blob, instruction) {
    const s = settings();
    const b64 = await blobToB64(blob);
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(s.models.geminiImage) +
        ':generateContent?key=' +
        encodeURIComponent(s.keys.gemini),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inlineData: { mimeType: blob.type || 'image/png', data: b64 } },
                { text: instruction },
              ],
            },
          ],
          generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
        }),
      }
    );
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content.parts) || [];
    for (const p of parts) {
      const inline = p.inlineData || p.inline_data;
      if (inline && inline.data) {
        return b64ToBlob(inline.data, inline.mimeType || inline.mime_type || 'image/png');
      }
    }
    throw new Error('A IA não retornou a imagem editada. Tente reformular a instrução.');
  }

  E.ai.editImageItem = async function (item) {
    const s = settings();
    if (!s.keys.gemini) {
      E.ui.toast('Pra editar imagens, configure a chave do Gemini — em Configurações > IA & Identidade');
      return;
    }
    const vals = await E.ui.modal({
      title: 'Editar imagem com IA',
      message: 'A versão editada aparece ao lado — a original fica intacta.',
      fields: [
        {
          name: 'instr',
          label: 'O que mudar nessa imagem?',
          placeholder: 'Ex.: troca o fundo por um pôr do sol, deixa mais quente…',
        },
      ],
      okLabel: 'Editar',
    });
    if (vals === null || !vals.instr.trim()) return;
    const rec = await E.db.get('blobs', item.content.blobId);
    if (!rec || !rec.blob) {
      E.ui.toast('Não encontrei o arquivo dessa imagem');
      return;
    }
    const job = jobStart('Editando imagem…');
    try {
      const out = await genImageEditGemini(rec.blob, vals.instr.trim());
      await E.canvas.addGeneratedImage(out, item);
      E.ui.toast('Imagem editada — colocada ao lado da original');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Erro na edição'));
    } finally {
      job.done();
    }
  };

  /* ---------- ÁUDIO (ElevenLabs) ---------- */

  async function genAudioEleven(text) {
    const s = settings();
    const r = await fetch(
      'https://api.elevenlabs.io/v1/text-to-speech/' + encodeURIComponent(s.models.elevenVoice),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': s.keys.eleven,
        },
        body: JSON.stringify({ text: text, model_id: s.models.elevenModel }),
      }
    );
    if (!r.ok) throw new Error(await errText(r));
    return r.blob();
  }

  /* ---------- fila do fal.ai (vídeo e imagem) ---------- */

  async function falQueueRun(modelId, payload, job, label) {
    const s = settings();
    const auth = { Authorization: 'Key ' + s.keys.fal };
    const submit = await fetch('https://queue.fal.run/' + modelId, {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, auth),
      body: JSON.stringify(payload),
    });
    if (!submit.ok) throw new Error(await errText(submit));
    const ticket = await submit.json();
    const statusUrl = ticket.status_url;
    const responseUrl = ticket.response_url;
    // A chave só pode ser enviada pra domínios do próprio fal.ai
    const VALID_FAL = /^https:\/\/(queue\.)?fal\.run\//;
    if (!statusUrl || !responseUrl || !VALID_FAL.test(statusUrl) || !VALID_FAL.test(responseUrl)) {
      throw new Error('Resposta inesperada do fal.ai');
    }

    const started = Date.now();
    for (;;) {
      await sleep(4000);
      const sr = await fetch(statusUrl, { headers: auth });
      if (!sr.ok) throw new Error(await errText(sr));
      const st = await sr.json();
      if (st.status === 'COMPLETED') break;
      if (st.status === 'FAILED' || st.status === 'ERROR') {
        throw new Error('A geração falhou no fal.ai. Tente outro modelo ou prompt.');
      }
      const mins = Math.floor((Date.now() - started) / 60000);
      job.update(label + (mins ? ' ' + mins + ' min — pode demorar' : ' na fila…'));
      if (Date.now() - started > 15 * 60000) throw new Error('Tempo esgotado (15 min). Verifique no painel do fal.ai.');
    }
    const rr = await fetch(responseUrl, { headers: auth });
    if (!rr.ok) throw new Error(await errText(rr));
    return rr.json();
  }

  /* ---------- VÍDEO (fal.ai: Veo 3, Kling, Seedance…) ---------- */

  async function genVideoFal(modelId, prompt, job) {
    const out = await falQueueRun(modelId, { prompt: prompt }, job, 'Gerando vídeo…');
    const url =
      (out.video && out.video.url) ||
      (out.videos && out.videos[0] && out.videos[0].url) ||
      out.url;
    if (!url) throw new Error('O fal.ai não retornou o arquivo de vídeo.');
    job.update('Baixando vídeo…');
    const vr = await fetch(url);
    if (!vr.ok) throw new Error('Não consegui baixar o vídeo gerado.');
    return vr.blob();
  }

  /* ---------- IMAGEM (OpenAI GPT Image) ---------- */

  function openaiSize(aspect) {
    if (aspect === '16:9') return '1536x1024';
    if (aspect === '9:16' || aspect === '4:5') return '1024x1536';
    return '1024x1024';
  }

  async function genImageOpenAI(prompt, refBlobs, aspect, quality) {
    const s = settings();
    const q = quality === 'padrao' ? 'medium' : 'high';
    let r;
    if (refBlobs && refBlobs.length) {
      // com referências (logo/produto) usa o endpoint de edição
      const fd = new FormData();
      fd.append('model', 'gpt-image-1');
      fd.append('prompt', prompt);
      fd.append('size', openaiSize(aspect));
      fd.append('quality', q);
      refBlobs.forEach((b, i) => fd.append('image[]', b, 'ref' + i + '.png'));
      r = await openaiFetch('/v1/images/edits', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + s.keys.openai },
        body: fd,
      });
    } else {
      r = await openaiFetch('/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + s.keys.openai,
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: prompt,
          size: openaiSize(aspect),
          quality: q,
        }),
      });
    }
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    const b64 = data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) throw new Error('A OpenAI não retornou a imagem.');
    return b64ToBlob(b64, 'image/png');
  }

  /* ---------- IMAGEM (Seedream via fal.ai) ---------- */

  function falImageSize(aspect) {
    if (aspect === '16:9') return 'landscape_16_9';
    if (aspect === '9:16') return 'portrait_16_9';
    if (aspect === '4:5') return 'portrait_4_3';
    return 'square_hd';
  }

  async function genImageSeedream(prompt, aspect, job) {
    const out = await falQueueRun(
      SEEDREAM_MODEL,
      { prompt: prompt, image_size: falImageSize(aspect) },
      job,
      'Gerando imagem…'
    );
    const url =
      (out.images && out.images[0] && out.images[0].url) ||
      (out.image && out.image.url) ||
      out.url;
    if (!url) throw new Error('O fal.ai não retornou a imagem.');
    const ir = await fetch(url);
    if (!ir.ok) throw new Error('Não consegui baixar a imagem gerada.');
    return ir.blob();
  }

  /* ---------- texto com visão (a IA olha uma imagem) ---------- */

  /* imageBlobs: um blob OU um array de blobs (até 4 imagens vão pra IA) */
  async function genVisionText(provider, prompt, system, imageBlobs) {
    const blobs = (Array.isArray(imageBlobs) ? imageBlobs : imageBlobs ? [imageBlobs] : [])
      .filter(Boolean)
      .slice(0, 4);
    if (!blobs.length) return genText(provider, prompt, system);
    const s = settings();
    const imgs = [];
    for (const b of blobs) {
      imgs.push({ b64: await blobToB64(b), mime: b.type || 'image/png' });
    }
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
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
          system: system || undefined,
          messages: [
            {
              role: 'user',
              content: imgs
                .map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.b64 } }))
                .concat([{ type: 'text', text: prompt }]),
            },
          ],
        }),
      });
      if (!r.ok) throw new Error(await errText(r));
      const data = await r.json();
      return data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
    }
    // Gemini
    const body = {
      contents: [
        {
          parts: imgs
            .map((i) => ({ inlineData: { mimeType: i.mime, data: i.b64 } }))
            .concat([{ text: prompt }]),
        },
      ],
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };
    const r = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' +
        encodeURIComponent(s.models.gemini) +
        ':generateContent?key=' +
        encodeURIComponent(s.keys.gemini),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!r.ok) throw new Error(await errText(r));
    const data = await r.json();
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content.parts) || [];
    return parts.map((p) => p.text || '').join('').trim();
  }

  /* ---------- identidade e branding kit ---------- */

  function currentProject() {
    const st = E.canvas.isOpen() ? E.canvas.getState() : null;
    return st ? st.project : null;
  }

  /* Texto descrevendo o branding kit do projeto, pra IA seguir */
  function brandText(project) {
    const b = project && project.brand;
    if (!b) return '';
    const bits = [];
    if (b.colors && b.colors.length) bits.push('Cores oficiais da marca: ' + b.colors.join(', '));
    if (b.fonts) bits.push('Tipografia da marca: ' + b.fonts);
    if (b.notes) bits.push('Combina com a marca (seguir sempre): ' + b.notes);
    if (b.negative) bits.push('NÃO combina com a marca (evitar SEMPRE, nunca incluir): ' + b.negative);
    if (!bits.length) return '';
    return '\n\nBranding kit do projeto "' + (project.name || '') + '" (siga rigorosamente):\n' + bits.join('\n');
  }

  /* Entidades de referência (produtos, personagens, cenários) do painel Marca */
  function brandEntitiesOf(project) {
    const b = project && project.brand;
    if (!b) return [];
    if (Array.isArray(b.entities)) return b.entities;
    // compat: fotos de produto antigas viram uma entidade única
    if (Array.isArray(b.productRefs) && b.productRefs.length) {
      return [{ id: 'legacy', name: 'Produto', kind: 'produto', desc: '', refs: b.productRefs }];
    }
    return [];
  }

  E.ai.brandEntities = function () {
    return brandEntitiesOf(currentProject());
  };

  async function brandLogoBlob(project) {
    const b = project && project.brand;
    if (!b || !b.logoBlobId) return null;
    const rec = await E.db.get('blobs', b.logoBlobId);
    return rec && rec.blob ? rec.blob : null;
  }

  /* Fotos de referência do produto (painel 🎨 Marca) */
  async function productRefBlobs(project, max) {
    const ids = (project && project.brand && project.brand.productRefs) || [];
    const out = [];
    for (const id of ids.slice(0, max || 3)) {
      const rec = await E.db.get('blobs', id);
      if (rec && rec.blob) out.push(rec.blob);
    }
    return out;
  }

  E.ai.videoModels = function () {
    const s = settings();
    const list = FAL_VIDEO_MODELS.slice();
    if (s.models.falCustom) list.push({ id: s.models.falCustom, label: 'Personalizado' });
    return list;
  };

  E.ai.imageModels = function () {
    return IMAGE_MODELS;
  };

  /* ---------- card Gerador (item no canvas) ---------- */

  E.ai.runFromGenItem = async function (item) {
    const c = item.content || {};
    const prompt = (c.prompt || '').trim();
    if (!prompt) {
      E.ui.toast('Escreva no card o que você quer criar');
      return;
    }
    const s = settings();
    const proj = currentProject();
    const useIdentity = c.useIdentity !== false;
    const brand = c.useBrand !== false ? brandText(proj) : '';
    const type = c.type || 'imagem';

    if (type === 'imagem') {
      const model = IMAGE_MODELS.find((m) => m.id === (c.imageModel || 'gemini')) || IMAGE_MODELS[0];
      if (!s.keys[model.key]) {
        E.ui.toast('Configure a chave de "' + model.label + '" — em Configurações > IA & Identidade');
        return;
      }
      const job = jobStart('Gerando imagem…');
      try {
        let p = visualPrompt(prompt, useIdentity) + brand;
        const refs = [];
        const ents = brandEntitiesOf(proj);
        const chosen = ents.filter((en) =>
          Array.isArray(c.entityIds) ? c.entityIds.indexOf(en.id) >= 0 : c.useProduct !== false
        );
        if (model.id !== 'seedream') {
          // cena/base anexada no card: vai SEMPRE como primeira referência
          if (c.sceneBlobId) {
            const sceneRec = await E.db.get('blobs', c.sceneBlobId);
            if (sceneRec && sceneRec.blob) {
              refs.push(sceneRec.blob);
              p +=
                '\nThe FIRST attached image is the BASE SCENE: compose the subject naturally INTO this exact scene — keep its perspective, lighting, surfaces and environment; only add or adjust what the prompt asks.';
            }
          }
          if (c.useBrand !== false) {
            const logo = await brandLogoBlob(proj);
            if (logo) refs.push(logo);
          }
          for (const en of chosen) {
            for (const bid of (en.refs || []).slice(0, 3)) {
              if (refs.length >= 6) break;
              const rec = await E.db.get('blobs', bid);
              if (rec && rec.blob) refs.push(rec.blob);
            }
          }
        }
        for (const en of chosen) {
          p +=
            '\nReference item "' + (en.name || 'item') + '" (' + (en.kind || 'produto') + '): ' +
            (en.desc || 'keep it EXACTLY as shown in the reference photos');
        }
        if (refs.length) {
          p +=
            '\n\nUse the attached reference images. Keep every reference item, packaging and brand look EXACTLY consistent with them — same real product/character/place.';
        }
        // ajustes finos do card → direção de arte precisa
        const fine = [];
        if (c.tuneColors) fine.push('Color direction: ' + c.tuneColors);
        if (c.tuneMood) fine.push('Atmosphere / mood: ' + c.tuneMood);
        if (c.tuneTexture) fine.push('Texture & detail: ' + c.tuneTexture);
        if (fine.length) {
          p += '\nFine art direction (follow precisely):\n- ' + fine.join('\n- ');
        }
        if ((c.quality || 'alta') === 'alta' && model.id !== 'openai') {
          p += '\nUltra-detailed, professional photography, high quality.';
        }
        let blob;
        if (model.id === 'openai') {
          blob = await genImageOpenAI(p, refs, c.aspect || '1:1', c.quality || 'alta');
        } else if (model.id === 'seedream') {
          blob = await genImageSeedream(p, c.aspect || '1:1', job);
        } else {
          blob = await genImageGemini(p, refs, c.aspect || '1:1');
        }
        await E.canvas.addGeneratedImage(blob, item);
        E.ui.toast('Imagem gerada');
      } catch (err) {
        console.error(err);
        E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Erro na geração'));
      } finally {
        job.done();
      }
    } else if (type === 'texto') {
      const prov = ['anthropic', 'openai', 'gemini'].find((k) => s.keys[k]);
      if (!prov) {
        E.ui.toast('Configure uma chave de IA de texto — em Configurações > IA & Identidade');
        return;
      }
      const job = jobStart('Gerando texto…');
      try {
        const text = await genText(prov, prompt, textSystem(useIdentity) + brand);
        E.canvas.addGeneratedNote(text, item);
        E.ui.toast('Texto gerado');
      } catch (err) {
        console.error(err);
        E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Erro na geração'));
      } finally {
        job.done();
      }
    } else if (type === 'video') {
      if (!s.keys.fal) {
        E.ui.toast('Configure a chave do fal.ai (vídeo) — em Configurações > IA & Identidade');
        return;
      }
      const job = jobStart('Gerando vídeo…');
      try {
        let p = visualPrompt(prompt, useIdentity) + brand;
        if (c.aspect) p += '\nAspect ratio: ' + c.aspect + '.';
        const model = c.videoModel || FAL_VIDEO_MODELS[0].id;
        const blob = await genVideoFal(model, p, job);
        await E.canvas.addGeneratedVideo(blob, prompt.slice(0, 40));
        E.ui.toast('Vídeo gerado');
      } catch (err) {
        console.error(err);
        E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Erro na geração'));
      } finally {
        job.done();
      }
    } else {
      if (!s.keys.eleven) {
        E.ui.toast('Configure a chave do ElevenLabs (áudio) — em Configurações > IA & Identidade');
        return;
      }
      const job = jobStart('Gerando áudio…');
      try {
        const blob = await genAudioEleven(prompt);
        await E.canvas.addGeneratedAudio(blob, prompt.slice(0, 40));
        E.ui.toast('Áudio gerado');
      } catch (err) {
        console.error(err);
        E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Erro na geração'));
      } finally {
        job.done();
      }
    }
  };

  function textSystem(useIdentity) {
    const s = settings();
    let sys =
      'Você é o assistente criativo de um diretor criativo brasileiro (clipes, fotos, propagandas, moda, social media). ' +
      'Responda sempre em português do Brasil, direto ao ponto, pronto pra usar — sem introduções nem despedidas.';
    if (useIdentity && s.identity.trim()) {
      sys += '\n\nIdentidade do estúdio (siga este estilo e tom em tudo):\n' + s.identity.trim();
    }
    return sys;
  }

  function visualPrompt(prompt, useIdentity) {
    const s = settings();
    if (useIdentity && s.identity.trim()) {
      return prompt + '\n\nVisual identity / style direction: ' + s.identity.trim();
    }
    return prompt;
  }

  /* ---------- gerador (modal) ---------- */

  const TYPES = [
    { id: 'texto', label: 'Texto' },
    { id: 'imagem', label: 'Imagem' },
    { id: 'audio', label: 'Áudio' },
    { id: 'video', label: 'Vídeo' },
  ];

  function providersFor(type) {
    const s = settings();
    if (type === 'texto') {
      return [
        { id: 'anthropic', label: 'Claude (Anthropic)', ok: !!s.keys.anthropic },
        { id: 'openai', label: 'GPT (OpenAI)', ok: !!s.keys.openai },
        { id: 'gemini', label: 'Gemini (Google)', ok: !!s.keys.gemini },
      ];
    }
    if (type === 'imagem') {
      return [{ id: 'gemini', label: 'Gemini Image (Google)', ok: !!s.keys.gemini }];
    }
    if (type === 'audio') {
      return [{ id: 'eleven', label: 'ElevenLabs', ok: !!s.keys.eleven }];
    }
    const s2 = settings();
    const list = FAL_VIDEO_MODELS.map((m) => ({ id: m.id, label: m.label, ok: !!s2.keys.fal }));
    if (s2.models.falCustom) {
      list.push({ id: s2.models.falCustom, label: 'Personalizado: ' + s2.models.falCustom, ok: !!s2.keys.fal });
    }
    return list;
  }

  E.ai.openGenerator = function () {
    if (!E.canvas.isOpen()) return;
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal modal-ai';
    box.innerHTML =
      '<h3>Gerar com IA</h3>' +
      '<div class="ai-types"></div>' +
      '<label class="ai-field"><span>Com qual IA?</span><select class="ai-provider"></select></label>' +
      '<label class="ai-field"><span class="ai-prompt-label">O que você quer criar?</span>' +
      '<textarea class="ai-prompt" rows="4" placeholder="Descreva sua ideia…"></textarea></label>' +
      '<label class="ai-check"><input type="checkbox" class="ai-identity" checked> Usar minha identidade (configure em Configurações > IA)</label>' +
      '<label class="ai-check ai-brand-row hidden"><input type="checkbox" class="ai-brand" checked> Usar o branding kit do projeto (painel Marca)</label>' +
      '<label class="ai-check ai-logo-row hidden"><input type="checkbox" class="ai-logo" checked> Incluir o logo como referência visual</label>' +
      '<div class="modal-actions"><button type="button" class="btn ghost ai-cancel">Cancelar</button>' +
      '<button type="button" class="btn primary ai-go">Gerar</button></div>';
    overlay.appendChild(box);
    root.appendChild(overlay);

    const typesEl = box.querySelector('.ai-types');
    const providerSel = box.querySelector('.ai-provider');
    const promptEl = box.querySelector('.ai-prompt');
    const identityChk = box.querySelector('.ai-identity');
    const brandChk = box.querySelector('.ai-brand');
    const logoChk = box.querySelector('.ai-logo');
    let type = 'texto';

    const proj = currentProject();
    const hasBrand = !!brandText(proj);
    const hasLogo = !!(proj && proj.brand && proj.brand.logoBlobId);

    function updateBrandRows() {
      box.querySelector('.ai-brand-row').classList.toggle('hidden', !hasBrand && !hasLogo);
      box.querySelector('.ai-logo-row').classList.toggle('hidden', !(hasLogo && type === 'imagem'));
    }

    function renderTypes() {
      typesEl.innerHTML = '';
      TYPES.forEach((t) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (t.id === type ? ' active' : '');
        b.textContent = t.label;
        b.addEventListener('click', () => {
          type = t.id;
          renderTypes();
          renderProviders();
          updateBrandRows();
        });
        typesEl.appendChild(b);
      });
    }
    function renderProviders() {
      providerSel.innerHTML = '';
      providersFor(type).forEach((p) => {
        const op = document.createElement('option');
        op.value = p.id;
        op.textContent = p.label + (p.ok ? '' : ' — configure a chave em Configurações');
        providerSel.appendChild(op);
      });
      box.querySelector('.ai-prompt-label').textContent =
        type === 'audio' ? 'Texto pra virar voz (locução)' : 'O que você quer criar?';
    }
    renderTypes();
    renderProviders();
    updateBrandRows();
    promptEl.focus();

    function close() {
      root.innerHTML = '';
    }
    box.querySelector('.ai-cancel').addEventListener('click', close);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close();
    });

    box.querySelector('.ai-go').addEventListener('click', () => {
      const prompt = promptEl.value.trim();
      if (!prompt) {
        E.ui.toast('Descreva o que você quer criar');
        return;
      }
      const provider = providerSel.value;
      const prov = providersFor(type).find((p) => p.id === provider);
      if (!prov || !prov.ok) {
        E.ui.toast('Configure a chave dessa IA primeiro — em Configurações > IA & Identidade');
        return;
      }
      const useIdentity = identityChk.checked;
      const useBrand = brandChk.checked && (hasBrand || hasLogo);
      const useLogo = logoChk.checked && hasLogo && type === 'imagem';
      close();
      runGeneration(type, provider, prompt, useIdentity, useBrand, useLogo);
    });
  };

  async function runGeneration(type, provider, prompt, useIdentity, useBrand, useLogo) {
    const labels = { texto: 'Gerando texto…', imagem: 'Gerando imagem…', audio: 'Gerando áudio…', video: 'Gerando vídeo…' };
    const job = jobStart(labels[type]);
    const proj = currentProject();
    const brand = useBrand ? brandText(proj) : '';
    try {
      if (type === 'texto') {
        const text = await genText(provider, prompt, textSystem(useIdentity) + brand);
        E.canvas.addGeneratedNote(text);
        E.ui.toast('Texto gerado');
      } else if (type === 'imagem') {
        const refs = [];
        if (useLogo) {
          const logo = await brandLogoBlob(proj);
          if (logo) refs.push(logo);
        }
        let p = visualPrompt(prompt, useIdentity) + brand;
        if (refs.length) p += '\n\nUse the attached logo image as the brand logo reference.';
        const blob = await genImageGemini(p, refs);
        await E.canvas.addGeneratedImage(blob);
        E.ui.toast('Imagem gerada');
      } else if (type === 'audio') {
        const blob = await genAudioEleven(prompt);
        await E.canvas.addGeneratedAudio(blob, prompt.slice(0, 40));
        E.ui.toast('Áudio gerado');
      } else if (type === 'video') {
        const blob = await genVideoFal(provider, visualPrompt(prompt, useIdentity) + brand, job);
        await E.canvas.addGeneratedVideo(blob, prompt.slice(0, 40));
        E.ui.toast('Vídeo gerado');
      }
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Algo deu errado na geração'));
    } finally {
      job.done();
    }
  }

  /* ---------- reescrever texto de um item ---------- */

  E.ai.rewriteItem = async function (item) {
    const s = settings();
    const provs = providersFor('texto').filter((p) => p.ok);
    if (!provs.length) {
      E.ui.toast('Configure uma chave de IA de texto primeiro — em Configurações > IA & Identidade');
      return;
    }
    const vals = await E.ui.modal({
      title: 'Reescrever com IA',
      message: 'O resultado vira uma nota nova ao lado — o original fica intacto.',
      fields: [
        {
          name: 'mode',
          label: 'O que fazer com o texto?',
          type: 'select',
          options: [
            { value: 'melhorar', label: 'Melhorar / refinar' },
            { value: 'encurtar', label: 'Encurtar' },
            { value: 'expandir', label: 'Expandir / desenvolver' },
            { value: 'variacoes', label: 'Gerar 3 variações' },
            { value: 'legenda', label: 'Virar legenda de post (com hashtags)' },
          ],
        },
        {
          name: 'provider',
          label: 'Com qual IA?',
          type: 'select',
          options: provs.map((p) => ({ value: p.id, label: p.label })),
        },
      ],
      okLabel: 'Gerar',
    });
    if (vals === null) return;

    const INSTR = {
      melhorar: 'Melhore e refine o texto abaixo mantendo a essência:',
      encurtar: 'Encurte o texto abaixo mantendo o impacto:',
      expandir: 'Expanda e desenvolva o texto abaixo com mais detalhes e força criativa:',
      variacoes: 'Crie 3 variações diferentes do texto abaixo, numeradas:',
      legenda: 'Transforme o texto abaixo numa legenda de post pronta pra publicar, com emojis na medida e hashtags relevantes no final:',
    };
    const job = jobStart('Reescrevendo…');
    try {
      const result = await genText(
        vals.provider,
        INSTR[vals.mode] + '\n\n' + (item.content.text || ''),
        textSystem(true) + brandText(currentProject())
      );
      E.canvas.addGeneratedNote(result, item);
      E.ui.toast('Pronto — nota nova criada ao lado');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Erro na geração'));
    } finally {
      job.done();
    }
  };

  /* ---------- legenda de Instagram pro post (a IA olha a imagem) ---------- */

  E.ai.captionPost = async function (item) {
    const s = settings();
    const provs = [
      { id: 'anthropic', label: 'Claude (Anthropic)', ok: !!s.keys.anthropic },
      { id: 'gemini', label: 'Gemini (Google)', ok: !!s.keys.gemini },
    ].filter((p) => p.ok);
    if (!provs.length) {
      E.ui.toast('Pra gerar legenda, configure a chave do Claude ou do Gemini — em Configurações > IA & Identidade');
      return;
    }
    const media = E.items.postMedia(item.content);
    const images = media.filter((m) => m.kind !== 'video');
    const hasImg = images.length > 0;
    const vals = await E.ui.modal({
      title: 'Gerar texto do post com IA',
      message: hasImg
        ? 'A IA lê ' +
          (images.length > 1 ? 'as imagens do post (até 4)' : 'a imagem do post') +
          ' e escreve o texto na direção que você escolher. O texto atual vira briefing e será substituído.'
        : 'O texto atual do post vira briefing e será substituído pelo texto pronto.',
      fields: [
        {
          name: 'style',
          label: 'Direção do texto',
          type: 'select',
          options: [
            { value: 'viral', label: 'Viral — gancho forte, feito pra compartilhar' },
            { value: 'vendas', label: 'Vendedor — desejo + chamada pra ação' },
            { value: 'inspirador', label: 'Inspirador — editorial, emocional' },
            { value: 'informativo', label: 'Informativo — direto ao ponto' },
            { value: 'humor', label: 'Engraçado — humor leve' },
          ],
        },
        {
          name: 'provider',
          label: 'Com qual IA?',
          type: 'select',
          options: provs.map((p) => ({ value: p.id, label: p.label })),
        },
        {
          name: 'hint',
          label: 'Direcionamento extra (opcional)',
          placeholder: 'promoção do dia, público-alvo, tom, palavra obrigatória…',
        },
      ],
      okLabel: 'Gerar texto',
    });
    if (vals === null) return;

    const STYLE = {
      viral:
        'Estilo VIRAL: primeira linha é um gancho irresistível (curiosidade, identificação imediata ou afirmação ousada — ela decide se a pessoa para de rolar o feed). Frases curtas, ritmo de retenção, e termina puxando comentário/compartilhamento.',
      vendas:
        'Estilo VENDEDOR: desperta desejo pelo que aparece na imagem, benefício concreto, urgência sutil e UMA chamada pra ação clara (comprar, pedir, chamar no direct).',
      inspirador:
        'Estilo INSPIRADOR/editorial: tom elegante e emocional, mini-storytelling ligado à imagem, zero clichê de coach.',
      informativo:
        'Estilo INFORMATIVO: claro, direto e escaneável; entrega valor concreto sobre o que está na imagem.',
      humor:
        'Estilo ENGRAÇADO: humor leve e esperto a partir do que está na imagem, sem piada forçada.',
    };

    let prompt =
      'Analise com atenção ' +
      (images.length > 1
        ? 'as ' + Math.min(images.length, 4) + ' imagens anexadas deste post carrossel'
        : hasImg
          ? 'a imagem anexada deste post'
          : 'o briefing abaixo') +
      ' — produto, cena, pessoas, texto que aparece na arte, clima — e crie UMA legenda de Instagram pronta pra publicar baseada nisso.\n' +
      (STYLE[vals.style] || STYLE.viral) +
      '\nEmojis na medida certa e hashtags relevantes no final. Escreva em português do Brasil. Responda SÓ com a legenda, nada mais.';
    if (item.content.text) prompt += '\n\nBriefing / contexto do criador: ' + item.content.text;
    if (vals.hint && vals.hint.trim()) prompt += '\nDirecionamento do criador (prioridade máxima): ' + vals.hint.trim();

    const imgBlobs = [];
    for (const m of images.slice(0, 4)) {
      const rec = await E.db.get('blobs', m.blobId);
      if (rec && rec.blob) imgBlobs.push(rec.blob);
    }

    const job = jobStart('Escrevendo o texto do post…');
    try {
      const text = await genVisionText(
        vals.provider,
        prompt,
        textSystem(true) + brandText(currentProject()),
        imgBlobs
      );
      item.content.text = text;
      E.canvas.refreshItem(item);
      E.ui.toast('Texto pronto — dois cliques no post pra ajustar');
    } catch (err) {
      console.error(err);
      E.ui.toast('⚠️ ' + (err && err.message ? err.message : 'Erro na geração'));
    } finally {
      job.done();
    }
  };

  /* ---------- teste de conexão das chaves ---------- */

  const PROVIDER_LABELS = {
    anthropic: 'Claude',
    openai: 'OpenAI',
    gemini: 'Gemini',
    eleven: 'ElevenLabs',
    fal: 'fal.ai',
  };

  async function testProvider(name, key, btn) {
    if (!key) {
      E.ui.toast('Cole a chave primeiro');
      return;
    }
    const s = settings();
    const label = PROVIDER_LABELS[name] || name;
    btn.disabled = true;
    btn.textContent = '…';
    try {
      if (name === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: s.models.anthropic,
            max_tokens: 16,
            messages: [{ role: 'user', content: 'oi' }],
          }),
        });
        if (!r.ok) throw new Error(await errText(r));
      } else if (name === 'openai') {
        const r = await openaiFetch('/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + key,
          },
          body: JSON.stringify({
            model: s.models.openai,
            messages: [{ role: 'user', content: 'oi' }],
          }),
        });
        if (!r.ok) throw new Error(await errText(r));
      } else if (name === 'gemini') {
        const r = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' +
            encodeURIComponent(s.models.gemini) +
            ':generateContent?key=' +
            encodeURIComponent(key),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: 'oi' }] }] }),
          }
        );
        if (!r.ok) throw new Error(await errText(r));
      } else if (name === 'eleven') {
        const r = await fetch('https://api.elevenlabs.io/v1/user', {
          headers: { 'xi-api-key': key },
        });
        if (!r.ok) throw new Error(await errText(r));
      } else if (name === 'fal') {
        const r = await fetch('https://queue.fal.run/fal-ai/veo3/requests/teste-de-chave/status', {
          headers: { Authorization: 'Key ' + key },
        });
        if (r.status === 401 || r.status === 403) {
          throw new Error('Chave do fal.ai inválida. Confira em fal.ai → Keys.');
        }
        // 404/422 aqui significa: chave aceita (o request de teste não existe, como esperado)
      }
      E.ui.toast(label + ' conectado!');
    } catch (err) {
      let msg = err && err.message ? err.message : 'Erro desconhecido';
      if (/model/i.test(msg) && (name === 'openai' || name === 'anthropic' || name === 'gemini')) {
        msg += ' → o nome do modelo pode não estar disponível na sua conta. Troque em "Avançado" (ex.: OpenAI: gpt-4o).';
      }
      E.ui.toast('⚠️ ' + label + ': ' + msg, 12000);
      console.error(name, err);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Testar';
    }
  }

  /* ---------- configurações (chaves + identidade) ---------- */

  E.ai.openSettings = function () {
    const s = settings();
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const box = document.createElement('div');
    box.className = 'modal modal-settings';

    function field(label, value, placeholder, type) {
      const lab = document.createElement('label');
      const span = document.createElement('span');
      span.textContent = label;
      const input = document.createElement('input');
      input.type = type || 'password';
      input.value = value || '';
      input.placeholder = placeholder || '';
      input.autocomplete = 'off';
      input.spellcheck = false;
      lab.appendChild(span);
      lab.appendChild(input);
      return { lab, input };
    }

    box.innerHTML =
      '<h3>IA & Identidade</h3>' +
      '<p class="modal-msg">As chaves ficam salvas só neste navegador, no seu computador. ' +
      'Crie cada chave no site da respectiva IA e cole aqui.</p>';

    const idLab = document.createElement('label');
    idLab.innerHTML = '<span>Sua identidade criativa (entra em todas as gerações)</span>';
    const idTa = document.createElement('textarea');
    idTa.rows = 4;
    idTa.placeholder =
      'Ex.: Estética urbana brasileira, cores quentes e saturadas, contraste alto, tipografia bold, tom direto e provocador. Referências: anos 90, grão de filme…';
    idTa.value = s.identity;
    idLab.appendChild(idTa);
    box.appendChild(idLab);

    const fields = [];
    function addKey(label, keyName, placeholder) {
      const f = field(label, s.keys[keyName], placeholder);
      // linha com o campo + botão de teste de conexão
      f.lab.removeChild(f.input);
      const row = document.createElement('div');
      row.className = 'key-row';
      row.appendChild(f.input);
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'btn ghost key-test';
      t.textContent = 'Testar';
      t.title = 'Faz uma chamada mínima pra conferir se a chave funciona';
      t.addEventListener('click', () => testProvider(keyName, f.input.value.trim(), t));
      row.appendChild(t);
      f.lab.appendChild(row);
      fields.push({ kind: 'key', name: keyName, input: f.input });
      box.appendChild(f.lab);
    }
    addKey('Claude / Anthropic (texto) — console.anthropic.com', 'anthropic', 'sk-ant-…');
    addKey('OpenAI / GPT (texto) — platform.openai.com', 'openai', 'sk-…');
    addKey('Google Gemini (texto + imagem) — aistudio.google.com', 'gemini', 'AIza…');
    addKey('ElevenLabs (áudio / locução) — elevenlabs.io', 'eleven', 'sk_…');
    addKey('fal.ai (vídeo: Veo 3, Kling, Seedance) — fal.ai', 'fal', 'chave:segredo');

    const adv = document.createElement('details');
    adv.innerHTML = '<summary>Avançado — modelos e voz</summary>';
    function addModel(label, modelName, type) {
      const f = field(label, s.models[modelName], '', type || 'text');
      fields.push({ kind: 'model', name: modelName, input: f.input });
      adv.appendChild(f.lab);
    }
    addModel('Modelo Claude', 'anthropic');
    addModel('Modelo OpenAI', 'openai');
    addModel('Modelo Gemini (texto)', 'gemini');
    addModel('Modelo Gemini (imagem)', 'geminiImage');
    addModel('Voz ElevenLabs (voice ID)', 'elevenVoice');
    addModel('Modelo de vídeo extra (id do fal.ai, opcional)', 'falCustom');
    box.appendChild(adv);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn ghost';
    cancelBtn.textContent = 'Cancelar';
    const okBtn = document.createElement('button');
    okBtn.className = 'btn primary';
    okBtn.textContent = 'Salvar';
    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    box.appendChild(actions);

    overlay.appendChild(box);
    root.appendChild(overlay);

    function close() {
      root.innerHTML = '';
    }
    cancelBtn.addEventListener('click', close);
    overlay.addEventListener('pointerdown', (e) => {
      if (e.target === overlay) close();
    });
    okBtn.addEventListener('click', () => {
      const out = settings();
      out.identity = idTa.value;
      fields.forEach((f) => {
        if (f.kind === 'key') out.keys[f.name] = f.input.value.trim();
        else out.models[f.name] = f.input.value.trim() || DEFAULTS.models[f.name];
      });
      saveSettings(out);
      close();
      E.ui.toast('Configurações salvas');
    });
  };
})();
