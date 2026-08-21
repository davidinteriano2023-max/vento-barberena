// netlify/functions/kommo-precalificacion.js
//
// Recibe el formulario de /precalificar/ y crea el lead en Kommo directamente
// en la etapa de PRECALIFICACIÓN, con el teléfono del cliente para que cuando
// escriba por WhatsApp se una a ese mismo lead en vez de crear uno nuevo.
//
// ─── Variables de entorno (Netlify → Site settings → Environment variables) ───
//   KOMMO_SUBDOMINIO     obligatoria   ej. "emotoinversiones"  (sin .kommo.com)
//   KOMMO_TOKEN          obligatoria   token de larga duración
//   KOMMO_STATUS_ID      obligatoria   id de la etapa PRECALIFICACIÓN
//   KOMMO_PIPELINE_ID    opcional      id del embudo
//   KOMMO_ETIQUETAS      opcional      por defecto "PRECALIFICACION WEB"
//   KOMMO_CF_DPI         opcional      id del campo personalizado DPI
//   KOMMO_CF_NACIMIENTO  opcional      id del campo Fecha de nacimiento
//   KOMMO_CF_TRABAJO     opcional      id del campo Ocupación
//   KOMMO_CF_TIEMPO      opcional      id del campo Tiempo laborando
//   KOMMO_CF_DOCS        opcional      id del campo Documentos
//   KOMMO_CF_MOTO        opcional      id del campo Moto de interés
//   KOMMO_DESCUBRIR_CLAVE opcional     habilita el modo descubrir (ver abajo)
//
// ─── Modo descubrir ───
// Para no andar buscando los ids a mano: poné KOMMO_DESCUBRIR_CLAVE con una
// palabra cualquiera y entrá a
//   https://ventobarberena.com/.netlify/functions/kommo-precalificacion?descubrir=<esa palabra>
// Te devuelve los embudos, sus etapas y los campos personalizados con sus ids.
// Cuando termines de configurar, borrá esa variable para cerrar el acceso.

const TIMEOUT_MS = 8000;

/* ─────────────── Utilidades ─────────────── */

const conf = (k, def) => (process.env[k] || def || '').trim();

function api(ruta) {
  return 'https://' + conf('KOMMO_SUBDOMINIO') + '.kommo.com/api/v4' + ruta;
}

async function kommo(ruta, opciones) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(api(ruta), Object.assign({
      signal: ctrl.signal,
      headers: {
        'Authorization': 'Bearer ' + conf('KOMMO_TOKEN'),
        'Content-Type': 'application/json'
      }
    }, opciones || {}));
    const texto = await r.text();
    let cuerpo = null;
    try { cuerpo = texto ? JSON.parse(texto) : null; } catch (_) { cuerpo = texto; }
    if (!r.ok) {
      const e = new Error('Kommo ' + r.status + ' en ' + ruta);
      e.status = r.status;
      e.detalle = cuerpo;
      throw e;
    }
    return cuerpo;
  } finally {
    clearTimeout(t);
  }
}

/** Deja el teléfono en formato internacional de Guatemala: +502XXXXXXXX */
function normalizarTel(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 8) return '+502' + d;
  if (d.length === 11 && d.startsWith('502')) return '+' + d;
  return '+' + d;
}

/** Kommo guarda las fechas como timestamp en segundos (mediodía UTC para
    que no se corra de día por la zona horaria). */
function aTimestamp(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const [a, m, d] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(a, m - 1, d, 12, 0, 0) / 1000);
}

function campo(idEnv, valor, tipo) {
  const id = conf(idEnv);
  if (!id || valor === '' || valor === null || valor === undefined) return null;
  return {
    field_id: Number(id),
    values: [{ value: tipo === 'fecha' ? Number(valor) : String(valor) }]
  };
}

const responder = (code, obj) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(obj)
});

/* ─────────────── Modo descubrir ─────────────── */

