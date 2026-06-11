/* Estado global, constantes e utilitários */
(function () {
  const E = (window.Estudio = window.Estudio || {});

  E.uid = function () {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
  };

  // Fases da pipeline de entrega
  E.STAGES = [
    { id: 'ideia',     label: 'Ideia',          color: '#a78bfa' },
    { id: 'conceito',  label: 'Conceito',       color: '#60a5fa' },
    { id: 'pre',       label: 'Pré-produção',   color: '#22d3ee' },
    { id: 'producao',  label: 'Produção',       color: '#fbbf24' },
    { id: 'edicao',    label: 'Edição / Refino', color: '#fb923c' },
    { id: 'aprovacao', label: 'Aprovação',      color: '#f472b6' },
    { id: 'entregue',  label: 'Entregue',       color: '#34d399' },
    { id: 'continuo',  label: 'Contínuo',       color: '#94a3b8' },
  ];

  // Tipos de projeto (icon = nome no registro E.icon)
  E.TYPES = [
    { id: 'clipe',      label: 'Clipe',           icon: 'film' },
    { id: 'foto',       label: 'Foto',            icon: 'camera' },
    { id: 'propaganda', label: 'Propaganda',      icon: 'megaphone' },
    { id: 'marca',      label: 'Marca / Social',  icon: 'smartphone' },
    { id: 'moda',       label: 'Moda / Coleção',  icon: 'hanger' },
    { id: 'web',        label: 'Web / Design',    icon: 'monitor' },
    { id: 'produto',    label: 'Produto',         icon: 'package' },
    { id: 'outro',      label: 'Outro',           icon: 'star' },
  ];

  // Status de um card de post (redes sociais)
  E.POST_STATUS = [
    { id: 'ideia',   label: 'Ideia',   color: '#a78bfa' },
    { id: 'roteiro', label: 'Roteiro', color: '#60a5fa' },
    { id: 'gravado', label: 'Gravado', color: '#fbbf24' },
    { id: 'editado', label: 'Editado', color: '#fb923c' },
    { id: 'postado', label: 'Postado', color: '#34d399' },
  ];

  // Formatos de prancha (apresentação / posts) — w/h em unidades do canvas,
  // exportW é a largura do PNG exportado
  E.FRAME_PRESETS = [
    { id: '16:9', label: '16:9 — Apresentação / YouTube', w: 960, h: 540, exportW: 1920 },
    { id: '9:16', label: '9:16 — Reels / Story / TikTok', w: 540, h: 960, exportW: 1080 },
    { id: '1:1', label: '1:1 — Feed quadrado', w: 720, h: 720, exportW: 1080 },
    { id: '4:5', label: '4:5 — Feed retrato', w: 720, h: 900, exportW: 1080 },
    { id: 'A4', label: 'A4 — Prancha / Documento', w: 794, h: 1123, exportW: 1654 },
  ];
  E.framePresetById = (id) => E.FRAME_PRESETS.find((p) => p.id === id) || E.FRAME_PRESETS[0];

  E.stageById = (id) => E.STAGES.find((s) => s.id === id) || E.STAGES[0];
  E.typeById = (id) => E.TYPES.find((t) => t.id === id) || E.TYPES[E.TYPES.length - 1];
  E.postStatusById = (id) => E.POST_STATUS.find((s) => s.id === id) || E.POST_STATUS[0];

  E.state = {
    projects: [],
    clients: [],
    clipboard: null,     // itens copiados (funciona entre projetos)
    galleryFilter: 'all',
    galleryClientFilter: 'all',
    editing: false,      // true enquanto um texto está sendo editado
  };

  E.CLIP_MARKER = '«estudio-clipboard»';

  E.debounce = function (fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  E.clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  E.escapeHtml = (s) =>
    String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
})();
