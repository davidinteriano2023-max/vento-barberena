// netlify/functions/ia-conocimiento.js
//
// Base de conocimiento EN VIVO para la IA de Kommo.
// No hay que editar nada aquí cuando cambian precios o modelos: cada vez que
// la IA responde, lee el sitio publicado y los precios guardados en Firebase
// (los mismos que se editan en el panel de Administración). Se guarda una
// copia en memoria unos minutos (IA_CACHE_MIN, por defecto 5) para que sea
// rápido; pasado ese tiempo se vuelve a leer y cualquier cambio entra solo.
//
// Fuentes:
//   1. index.html del sitio  → CATS, MOTOS (ficha, colores, equipamiento), PAGOS,
//                              beneficios, JSON-LD (dirección, horario, FAQ)
//   2. Firestore /motos      → nombre, precio, precio anterior, badge, disponible
//
// Variables de entorno:
//   IA_SITIO          por defecto https://comercializadorawb.com
//   IA_CACHE_MIN      minutos de caché, por defecto 5
//   IA_WHATSAPP       número de ventas que da la IA, por defecto 4016-5239
//   FIREBASE_PROJECT_ID, FIREBASE_API_KEY (ya existen en el sitio)

const SITIO = (process.env.IA_SITIO || 'https://comercializadorawb.com').replace(/\/+$/, '');
const TTL_MS = Math.max(1, Number(process.env.IA_CACHE_MIN || 5)) * 60 * 1000;
const WHATSAPP = process.env.IA_WHATSAPP || '4016-5239';
const TIMEOUT_MS = 4000;

let cache = null; // { texto, generado, fuente }

/* ─────────────── utilidades ─────────────── */

async function traer(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' en ' + url);
    return r;
  } finally {
    clearTimeout(t);
  }
}

/** Saca un bloque `const NOMBRE=[ ... \n];` del HTML y lo evalúa (mismo método que build-paginas.js). */
function bloque(src, inicio, cierre, nombre) {
  const i = src.indexOf(inicio);
  if (i < 0) return null;
  const j = src.indexOf(cierre, i);
  if (j < 0) return null;
  try {
    return new Function(src.slice(i, j + cierre.length) + '\nreturn ' + nombre + ';')();
  } catch (e) {
    console.error('No pude leer ' + nombre + ' del sitio:', e.message);
    return null;
  }
}

const slug = (s) => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const Q = (n) => 'Q' + Number(n).toLocaleString('en-US');

const sinHtml = (s) => String(s == null ? '' : s)
  .replace(/<[^>]+>/g, '')
  .replace(/&middot;/g, '·').replace(/&nbsp;/g, ' ')
  .replace(/&aacute;/g, 'á').replace(/&eacute;/g, 'é').replace(/&iacute;/g, 'í')
  .replace(/&oacute;/g, 'ó').replace(/&uacute;/g, 'ú').replace(/&ntilde;/g, 'ñ')
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, ' ').trim();

/** Misma fórmula de cuotas que el cotizador y las páginas de /motos/. */
function planes(p) {
  const e = Math.round(p * 0.2), f = p - e;
  return {
    enganche: e,
    lista: [
      { m: 24, cuota: Math.round(f * 1.20 / 24) },
      { m: 36, cuota: Math.round(f * 1.26 / 36) },
      { m: 48, cuota: Math.round(f * 1.32 / 48) }
    ]
  };
}

function valorFs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  return null;
}

/* ─────────────── fuentes ─────────────── */

async function preciosFirebase() {
  const proj = process.env.FIREBASE_PROJECT_ID;
  const key = process.env.FIREBASE_API_KEY;
  if (!proj || !key) return {};
  const url = 'https://firestore.googleapis.com/v1/projects/' + proj +
    '/databases/(default)/documents/motos?pageSize=100&key=' + key;
  const r = await traer(url);
  const data = await r.json();
  const out = {};
  for (const doc of data.documents || []) {
    const id = doc.name.split('/').pop();
    const f = doc.fields || {};
    const o = {};
    ['nom', 'p', 'po', 'badge', 'disponible'].forEach((k) => {
      if (k in f) o[k] = valorFs(f[k]);
    });
    out[id] = o;
  }
  return out;
}

