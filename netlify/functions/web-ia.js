// netlify/functions/web-ia.js
//
// Sofía en la PÁGINA WEB (chat flotante tabi-widget.js).
// Usa la MISMA base de conocimiento en vivo (ia-conocimiento.js: sitio + precios
// de Firebase al instante) y la MISMA personalidad y proceso de venta
// (ia-prompt.js) que la IA de Kommo.
//
// Diferencias con Kommo:
//   - El historial lo guarda el navegador del cliente y lo manda en cada mensaje.
//   - Como no hay WhatsApp, Sofía pide el teléfono.
//   - Cuando un cliente de efectivo o tarjeta completa sus datos, se CREA el lead
//     en Kommo (etapa IA_WEB_ETAPA_ID, por defecto "Leads Entrantes") con sus
//     datos y etiquetas. Si compra en ≤ 15 días, se avisa por correo/WhatsApp.
//
// Variables de entorno (las mismas de kommo-ia + opcionales):
//   ANTHROPIC_API_KEY, KOMMO_IA_SUBDOMINIO, KOMMO_IA_TOKEN (o KOMMO_TOKEN),
//   IA_ALERTAS_EMAIL, RESEND_API_KEY, CALLMEBOT_PHONE/APIKEY (opcional)
//   IA_WEB_ETAPA_ID     opcional  etapa donde se crean los leads web (108147027 = Leads Entrantes)
//   IA_WEB_PIPELINE_ID  opcional  embudo (14011683)
//   IA_WEB_ACTIVA       opcional  "false" apaga el chat de la web

const { obtenerConocimiento, SITIO, WHATSAPP } = require('./ia-conocimiento.js');
const { instrucciones, HERRAMIENTA } = require('./ia-prompt.js');
const { enviarCorreoResend, escapeHtml, filtrarDestinatarios } = require('./reportes-common.js');

const crypto = require('crypto');
const conf = (k, def) => String(process.env[k] || def || '').trim();

/* El estado (leadId) viaja en el navegador: se firma para que nadie pueda
   cambiar el número y tocar leads ajenos. */
function firmar(leadId) {
  return crypto.createHmac('sha256', conf('IA_KOMMO_CLAVE', 'vento-web')).update('lead:' + leadId).digest('hex').slice(0, 32);
}
function estadoValido(e) {
  const out = { firma: typeof e.firma === 'string' ? e.firma.slice(0, 4000) : '', avisado: Boolean(e.avisado) };
  if (e.leadId && e.sig && firmar(e.leadId) === e.sig) { out.leadId = Number(e.leadId); out.sig = e.sig; }
  return out;
}
const MODELO = conf('CLAUDE_MODEL', 'claude-sonnet-5-5');
const ASESOR_NOMBRE = conf('IA_ASESOR_NOMBRE', 'David Interiano');
const ASESOR_TEL = conf('IA_ASESOR_TEL', '3182-3625');
const DIAS_URGENTE = Number(conf('IA_DIAS_URGENTE', '15'));
const ETAPA_WEB = Number(conf('IA_WEB_ETAPA_ID', '108147027'));
const EMBUDO_WEB = Number(conf('IA_WEB_PIPELINE_ID', '14011683'));
const SUB = () => conf('KOMMO_IA_SUBDOMINIO') || conf('KOMMO_SUBDOMINIO');
const TOKEN = () => conf('KOMMO_IA_TOKEN') || conf('KOMMO_TOKEN');
const ALERTAS = () => conf('IA_ALERTAS_EMAIL', 'davidinteriano2023@gmail.com').split(',').map((s) => s.trim()).filter(Boolean);

const CAMPOS_CRM = Object.assign({
  nombre: 685792, modelo: 685844, telefono: 685976,
  forma_pago: 2102247, fecha_compra: 2102249, tarjeta: 2102251, cuotas: 2102253
}, (() => { try { return JSON.parse(process.env.IA_CAMPOS_CRM || '{}'); } catch (_) { return {}; } })());

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const responder = (code, obj) => ({ statusCode: code, headers: HEADERS, body: JSON.stringify(obj) });

const conTimeout = (p, ms, et) => {
  let t;
  return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout ' + et)), ms); })])
    .finally(() => clearTimeout(t));
};

function hoyGuatemala() {
  const d = new Date(Date.now() - 6 * 3600 * 1000);
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return dias.at(d.getUTCDay()) + ' ' + d.toISOString().slice(0, 10);
}

