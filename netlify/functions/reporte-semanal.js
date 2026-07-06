// netlify/functions/reporte-semanal.js
// Se ejecuta automáticamente todos los lunes a las 8:00am hora Guatemala (ver netlify.toml).
// Envía por correo el resumen de la SEMANA ANTERIOR (lunes a domingo).

const lib = require('./reportes-common.js');

exports.handler = async function () {
  try {
    const { desde, hasta } = lib.rangoSemanaGT(); // semana anterior
    const [metricas, etiquetas, correos] = await Promise.all([
      lib.calcularMetricas(desde, hasta),
      lib.obtenerEtiquetasEventos(),
      lib.obtenerCorreosNotificables()
    ]);

    const optsDate = { timeZone: 'America/Guatemala', day: '2-digit', month: 'long', year: 'numeric' };
    const desdeTexto = new Date(desde.getTime() + 12 * 3600 * 1000).toLocaleDateString('es-GT', optsDate);
    const hastaTexto = new Date(hasta.getTime() - 12 * 3600 * 1000).toLocaleDateString('es-GT', optsDate);

    const html =
      '<h2 style="color:#E8142B">📈 Reporte semanal — Vento Barberena</h2>' +
      '<p style="color:#666">Período: ' + desdeTexto + ' al ' + hastaTexto + '</p>' +
      '<p>' +
      '<b>' + lib.escapeHtml(etiquetas.pedidoLabel) + ':</b> ' + metricas.numCotizaciones + '<br>' +
      '<b>' + lib.escapeHtml(etiquetas.humanoLabel) + ':</b> ' + metricas.numSolicitudesHumano +
      '</p>' +
      '<h3>Detalle de cotizaciones de la semana</h3>' +
      lib.formatearTablaCotizaciones(metricas.pedidos) +
      '<p style="color:#888;font-size:12px;margin-top:20px">Este reporte se puede configurar desde el panel interno de Vento Barberena.</p>';

    const destinatarios = correos.length ? correos : [process.env.RESEND_TO_EMAIL || 'egguatemala2@gmail.com'];

    await lib.enviarCorreoResend({
      to     : destinatarios,
      subject: '📈 Reporte semanal Vento Barberena — ' + desdeTexto + ' al ' + hastaTexto,
      html
    });

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Error generando el reporte semanal', err);
    return { statusCode: 500, body: 'error' };
  }
};
