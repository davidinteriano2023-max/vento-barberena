// netlify/functions/kommo-ia.js
//
// La IA (Claude) que responde los chats de Kommo.
//
// ─── Cómo se conecta (igual que el bot "Sofia") ───
// Salesbot → paso "Webhooks de Salesbot" hace POST a
//   https://comercializadorawb.com/.netlify/functions/kommo-ia?k=<IA_KOMMO_CLAVE>
// con cuerpo JSON  { "message": "{{message_text}}", "lead_id": "{{lead.id}}" }
// y guarda la respuesta (ruta "data.reply") en el campo del lead IA_Respuesta.
// Esta función además escribe la segunda burbuja (CTA) en el campo IA_CTA
// por la API de Kommo. Luego el Salesbot manda las dos burbujas.
//
// Si la IA no debe contestar (lead fuera de la etapa PRUEBA IA, etiqueta
// "IA OFF", interruptor apagado) devuelve reply = "__PAUSA__" y el Salesbot
// debe detenerse con una condición sobre IA_Respuesta.
//
// ─── Variables de entorno (Netlify → Site configuration → Environment variables) ───
//   ANTHROPIC_API_KEY      obligatoria  clave de la API de Claude
//   IA_KOMMO_CLAVE         obligatoria  palabra secreta que va en ?k= del webhook
//   KOMMO_IA_SUBDOMINIO    obligatoria  "davidinteriano2023" (si falta usa KOMMO_SUBDOMINIO)
//   KOMMO_IA_TOKEN         obligatoria  token de larga duración de esa cuenta (si falta usa KOMMO_TOKEN)
//   KOMMO_CF_IA_CTA        obligatoria  id del campo del lead "IA_CTA"
//   KOMMO_CF_IA_MEMORIA    recomendada  id del campo del lead "IA_Memoria" (área de texto):
//                                       ahí se guarda la conversación para que la IA recuerde
//   IA_ETAPAS_IDS          recomendada  id(s) de la etapa PRUEBA IA, separados por coma
//   IA_TAG_PAUSA           opcional     por defecto "IA OFF"
//   IA_TAG_COMPRA          opcional     por defecto "IA COMPRA"
//   IA_ALERTAS_EMAIL       opcional     por defecto davidinteriano2023@gmail.com (varios con coma)
//   CLAUDE_MODEL           opcional     por defecto claude-sonnet-5-5
//   IA_ACTIVA              opcional     "false" apaga la IA en todos los chats
//   RESEND_API_KEY, RESEND_FROM_EMAIL, FIREBASE_*, FIRESTORE_SERVICE_* (ya existen)
//
// ─── Pruebas sin Kommo ───
//   GET  ...kommo-ia?k=<clave>                 → estado y tamaño del conocimiento
//   GET  ...kommo-ia?k=<clave>&probar=<texto>  → lo que respondería la IA

const { obtenerConocimiento, SITIO, WHATSAPP } = require('./ia-conocimiento.js');
const { instrucciones, HERRAMIENTA } = require('./ia-prompt.js');
const {
  enviarCorreoResend, escapeHtml, obtenerIdTokenServicio, FIRESTORE_BASE, FIREBASE_API_KEY
} = require('./reportes-common.js');

const PAUSA = '__PAUSA__';
const conf = (k, def) => String(process.env[k] || def || '').trim();

const MODELO = conf('CLAUDE_MODEL', 'claude-sonnet-5-5');
const TAG_PAUSA = conf('IA_TAG_PAUSA', 'IA OFF');
const TAG_COMPRA = conf('IA_TAG_COMPRA', 'IA COMPRA');
const SUB = () => conf('KOMMO_IA_SUBDOMINIO') || conf('KOMMO_SUBDOMINIO');
const TOKEN = () => conf('KOMMO_IA_TOKEN') || conf('KOMMO_TOKEN');
const ALERTAS = () => conf('IA_ALERTAS_EMAIL', 'davidinteriano2023@gmail.com')
  .split(',').map((s) => s.trim()).filter(Boolean);

const T_CLAUDE_MS = Number(conf('IA_TIMEOUT_MS', '7500'));
const T_KOMMO_MS = 3000;
const MAX_HISTORIAL = 20;

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const responder = (code, obj) => ({ statusCode: code, headers: HEADERS, body: JSON.stringify(obj) });