const CANAL_WEB = `# CANAL: PÁGINA WEB (no WhatsApp)
- El cliente te escribe desde el chat de la página ${SITIO}. El saludo ya se le mostró: NO te volvás a presentar ni pidás el nombre al inicio; respondé directo lo que pregunte.
- Ignorá todo lo que diga "este mismo WhatsApp" o "este número": aquí NO tenés su teléfono. En efectivo o tarjeta pedí su NOMBRE y su NÚMERO DE TELÉFONO (8 dígitos) como parte de los datos.
- Las negritas van con UN asterisco (*palabra*). Los enlaces escribilos completos (https://...) para que se puedan tocar.
- En "opciones" dale de 2 a 4 respuestas rápidas que tengan sentido para su siguiente paso (ej. "Financiamiento", "Pago de contado", "Tarjeta de crédito", "Ver ubicación"). Si estás pidiendo un dato libre (nombre, teléfono), dejá "opciones" vacío.
- FOTOS: la página puede mostrar una TARJETA con la foto, precio y cuota de cada moto. Cuando el cliente pida fotos o ver una moto, poné el nombre exacto en "motos" y en la respuesta decí algo como "¡Mirala aquí!" — NO mandés el enlace de la página de la moto para que vea fotos. Si recomendás 2 o 3 motos, ponelas también en "motos".
- No repitás en el texto el precio y la cuota que ya muestra la tarjeta; usá el texto para el beneficio o la recomendación.
- Si prefiere seguir por WhatsApp, dale el ${WHATSAPP}.`;

/* ─────────────── Límite simple por IP (evita abuso y gasto) ─────────────── */
const visitas = new Map();
function permitido(ip) {
  const ahora = Date.now(), ventana = 10 * 60 * 1000, max = Number(conf('IA_WEB_MAX_10MIN', '40'));
  const lista = (visitas.get(ip) || []).filter((t) => ahora - t < ventana);
  lista.push(ahora);
  visitas.set(ip, lista);
  if (visitas.size > 5000) visitas.clear();
  return lista.length <= max;
}

/* ─────────────── Claude ─────────────── */
async function preguntarAClaude(conocimiento, historial, mensaje) {
  const apiKey = conf('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Falta ANTHROPIC_API_KEY');
  const lista = historial.concat([{ role: 'user', content: mensaje }]);
  const msgs = [];
  for (const m of lista) {
    if (!msgs.length && m.role !== 'user') continue;
    const ult = msgs[msgs.length - 1];
    if (ult && ult.role === m.role) ult.content += '\n' + m.content;
    else msgs.push({ role: m.role, content: m.content });
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 700,
        system: [
          { type: 'text', text: instrucciones({ whatsapp: WHATSAPP, sitio: SITIO, hoy: hoyGuatemala(), asesorNombre: ASESOR_NOMBRE, asesorTel: ASESOR_TEL }) },
          { type: 'text', text: '# CONOCIMIENTO ACTUAL DEL SITIO (actualizado ' + new Date(conocimiento.generado).toISOString() + ')\n\n' + conocimiento.texto, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: CANAL_WEB }
        ],
        tools: [HERRAMIENTA],
        tool_choice: { type: 'auto' },
        messages: msgs
      })
    });
    const data = await r.json();
    if (!r.ok) throw new Error('Claude ' + r.status + ': ' + JSON.stringify(data).slice(0, 300));
    const uso = (data.content || []).find((c) => c.type === 'tool_use' && c.name === HERRAMIENTA.name);
    if (uso && uso.input && uso.input.respuesta) return uso.input;
    const texto = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n').trim();
    if (!texto) throw new Error('Claude no devolvió respuesta');
    return { respuesta: texto.slice(0, 1000), cta: '', accion: 'conversar' };
  } finally {
    clearTimeout(t);
  }
}

/* ─────────────── Kommo ─────────────── */
async function kommo(ruta, opciones) {
  const r = await conTimeout(fetch('https://' + SUB() + '.kommo.com/api/v4' + ruta, Object.assign({
    headers: { Authorization: 'Bearer ' + TOKEN(), 'Content-Type': 'application/json' }
  }, opciones || {})), 4000, 'kommo');
  const texto = await r.text();
  let cuerpo = null;
  try { cuerpo = texto ? JSON.parse(texto) : null; } catch (_) { cuerpo = texto; }
  if (!r.ok) throw new Error('Kommo ' + r.status + ' en ' + ruta + ': ' + texto.slice(0, 200));
  return cuerpo;
}

function telefonoGT(t) {
  const d = String(t || '').replace(/\D/g, '');
  if (d.length === 8) return '+502' + d;
  if (d.length === 11 && d.startsWith('502')) return '+' + d;
  return d ? '+' + d : '';
}