function leerJsonLd(html) {
  const res = { negocio: null, faq: [] };
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    let j;
    try { j = JSON.parse(m[1]); } catch (_) { continue; }
    const nodos = j['@graph'] || [j];
    for (const n of nodos) {
      const tipos = [].concat(n['@type'] || []);
      if (tipos.includes('MotorcycleDealer') || tipos.includes('LocalBusiness')) res.negocio = n;
      if (tipos.includes('FAQPage')) {
        (n.mainEntity || []).forEach((q) => {
          if (q && q.name && q.acceptedAnswer) res.faq.push({ p: q.name, r: q.acceptedAnswer.text });
        });
      }
    }
  }
  return res;
}

/* ─────────────── armado del texto ─────────────── */

function armarTexto({ html, fb }) {
  const CATS = bloque(html, 'const CATS=[', '\n];', 'CATS') || [];
  const MOTOS = bloque(html, 'const MOTOS=[', '\n];', 'MOTOS') || [];
  const PAGOS = bloque(html, 'const PAGOS={', '\n};', 'PAGOS') || {};
  if (!MOTOS.length) throw new Error('No encontré el catálogo (MOTOS) en el sitio');

  // Precios del panel de Administración (Firebase) mandan sobre los del HTML
  MOTOS.forEach((m) => {
    const o = fb[m.id];
    if (!o) return;
    if (o.nom != null) m.nom = o.nom;
    if (o.p != null) m.p = o.p;
    if (o.po != null) m.po = o.po;
    if ('badge' in o) m.badge = o.badge;
    if (o.disponible != null) m.disponible = o.disponible;
  });

  const { negocio, faq } = leerJsonLd(html);
  const beneficios = [];
  const reBen = /<div class="ben">([\s\S]*?)<\/div>/g;
  let b;
  while ((b = reBen.exec(html))) {
    const t = sinHtml(b[1]);
    if (t && !beneficios.includes(t)) beneficios.push(t);
  }

  const L = [];
  L.push('# DATOS DEL NEGOCIO');
  L.push('Nombre: Vento Barberena — Distribuidor Autorizado Vento (Santa Rosa, Guatemala)');
  if (negocio && negocio.address) {
    const a = negocio.address;
    L.push('Dirección: ' + [a.streetAddress, a.addressLocality, a.addressRegion].filter(Boolean).join(', '));
  }
  if (negocio && negocio.openingHoursSpecification) {
    const h = [].concat(negocio.openingHoursSpecification)[0] || {};
    const todos = [].concat(h.dayOfWeek || []).length === 7;
    L.push('Horario: ' + (todos ? 'lunes a domingo' : [].concat(h.dayOfWeek || []).join(', ')) +
      ', de ' + (h.opens || '') + ' a ' + (h.closes || '') + ' (abierto los 7 días)');
  }
  L.push('WhatsApp de ventas: ' + WHATSAPP);
  L.push('Sitio web: ' + SITIO + '/');
  L.push('Catálogo completo: ' + SITIO + '/motos/');
  L.push('Precalificación de crédito en línea (1 minuto): ' + SITIO + '/precalificar/');
  if (negocio && negocio.geo) {
    L.push('Ubicación en Google Maps: https://www.google.com/maps/search/?api=1&query=' +
      negocio.geo.latitude + ',' + negocio.geo.longitude);
  }

  if (beneficios.length) {
    L.push('');
    L.push('# BENEFICIOS QUE INCLUYE CADA MOTO');
    beneficios.forEach((t) => L.push('- ' + t));
  }

  L.push('');
  L.push('# FORMAS DE PAGO (tal como aparecen en la web)');
  Object.keys(PAGOS).forEach((k) => {
    const p = PAGOS[k] || {};
    const partes = [p.badge, [p.b1, p.b2, p.b3].filter(Boolean).join(' '), p.sub, p.foot]
      .map(sinHtml).filter(Boolean);
    if (partes.length) L.push('- ' + partes.join(' — '));
  });
  L.push('- Cuotas de referencia publicadas en la web: estimadas con 20% de enganche, planes de 24, 36 y 48 meses. ' +
    'La cuota final depende de la evaluación de crédito; para eso el cliente precalifica.');

  L.push('');
  L.push('# CATÁLOGO ACTUAL (precios de contado en quetzales)');
  const porCat = {};
  MOTOS.forEach((m) => { (porCat[m.cat] = porCat[m.cat] || []).push(m); });
  const orden = CATS.length ? CATS : Object.keys(porCat).map((k) => ({ k, l: k }));
  orden.forEach((c) => {
    const lista = porCat[c.k];
    if (!lista || !lista.length) return;
    L.push('');
    L.push('## Línea ' + c.l);
    lista.forEach((m) => {
      const disp = m.disponible === false ? ' · NO DISPONIBLE por ahora' : '';
      const antes = m.po && m.po > m.p ? ' (antes ' + Q(m.po) + ')' : '';
      const badge = m.badge ? ' · ' + m.badge : '';
      L.push('- ' + m.nom + (m.año ? ' ' + m.año : '') + ' — precio de contado ' + Q(m.p) + antes + badge + disp);
      const pl = planes(m.p);
      L.push('  Crédito (estimado con enganche 20% = ' + Q(pl.enganche) + '): ' +
        pl.lista.map((x) => x.m + ' meses ' + Q(x.cuota) + '/mes').join(' · '));
      if (m.cols && m.cols.length) L.push('  Colores: ' + m.cols.map((x) => x.n).join(', '));
      if (m.specs) {
        const sp = Object.keys(m.specs).map((g) =>
          g + ': ' + Object.keys(m.specs[g]).map((k) => k + ' ' + m.specs[g][k]).join(', '));
        L.push('  Ficha técnica: ' + sp.join(' | '));
      }
      if (m.feats && m.feats.length) L.push('  Equipamiento: ' + m.feats.join(', '));
      L.push('  Página: ' + SITIO + '/motos/' + slug(m.nom) + '/ · Precalificar esta moto: ' +
        SITIO + '/precalificar/?m=' + m.id);
    });
  });

  if (faq.length) {
    L.push('');
    L.push('# PREGUNTAS FRECUENTES (publicadas en la web)');
    faq.forEach((f) => { L.push('P: ' + f.p); L.push('R: ' + f.r); });
  }

  return L.join('\n');
}

