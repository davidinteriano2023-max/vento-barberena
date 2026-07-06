var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// mnt/VENTO BARBERENA/netlify/functions/reportes-common.js
var require_reportes_common = __commonJS({
  "mnt/VENTO BARBERENA/netlify/functions/reportes-common.js"(exports2, module2) {
    var FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "ventobarberena-cotizador";
    var FIREBASE_API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyD8MUzezXAT9EFy2RMKGyRSCaMfJIBmwIU";
    var FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/" + FIREBASE_PROJECT_ID + "/databases/(default)/documents";
    var cachedToken = null;
    var cachedTokenExp = 0;
    async function obtenerIdTokenServicio() {
      const email = process.env.FIRESTORE_SERVICE_EMAIL;
      const password = process.env.FIRESTORE_SERVICE_PASSWORD;
      if (!email || !password) return null;
      const ahora = Date.now();
      if (cachedToken && ahora < cachedTokenExp) return cachedToken;
      try {
        const resp = await fetch(
          "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + FIREBASE_API_KEY,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, returnSecureToken: true })
          }
        );
        if (!resp.ok) {
          console.error("Error autenticando cuenta de servicio", resp.status, await resp.text());
          return null;
        }
        const data = await resp.json();
        cachedToken = data.idToken;
        cachedTokenExp = ahora + (Number(data.expiresIn || 3600) - 60) * 1e3;
        return cachedToken;
      } catch (err) {
        console.error("Error en autenticaci\xF3n de servicio", err);
        return null;
      }
    }
    async function fetchFirestoreAuth(url) {
      const token = await obtenerIdTokenServicio();
      const headers = token ? { Authorization: "Bearer " + token } : {};
      return fetch(url, { headers });
    }
    async function obtenerColeccion(nombre) {
      const docs = [];
      let pageToken = "";
      do {
        const url = FIRESTORE_BASE + "/" + nombre + "?pageSize=300&key=" + FIREBASE_API_KEY + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : "");
        const resp = await fetchFirestoreAuth(url);
        if (!resp.ok) break;
        const data = await resp.json();
        (data.documents || []).forEach((d) => docs.push(d));
        pageToken = data.nextPageToken || "";
      } while (pageToken);
      return docs;
    }
    function campo(doc, nombre) {
      const f = (doc.fields || {})[nombre];
      if (!f) return void 0;
      if ("stringValue" in f) return f.stringValue;
      if ("integerValue" in f) return parseInt(f.integerValue, 10);
      if ("doubleValue" in f) return f.doubleValue;
      if ("booleanValue" in f) return f.booleanValue;
      if ("timestampValue" in f) return f.timestampValue;
      return void 0;
    }
    async function obtenerEtiquetasEventos() {
      try {
        const resp = await fetchFirestoreAuth(FIRESTORE_BASE + "/config/eventos_tipos?key=" + FIREBASE_API_KEY);
        if (!resp.ok) throw new Error("sin doc");
        const data = await resp.json();
        const f = data.fields || {};
        return {
          pedidoLabel: f.pedidoLabel && f.pedidoLabel.stringValue || "Cotizaci\xF3n recibida",
          humanoLabel: f.humanoLabel && f.humanoLabel.stringValue || "Solicitud de asesor"
        };
      } catch {
        return { pedidoLabel: "Cotizaci\xF3n recibida", humanoLabel: "Solicitud de asesor" };
      }
    }
    async function obtenerCorreosNotificables() {
      try {
        const resp = await fetchFirestoreAuth(FIRESTORE_BASE + "/usuarios?key=" + FIREBASE_API_KEY + "&pageSize=200");
        if (!resp.ok) return [];
        const data = await resp.json();
        const docs = data.documents || [];
        const correos = [];
        for (const doc of docs) {
          const f = doc.fields || {};
          const activo = !!(f.activo && f.activo.booleanValue);
          const correo = f.correo && f.correo.stringValue;
          if (activo && f.notifCorreo && f.notifCorreo.booleanValue && correo) correos.push(correo);
        }
        return correos;
      } catch (err) {
        console.error("No se pudieron leer usuarios para el reporte", err);
        return [];
      }
    }
    var OFFSET_HORAS = 6;
    function rangoDiaGT(offsetDias) {
      const ahora = /* @__PURE__ */ new Date();
      const gt = new Date(ahora.getTime() - OFFSET_HORAS * 3600 * 1e3);
      const y = gt.getUTCFullYear(), m = gt.getUTCMonth(), d = gt.getUTCDate();
      const hoy00 = new Date(Date.UTC(y, m, d, OFFSET_HORAS, 0, 0));
      const desde = new Date(hoy00.getTime() + offsetDias * 24 * 3600 * 1e3);
      const hasta = new Date(desde.getTime() + 24 * 3600 * 1e3);
      return { desde, hasta };
    }
    function rangoSemanaGT() {
      const ahora = /* @__PURE__ */ new Date();
      const gt = new Date(ahora.getTime() - OFFSET_HORAS * 3600 * 1e3);
      const y = gt.getUTCFullYear(), m = gt.getUTCMonth(), d = gt.getUTCDate();
      const hoy00 = new Date(Date.UTC(y, m, d, OFFSET_HORAS, 0, 0));
      const desde = new Date(hoy00.getTime() - 7 * 24 * 3600 * 1e3);
      return { desde, hasta: hoy00 };
    }
    function enRango(fechaISO, desde, hasta) {
      if (!fechaISO) return false;
      const t = new Date(fechaISO).getTime();
      return t >= desde.getTime() && t < hasta.getTime();
    }
    async function calcularMetricas(desde, hasta) {
      const [pedidosDocs, humanoDocs] = await Promise.all([
        obtenerColeccion("pedidos_chat"),
        obtenerColeccion("eventos_humano")
      ]);
      const pedidos = pedidosDocs.map((doc) => ({
        nombre: campo(doc, "nombre") || "\u2014",
        telefono: campo(doc, "telefono") || "\u2014",
        modelo: campo(doc, "modelo") || "",
        interes: campo(doc, "interes") || "",
        fecha: campo(doc, "fecha")
      })).filter((p) => enRango(p.fecha, desde, hasta));
      const humanos = humanoDocs.map((doc) => ({ fecha: campo(doc, "fecha") })).filter((h) => enRango(h.fecha, desde, hasta));
      return { pedidos, numCotizaciones: pedidos.length, numSolicitudesHumano: humanos.length };
    }
    async function enviarCorreoResend({ to, subject, html }) {
      const apiKey = process.env.RESEND_API_KEY;
      if (!apiKey || !to.length) {
        console.warn("Resend no configurado o sin destinatarios; correo no enviado.");
        return;
      }
      try {
        const resp = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
          body: JSON.stringify({
            from: process.env.RESEND_FROM_EMAIL || "LIA Vento Barberena <onboarding@resend.dev>",
            to,
            subject,
            html
          })
        });
        if (!resp.ok) console.error("Resend error", resp.status, await resp.text());
      } catch (err) {
        console.error("No se pudo enviar el correo por Resend", err);
      }
    }
    function escapeHtml(s) {
      return String(s == null ? "" : s).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
      );
    }
    function formatearTablaCotizaciones(pedidos) {
      if (!pedidos.length) return "<p><i>Sin cotizaciones en este per\xEDodo.</i></p>";
      const filas = pedidos.map(
        (p) => "<tr><td>" + escapeHtml(p.nombre) + "</td><td>" + escapeHtml(p.telefono) + "</td><td>" + escapeHtml(p.modelo) + "</td><td>" + escapeHtml(p.interes) + "</td></tr>"
      ).join("");
      return '<table cellpadding="6" style="border-collapse:collapse;width:100%"><tr style="background:#f0f0f0"><th align="left">Cliente</th><th align="left">Tel\xE9fono</th><th align="left">Modelo</th><th align="left">Inter\xE9s</th></tr>' + filas + "</table>";
    }
    module2.exports = {
      FIREBASE_PROJECT_ID,
      FIREBASE_API_KEY,
      FIRESTORE_BASE,
      obtenerIdTokenServicio,
      fetchFirestoreAuth,
      obtenerColeccion,
      campo,
      obtenerEtiquetasEventos,
      obtenerCorreosNotificables,
      rangoDiaGT,
      rangoSemanaGT,
      calcularMetricas,
      enviarCorreoResend,
      escapeHtml,
      formatearTablaCotizaciones,
      OFFSET_HORAS
    };
  }
});