/** Formato que entiende el Salesbot: data.reply (y también reply en la raíz). */
function salida(reply, cta, extra) {
  return responder(200, Object.assign({ reply, cta, data: { reply, cta } }, extra || {}));
}

function conTimeout(promesa, ms, etiqueta) {
  let t;
  return Promise.race([
    promesa,
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout ' + etiqueta)), ms); })
  ]).finally(() => clearTimeout(t));
}

/* ─────────────── Kommo ─────────────── */

async function kommo(ruta, opciones) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), T_KOMMO_MS);
  try {
    const r = await fetch('https://' + SUB() + '.kommo.com/api/v4' + ruta, Object.assign({
      signal: ctrl.signal,
      headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' }
    }, opciones || {}));
    const texto = await r.text();
    let cuerpo = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch (_) { cuerpo = texto; }
    if (!r.ok) {
      const e = new Error('Kommo ' + r.status + ' en ' + ruta);
      e.detalle = cuerpo;
      throw e;
    }
    return cuerpo;
  } finally {
    clearTimeout(t);
  }
}

const kommoListo = () => Boolean(SUB() && TOKEN());

async function leerLead(leadId) {
  if (!kommoListo() || !leadId) return null;
  return kommo('/leads/' + leadId + '?with=contacts');
}

async function telefonoContacto(lead) {
  try {
    const cs = (lead && lead._embedded && lead._embedded.contacts) || [];
    const c = cs.find((x) => x.is_main) || cs[0];
    if (!c) return '';
    const contacto = await kommo('/contacts/' + c.id);
    const f = (contacto.custom_fields_values || []).find((x) => x.field_code === 'PHONE');
    return (f && f.values && f.values[0] && f.values[0].value) || '';
  } catch (_) {
    return '';
  }
}

async function actualizarLead(leadId, { cta, tags, memoria }) {
  if (!kommoListo() || !leadId) return;
  const cuerpo = {};
  const campos = [];
  const idCta = Number(conf('KOMMO_CF_IA_CTA'));
  const idMem = Number(conf('KOMMO_CF_IA_MEMORIA'));
  if (idCta && cta != null) campos.push({ field_id: idCta, values: [{ value: cta }] });
  if (idMem && memoria) campos.push({ field_id: idMem, values: [{ value: memoria }] });
  if (campos.length) cuerpo.custom_fields_values = campos;
  if (tags && tags.length) cuerpo.tags_to_add = tags.map((name) => ({ name }));
  if (!Object.keys(cuerpo).length) return;
  await kommo('/leads/' + leadId, { method: 'PATCH', body: JSON.stringify(cuerpo) });
}

async function notaLead(leadId, texto) {
  if (!kommoListo() || !leadId) return;
  await kommo('/leads/' + leadId + '/notes', {
    method: 'POST',
    body: JSON.stringify([{ note_type: 'common', params: { text: texto } }])
  });
}

/* ─────────────── Memoria de la conversación ───────────────
   Principal: campo de área de texto del lead "IA_Memoria" (KOMMO_CF_IA_MEMORIA).
   Respaldo: Firestore ia_chats/lead_<id> (si las reglas lo permiten). */

const MAX_MEMORIA = 9000; // caracteres guardados en el campo del lead

function memoriaDesdeLead(lead) {
  const id = Number(conf('KOMMO_CF_IA_MEMORIA'));
  if (!id || !lead) return null;
  const f = (lead.custom_fields_values || []).find((x) => Number(x.field_id) === id);
  const v = f && f.values && f.values[0] && f.values[0].value;
  if (!v) return { historial: [], estado: {} };
  try {
    const o = JSON.parse(v);
    return { historial: Array.isArray(o.h) ? o.h : [], estado: o.e || {} };
  } catch (_) {
    return { historial: [], estado: {} };
  }
}

function memoriaComoTexto(historial, estado) {
  let h = historial.slice(-MAX_HISTORIAL).map((m) => ({ r: m.r, t: String(m.t).slice(0, 1200) }));
  let s = JSON.stringify({ h, e: estado || {} });
  while (s.length > MAX_MEMORIA && h.length > 2) {
    h = h.slice(2);
    s = JSON.stringify({ h, e: estado || {} });
  }
  return s;
}