/* ─────────────── API ─────────────── */

/*
 * Dos niveles:
 *  - El HTML del sitio (fichas, colores, formas de pago, FAQ) se guarda 5 min:
 *    cambia solo cuando se publica el sitio.
 *  - Los precios de Firebase (panel de Administración) se leen EN CADA respuesta,
 *    así un cambio guardado en el panel llega al instante a la IA de Kommo y a la
 *    de la página web. Si Firebase tarda más de 1.5 s se usa la última lectura buena.
 */
let htmlCache = null;   // { html, at }
let fbCache = {};       // último resultado bueno de Firebase

async function obtenerHtml() {
  const ahora = Date.now();
  if (htmlCache && ahora - htmlCache.at < TTL_MS) return htmlCache.html;
  try {
    const html = await traer(SITIO + '/?ia=' + ahora).then((r) => r.text());
    htmlCache = { html, at: ahora };
    return html;
  } catch (e) {
    console.error('No pude leer el sitio:', e.message);
    if (htmlCache) return htmlCache.html;
    throw e;
  }
}

async function obtenerPreciosVivos() {
  try {
    const fb = await Promise.race([
      preciosFirebase(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout firebase')), 1500))
    ]);
    if (fb && Object.keys(fb).length) fbCache = fb;
    return fbCache;
  } catch (e) {
    console.error('Firebase precios:', e.message);
    return fbCache;
  }
}

/** Devuelve el conocimiento actualizado (texto) y la hora en que se armó. */
async function obtenerConocimiento() {
  const [html, fb] = await Promise.all([obtenerHtml(), obtenerPreciosVivos()]);
  const texto = armarTexto({ html, fb: JSON.parse(JSON.stringify(fb)) });
  return { texto, generado: Date.now(), fuente: SITIO };
}

module.exports = { obtenerConocimiento, SITIO, WHATSAPP };
