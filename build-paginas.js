#!/usr/bin/env node
/**
 * build-paginas.js — Vento Barberena
 *
 * Genera páginas HTML reales e indexables a partir del catálogo que ya vive
 * dentro de index.html. No duplica los datos: los lee de ahí, así que cuando
 * cambiás un precio o agregás un modelo en index.html, estas páginas se
 * regeneran solas en el siguiente deploy.
 *
 *   /motos/<modelo>/index.html   → ficha completa independiente (16)
 *   /motos/<linea>/index.html    → listado de la línea (6)
 *   /motos/index.html            → índice de todo el catálogo
 *   /sitemap.xml
 *   /robots.txt
 */

const fs = require('fs');
const path = require('path');

const SITIO = 'https://ventobarberena.com';
const RAIZ = __dirname;
const WA = '50240165239';
const TEL = '+50240165239';
const OG_DEFAULT = 'https://res.cloudinary.com/dondwgkhw/image/upload/v1782782932/vento-barberena/vento-barberena-og.jpg';

/* ─────────────────────────────────────────────────────────────
   1. Leer CATS y MOTOS desde index.html
   ───────────────────────────────────────────────────────────── */
function leerCatalogo() {
  const src = fs.readFileSync(path.join(RAIZ, 'index.html'), 'utf8');
  const trozo = (inicio) => {
    const i = src.indexOf(inicio);
    if (i < 0) throw new Error('No encontré "' + inicio + '" en index.html');
    const j = src.indexOf('\n];', i);
    if (j < 0) throw new Error('No encontré el cierre de "' + inicio + '"');
    return src.slice(i, j + 3);
  };
  const cuerpo = trozo('const CATS=[') + '\n' + trozo('const MOTOS=[') + '\nreturn {CATS,MOTOS};';
  return new Function(cuerpo)();
}

/* ─────────────────────────────────────────────────────────────
   2. Utilidades
   ───────────────────────────────────────────────────────────── */
const slug = (s) => String(s)
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const Q = (n) => 'Q' + Number(n).toLocaleString('en-US');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Transformación Cloudinary sin IA (misma política que cldImg en el sitio). */
function cld(url, t) {
  if (!url || url.indexOf('res.cloudinary.com') < 0) return url;
  if (/\/upload\/(?:[^\/]*,)*(?:e_upscale|e_enhance|e_improve|c_fit|c_fill|q_auto|f_auto)/.test(url)) return url;
  return url.replace('/image/upload/', '/image/upload/' + t + '/');
}
const imgCard = (u) => cld(u, 'c_fit,w_1000,h_1000/f_auto,q_auto:good');
const imgHero = (u) => cld(u, 'c_fit,w_1600,h_1600/f_auto,q_auto:good');

/** Planes de financiamiento — misma fórmula que el cotizador. */
function planes(p) {
  const e = Math.round(p * 0.2), f = p - e;
  return [
    { nom: 'Plan Express 24', m: 24, cuota: Math.round(f * 1.20 / 24), tot: Math.round(e + f * 1.20) },
    { nom: 'Plan Cómodo 36', m: 36, cuota: Math.round(f * 1.26 / 36), tot: Math.round(e + f * 1.26) },
    { nom: 'Plan Flex 48', m: 48, cuota: Math.round(f * 1.32 / 48), tot: Math.round(e + f * 1.32) }
  ];
}

function escribir(rel, contenido) {
  const destino = path.join(RAIZ, rel);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, contenido, 'utf8');
  return rel;
}

/* ─────────────────────────────────────────────────────────────
   3. Estilos compartidos
   ───────────────────────────────────────────────────────────── */