/* Respaldo en Firestore */

function urlChat(leadId) {
  return FIRESTORE_BASE + '/ia_chats/lead_' + encodeURIComponent(leadId) + '?key=' + FIREBASE_API_KEY;
}

async function cabecerasFs() {
  const tk = await obtenerIdTokenServicio().catch(() => null);
  return Object.assign({ 'Content-Type': 'application/json' }, tk ? { Authorization: 'Bearer ' + tk } : {});
}

async function leerChat(leadId) {
  const vacio = { historial: [], estado: {} };
  if (!leadId || !FIREBASE_API_KEY) return vacio;
  try {
    const r = await fetch(urlChat(leadId), { headers: await cabecerasFs() });
    if (!r.ok) return vacio;
    const d = await r.json();
    const f = d.fields || {};
    return {
      historial: JSON.parse((f.historial && f.historial.stringValue) || '[]'),
      estado: JSON.parse((f.estado && f.estado.stringValue) || '{}')
    };
  } catch (_) {
    return vacio;
  }
}

async function guardarChat(leadId, historial, estado) {
  if (!leadId || !FIREBASE_API_KEY) return;
  const fields = {
    historial: { stringValue: JSON.stringify(historial.slice(-MAX_HISTORIAL)) },
    estado: { stringValue: JSON.stringify(estado || {}) },
    actualizado: { timestampValue: new Date().toISOString() }
  };
  const r = await fetch(urlChat(leadId), {
    method: 'PATCH', headers: await cabecerasFs(), body: JSON.stringify({ fields })
  });
  if (!r.ok) console.error('No se guardó el historial', r.status, await r.text());
}

async function interruptorFirebase() {
  // config/ia_kommo { activo: false } apaga la IA sin tocar Netlify
  try {
    const r = await fetch(FIRESTORE_BASE + '/config/ia_kommo?key=' + FIREBASE_API_KEY, { headers: await cabecerasFs() });
    if (!r.ok) return true;
    const f = (await r.json()).fields || {};
    if (f.activo && typeof f.activo.booleanValue === 'boolean') return f.activo.booleanValue;
    return true;
  } catch (_) {
    return true;
  }
}

/* ─────────────── Claude ─────────────── */

function armarMensajes(historial, mensaje) {
  const lista = historial
    .filter((m) => m && (m.r === 'u' || m.r === 'a') && m.t)
    .map((m) => ({ role: m.r === 'u' ? 'user' : 'assistant', content: String(m.t).slice(0, 2000) }));
  lista.push({ role: 'user', content: mensaje });
  // La API pide que empiece con user y que se alternen los roles
  const out = [];
  for (const m of lista) {
    if (!out.length && m.role !== 'user') continue;
    const ult = out[out.length - 1];
    if (ult && ult.role === m.role) ult.content += '\n' + m.content;
    else out.push({ role: m.role, content: m.content });
  }
  return out;
}

async function preguntarAClaude(conocimiento, historial, mensaje) {
  const apiKey = conf('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY');

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), T_CLAUDE_MS);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 700,
        system: [
          { type: 'text', text: instrucciones({ whatsapp: WHATSAPP, sitio: SITIO }) },
          {
            type: 'text',
            text: '# CONOCIMIENTO ACTUAL DEL SITIO (actualizado ' +
              new Date(conocimiento.generado).toISOString() + ')\n\n' + conocimiento.texto,
            cache_control: { type: 'ephemeral' }
          }
        ],
        tools: [HERRAMIENTA],
        // Algunos modelos no aceptan forzar la herramienta: se deja en "auto"
        // y el prompt le pide usarla siempre. Si contesta en texto, se aprovecha.
        tool_choice: { type: 'auto' },
        messages: armarMensajes(historial, mensaje)
      })
    });
    const data = await r.json();
    if (!r.ok) {
      const e = new Error('Claude ' + r.status + ': ' + JSON.stringify(data).slice(0, 300));
      e.status = r.status;
      throw e;
    }
    const uso = (data.content || []).find((c) => c.type === 'tool_use' && c.name === HERRAMIENTA.name);
    if (uso && uso.input && uso.input.respuesta) return uso.input;

    // Respaldo: Claude contestó en texto libre
    const texto = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (!texto) throw new Error('Claude no devolvió respuesta');
    const json = texto.match(/\{[\s\S]*"respuesta"[\s\S]*\}/);
    if (json) {
      try {
        const o = JSON.parse(json[0]);
        if (o.respuesta) return o;
      } catch (_) { /* sigue abajo */ }
    }
    return { respuesta: texto.slice(0, 1000), cta: '', accion: 'conversar' };
  } finally {
    clearTimeout(t);
  }
}

