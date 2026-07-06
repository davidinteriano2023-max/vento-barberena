// netlify/functions/tabi-chat.js
// Función principal del chat LIA para Vento Barberena.
// Llama a OpenAI, detecta señales de cotización/escalamiento y notifica.

const { TABI_SYSTEM_PROMPT } = require('./tabi-prompt.js');
const { fetchFirestoreAuth } = require('./reportes-common.js');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_API_KEY    = process.env.FIREBASE_API_KEY;
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents';

const HEADERS = {
  'Content-Type'                : 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST')    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Método no permitido' }) };

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'JSON inválido' }) }; }

  const message    = String(payload.message || '').slice(0, 2000);
  const historyRaw = Array.isArray(payload.history) ? payload.history : [];
  if (!message.trim()) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Falta el mensaje' }) };

  // Verificar si el asesor IA está activo
  const activo = await asesorActivo();
  if (!activo) {
    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({ reply: 'En este momento el chat no está disponible. Escribinos por WhatsApp al 3897-8935. 📲', deshabilitado: true })
    };
  }

  const history = historyRaw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 2000) }));

  const messages = [
    { role: 'system',    content: TABI_SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message }
  ];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 200, headers: HEADERS,
      body: JSON.stringify({ reply: 'El asistente todavía no está conectado. Escribinos al WhatsApp 3897-8935 mientras lo activamos. 🙏' })
    };
  }

  let rawReply;
  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body   : JSON.stringify({ model: 'gpt-4o-mini', messages, temperature: 0.7, max_tokens: 400 })
    });
    if (!resp.ok) {
      console.error('OpenAI error', resp.status, await resp.text());
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ reply: 'Se me trabó la conexión. Escribinos al WhatsApp 3897-8935. 📲' }) };
    }
    const data = await resp.json();
    rawReply   = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  } catch (err) {
    console.error('Fallo llamando a OpenAI', err);
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ reply: 'Se me trabó la conexión. Escribinos al WhatsApp 3897-8935. 📲' }) };
  }

  let reply = rawReply;

  // ── Detectar señal de cotización ──────────────────────────────────────────
  const pedidoMatch = reply.match(/\[\[PEDIDO:\]\]([\s\S]*?)\[\[\/PEDIDO\]\]/);
  if (pedidoMatch) {
    reply = reply.replace(pedidoMatch[0], '').trim();
    let cotizacion = null;
    try { cotizacion = JSON.parse(pedidoMatch[1]); }
    catch (err) { console.error('No se pudo parsear JSON de cotización', err, pedidoMatch[1]); }
    if (cotizacion) {
      await Promise.allSettled([
        notificarWhatsapp(cotizacion),
        notificarCorreo(cotizacion),
        guardarCotizacion(cotizacion)
      ]);
    }
  }

  // ── Detectar señal de escalamiento a humano ───────────────────────────────
  const humanoMatch = reply.match(/\[\[HUMANO\]\]/);
  if (humanoMatch) {
    reply = reply.replace(humanoMatch[0], '').trim();
    await Promise.allSettled([
      guardarEventoHumano({ message })
    ]);
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ reply }) };
};

// ─── VERIFICAR SI EL BOT ESTÁ ACTIVO ─────────────────────────────────────────
async function asesorActivo() {
  try {
    const resp = await fetchFirestoreAuth(FIRESTORE_BASE + '/config/asesor_ia?key=' + FIREBASE_API_KEY);
    if (!resp.ok) return true;
    const data = await resp.json();
    const f    = data.fields || {};
    if (f.activo && typeof f.activo.booleanValue === 'boolean') return f.activo.booleanValue;
    return true;
  } catch {
    return true; // si falla, asumir activo
  }
}

// ─── OBTENER USUARIOS NOTIFICABLES ───────────────────────────────────────────
async function obtenerUsuariosNotificables() {
  try {
    const resp = await fetchFirestoreAuth(FIRESTORE_BASE + '/usuarios?key=' + FIREBASE_API_KEY + '&pageSize=200');
    if (!resp.ok) return { correos: [], whatsapps: [] };
    const data     = await resp.json();
    const correos  = [];
    const whatsapps = [];
    for (const doc of (data.documents || [])) {
      const f      = doc.fields || {};
      const activo = !!(f.activo && f.activo.booleanValue);
      if (!activo) continue;
      const correo        = f.correo        && f.correo.stringValue;
      const whatsappPhone = f.whatsappPhone && f.whatsappPhone.stringValue;
      const whatsappApikey = f.whatsappApikey && f.whatsappApikey.stringValue;
      if (f.notifCorreo   && f.notifCorreo.booleanValue   && correo) correos.push(correo);
      if (f.notifWhatsapp && f.notifWhatsapp.booleanValue && whatsappPhone && whatsappApikey)
        whatsapps.push({ phone: whatsappPhone, apikey: whatsappApikey });
    }
    return { correos, whatsapps };
  } catch (err) {
    console.error('No se pudo leer usuarios para notificaciones', err);
    return { correos: [], whatsapps: [] };
  }
}