async function descubrir() {
  const [embudos, cfLeads, cfContactos] = await Promise.all([
    kommo('/leads/pipelines'),
    kommo('/leads/custom_fields?limit=250'),
    kommo('/contacts/custom_fields?limit=250')
  ]);

  const pipelines = ((embudos && embudos._embedded && embudos._embedded.pipelines) || []).map((p) => ({
    KOMMO_PIPELINE_ID: p.id,
    embudo: p.name,
    etapas: ((p._embedded && p._embedded.statuses) || []).map((s) => ({
      KOMMO_STATUS_ID: s.id, etapa: s.name
    }))
  }));

  const listar = (r) => ((r && r._embedded && r._embedded.custom_fields) || [])
    .map((c) => ({ id: c.id, nombre: c.name, tipo: c.type }));

  return {
    _instrucciones: 'Copiá el KOMMO_STATUS_ID de la etapa PRECALIFICACIÓN y los ids de los campos que quieras llenar. Después borrá la variable KOMMO_DESCUBRIR_CLAVE.',
    embudos: pipelines,
    campos_de_lead: listar(cfLeads),
    campos_de_contacto: listar(cfContactos)
  };
}

/* ─────────────── Crear las celdas dinámicas ─────────────── */
// Grupo "PRECALIFICACION" con un campo por cada dato del formulario.
// Se llama una sola vez desde ?crearcampos=<clave>

const CAMPOS = [
  { env: 'KOMMO_CF_TELEFONO',   name: 'WhatsApp',            type: 'text' },
  { env: 'KOMMO_CF_DPI',        name: 'DPI',                 type: 'text' },
  { env: 'KOMMO_CF_NACIMIENTO', name: 'Fecha de nacimiento', type: 'date' },
  { env: 'KOMMO_CF_EDAD',       name: 'Edad',                type: 'numeric' },
  { env: 'KOMMO_CF_TRABAJO',    name: 'De qué trabaja',      type: 'text' },
  { env: 'KOMMO_CF_TIEMPO',     name: 'Tiempo trabajando',   type: 'text' },
  {
    env: 'KOMMO_CF_DOCS', name: 'Documentos que presenta', type: 'select',
    enums: ['Carta laboral', 'Estados de cuenta', 'Carta laboral y estados de cuenta', 'Otros', 'Ninguno de los dos']
  },
  { env: 'KOMMO_CF_MOTO',       name: 'Moto de interés',     type: 'text' },
  { env: 'KOMMO_CF_ENVIADO',    name: 'Precalificación enviada', type: 'date_time' }
];

async function crearCampos() {
  // 1. El grupo (la "pestaña" PRECALIFICACION en la tarjeta del lead).
  //    Si el plan de Kommo no permite grupos, seguimos sin él: los campos se
  //    crean igual y caen en la sección por defecto.
  let grupoId = null;
  let avisoGrupo = null;
  const RUTA_GRUPOS = '/leads/custom_fields/groups';

  try {
    const grupos = await kommo(RUTA_GRUPOS);
    const lista = (grupos && grupos._embedded &&
                  (grupos._embedded.custom_field_groups || grupos._embedded.groups)) || [];
    const existente = lista.find((g) =>
      String(g.name).toUpperCase().replace('Ó', 'O').indexOf('PRECALIFICACION') >= 0);

    if (existente) {
      grupoId = existente.id;
    } else {
      const creado = await kommo(RUTA_GRUPOS, {
        method: 'POST', body: JSON.stringify([{ name: 'PRECALIFICACION' }])
      });
      const g = creado && creado._embedded &&
                (creado._embedded.custom_field_groups || creado._embedded.groups);
      grupoId = g && g[0] ? g[0].id : null;
    }
  } catch (e) {
    avisoGrupo = 'No se pudo crear el grupo (' + e.message + '). Los campos se crean igual, sin agrupar.';
    console.warn('[kommo] ' + avisoGrupo);
  }

  // 2. Los campos que todavía no existan
  const actuales = await kommo('/leads/custom_fields?limit=250');
  const yaHay = new Map(((actuales && actuales._embedded && actuales._embedded.custom_fields) || [])
    .map((c) => [String(c.name).trim().toLowerCase(), c.id]));

  const porCrear = CAMPOS.filter((c) => !yaHay.has(c.name.toLowerCase()));
  let nuevos = [];
  if (porCrear.length) {
    const payload = porCrear.map((c) => {
      const o = { name: c.name, type: c.type };
      if (grupoId) o.group_id = grupoId;
      if (c.enums) o.enums = c.enums.map((v, i) => ({ value: v, sort: i + 1 }));
      return o;
    });
    const r = await kommo('/leads/custom_fields', { method: 'POST', body: JSON.stringify(payload) });
    nuevos = (r && r._embedded && r._embedded.custom_fields) || [];
    nuevos.forEach((c) => yaHay.set(String(c.name).trim().toLowerCase(), c.id));
  }

  // 3. Devolvemos las variables listas para copiar y pegar en Netlify
  const variables = {};
  CAMPOS.forEach((c) => {
    const id = yaHay.get(c.name.toLowerCase());
    if (id) variables[c.env] = String(id);
  });

  return {
    _instrucciones: 'Copiá estas variables en Netlify → Environment variables. Después borrá KOMMO_DESCUBRIR_CLAVE.',
    _aviso: avisoGrupo || undefined,
    grupo: { id: grupoId, nombre: grupoId ? 'PRECALIFICACION' : '(sin agrupar)' },
    campos_creados: nuevos.map((c) => c.name),
    campos_que_ya_existían: CAMPOS.filter((c) => !nuevos.some((n) => n.name === c.name)).map((c) => c.name),
    variables_para_netlify: variables
  };
}

