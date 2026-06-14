/* Google Calendar (só leitura): cada usuário conecta a própria conta pela
   janela do app (mesmo OAuth do Drive, token cifrado só neste computador,
   escopo calendar.readonly). A Agenda usa isto pra mostrar os eventos do
   Google junto com os posts dos projetos. Só funciona no app desktop. */
(function () {
  const E = window.Estudio;
  E.calendar = {};
  const HD = { 'X-Livrai': '1' };

  E.calendar.status = async function () {
    try {
      const r = await fetch('/__studio/calendar-status', { headers: HD });
      if (!r.ok) return { connected: false };
      return await r.json();
    } catch (_) {
      return { connected: false, unavailable: true };
    }
  };

  E.calendar.connect = async function () {
    try {
      await fetch('/__studio/calendar-connect', { method: 'POST', headers: HD });
      return true;
    } catch (_) {
      return false;
    }
  };

  E.calendar.disconnect = async function () {
    try {
      await fetch('/__studio/calendar-disconnect', { method: 'POST', headers: HD });
    } catch (_) {}
  };

  /* eventos no intervalo [fromIso, toIso] — devolve [] em qualquer erro */
  E.calendar.events = async function (fromIso, toIso) {
    try {
      const r = await fetch(
        '/__studio/calendar-events?from=' + encodeURIComponent(fromIso) + '&to=' + encodeURIComponent(toIso),
        { headers: HD }
      );
      if (!r.ok) return [];
      const data = await r.json();
      return Array.isArray(data.events) ? data.events : [];
    } catch (_) {
      return [];
    }
  };

  /* a data local (YYYY-MM-DD) em que o evento cai na grade do mês */
  E.calendar.dateKey = function (ev) {
    if (!ev || !ev.start) return '';
    if (ev.allDay) return ev.start.slice(0, 10); // já vem YYYY-MM-DD
    const d = new Date(ev.start);
    if (isNaN(d)) return ev.start.slice(0, 10);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  };

  /* etiqueta de hora pros eventos com horário (vazia pros de dia inteiro) */
  E.calendar.timeLabel = function (ev) {
    if (!ev || ev.allDay || !ev.start) return '';
    const d = new Date(ev.start);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };
})();
