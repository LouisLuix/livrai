/* Instagram: publicação assistida a partir de um card de post.
   A API oficial (Instagram Graph) só publica imagem hospedada em URL
   pública e exige conta Business + app aprovado pela Meta — então o
   Estúdio faz o caminho rápido e sem burocracia: salva as mídias na
   pasta do projeto, copia a legenda e abre o Instagram. É só arrastar. */
(function () {
  const E = window.Estudio;
  E.insta = {};

  const KEY = 'estudio-insta-user';

  E.insta.user = function () {
    return (localStorage.getItem(KEY) || '').replace(/^@/, '').trim();
  };

  E.insta.setUser = function (u) {
    const clean = String(u || '').trim().replace(/^@/, '');
    if (clean) localStorage.setItem(KEY, clean);
    else localStorage.removeItem(KEY);
    return clean;
  };

  E.insta.publishPost = async function (item) {
    const c = item.content || {};
    const media = E.items.postMedia(c);
    if (!media.length) {
      E.ui.toast('Esse post ainda não tem mídia — adicione imagens ou vídeo antes de publicar');
      return;
    }

    // 1) legenda pronta no clipboard
    const caption = (c.text || '').trim();
    if (caption && navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(caption);
      } catch (_) {}
    }

    // 2) mídias salvas na pasta do projeto (no app desktop, já revela no Finder)
    let saved = 0;
    try {
      saved = await E.files.exportPostMedia(item);
    } catch (err) {
      console.error('exportPostMedia', err);
    }

    // 3) Instagram aberto (no perfil salvo nas Configurações, se houver)
    const user = E.insta.user();
    window.open('https://www.instagram.com/' + (user ? user + '/' : ''), '_blank', 'noopener');

    E.ui.toast(
      (saved ? saved + (saved > 1 ? ' mídias salvas' : ' mídia salva') + ' na pasta do projeto · ' : '') +
        (caption ? 'legenda copiada · ' : '') +
        'Instagram aberto — arraste os arquivos e cole a legenda'
    );
  };
})();