/* ─────────────── Actualizar un lead que ya existe ─────────────── */

async function actualizarLead(leadId, d, camposLead, etiquetas, nota) {
  const cambios = { status_id: Number(conf('KOMMO_STATUS_ID')) };
  if (conf('KOMMO_PIPELINE_ID')) cambios.pipeline_id = Number(conf('KOMMO_PIPELINE_ID'));
  if (camposLead.length) cambios.custom_fields_values = camposLead;
  if (etiquetas.length) cambios._embedded = { tags: etiquetas };

  await kommo('/leads/' + leadId, { method: 'PATCH', body: JSON.stringify(cambios) });

  try {
    await kommo('/leads/' + leadId + '/notes', {
      method: 'POST', body: JSON.stringify([{ note_type: 'common', params: { text: nota } }])
    });
  } catch (e) {
    console.warn('[kommo] lead actualizado pero la nota falló', e.message);
  }
  return leadId;
}

/* ─────────────── Crear el lead ─────────────── */

async function procesar(d) {
  const nombre = String(d.nombre || '').trim();
  const tel = normalizarTel(d.telefono);

  const camposLead = [
    campo('KOMMO_CF_TELEFONO', tel),
    campo('KOMMO_CF_DPI', d.dpi),
    campo('KOMMO_CF_NACIMIENTO', aTimestamp(d.nacimiento), 'fecha'),
    campo('KOMMO_CF_EDAD', d.edad),
    campo('KOMMO_CF_TRABAJO', d.trabajo),
    campo('KOMMO_CF_TIEMPO', d.tiempo),
    campo('KOMMO_CF_DOCS', d.documentos),
    campo('KOMMO_CF_MOTO', d.moto),
    campo('KOMMO_CF_ENVIADO', Math.floor(Date.now() / 1000), 'fecha')
  ].filter(Boolean);

  // Todo lo que no tenga campo personalizado configurado va como nota, así no
  // se pierde ningún dato aunque falten ids.
  const nota = [
    'PRECALIFICACIÓN DESDE LA WEB',
    '',
    'Nombre: ' + nombre,
    'Teléfono: ' + (tel || '(no indicado)'),
    'DPI: ' + (d.dpi || '—'),
    'Fecha de nacimiento: ' + (d.nacimientoTexto || d.nacimiento || '—') + (d.edad ? ' (' + d.edad + ' años)' : ''),
    'Trabaja de: ' + (d.trabajo || '—'),
    'Tiempo trabajando: ' + (d.tiempo || '—'),
    'Documentos que puede presentar: ' + (d.documentos || '—'),
    'Moto que desea: ' + (d.moto || '—'),
    d.referencia ? 'Referencia freelance: ' + d.referencia : '',
    '',
    'Pendiente: fotos del DPI por ambos lados.'
  ].filter(Boolean).join('\n');

  const etiquetas = conf('KOMMO_ETIQUETAS', 'PRECALIFICACION WEB')
    .split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name }));

  /* Si el bot mandó el enlace con ?lead=, actualizamos ESE lead:
     lo movemos a PRECALIFICACIÓN y le llenamos las celdas. Así no se duplica
     la conversación que ya venía de WhatsApp. */
  const leadId = String(d.leadId || '').trim();
  if (/^\d+$/.test(leadId)) {
    try {
      await actualizarLead(leadId, d, camposLead, etiquetas, nota);
      return { id: Number(leadId), modo: 'actualizado' };
    } catch (e) {
      // Si el id no existe o ya se borró, seguimos y creamos uno nuevo.
      console.warn('[kommo] no pude actualizar el lead ' + leadId + ' (' + e.message + '), creo uno nuevo');
    }
  }

  const lead = {
    name: 'Precalificación web — ' + (nombre || 'sin nombre') + (d.moto ? ' — ' + d.moto : ''),
    status_id: Number(conf('KOMMO_STATUS_ID')),
    _embedded: {
      tags: etiquetas,
      contacts: [{
        name: nombre || 'Cliente web',
        custom_fields_values: tel ? [{
          field_code: 'PHONE',
          values: [{ value: tel, enum_code: 'MOB' }]
        }] : undefined
      }]
    }
  };
  if (conf('KOMMO_PIPELINE_ID')) lead.pipeline_id = Number(conf('KOMMO_PIPELINE_ID'));
  if (camposLead.length) lead.custom_fields_values = camposLead;

  // /leads/complex crea lead + contacto de una sola vez y reutiliza el
  // contacto si ya existe uno con ese teléfono.
  const creado = await kommo('/leads/complex', { method: 'POST', body: JSON.stringify([lead]) });
  const nuevoId = Array.isArray(creado) && creado[0] ? creado[0].id : null;

  if (nuevoId) {
    // La nota va en una llamada aparte: si falla, el lead igual quedó creado.
    try {
      await kommo('/leads/' + nuevoId + '/notes', {
        method: 'POST',
        body: JSON.stringify([{ note_type: 'common', params: { text: nota } }])
      });
    } catch (e) {
      console.warn('[kommo] el lead se creó pero la nota falló', e.message);
    }
  }

  return { id: nuevoId, modo: 'creado' };
}

