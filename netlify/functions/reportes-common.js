// netlify/functions/reportes-common.js
// Utilidades compartidas: autenticación Firestore, lectura de colecciones,
// rangos de fechas Guatemala (UTC-6) y envío de correos con Resend.

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY    = process.env.FIREBASE_API_KEY;
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents';

// ─── TOKEN DE CUENTA DE SERVICIO ─────────────────────────────────────────────
let cachedToken    = null;
let cachedTokenExp = 0;

async function obtenerIdTokenServicio() {
  const email    = process.env.FIRESTORE_SERVICE_EMAIL;
  const password = process.env.FIRESTORE_SERVICE_PASSWORD;
  if (!email || !password) return null;
  const ahora = Date.now();
  if (cachedToken && ahora < cachedTokenExp) return cachedToken;
  try {
    const resp = await fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + FIREBASE_API_KEY,
      {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ email, password, returnSecureToken: true })
      }
    );
    if (!resp.ok) {
      console.error('Error autenticando cuenta de servicio', resp.status, await resp.text());
      return null;
    }
    const data     = await resp.json();
    cachedToken    = data.idToken;
    cachedTokenExp = ahora + (Number(data.expiresIn || 3600) - 60) * 1000;
    return cachedToken;
  } catch (err) {
    console.error('Error en autenticación de servicio', err);
    return null;
  }
}

async function fetchFirestoreAuth(url) {
  const token   = await obtenerIdTokenServicio();
  const headers = token ? { Authorization: 'Bearer ' + token } : {};
  return fetch(url, { headers });
}