const CSS = `
:root{
  --rojo:#0057C8; --rojo-glow:rgba(0,87,200,.18);
  --negro:#080808; --gt:#888;
  --fondo:#f3f4f6; --borde:#e0e2e8;
  --fh:'Rajdhani',sans-serif; --fb:'Inter',sans-serif;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:var(--fb);background:var(--fondo);color:var(--negro);-webkit-font-smoothing:antialiased}
a{text-decoration:none;color:inherit}
img{max-width:100%;display:block}

header{background:var(--negro);padding:13px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;position:sticky;top:0;z-index:20}
.hd-back{display:inline-flex;align-items:center;gap:7px;color:#fff;font-size:13px;font-weight:600}
.hd-tel{display:inline-flex;align-items:center;gap:7px;background:rgba(255,255,255,.1);color:#fff;border-radius:999px;padding:7px 13px;font-size:12.5px;font-weight:700}

.wrap{max-width:760px;margin:0 auto;padding:16px 16px 48px}
.bc{font-size:11.5px;color:#8b91a0;margin-bottom:14px;line-height:1.6}
.bc a{color:var(--rojo);font-weight:600}

.card{background:#fff;border:1px solid var(--borde);border-radius:16px;padding:20px 18px 24px;box-shadow:0 1px 4px rgba(0,0,0,.05),0 8px 28px rgba(0,0,0,.05)}
.foto{background:#fff;border:1px solid var(--borde);border-radius:16px;padding:14px;margin-bottom:16px}
.foto img{width:100%;height:auto;border-radius:10px}

h1{font-family:var(--fh);font-size:31px;font-weight:700;text-transform:uppercase;line-height:1.08;letter-spacing:.01em}
.sub{margin-top:5px;font-size:13px;color:var(--gt);font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.intro{margin-top:14px;font-size:14px;line-height:1.7;color:#4b5563}

.px{margin-top:18px;background:linear-gradient(135deg,#f8f8f8,#f2f2f2);border:1px solid var(--borde);border-radius:12px;padding:16px 18px;display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}
.px-l{font-size:9px;letter-spacing:.2em;text-transform:uppercase;color:var(--gt);font-weight:700}
.px-o{font-size:12px;color:#bbb;text-decoration:line-through;margin-top:3px;font-weight:500}
.px-v{font-family:var(--fh);font-size:34px;font-weight:700;line-height:1}
.px-s{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:5px 11px;font-size:12px;font-weight:700;color:#15803d;white-space:nowrap;align-self:center}

.slbl{font-size:9px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--gt);display:block;margin-top:24px;margin-bottom:9px}

.cols{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.sw{width:26px;height:26px;border-radius:50%;border:2px solid #fff;box-shadow:0 0 0 1px var(--borde)}
.sw-n{font-size:12px;color:#666;font-weight:600}

.feats{display:flex;flex-wrap:wrap;gap:7px}
.feat{background:var(--fondo);border:1px solid var(--borde);border-radius:999px;padding:5px 11px;font-size:11.5px;font-weight:600;color:#444}

.pl{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:9px}
.pl-i{background:var(--fondo);border:1px solid var(--borde);border-radius:12px;padding:13px 14px}
.pl-n{font-family:var(--fh);font-size:15px;font-weight:700;text-transform:uppercase}
.pl-d{font-size:11px;color:var(--gt);margin-top:2px}
.pl-c{font-family:var(--fh);font-size:22px;font-weight:700;color:var(--rojo);margin-top:6px}
.pl-c small{font-family:var(--fb);font-size:11px;font-weight:600;color:var(--gt)}

table{width:100%;border-collapse:collapse;margin-top:6px}
caption{font-family:var(--fh);font-size:16px;font-weight:700;text-transform:uppercase;text-align:left;padding:14px 0 7px;letter-spacing:.03em}
th,td{text-align:left;padding:9px 2px;border-bottom:1px solid var(--borde);font-size:13px}
th{color:var(--gt);font-weight:600;width:46%}
td{font-weight:600}

/* Financiamiento */
.fin{margin-top:26px;background:var(--fondo);border:1px solid var(--borde);border-radius:14px;padding:18px 15px 16px;text-align:center}
.fin-badge{display:inline-flex;align-items:center;gap:7px;background:rgba(0,87,200,.10);color:var(--rojo);border-radius:999px;padding:5px 13px;font-size:9.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}
.fin-dot{width:5px;height:5px;border-radius:50%;background:var(--rojo)}
.fin-banner{position:relative;margin-top:14px;background:linear-gradient(160deg,#131313,#080808);border-radius:14px;padding:20px 16px 23px;overflow:hidden}
.fin-banner::after{content:'';position:absolute;left:5%;right:5%;bottom:0;height:5px;border-radius:999px 999px 0 0;background:var(--rojo);box-shadow:0 0 22px 5px var(--rojo-glow)}
.fin-b1{font-family:var(--fh);font-size:14px;font-weight:600;letter-spacing:.15em;text-transform:uppercase;color:#9a9a9a}
.fin-b2{font-family:var(--fh);font-size:26px;font-weight:700;text-transform:uppercase;color:#fff;line-height:1.08;margin-top:3px}
.fin-b3{font-family:var(--fh);font-size:18px;font-weight:700;letter-spacing:.035em;text-transform:uppercase;color:#4A8BF0;margin-top:4px}
.fin-sub{margin:13px 2px 0;font-size:12.5px;line-height:1.62;color:#6b7280}
.fin-sub b{color:#333}
.fin-sep{height:1px;background:var(--borde);margin:16px auto 0;width:36%}
.fin-cta-t{margin-top:14px;font-family:var(--fh);font-size:19px;font-weight:700;text-transform:uppercase;color:var(--negro);display:flex;align-items:center;justify-content:center;gap:9px;flex-wrap:wrap}
.fin-min{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.35);color:#15803d;border-radius:999px;padding:3px 10px;font-family:var(--fb);font-size:10.5px;font-weight:700;white-space:nowrap}
.fin-btn{display:flex;align-items:center;justify-content:center;gap:11px;width:100%;margin-top:12px;padding:16px 12px;border-radius:12px;background:linear-gradient(135deg,#0b63de,#0047a8);color:#fff;font-family:var(--fh);font-weight:700;font-size:16px;letter-spacing:.09em;text-transform:uppercase;box-shadow:0 6px 26px rgba(0,87,200,.34);transition:transform .12s,box-shadow .2s}
.fin-btn:hover{transform:translateY(-2px);box-shadow:0 10px 34px rgba(0,87,200,.44)}
.fin-foot{margin-top:9px;font-size:11px;color:#9aa0aa}

/* Grid de modelos */
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:14px;margin-top:8px}
.mc{background:#fff;border:1px solid var(--borde);border-radius:16px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.05);transition:transform .15s,box-shadow .2s;display:block}
.mc:hover{transform:translateY(-3px);box-shadow:0 8px 28px rgba(0,0,0,.10)}
.mc-i{background:#fff;padding:12px}
.mc-i img{width:100%;height:150px;object-fit:contain}
.mc-b{padding:0 14px 16px}
.mc-c{font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--gt);font-weight:700}
.mc-n{font-family:var(--fh);font-size:19px;font-weight:700;text-transform:uppercase;margin-top:3px;line-height:1.12}
.mc-p{font-family:var(--fh);font-size:23px;font-weight:700;margin-top:8px}
.mc-q{font-size:11.5px;color:var(--gt);font-weight:600;margin-top:1px}
.mc-q b{color:var(--rojo)}

.lineas{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.lin{background:#fff;border:1.5px solid var(--borde);border-radius:999px;padding:8px 15px;font-family:var(--fh);font-weight:700;font-size:13.5px;text-transform:uppercase;letter-spacing:.05em;transition:border-color .15s,color .15s}
.lin:hover,.lin.on{border-color:var(--rojo);color:var(--rojo)}

footer{background:var(--negro);color:#8a8a8a;text-align:center;padding:24px 16px;font-size:11.5px;line-height:1.75}
footer a{color:#fff;font-weight:600}
@media(max-width:420px){h1{font-size:26px}.fin-b2{font-size:22px}.fin-b3{font-size:15.5px}}
`;