/* ─────────────── Correos (Resend) ─────────────── */

function linkLead(leadId) {
  return SUB() && leadId ? 'https://' + SUB() + '.kommo.com/leads/detail/' + leadId : '';
}

function tablaHtml(filas) {
  return '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">' +
    filas.filter((f) => f[1]).map((f) =>
      '<tr><td style="color:#666;padding-right:14px"><b>' + escapeHtml(f[0]) + '</b></td><td>' + escapeHtml(f[1]) + '</td></tr>'
    ).join('') + '</table>';
}

function pieHtml(leadId, mensaje, r) {
  const link = linkLead(leadId);
  return '<p style="font-family:Arial,sans-serif;font-size:13px;color:#444"><b>Último mensaje del cliente:</b><br>' +
    escapeHtml(mensaje) + '</p>' +
    (r ? '<p style="font-family:Arial,sans-serif;font-size:13px;color:#444"><b>La IA respondió:</b><br>' +
      escapeHtml(r.respuesta) + '<br><i>' + escapeHtml(r.cta) + '</i></p>' : '') +
    (link ? '<p><a href="' + link + '" style="background:#0057C8;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">Abrir el lead en Kommo</a></p>' : '');
}

async function correoCompra({ leadId, lead, tel, r, mensaje }) {
  const d = r.datos_cliente || {};
  await enviarCorreoResend({
    to: ALERTAS(),
    subject: '🏍️ Compra en curso: ' + (d.modelo || 'Moto Vento') + ' — ' + (d.nombre || (lead && lead.name) || 'cliente de WhatsApp'),
    html: '<h2 style="font-family:Arial,sans-serif;color:#0057C8">🏍️ Cliente con intención de compra</h2>' +
      tablaHtml([
        ['Cliente', d.nombre || (lead && lead.name)],
        ['Teléfono', d.telefono || tel],
        ['Moto', d.modelo],
        ['Forma de pago', d.forma_pago],
        ['Qué quiere', d.comentario],
        ['Lead', leadId ? '#' + leadId : '']
      ]) + pieHtml(leadId, mensaje, r)
  });
}

async function correoAlerta({ titulo, leadId, lead, tel, r, mensaje, motivo }) {
  await enviarCorreoResend({
    to: ALERTAS(),
    subject: '⚠️ ' + titulo + ' — ' + ((lead && lead.name) || ('lead #' + (leadId || '?'))),
    html: '<h2 style="font-family:Arial,sans-serif;color:#b45309">⚠️ ' + escapeHtml(titulo) + '</h2>' +
      tablaHtml([
        ['Motivo', motivo],
        ['Cliente', lead && lead.name],
        ['Teléfono', tel],
        ['Lead', leadId ? '#' + leadId : '']
      ]) + pieHtml(leadId, mensaje, r)
  });
}

let ultimaFalla = 0;
async function correoFalla(error, leadId, mensaje) {
  if (Date.now() - ultimaFalla < 15 * 60 * 1000) return; // máximo uno cada 15 min por instancia
  ultimaFalla = Date.now();
  await enviarCorreoResend({
    to: ALERTAS(),
    subject: '🚨 La IA de Kommo tuvo una falla',
    html: '<h2 style="font-family:Arial,sans-serif;color:#dc2626">🚨 La IA de Kommo no pudo responder</h2>' +
      tablaHtml([['Error', String(error && error.message || error)], ['Lead', leadId ? '#' + leadId : '']]) +
      '<p style="font-family:Arial,sans-serif;font-size:13px">El cliente recibió un mensaje de espera. Revisá el chat y las variables de entorno en Netlify (ANTHROPIC_API_KEY, KOMMO_IA_TOKEN).</p>' +
      pieHtml(leadId, mensaje, null)
  });
}