// mnt/VENTO BARBERENA/netlify/functions/reporte-diario.js
var lib = require_reportes_common();
exports.handler = async function() {
  try {
    const { desde, hasta } = lib.rangoDiaGT(-1);
    const [metricas, etiquetas, correos] = await Promise.all([
      lib.calcularMetricas(desde, hasta),
      lib.obtenerEtiquetasEventos(),
      lib.obtenerCorreosNotificables()
    ]);
    const fechaTexto = new Date(desde.getTime() + 12 * 3600 * 1e3).toLocaleDateString("es-GT", {
      timeZone: "America/Guatemala",
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
    const html = '<h2 style="color:#E8142B">\u{1F4CA} Reporte diario \u2014 Vento Barberena \u2014 ' + fechaTexto + "</h2><p><b>" + lib.escapeHtml(etiquetas.pedidoLabel) + ":</b> " + metricas.numCotizaciones + "<br><b>" + lib.escapeHtml(etiquetas.humanoLabel) + ":</b> " + metricas.numSolicitudesHumano + "</p><h3>Detalle de cotizaciones</h3>" + lib.formatearTablaCotizaciones(metricas.pedidos) + '<p style="color:#888;font-size:12px;margin-top:20px">Este reporte se puede configurar desde el panel interno de Vento Barberena.</p>';
    const destinatarios = correos.length ? correos : [process.env.RESEND_TO_EMAIL || "egguatemala2@gmail.com"];
    await lib.enviarCorreoResend({
      to: destinatarios,
      subject: "\u{1F4CA} Reporte diario Vento Barberena \u2014 " + fechaTexto,
      html
    });
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error("Error generando el reporte diario", err);
    return { statusCode: 500, body: "error" };
  }
};