// ─── LEER COLECCIÓN COMPLETA ─────────────────────────────────────────────────
async function obtenerColeccion(nombre) {
  const docs      = [];
  let   pageToken = '';
  do {
    const url  = FIRESTORE_BASE + '/' + nombre + '?pageSize=300&key=' + FIREBASE_API_KEY
                 + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const resp = await fetchFirestoreAuth(url);
    if (!resp.ok) break;
    const data = await resp.json();
    (data.documents || []).forEach((d) => docs.push(d));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return docs;
}

// ─── HELPERS FIRESTORE ───────────────────────────────────────────────────────
function campo(doc, nombre) {
  const f = (doc.fields || {})[nombre];
  if (!f) return undefined;
  if ('stringValue'    in f) return f.stringValue;
  if ('integerValue'   in f) return parseInt(f.integerValue, 10);
  if ('doubleValue'    in f) return f.doubleValue;
  if ('booleanValue'   in f) return f.booleanValue;
  if ('timestampValue' in f) return f.timestampValue;
  return undefined;
}

// ─── ETIQUETAS DE EVENTOS ────────────────────────────────────────────────────
async function obtenerEtiquetasEventos() {
  try {
    const resp = await fetchFirestoreAuth(FIRESTORE_BASE + '/config/eventos_tipos?key=' + FIREBASE_API_KEY);
    if (!resp.ok) throw new Error('sin doc');
    const data = await resp.json();
    const f    = data.fields || {};
    return {
      pedidoLabel: (f.pedidoLabel && f.pedidoLabel.stringValue) || 'Cotización recibida',
      humanoLabel: (f.humanoLabel && f.humanoLabel.stringValue) || 'Solicitud de asesor'
    };
  } catch {
    return { pedidoLabel: 'Cotización recibida', humanoLabel: 'Solicitud de asesor' };
  }
}

// ─── CORREOS DE USUARIOS NOTIFICABLES ────────────────────────────────────────
async function obtenerCorreosNotificables() {
  try {
    const resp = await fetchFirestoreAuth(FIRESTORE_BASE + '/usuarios?key=' + FIREBASE_API_KEY + '&pageSize=200');
    if (!resp.ok) return [];
    const data   = await resp.json();
    const docs   = data.documents || [];
    const correos = [];
    for (const doc of docs) {
      const f      = doc.fields || {};
      const activo = !!(f.activo && f.activo.booleanValue);
      const correo = f.correo && f.correo.stringValue;
      if (activo && f.notifCorreo && f.notifCorreo.booleanValue && correo) correos.push(correo);
    }
    return correos;
  } catch (err) {
    console.error('No se pudieron leer usuarios para el reporte', err);
    return [];
  }
}

// ─── RANGOS DE FECHAS (Guatemala = UTC-6, sin horario de verano) ─────────────
const OFFSET_HORAS = 6;

function rangoDiaGT(offsetDias) {
  const ahora  = new Date();
  const gt     = new Date(ahora.getTime() - OFFSET_HORAS * 3600 * 1000);
  const y = gt.getUTCFullYear(), m = gt.getUTCMonth(), d = gt.getUTCDate();
  const hoy00  = new Date(Date.UTC(y, m, d, OFFSET_HORAS, 0, 0));
  const desde  = new Date(hoy00.getTime() + offsetDias * 24 * 3600 * 1000);
  const hasta  = new Date(desde.getTime() + 24 * 3600 * 1000);
  return { desde, hasta };
}

function rangoSemanaGT() {
  const ahora  = new Date();
  const gt     = new Date(ahora.getTime() - OFFSET_HORAS * 3600 * 1000);
  const y = gt.getUTCFullYear(), m = gt.getUTCMonth(), d = gt.getUTCDate();
  const hoy00  = new Date(Date.UTC(y, m, d, OFFSET_HORAS, 0, 0));
  const desde  = new Date(hoy00.getTime() - 7 * 24 * 3600 * 1000);
  return { desde, hasta: hoy00 };
}

function enRango(fechaISO, desde, hasta) {
  if (!fechaISO) return false;
  const t = new Date(fechaISO).getTime();
  return t >= desde.getTime() && t < hasta.getTime();
}

// ─── MÉTRICAS ────────────────────────────────────────────────────────────────
async function calcularMetricas(desde, hasta) {
  const [pedidosDocs, humanoDocs] = await Promise.all([
    obtenerColeccion('pedidos_chat'),
    obtenerColeccion('eventos_humano')
  ]);

  const pedidos = pedidosDocs
    .map((doc) => ({
      nombre  : campo(doc, 'nombre')   || '—',
      telefono: campo(doc, 'telefono') || '—',
      modelo  : campo(doc, 'modelo')   || '',
      interes : campo(doc, 'interes')  || '',
      fecha   : campo(doc, 'fecha')
    }))
    .filter((p) => enRango(p.fecha, desde, hasta));

  const humanos = humanoDocs
    .map((doc) => ({ fecha: campo(doc, 'fecha') }))
    .filter((h) => enRango(h.fecha, desde, hasta));

  return { pedidos, numCotizaciones: pedidos.length, numSolicitudesHumano: humanos.length };
}

// ─── ENVÍO DE CORREOS (Resend) ───────────────────────────────────────────────
async function enviarCorreoResend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || !to.length) {
    console.warn('Resend no configurado o sin destinatarios; correo no enviado.');
    return;
  }
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body   : JSON.stringify({
        from   : process.env.RESEND_FROM_EMAIL || 'LIA Vento Barberena <onboarding@resend.dev>',
        to,
        subject,
        html
      })
    });
    if (!resp.ok) console.error('Resend error', resp.status, await resp.text());
  } catch (err) {
    console.error('No se pudo enviar el correo por Resend', err);
  }
}

// ─── HELPERS HTML ─────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function formatearTablaCotizaciones(pedidos) {
  if (!pedidos.length) return '<p><i>Sin cotizaciones en este período.</i></p>';
  const filas = pedidos.map((p) =>
    '<tr>' +
    '<td>' + escapeHtml(p.nombre)   + '</td>' +
    '<td>' + escapeHtml(p.telefono) + '</td>' +
    '<td>' + escapeHtml(p.modelo)   + '</td>' +
    '<td>' + escapeHtml(p.interes)  + '</td>' +
    '</tr>'
  ).join('');
  return (
    '<table cellpadding="6" style="border-collapse:collapse;width:100%">' +
    '<tr style="background:#f0f0f0"><th align="left">Cliente</th><th align="left">Teléfono</th><th align="left">Modelo</th><th align="left">Interés</th></tr>' +
    filas +
    '</table>'
  );
}

module.exports = {
  FIREBASE_PROJECT_ID, FIREBASE_API_KEY, FIRESTORE_BASE,
  obtenerIdTokenServicio, fetchFirestoreAuth,
  obtenerColeccion, campo, obtenerEtiquetasEventos, obtenerCorreosNotificables,
  rangoDiaGT, rangoSemanaGT, calcularMetricas, enviarCorreoResend,
  escapeHtml, formatearTablaCotizaciones, OFFSET_HORAS
};
                                                                              