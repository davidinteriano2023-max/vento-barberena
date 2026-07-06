// netlify/functions/reporte-diario.js
// Se ejecuta automáticamente todos los días a las 8:00am hora Guatemala (ver netlify.toml).
// Envía por correo el resumen del día ANTERIOR.

const lib = require('./reportes-common.js');

exports.handler = async function () {
  try {
    const { desde, hasta } = lib.rangoDiaGT(-1); // día de ayer
    const [metricas, etiquetas, correos] = await Promise.all([
      lib.calcularMetricas(desde, hasta),
      lib.obtenerEtiquetasEventos(),
      lib.obtenerCorreosNotificables()
    ]);

    const fechaTexto = new Date(desde.getTime() + 12 * 3600 * 1000).toLocaleDateString('es-GT', {
      timeZone: 'America/Guatemala', day: '2-digit', month: 'long', year: 'numeric'
    });

    const html =
      '<h2 style="color:#E8142B">📊 Reporte diario — Vento Barberena — ' + fechaTexto + '</h2>' +
      '<p>' +
      '<b>' + lib.escapeHtml(etiquetas.pedidoLabel) + ':</b> ' + metricas.numCotizaciones + '<br>' +
      '<b>' + lib.escapeHtml(etiquetas.humanoLabel) + ':</b> ' + metricas.numSolicitudesHumano +
      '</p>' +
      '<h3>Detalle de cotizaciones</h3>' +
      lib.formatearTablaCotizaciones(metricas.pedidos) +
      '<p style="color:#888;font-size:12px;margin-top:20px">Este reporte se puede configurar desde el panel interno de Vento Barberena.</p>';

    const destinatarios = correos.length ? correos : [process.env.RESEND_TO_EMAIL || 'egguatemala2@gmail.com'];

    await lib.enviarCorreoResend({
      to     : destinatarios,
      subject: '📊 Reporte diario Vento Barberena — ' + fechaTexto,
      html
    });

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Error generando el reporte diario', err);
    return { statusCode: 500, body: 'error' };
  }
};
