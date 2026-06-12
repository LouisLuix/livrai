/* Nuvem do LIVRAI (Firestore) — base do compartilhamento de decks e da
   sincronização. O projeto não tem Storage (plano gratuito), então mídia
   viaja comprimida, gzipada e fatiada em documentos de até ~700KB.
   Senha de compartilhamento = cifra AES-GCM feita AQUI: o conteúdo sobe
   ilegível e a senha nunca sai do computador. */
(function () {
  const E = window.Estudio;
  E.cloud = {};

  const SDK_FIRESTORE = 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js';
  const CHUNK = 700000; // caracteres de base64 por documento (limite do doc: 1MB)
  E.cloud.CHUNK = CHUNK;

  let fsPromise = null;

  /* Firestore sob demanda — soma ao app+auth que o account.js já carrega */
  E.cloud.db = async function () {
    const fb = await E.account.loadFirebase();
    if (!fb.firestore) {
      if (!fsPromise) {
        fsPromise = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = SDK_FIRESTORE;
          s.onload = resolve;
          s.onerror = () => {
            fsPromise = null;
            reject(new Error('offline'));
          };
          document.head.appendChild(s);
        });
      }
      await fsPromise;
    }
    return fb.firestore();
  };

  /* ---------- mídia: comprime pra viajar ---------- */

  /* Imagem → JPEG (ou PNG quando tem recorte) limitada a maxDim px */
  E.cloud.compressImage = async function (blob, maxDim, preferPng) {
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) bmp.close();
      const type = preferPng ? 'image/png' : 'image/jpeg';
      const out = await new Promise((r) => cv.toBlob(r, type, 0.82));
      return out && out.size < blob.size ? out : blob;
    } catch (_) {
      return blob; // indecodificável — segue original
    }
  };

  /* ---------- bytes ↔ base64 ↔ fatias ---------- */

  E.cloud.blobToB64 = function (blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  };

  E.cloud.chunkString = function (s) {
    const out = [];
    for (let i = 0; i < s.length; i += CHUNK) out.push(s.slice(i, i + CHUNK));
    return out;
  };

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 32768) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
    }
    return btoa(bin);
  }

  function b64ToBuf(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }
  E.cloud.bufToB64 = bufToB64;
  E.cloud.b64ToBuf = b64ToBuf;

  /* ---------- gzip (CompressionStream nativo) ---------- */

  E.cloud.gzip = async function (str) {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('gzip');
    const blob = new Blob([new TextEncoder().encode(str)]);
    const out = await new Response(blob.stream().pipeThrough(cs)).arrayBuffer();
    return out;
  };

  E.cloud.gunzip = async function (buf) {
    const ds = new DecompressionStream('gzip');
    const blob = new Blob([buf]);
    const out = await new Response(blob.stream().pipeThrough(ds)).arrayBuffer();
    return new TextDecoder().decode(out);
  };

  /* ---------- cifra com senha (AES-GCM + PBKDF2) ---------- */

  async function deriveKey(password, saltBuf) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBuf, iterations: 200000, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /* cifra um ArrayBuffer → { dataBuf, saltB64, ivB64 } */
  E.cloud.encrypt = async function (buf, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const dataBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, buf);
    return { dataBuf: dataBuf, saltB64: bufToB64(salt), ivB64: bufToB64(iv) };
  };

  /* decifra — lança erro se a senha estiver errada */
  E.cloud.decrypt = async function (dataBuf, password, saltB64, ivB64) {
    const key = await deriveKey(password, b64ToBuf(saltB64));
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(ivB64)) }, key, dataBuf);
  };
})();