/* ─────────────── Lógica principal ─────────────── */

function leerCuerpo(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (_) { /* puede venir como formulario */ }
  const p = new URLSearchParams(raw);
  const o = {};
  for (const [k, v] of p.entries()) o[k] = v;
  return o;
}

function etiquetas(lead) {
  return ((lead && lead._embedded && lead._embedded.tags) || []).map((t) => String(t.name || '').trim().toUpperCase());
}

function motivoPausa(lead) {
  if (conf('IA_ACTIVA').toLowerCase() === 'false') return 'IA apagada (IA_ACTIVA=false)';
  if (!lead) return '';
  if (etiquetas(lead).includes(TAG_PAUSA.toUpperCase())) return 'Lead con etiqueta ' + TAG_PAUSA;
  const etapas = conf('IA_ETAPAS_IDS').split(',').map((s) => s.trim()).filter(Boolean);
  if (etapas.length && !etapas.includes(String(lead.status_id))) return 'Lead fuera de la etapa de la IA (' + lead.status_id + ')';
  return '';
}

const RESPUESTA_ESPERA = {
  respuesta: '¡Gracias por escribirnos! 🙌 Dame un momento, un asesor te responde en breve por aquí mismo.',
  cta: '📲 También podés escribirnos al ' + WHATSAPP,
  accion: 'conversar'
};