function camposCrm(d) {
  const out = [];
  Object.keys(CAMPOS_CRM).forEach((k) => {
    let v = d[k];
    if (k === 'forma_pago' && v === 'no_definido') v = '';
    v = String(v == null ? '' : v).trim();
    if (Number(CAMPOS_CRM[k]) && v) out.push({ field_id: Number(CAMPOS_CRM[k]), values: [{ value: v.slice(0, 250) }] });
  });
  return out;
}

async function guardarLead(leadId, d, dias) {
  if (!SUB() || !TOKEN()) return null;
  const etiquetas = ['WEB SOFIA'];
  if (d.forma_pago === 'efectivo') etiquetas.push('IA EFECTIVO');
  if (d.forma_pago === 'tarjeta') etiquetas.push('IA TARJETA');
  if (Number.isFinite(dias) && dias <= DIAS_URGENTE) etiquetas.push('COMPRA ' + DIAS_URGENTE + ' DIAS');
  if (leadId) {
    await kommo('/leads/' + leadId, {
      method: 'PATCH',
      body: JSON.stringify({ custom_fields_values: camposCrm(d), tags_to_add: etiquetas.map((name) => ({ name })) })
    });
    return Number(leadId);
  }
  const tel = telefonoGT(d.telefono);
  const lead = {
    name: 'Web Sofía — ' + (d.nombre || 'Cliente') + (d.modelo ? ' — ' + d.modelo : ''),
    pipeline_id: EMBUDO_WEB,
    status_id: ETAPA_WEB,
    custom_fields_values: camposCrm(Object.assign({}, d, { telefono: tel || d.telefono })),
    _embedded: {
      tags: etiquetas.map((name) => ({ name })),
      contacts: [{
        first_name: d.nombre || 'Cliente web',
        custom_fields_values: tel ? [{ field_code: 'PHONE', values: [{ enum_code: 'WORK', value: tel }] }] : []
      }]
    }
  };
  const res = await kommo('/leads/complex', { method: 'POST', body: JSON.stringify([lead]) });
  const id = res && res[0] && res[0].id;
  if (id) {
    await kommo('/leads/' + id + '/notes', {
      method: 'POST',
      body: JSON.stringify([{ note_type: 'common', params: { text: '🤖 Lead creado por Sofía (chat de la página web)\nMoto: ' + (d.modelo || '—') +
        '\nPago: ' + (d.forma_pago || '—') + (d.tarjeta ? ' · ' + d.tarjeta : '') + (d.cuotas ? ' · ' + d.cuotas + ' cuotas' : '') +
        '\nCuándo: ' + (d.fecha_compra || '—') + '\nTel: ' + (tel || d.telefono || '—') + '\n' + (d.comentario || '') } }])
    }).catch(() => {});
  }
  return id || null;
}

/* ─────────────── Avisos ─────────────── */
async function avisarVendedor(d, leadId, dias) {
  const link = SUB() && leadId ? 'https://' + SUB() + '.kommo.com/leads/detail/' + leadId : '';
  const filas = [['Cliente', d.nombre], ['Teléfono', d.telefono], ['Moto', d.modelo], ['Forma de pago', d.forma_pago],
    ['Cuándo compra', d.fecha_compra], ['Tarjeta', d.tarjeta], ['Cuotas', d.cuotas], ['Qué quiere', d.comentario]]
    .filter((f) => f[1]).map((f) => '<tr><td style="color:#666;padding-right:14px"><b>' + escapeHtml(f[0]) + '</b></td><td>' + escapeHtml(f[1]) + '</td></tr>').join('');
  await enviarCorreoResend({
    to: filtrarDestinatarios(ALERTAS()),
    subject: '🏍️ (Web) Compra en ' + (dias <= 0 ? 'HOY' : dias + ' días') + ' (' + (d.forma_pago || '—') + '): ' + (d.modelo || 'Moto Vento') + ' — ' + (d.nombre || 'cliente web'),
    html: '<h2 style="font-family:Arial,sans-serif;color:#0057C8">🏍️ Cliente de la página web listo para comprar — contactar desde el ' + escapeHtml(ASESOR_TEL) + '</h2>' +
      '<table cellpadding="6" style="font-family:Arial,sans-serif;font-size:14px">' + filas + '</table>' +
      (link ? '<p><a href="' + link + '" style="background:#0057C8;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-family:Arial,sans-serif">Abrir el lead en Kommo</a></p>' : '')
  });
  const phones = conf('CALLMEBOT_PHONE').split(',').map((s) => s.trim()).filter(Boolean);
  const keys = conf('CALLMEBOT_APIKEY').split(',').map((s) => s.trim()).filter(Boolean);
  if (phones.length && keys.length) {
    const texto = '🏍️ (WEB) COMPRA EN ' + (dias <= 0 ? 'HOY' : dias + ' DÍAS') + ' (' + d.forma_pago + ')\nCliente: ' + (d.nombre || '—') +
      '\nTel: ' + (d.telefono || '—') + '\nMoto: ' + (d.modelo || '—') + '\nCuándo: ' + (d.fecha_compra || '—') + '\n' + link;
    await Promise.allSettled(phones.map((ph, i) => conTimeout(fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(ph) +
      '&text=' + encodeURIComponent(texto) + '&apikey=' + encodeURIComponent(keys.at(i) || keys.at(0))), 2000, 'callmebot')));
  }
}