// ─── NOTIFICACIÓN POR WHATSAPP (CallMeBot) ───────────────────────────────────
async function notificarWhatsapp(cotizacion) {
  const texto =
    '🏍️ NUEVA COTIZACIÓN (LIA - Vento Barberena)\n' +
    'Nombre: '   + (cotizacion.nombre   || '—') + '\n' +
    'Tel: '      + (cotizacion.telefono || '—') + '\n' +
    'Modelo: '   + (cotizacion.modelo   || '—') + '\n' +
    'Interés: '  + (cotizacion.interes  || '—');

  const destinatarios = [];
  const envPhone  = process.env.CALLMEBOT_PHONE;
  const envApikey = process.env.CALLMEBOT_APIKEY;
  if (envApikey) destinatarios.push({ phone: envPhone, apikey: envApikey });

  const { whatsapps } = await obtenerUsuariosNotificables();
  whatsapps.forEach((w) => destinatarios.push(w));

  if (!destinatarios.length) {
    console.warn('CallMeBot no configurado; cotización no notificada por WhatsApp.');
    return;
  }

  await Promise.allSettled(
    destinatarios.map((d) => {
      const url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(d.phone) +
                  '&text=' + encodeURIComponent(texto) + '&apikey=' + encodeURIComponent(d.apikey);
      return fetch(url).catch((err) => console.error('Error CallMeBot a ' + d.phone, err));
    })
  );
}

// ─── NOTIFICACIÓN POR CORREO (Resend) ────────────────────────────────────────
async function notificarCorreo(cotizacion) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) { console.warn('Resend no configurado; cotización no notificada por correo.'); return; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const html =
    '<h2 style="color:#E8142B">🏍️ Nueva cotización — LIA Vento Barberena</h2>' +
    '<p><b>Nombre:</b> '  + esc(cotizacion.nombre)   + '<br>' +
    '<b>Teléfono:</b> ' + esc(cotizacion.telefono) + '<br>' +
    '<b>Modelo:</b> '   + esc(cotizacion.modelo)   + '<br>' +
    '<b>Interés:</b> '  + esc(cotizacion.interes)  + '</p>' +
    '<p style="color:#666;font-size:13px">Contactar al cliente lo antes posible por WhatsApp.</p>';

  const { correos } = await obtenerUsuariosNotificables();
  const destinatarios = correos.length ? correos : [process.env.RESEND_TO_EMAIL || 'egguatemala2@gmail.com'];

  try {
    await fetch('https://api.resend.com/emails', {
      method : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      body   : JSON.stringify({
        from   : process.env.RESEND_FROM_EMAIL || 'LIA Vento Barberena <onboarding@resend.dev>',
        to     : destinatarios,
        subject: '🏍️ Nueva cotización: ' + (cotizacion.modelo || 'Moto Vento') + ' — ' + (cotizacion.nombre || ''),
        html
      })
    });
  } catch (err) {
    console.error('No se pudo enviar el correo con Resend', err);
  }
}

// ─── GUARDAR COTIZACIÓN EN FIRESTORE ─────────────────────────────────────────
async function guardarCotizacion(cotizacion) {
  try {
    const url    = FIRESTORE_BASE + '/pedidos_chat?key=' + FIREBASE_API_KEY;
    const fields = {
      nombre  : { stringValue: String(cotizacion.nombre   || '') },
      telefono: { stringValue: String(cotizacion.telefono || '') },
      modelo  : { stringValue: String(cotizacion.modelo   || '') },
      interes : { stringValue: String(cotizacion.interes  || '') },
      origen  : { stringValue: 'chat_lia' },
      fecha   : { timestampValue: new Date().toISOString() }
    };
    await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ fields })
    });
  } catch (err) {
    console.error('No se pudo guardar la cotización en Firestore', err);
  }
}

// ─── GUARDAR EVENTO HUMANO EN FIRESTORE ──────────────────────────────────────
async function guardarEventoHumano({ message }) {
  try {
    const url    = FIRESTORE_BASE + '/eventos_humano?key=' + FIREBASE_API_KEY;
    const fields = {
      mensaje: { stringValue: String(message || '').slice(0, 500) },
      origen : { stringValue: 'chat_lia' },
      fecha  : { timestampValue: new Date().toISOString() }
    };
    await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ fields })
    });
  } catch (err) {
    console.error('No se pudo guardar el evento de escalamiento', err);
  }
}
                                                                              