exports.handler = async function (event) {
  const q = event.queryStringParameters || {};
  const clave = conf('IA_KOMMO_CLAVE');
  if (!clave || q.k !== clave) return responder(401, { error: 'No autorizado' });

  /* ── Pruebas desde el navegador ── */
  if (event.httpMethod === 'GET') {
    if (q.correo_prueba) {
      // Envía un correo de prueba y devuelve la respuesta exacta de Resend
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + conf('RESEND_API_KEY') },
          body: JSON.stringify({
            from: conf('RESEND_FROM_EMAIL', 'LIA Vento Barberena <onboarding@resend.dev>'),
            to: ALERTAS(),
            subject: '✅ Prueba: alertas de la IA de Kommo funcionando',
            html: '<p style="font-family:Arial,sans-serif">Si te llegó este correo, las alertas de compras, asesor y fallas de la IA de Kommo ya funcionan.</p>'
          })
        });
        return responder(200, { resend_status: r.status, resend: await r.text(), destinatarios: ALERTAS() });
      } catch (e) {
        return responder(500, { error: e.message });
      }
    }
    try {
      const c = await obtenerConocimiento();
      if (q.probar) {
        const r = await preguntarAClaude(c, [], String(q.probar).slice(0, 1000));
        return responder(200, { modelo: MODELO, prueba: q.probar, resultado: r });
      }
      return responder(200, {
        ok: true, modelo: MODELO, sitio: SITIO, kommo: kommoListo() ? SUB() : 'sin configurar',
        conocimiento_caracteres: c.texto.length, conocimiento_actualizado: new Date(c.generado).toISOString(),
        claude: conf('ANTHROPIC_API_KEY') ? 'configurado' : 'FALTA ANTHROPIC_API_KEY',
        resend: conf('RESEND_API_KEY') ? 'configurado' : 'FALTA RESEND_API_KEY'
      });
    } catch (e) {
      return responder(500, { ok: false, error: e.message });
    }
  }
  if (event.httpMethod !== 'POST') return responder(405, { error: 'Método no permitido' });

  const b = leerCuerpo(event);
  const leadId = String(b.lead_id || b.leadId || (b.lead && b.lead.id) || '').replace(/\D/g, '');
  let mensaje = String(b.message || b.mensaje || b.message_text || '').trim().slice(0, 2000);
  if (!mensaje || /^\{\{.*\}\}$/.test(mensaje)) {
    mensaje = '[El cliente envió una foto, audio, sticker o archivo sin texto]';
  }

  // Lead, conocimiento, historial e interruptor en paralelo
  const [leadR, conR, chatR, swR] = await Promise.allSettled([
    conTimeout(leerLead(leadId), T_KOMMO_MS, 'lead'),
    obtenerConocimiento(),
    conTimeout(leerChat(leadId), 2500, 'historial'),
    conTimeout(interruptorFirebase(), 2000, 'interruptor')
  ]);
  const lead = leadR.status === 'fulfilled' ? leadR.value : null;
  if (leadR.status === 'rejected') console.error('No pude leer el lead', leadR.reason && leadR.reason.message);
  const chat = memoriaDesdeLead(lead) ||
    (chatR.status === 'fulfilled' ? chatR.value : { historial: [], estado: {} });
  const activoFb = swR.status === 'fulfilled' ? swR.value : true;

  const pausa = !activoFb ? 'IA apagada en Firebase (config/ia_kommo)' : motivoPausa(lead);
  if (pausa) {
    console.log('Pausa lead ' + leadId + ': ' + pausa);
    return salida(PAUSA, PAUSA, { pausa });
  }

  let r;
  let fallo = null;
  try {
    if (conR.status === 'rejected') throw conR.reason;
    r = await preguntarAClaude(conR.value, chat.historial, mensaje);
  } catch (e) {
    fallo = e;
    console.error('Falla IA:', e.message);
    r = Object.assign({}, RESPUESTA_ESPERA);
  }

  const respuesta = String(r.respuesta || '').trim() || RESPUESTA_ESPERA.respuesta;
  const cta = String(r.cta || '').trim() || ('🏍️ Mirá todos los modelos y precios: ' + SITIO + '/motos/');
  r.respuesta = respuesta;
  r.cta = cta;

  /* ── Efectos: campo CTA, etiquetas, notas, correos, historial ── */
  const estado = Object.assign({}, chat.estado);
  const tags = [];
  const tareas = [];
  const necesitaTel = !fallo && (r.accion === 'compra' || r.accion === 'asesor' || r.accion === 'sin_informacion');
  const tel = necesitaTel && lead ? await conTimeout(telefonoContacto(lead), 1500, 'tel').catch(() => '') : '';

  if (fallo) {
    tareas.push(correoFalla(fallo, leadId, mensaje));
  } else if (r.accion === 'compra') {
    tags.push(TAG_COMPRA);
    const firma = JSON.stringify(r.datos_cliente || {});
    if (estado.compraNotificada !== firma) {
      estado.compraNotificada = firma;
      tareas.push(correoCompra({ leadId, lead, tel, r, mensaje }));
      const d = r.datos_cliente || {};
      tareas.push(notaLead(leadId, '🤖 IA: intención de compra\nMoto: ' + (d.modelo || '—') +
        '\nForma de pago: ' + (d.forma_pago || '—') + '\nNombre: ' + (d.nombre || '—') +
        '\nTel: ' + (d.telefono || tel || '—') + '\n' + (d.comentario || '')));
    }
  } else if (r.accion === 'asesor') {
    tags.push(TAG_PAUSA);
    tareas.push(correoAlerta({ titulo: 'Cliente pide un asesor', leadId, lead, tel, r, mensaje, motivo: r.motivo }));
    tareas.push(notaLead(leadId, '🤖 IA pausada: el cliente necesita un asesor.\nMotivo: ' + (r.motivo || '—') +
      '\nPara reactivar la IA quitá la etiqueta "' + TAG_PAUSA + '".'));
  } else if (r.accion === 'sin_informacion') {
    const hace = Date.now() - Number(estado.ultimaSinInfo || 0);
    if (hace > 60 * 60 * 1000) {
      estado.ultimaSinInfo = Date.now();
      tareas.push(correoAlerta({ titulo: 'La IA no tenía la información', leadId, lead, tel, r, mensaje, motivo: r.motivo }));
    }
  }

  const historial = chat.historial.concat([
    { r: 'u', t: mensaje },
    { r: 'a', t: respuesta + '\n' + cta }
  ]);
  const usaCampo = Boolean(Number(conf('KOMMO_CF_IA_MEMORIA')));
  tareas.push(actualizarLead(leadId, {
    cta, tags, memoria: usaCampo ? memoriaComoTexto(historial, estado) : null
  }));
  if (!usaCampo) tareas.push(guardarChat(leadId, historial, estado));

  const res = await conTimeout(Promise.allSettled(tareas), 2500, 'tareas').catch(() => []);
  (res || []).forEach((x) => { if (x.status === 'rejected') console.error('Tarea falló:', x.reason && x.reason.message); });

  return salida(respuesta, cta, { accion: r.accion || 'conversar' });
};