/* ─────────────── Handler ─────────────── */

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, body: '' };

  const falta = ['KOMMO_SUBDOMINIO', 'KOMMO_TOKEN'].filter((k) => !conf(k));

  // Modos de configuración: ?descubrir=<clave> y ?crearcampos=<clave>
  if (event.httpMethod === 'GET') {
    const clave = conf('KOMMO_DESCUBRIR_CLAVE');
    const q = event.queryStringParameters || {};
    const pedida = q.descubrir || q.crearcampos || '';
    if (!clave) return responder(404, { error: 'No disponible.' });
    if (pedida !== clave) return responder(403, { error: 'Clave incorrecta.' });
    if (falta.length) return responder(500, { error: 'Faltan variables', falta });
    try {
      return responder(200, q.crearcampos ? await crearCampos() : await descubrir());
    } catch (e) {
      return responder(502, { error: e.message, detalle: e.detalle || null });
    }
  }

  if (event.httpMethod !== 'POST') return responder(405, { error: 'Usá POST.' });

  if (falta.length || !conf('KOMMO_STATUS_ID')) {
    // Todavía sin configurar: no es un error del cliente, el formulario sigue
    // funcionando por WhatsApp. Lo dejamos anotado en los logs.
    console.warn('[kommo] sin configurar, faltan:', falta.concat(conf('KOMMO_STATUS_ID') ? [] : ['KOMMO_STATUS_ID']).join(', '));
    return responder(200, { ok: false, motivo: 'kommo-sin-configurar' });
  }

  let datos;
  try { datos = JSON.parse(event.body || '{}'); }
  catch (_) { return responder(400, { error: 'JSON inválido.' }); }

  if (!String(datos.nombre || '').trim()) return responder(400, { error: 'Falta el nombre.' });

  try {
    const r = await procesar(datos);
    console.log('[kommo] lead ' + r.modo, r.id);
    return responder(200, { ok: true, leadId: r.id, modo: r.modo });
  } catch (e) {
    // Nunca rompemos el flujo del cliente: el formulario ya lo mandó a WhatsApp.
    console.error('[kommo] no se pudo crear el lead:', e.message, JSON.stringify(e.detalle || {}));
    return responder(200, { ok: false, motivo: e.message });
  }
};