const HEADER = `<header>
  <a class="hd-back" href="/">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
    Catálogo Vento
  </a>
  <a class="hd-tel" href="tel:${TEL}">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.58.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1C10.61 21 3 13.39 3 4c0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.26.2 2.47.57 3.6.1.34.02.74-.24 1.01L6.6 10.8z"/></svg>
    4016-5239
  </a>
</header>`;

const FOOTER = `<footer>
  <b style="color:#fff">Vento Barberena</b> — Distribuidor Autorizado Vento<br>
  Km 54, Barrio El Centro, 1a Avenida 80-01, Zona 1, Barberena, Santa Rosa, Guatemala<br>
  <a href="tel:${TEL}">4016-5239</a> &middot; Lunes a domingo, 8:00 a.m. – 6:00 p.m.
</footer>`;

function finBloque(href) {
  return `<div class="fin">
  <span class="fin-badge"><span class="fin-dot"></span>Financiamiento Vento</span>
  <div class="fin-banner">
    <div class="fin-b1">Contamos con los mejores</div>
    <div class="fin-b2">Planes de Financiamiento</div>
    <div class="fin-b3">Para tu motocicleta Vento</div>
  </div>
  <p class="fin-sub">Plazos desde 6 hasta 48 meses &middot; <b>PLANES SIN ENGANCHE</b> &middot; aprobación rápida y requisitos sencillos.</p>
  <div class="fin-sep"></div>
  <div class="fin-cta-t">Precalifica ya !! <span class="fin-min">1 minuto</span></div>
  <a class="fin-btn" href="${href}">Precalificar <span aria-hidden="true">&rarr;</span></a>
  <div class="fin-foot">Sin costo &middot; Sin compromiso &middot; Respuesta inmediata</div>
</div>`;
}