/* ─────────────── Handler ─────────────── */
exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return responder(405, { error: 'Método no permitido' });
  if (conf('IA_WEB_ACTIVA').toLowerCase() === 'false') {
    return responder(200, { respuesta: 'En este momento el chat no está disponible. Escribinos por WhatsApp al ' + WHATSAPP + '.', cta: '', opciones: [] });
  }

  const ip = (event.headers && (event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'])) || 'x';
  if (!permitido(String(ip).split(',')[0])) {
    return responder(429, { respuesta: 'Recibimos muchos mensajes seguidos. Escribinos por WhatsApp al ' + WHATSAPP + ' y te atendemos de inmediato.', cta: '', opciones: [] });
  }

  let b;
  try { b = JSON.parse(event.body || '{}'); } catch (_) { return responder(400, { error: 'JSON inválido' }); }
  const mensaje = String(b.message || '').trim().slice(0, 1000);
  if (!mensaje) return responder(400, { error: 'Falta el mensaje' });
  const historial = (Array.isArray(b.history) ? b.history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-20).map((m) => ({ role: m.role, content: m.content.slice(0, 1500) }));
  const estado = estadoValido((b.estado && typeof b.estado === 'object') ? b.estado : {});

  let r, conocimiento;
  try {
    conocimiento = await obtenerConocimiento();
    r = await preguntarAClaude(conocimiento, historial, mensaje);
  } catch (e) {
    console.error('Falla IA web:', e.message);
    return responder(200, {
      respuesta: 'Se me trabó la conexión un momento. Escribinos por WhatsApp al *' + WHATSAPP + '* y te atendemos de inmediato.',
      cta: '', opciones: [], estado
    });
  }

  const d = r.datos_cliente || {};
  const dias = Number(d.dias_para_compra);
  const contadoOTarjeta = d.forma_pago === 'efectivo' || d.forma_pago === 'tarjeta';

  // Crear o actualizar el lead en Kommo cuando ya hay datos de compra (efectivo o tarjeta)
  if (contadoOTarjeta && d.nombre && d.telefono && (r.accion === 'compra' || estado.leadId)) {
    const firma = JSON.stringify(d);
    if (estado.firma !== firma) {
      try {
        const id = await guardarLead(estado.leadId, d, dias);
        if (id) { estado.leadId = id; estado.sig = firmar(id); }
        estado.firma = firma;
      } catch (e) {
        console.error('No se pudo guardar el lead web:', e.message);
      }
    }
    if (r.accion === 'compra' && Number.isFinite(dias) && dias <= DIAS_URGENTE && !estado.avisado) {
      estado.avisado = true;
      await conTimeout(avisarVendedor(d, estado.leadId, dias), 4000, 'aviso').catch((e) => console.error('Aviso web:', e.message));
    }
  }

  // Tarjetas con foto: se buscan en el catálogo en vivo (precio y foto actuales)
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^vento\s+/, '').replace(/\s+20\d\d$/, '').trim();
  const catalogo = (conocimiento && conocimiento.catalogo) || [];
  const tarjetas = [];
  (Array.isArray(r.motos) ? r.motos : []).slice(0, 3).forEach((n) => {
    const q = norm(n);
    const m = catalogo.find((x) => norm(x.nombre) === q) || catalogo.find((x) => norm(x.nombre).includes(q) || q.includes(norm(x.nombre)));
    if (m && !tarjetas.some((t) => t.id === m.id)) tarjetas.push(m);
  });
  const opciones = Array.isArray(r.opciones) ? r.opciones.map((o) => String(o).slice(0, 30)).filter(Boolean).slice(0, 4) : [];
  return responder(200, {
    respuesta: String(r.respuesta || '').trim(),
    cta: String(r.cta || '').trim(),
    opciones,
    tarjetas,
    accion: r.accion || 'conversar',
    estado
  });
};
