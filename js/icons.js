/* Ícones SVG autorais — traço 1.5, grade 24. Nenhum emoji no app. */
(function () {
  const E = (window.Estudio = window.Estudio || {});

  const P = {
    settings:
      '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-2.6-1.5L14 2.5h-4L9.6 5a7.7 7.7 0 0 0-2.6 1.5l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 2.6-1.5l2.4 1 2-3.4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    'arrow-left': '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    'arrow-up-right': '<path d="M7 17 17 7M8 7h9v9"/>',
    'chevron-left': '<path d="M14.5 6 8.5 12l6 6"/>',
    'chevron-right': '<path d="M9.5 6l6 6-6 6"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    check: '<path d="M5 12.5 10 17.5 19 7"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 9.5v5M12 17.2v.3"/>',
    more: '<circle cx="5.5" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18.5" cy="12" r="1.1"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',
    kanban:
      '<rect x="3.5" y="4" width="5.4" height="16" rx="1.2"/><rect x="11.5" y="4" width="5.4" height="11" rx="1.2"/><rect x="19.2" y="4" width="1.3" height="7" rx="0.6"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20.5c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>',
    users:
      '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 20c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5"/><path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M17.8 15.3c1.7.7 2.8 2.3 3.2 4.7"/>',
    sparkles:
      '<path d="M12 4.5 13.8 10 19.5 12l-5.7 2-1.8 5.5L10.2 14 4.5 12l5.7-2z"/><path d="M19 3.5v3M17.5 5h3"/>',
    wand: '<path d="M5 19 17.5 6.5M15 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19.5 12.5l.6 1.2 1.2.6-1.2.6-.6 1.2-.6-1.2-1.2-.6 1.2-.6z"/>',
    image:
      '<rect x="3.5" y="5" width="17" height="14" rx="1.6"/><circle cx="9" cy="10" r="1.6"/><path d="m3.5 16.5 5-4.5 4 3.5 3-2.5 5 4"/>',
    film: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.6"/><path d="M8 4.5v15M16 4.5v15M3.5 9.3H8M3.5 14.7H8M16 9.3h4.5M16 14.7h4.5"/>',
    camera:
      '<path d="M4 8h3l1.6-2.5h6.8L17 8h3a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 20H4a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 4 8z"/><circle cx="12" cy="13.5" r="3.4"/>',
    audio:
      '<path d="M4 13a8 8 0 0 1 16 0"/><rect x="3" y="13" width="4" height="6.5" rx="1.4"/><rect x="17" y="13" width="4" height="6.5" rx="1.4"/>',
    note: '<path d="M5 4.5h14V14l-5.5 5.5H5z"/><path d="M13.5 19.5V14H19"/>',
    type: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>',
    calendar:
      '<rect x="3.5" y="5.5" width="17" height="15" rx="1.6"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    frame: '<path d="M7 2.5v19M17 2.5v19M2.5 7h19M2.5 17h19"/>',
    flow: '<rect x="3" y="3.5" width="7.5" height="6" rx="1.4"/><rect x="13.5" y="14.5" width="7.5" height="6" rx="1.4"/><path d="M6.75 9.5v4a2 2 0 0 0 2 2h4.25"/><path d="m10.5 13 2.5 2.5-2.5 2.5"/>',
    link: '<path d="M10 14.5 14 10.5"/><path d="m12.5 7.5 2-2a3.5 3.5 0 0 1 5 5l-2 2M11.5 16.5l-2 2a3.5 3.5 0 0 1-5-5l2-2"/>',
    droplet: '<path d="M12 3.5c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z"/>',
    palette:
      '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.4 0 2-.8 2-1.8 0-1.6-1.6-2 0-3.7 1-1 6.5.6 6.5-3.3 0-4.6-3.8-8.2-8.5-8.2z"/><circle cx="8" cy="9" r="1"/><circle cx="13" cy="7.5" r="1"/><circle cx="7.5" cy="13.5" r="1"/>',
    download: '<path d="M12 4v11M7.5 11.5 12 16l4.5-4.5M5 19.5h14"/>',
    upload: '<path d="M12 16V5M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>',
    folder:
      '<path d="M3.5 6.5A1.5 1.5 0 0 1 5 5h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
    pin: '<path d="M9 4h6l-1 6.5 3 2.5v1.5H7V13l3-2.5zM12 14.5V21"/>',
    trash:
      '<path d="M5 7h14M9.5 7V4.5h5V7M7 7l1 13h8l1-13M10 11v5M14 11v5"/>',
    pencil: '<path d="m5 19 1-4L16.5 4.5a1.8 1.8 0 0 1 2.5 0l.5.5a1.8 1.8 0 0 1 0 2.5L9 18z"/>',
    key: '<circle cx="8" cy="15.5" r="4"/><path d="m11 12.5 8.5-8.5M17 6.5 19.5 9M14.5 9 17 11.5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="1.6"/><path d="M5 14.5H4.5A1.5 1.5 0 0 1 3 13V4.5A1.5 1.5 0 0 1 4.5 3H13a1.5 1.5 0 0 1 1.5 1.5V5"/>',
    clipboard:
      '<rect x="5" y="4.5" width="14" height="16.5" rx="1.6"/><path d="M9 4.5a3 3 0 0 1 6 0M9 11h6M9 15h6"/>',
    maximize:
      '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    monitor:
      '<rect x="3" y="4.5" width="18" height="12.5" rx="1.6"/><path d="M9 20.5h6M12 17v3.5"/>',
    package:
      '<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    hanger:
      '<path d="M12 7.5a2.2 2.2 0 1 1 2.2-2.2M12 7.5v2L3.5 15a1.4 1.4 0 0 0 .9 2.5h15.2a1.4 1.4 0 0 0 .9-2.5L12 9.5z"/>',
    megaphone:
      '<path d="M3.5 10v4l4 .5 1 5h2.5l-1-4.8L19 17.5v-11L7.5 9.5zM19 10a2.5 2.5 0 0 1 0 4"/>',
    smartphone:
      '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 17.5h2"/>',
    star: '<path d="m12 3.5 2.5 5.4 5.9.7-4.4 4 1.2 5.8-5.2-3-5.2 3 1.2-5.8-4.4-4 5.9-.7z"/>',
    database:
      '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v13c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-13"/><path d="M4 12c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8"/>',
    brush:
      '<path d="M9 13.5 18.5 3l2.5 2.5L10.5 15"/><path d="M9 13.5c-2.5 0-4 1.5-4 4 0 1.5-1 2-2.5 2 1 1.5 2.5 2 4 2 2.8 0 5-1.7 5-4.5z"/>',
    layers:
      '<path d="m12 3.5 9 5-9 5-9-5z"/><path d="m4.5 12.5-1.5.8 9 5 9-5-1.5-.8"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.3-5.6M20 3.5V8h-4.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    'zoom-in': '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4M11 8.5v5M8.5 11h5"/>',
    'zoom-out': '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4-4M8.5 11h5"/>',
    filter: '<path d="M3.5 5h17l-6.5 7.5v5L10 20v-7.5z"/>',
    archive:
      '<rect x="3" y="4" width="18" height="5" rx="1.2"/><path d="M5 9v9.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V9M10 13h4"/>',
    logo: '<path d="M4 4h7v7H4zM13 13h7v7h-7zM13 4l7 7M4 13l7 7"/>',
  };

  /** Markup SVG do ícone. E.icon('plus') ou E.icon('plus', 18) */
  E.icon = function (name, size) {
    const path = P[name] || P.star;
    const s = size || 16;
    return (
      '<svg class="ic" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path +
      '</svg>'
    );
  };

  /** Elemento <span class="ic-wrap"> contendo o SVG */
  E.iconEl = function (name, size) {
    const span = document.createElement('span');
    span.className = 'ic-wrap';
    span.innerHTML = E.icon(name, size);
    return span.firstChild ? span : span;
  };

  /** Preenche um elemento com ícone + texto (substitui textContent com emoji) */
  E.setLabel = function (el, iconName, text) {
    el.innerHTML = '';
    if (iconName) el.insertAdjacentHTML('beforeend', E.icon(iconName));
    if (text != null && text !== '') {
      const s = document.createElement('span');
      s.textContent = text;
      el.appendChild(s);
    }
  };

  /* Hidrata elementos estáticos do HTML marcados com data-icon */
  document.querySelectorAll('[data-icon]').forEach((el) => {
    el.insertAdjacentHTML('afterbegin', E.icon(el.dataset.icon, parseInt(el.dataset.iconSize, 10) || 16));
  });
})();