function documento({ titulo, desc, url, og, jsonld, cuerpo }) {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<link rel="manifest" href="/manifest.json">
<meta name="theme-color" content="#080808">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1">
<meta name="geo.region" content="GT-06">
<meta name="geo.placename" content="Barberena, Santa Rosa, Guatemala">
<meta name="geo.position" content="14.3050906;-90.3611872">
<meta name="ICBM" content="14.3050906, -90.3611872">
<link rel="alternate" hreflang="es-gt" href="${url}">
<link rel="alternate" hreflang="x-default" href="${url}">
<meta property="og:locale" content="es_GT">
<meta property="og:site_name" content="Vento Barberena">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${og}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(titulo)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${og}">
<script type="application/ld+json">${JSON.stringify(jsonld)}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Rajdhani:wght@600;700&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body>
${HEADER}
<div class="wrap">
${cuerpo}
</div>
${FOOTER}
<script>
/* Arrastra el ?lead= de Kommo hasta el botón de precalificar, para que el
   formulario actualice ese lead y no cree uno nuevo. */
(function(){
  var id='';
  try{
    var u=new URLSearchParams(location.search).get('lead');
    if(u&&/^\\d+$/.test(u)){ sessionStorage.setItem('vbLead',u); id=u; }
    else { var g=sessionStorage.getItem('vbLead'); if(g&&/^\\d+$/.test(g)) id=g; }
  }catch(e){}
  if(!id) return;
  document.querySelectorAll('a[href^="/precalificar/"]').forEach(function(a){
    a.href += (a.href.indexOf('?')<0?'?':'&')+'lead='+encodeURIComponent(id);
  });
})();
</script>
</body>
</html>
`;
}

/* ─────────────────────────────────────────────────────────────
   4. Página de un modelo
   ───────────────────────────────────────────────────────────── */
function paginaModelo(m, cat, todas) {
  const url = `${SITIO}/motos/${m.slug}/`;
  const ps = planes(m.p);
  const ahorro = m.po - m.p;
  const cil = (m.specs['Motor'] || {})['Cilindrada'] || '';
  const pot = (m.specs['Motor'] || {})['Potencia'] || '';

  const desc = `Vento ${m.nom} ${m.año} en Barberena, Santa Rosa: ${Q(m.p)} de contado`
    + (cil ? `, ${cil}` : '') + (pot ? `, ${pot}` : '')
    + `. Crédito desde ${Q(ps[2].cuota)}/mes. Distribuidor autorizado, garantía de fábrica.`;

  const relacionadas = todas
    .filter((x) => x.cat === m.cat && x.id !== m.id)
    .slice(0, 3);

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Product',
        '@id': url + '#producto',
        name: `Vento ${m.nom}`,
        description: desc,
        image: [imgHero(m.img)],
        sku: m.slug,
        model: m.nom,
        category: cat.l,
        brand: { '@type': 'Brand', name: 'Vento' },
        color: m.cols.map((c) => c.n),
        releaseDate: String(m.año),
        offers: {
          '@type': 'Offer',
          url,
          price: m.p,
          priceCurrency: 'GTQ',
          availability: 'https://schema.org/InStock',
          itemCondition: 'https://schema.org/NewCondition',
          seller: { '@id': SITIO + '/#negocio' }
        },
        additionalProperty: Object.entries(m.specs).flatMap(([grupo, campos]) =>
          Object.entries(campos).map(([k, v]) => ({
            '@type': 'PropertyValue', name: `${grupo} — ${k}`, value: String(v)
          }))
        )
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITIO + '/' },
          { '@type': 'ListItem', position: 2, name: 'Motos', item: SITIO + '/motos/' },
          { '@type': 'ListItem', position: 3, name: cat.l, item: `${SITIO}/motos/${cat.slug}/` },
          { '@type': 'ListItem', position: 4, name: `Vento ${m.nom}`, item: url }
        ]
      }
    ]
  };

  const cuerpo = `
<nav class="bc" aria-label="Miga de pan">
  <a href="/">Inicio</a> › <a href="/motos/">Motos</a> › <a href="/motos/${cat.slug}/">${esc(cat.l)}</a> › <span>Vento ${esc(m.nom)}</span>
</nav>

<div class="foto">
  <img src="${imgHero(m.img)}" alt="Moto Vento ${esc(m.nom)} ${m.año} — ${esc(cat.l)}" width="1000" height="750" fetchpriority="high">
</div>

<div class="card">
  <h1>Vento ${esc(m.nom)}</h1>
  <div class="sub">${m.año} &middot; ${esc(cat.l)}</div>

  <p class="intro">
    La <b>Vento ${esc(m.nom)} ${m.año}</b>${cil ? ` de ${esc(cil)}` : ''}${pot ? ` y ${esc(pot)}` : ''} está disponible en
    <b>Vento Barberena</b>, distribuidor autorizado en Barberena, Santa Rosa.
    Precio de contado <b>${Q(m.p)}</b> o a crédito desde <b>${Q(ps[2].cuota)} al mes</b>.
    Moto nueva, con factura y garantía oficial de fábrica.
  </p>

  <div class="px">
    <div>
      <div class="px-l">Precio contado</div>
      ${ahorro > 0 ? `<div class="px-o">${Q(m.po)}</div>` : ''}
      <div class="px-v">${Q(m.p)}</div>
    </div>
    ${ahorro > 0 ? `<div class="px-s">Ahorrás ${Q(ahorro)}</div>` : ''}
  </div>

  <span class="slbl">Colores disponibles</span>
  <div class="cols">
    ${m.cols.map((c) => `<span class="sw" style="background:${c.c}" title="${esc(c.n)}"></span>`).join('')}
    <span class="sw-n">${m.cols.map((c) => esc(c.n)).join(' &middot; ')}</span>
  </div>

  <span class="slbl">Incluye</span>
  <div class="feats">
    ${m.feats.map((f) => `<span class="feat">✓ ${esc(f)}</span>`).join('')}
  </div>
  <div class="feats" style="margin-top:7px">
    <span class="feat">🛡️ Garantía 2 años o 20,000 km</span>
    <span class="feat">🔧 Primer servicio gratis</span>
    <span class="feat">🔒 Alarma antirrobo</span>
  </div>

  <span class="slbl">Planes de crédito</span>
  <div class="pl">
    ${ps.map((p) => `<div class="pl-i">
      <div class="pl-n">${esc(p.nom)}</div>
      <div class="pl-d">${p.m} meses &middot; 20% enganche</div>
      <div class="pl-c">${Q(p.cuota)}<small>/mes</small></div>
    </div>`).join('')}
  </div>

  <span class="slbl">Ficha técnica</span>
  ${Object.entries(m.specs).map(([grupo, campos]) => `<table>
    <caption>${esc(grupo)}</caption>
    <tbody>
      ${Object.entries(campos).map(([k, v]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
    </tbody>
  </table>`).join('')}

  ${finBloque(`/precalificar/?m=${m.id}`)}
</div>

${relacionadas.length ? `<span class="slbl">Otras motos ${esc(cat.l)}</span>
<div class="grid">
  ${relacionadas.map((r) => tarjeta(r, cat)).join('')}
</div>` : ''}
`;

  return documento({
    titulo: `Vento ${m.nom} ${m.año} — Precio ${Q(m.p)} en Guatemala | Vento Barberena`,
    desc, url, og: imgHero(m.img), jsonld, cuerpo
  });
}

function tarjeta(m, cat) {
  const ps = planes(m.p);
  return `<a class="mc" href="/motos/${m.slug}/">
  <div class="mc-i"><img src="${imgCard(m.img)}" alt="Vento ${esc(m.nom)}" loading="lazy" width="300" height="150"></div>
  <div class="mc-b">
    <div class="mc-c">${esc(cat.l)}</div>
    <div class="mc-n">${esc(m.nom)}</div>
    <div class="mc-p">${Q(m.p)}</div>
    <div class="mc-q">Desde <b>${Q(ps[2].cuota)}/mes</b></div>
  </div>
</a>`;
}

/* ─────────────────────────────────────────────────────────────
   5. Página de una línea
   ───────────────────────────────────────────────────────────── */
function paginaLinea(cat, motos, cats) {
  const url = `${SITIO}/motos/${cat.slug}/`;
  const precios = motos.map((m) => m.p);
  const min = Math.min(...precios), max = Math.max(...precios);
  const desc = `${motos.length} motos Vento ${cat.l} 2026 en Barberena, Santa Rosa. `
    + `Precios desde ${Q(min)} hasta ${Q(max)}, con crédito a 24, 36 y 48 meses. Distribuidor autorizado.`;

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': url,
        name: `Motos Vento ${cat.l}`,
        description: desc,
        url,
        isPartOf: { '@id': SITIO + '/#sitio' }
      },
      {
        '@type': 'ItemList',
        name: `Motos Vento ${cat.l} en Vento Barberena`,
        numberOfItems: motos.length,
        itemListElement: motos.map((m, i) => ({
          '@type': 'ListItem', position: i + 1,
          url: `${SITIO}/motos/${m.slug}/`, name: `Vento ${m.nom}`
        }))
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITIO + '/' },
          { '@type': 'ListItem', position: 2, name: 'Motos', item: SITIO + '/motos/' },
          { '@type': 'ListItem', position: 3, name: cat.l, item: url }
        ]
      }
    ]
  };

  const cuerpo = `
<nav class="bc" aria-label="Miga de pan">
  <a href="/">Inicio</a> › <a href="/motos/">Motos</a> › <span>${esc(cat.l)}</span>
</nav>

<div class="card">
  <h1>Motos Vento ${esc(cat.l)}</h1>
  <div class="sub">${motos.length} modelo${motos.length === 1 ? '' : 's'} 2026 &middot; desde ${Q(min)}</div>
  <p class="intro">
    Conocé la línea <b>${esc(cat.l)}</b> de Vento disponible en <b>Vento Barberena</b>, distribuidor
    autorizado en Barberena, Santa Rosa. Precios de contado entre <b>${Q(min)}</b> y <b>${Q(max)}</b>,
    con planes de crédito a 24, 36 y 48 meses. Todas nuevas, con factura y garantía oficial de fábrica.
  </p>

  <span class="slbl">Otras líneas</span>
  <div class="lineas">
    ${cats.map((c) => `<a class="lin${c.k === cat.k ? ' on' : ''}" href="/motos/${c.slug}/">${esc(c.l)}</a>`).join('')}
  </div>

  ${finBloque('/precalificar/')}
</div>

<span class="slbl">Modelos ${esc(cat.l)}</span>
<div class="grid">
  ${motos.map((m) => tarjeta(m, cat)).join('')}
</div>
`;

  return documento({
    titulo: `Motos Vento ${cat.l} 2026 — Precios desde ${Q(min)} | Vento Barberena`,
    desc, url, og: imgHero(motos[0].img), jsonld, cuerpo
  });
}

/* ─────────────────────────────────────────────────────────────
   6. Índice /motos/
   ───────────────────────────────────────────────────────────── */
function paginaIndice(cats, motos) {
  const url = `${SITIO}/motos/`;
  const precios = motos.map((m) => m.p);
  const min = Math.min(...precios), max = Math.max(...precios);
  const desc = `Catálogo completo: ${motos.length} motos Vento 2026 en Barberena, Santa Rosa. `
    + `Precios desde ${Q(min)} hasta ${Q(max)} con crédito a 24, 36 y 48 meses.`;

  const jsonld = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage', '@id': url,
        name: 'Catálogo de motos Vento', description: desc, url,
        isPartOf: { '@id': SITIO + '/#sitio' }
      },
      {
        '@type': 'ItemList', name: 'Catálogo Vento Barberena 2026',
        numberOfItems: motos.length,
        itemListElement: motos.map((m, i) => ({
          '@type': 'ListItem', position: i + 1,
          url: `${SITIO}/motos/${m.slug}/`, name: `Vento ${m.nom}`
        }))
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Inicio', item: SITIO + '/' },
          { '@type': 'ListItem', position: 2, name: 'Motos', item: url }
        ]
      }
    ]
  };

  const cuerpo = `
<nav class="bc" aria-label="Miga de pan"><a href="/">Inicio</a> › <span>Motos</span></nav>

<div class="card">
  <h1>Catálogo de motos Vento</h1>
  <div class="sub">${motos.length} modelos 2026 &middot; desde ${Q(min)}</div>
  <p class="intro">
    Todas las motos <b>Vento</b> disponibles en <b>Vento Barberena</b>, distribuidor autorizado en
    Barberena, Santa Rosa. Precios de contado entre <b>${Q(min)}</b> y <b>${Q(max)}</b>, con planes
    de crédito a 24, 36 y 48 meses y aprobación rápida.
  </p>
  <span class="slbl">Líneas</span>
  <div class="lineas">
    ${cats.map((c) => `<a class="lin" href="/motos/${c.slug}/">${esc(c.l)}</a>`).join('')}
  </div>
  ${finBloque('/precalificar/')}
</div>

${cats.map((c) => {
    const lista = motos.filter((m) => m.cat === c.k);
    if (!lista.length) return '';
    return `<span class="slbl">${esc(c.l)}</span>
<div class="grid">${lista.map((m) => tarjeta(m, c)).join('')}</div>`;
  }).join('')}
`;

  return documento({
    titulo: `Catálogo de motos Vento 2026 en Guatemala — ${motos.length} modelos | Vento Barberena`,
    desc, url, og: OG_DEFAULT, jsonld, cuerpo
  });
}

/* ─────────────────────────────────────────────────────────────
   7. Ejecutar
   ───────────────────────────────────────────────────────────── */
function main() {
  const { CATS, MOTOS } = leerCatalogo();

  const cats = CATS.map((c) => ({ ...c, slug: slug(c.l) }));
  const motos = MOTOS
    .filter((m) => m.disponible !== false)
    .map((m) => ({ ...m, slug: slug(m.nom) }));

  // Los slugs tienen que ser únicos o dos motos se pisarían entre sí.
  const vistos = new Set();
  for (const m of motos) {
    if (vistos.has(m.slug)) throw new Error('Slug duplicado: ' + m.slug);
    vistos.add(m.slug);
  }

  const generadas = [];
  const hoy = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: SITIO + '/', pri: '1.0', chg: 'weekly' },
    { loc: SITIO + '/motos/', pri: '0.9', chg: 'weekly' },
    { loc: SITIO + '/precalificar/', pri: '0.9', chg: 'monthly' }
  ];

  generadas.push(escribir('motos/index.html', paginaIndice(cats, motos)));
  urls.push();

  for (const c of cats) {
    const lista = motos.filter((m) => m.cat === c.k);
    if (!lista.length) continue;
    generadas.push(escribir(`motos/${c.slug}/index.html`, paginaLinea(c, lista, cats)));
    urls.push({ loc: `${SITIO}/motos/${c.slug}/`, pri: '0.8', chg: 'weekly' });
  }

  for (const m of motos) {
    const c = cats.find((x) => x.k === m.cat);
    generadas.push(escribir(`motos/${m.slug}/index.html`, paginaModelo(m, c, motos)));
    urls.push({ loc: `${SITIO}/motos/${m.slug}/`, pri: '0.8', chg: 'weekly' });
  }

  // sitemap.xml
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${hoy}</lastmod>
    <changefreq>${u.chg}</changefreq>
    <priority>${u.pri}</priority>
  </url>`).join('\n')}
</urlset>
`;
  generadas.push(escribir('sitemap.xml', sitemap));

  // robots.txt
  generadas.push(escribir('robots.txt', `User-agent: *
Allow: /
Disallow: /admin.html
Disallow: /panel-freelance.html
Disallow: /analitica-freelance.html

Sitemap: ${SITIO}/sitemap.xml
`));

  console.log(`[build-paginas] ${motos.length} modelos, ${cats.length} líneas`);
  console.log(`[build-paginas] ${generadas.length} archivos generados`);
  for (const g of generadas) console.log('  · ' + g);
}

main();
