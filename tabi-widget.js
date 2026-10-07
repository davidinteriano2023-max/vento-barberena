/* tabi-widget.js — Sofía, asistente virtual de Vento Barberena (IA con Claude).
   JS puro, sin frameworks. Habla con /.netlify/functions/web-ia, que usa la misma
   base de conocimiento en vivo (sitio + precios de Firebase) que la IA de Kommo.
   Estilo inspirado en el widget "Lia" de tvspamplona.com, con los colores de Vento. */
(function () {
  'use strict';
  if (window.location.pathname.indexOf('/freelance') !== -1 || window.location.pathname.indexOf('/admin') !== -1) return;

  var FIREBASE_PROJECT_ID = window.VENTO_FIREBASE_PROJECT_ID || 'ventobarberena-cotizador';
  var FIREBASE_API_KEY    = window.VENTO_FIREBASE_API_KEY    || '';

  // Interruptor en Firestore (config/asesor_ia.activo = false oculta el chat)
  fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/config/asesor_ia?key=' + FIREBASE_API_KEY)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var f = data && data.fields;
      if (!(f && f.activo && f.activo.booleanValue === false)) iniciar();
    })
    .catch(function () { iniciar(); });

  function iniciar() {
    var ENDPOINT = '/.netlify/functions/web-ia';
    var KEY      = 'sofia_vento_v3';
    var WA       = '50240165239';
    var AVATAR   = '/sofia-avatar.webp';
    var AZUL = '#0057C8', AZUL_OSC = '#003a8c', AZUL_NOCHE = '#002457';

    var css = [
      '#sof-wrap{position:fixed;bottom:18px;right:16px;z-index:99999;display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:none}',
      '#sof-fab{width:68px;height:68px;border:none;background:transparent;padding:0;cursor:pointer;position:relative;pointer-events:all;outline:none;animation:sofFloat 3s ease-in-out infinite;transition:transform .22s cubic-bezier(.34,1.56,.64,1),filter .18s}',
      '#sof-fab:hover{animation:none;transform:translateY(-4px) scale(1.08);filter:drop-shadow(0 8px 18px rgba(0,87,200,.55))}',
      '#sof-fab img{width:68px;height:68px;display:block;border-radius:50%;animation:sofPulse 2.8s ease-out infinite}',
      '#sof-badge{position:absolute;top:-2px;right:-2px;min-width:20px;height:20px;border-radius:10px;background:#ef4444;color:#fff;font:800 11px/20px system-ui,sans-serif;text-align:center;padding:0 5px;border:2px solid #fff;display:none}',
      '#sof-label{pointer-events:all;cursor:pointer;color:#fff;font:800 10.5px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:.8px;text-transform:uppercase;white-space:nowrap;background:linear-gradient(135deg,' + AZUL + ',' + AZUL_OSC + ');padding:5px 11px;border-radius:20px;box-shadow:0 2px 8px rgba(0,0,0,.25),inset 0 1px 0 rgba(255,255,255,.15)}',
      '@keyframes sofFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}',
      '@keyframes sofPulse{0%{box-shadow:0 0 0 0 rgba(0,87,200,.55),0 6px 22px rgba(0,87,200,.40)}70%{box-shadow:0 0 0 14px rgba(0,87,200,0),0 6px 22px rgba(0,87,200,.40)}100%{box-shadow:0 0 0 0 rgba(0,87,200,0),0 6px 22px rgba(0,87,200,.40)}}',
      '@keyframes sofIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',

      '#sof-teaser{position:fixed;right:98px;bottom:52px;z-index:99999;max-width:240px;background:#fff;color:#0f172a;border-radius:16px 16px 4px 16px;padding:11px 14px;font:500 13px/1.45 system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,36,87,.25);cursor:pointer;display:none;animation:sofIn .35s ease}',
      '#sof-teaser b{color:' + AZUL + '}',
      '#sof-teaser .x{position:absolute;top:-8px;left:-8px;width:20px;height:20px;border-radius:50%;background:#334155;color:#fff;font-size:12px;line-height:20px;text-align:center;border:none;cursor:pointer}',

      '#sof-panel{position:fixed;bottom:128px;right:16px;z-index:99998;width:420px;max-width:calc(100vw - 24px);height:min(680px,calc(100dvh - 150px));background:#fff;border-radius:20px;box-shadow:0 24px 64px rgba(0,36,87,.22),0 8px 24px rgba(0,36,87,.12),0 0 0 1px rgba(0,87,200,.08);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}',
      '#sof-panel.on{display:flex;animation:sofIn .25s ease}',
      '@media(max-width:520px){#sof-panel{right:8px;left:8px;width:auto;bottom:118px;height:calc(100dvh - 140px)}}',
      '#sof-head{background:linear-gradient(135deg,' + AZUL + ' 0%,' + AZUL_NOCHE + ' 100%);padding:13px 12px 13px 14px;display:flex;align-items:center;gap:11px;flex-shrink:0;position:relative;overflow:hidden}',
      '#sof-head::after{content:"";position:absolute;top:-30px;right:-20px;width:110px;height:110px;border-radius:50%;background:rgba(255,255,255,.06);pointer-events:none}',
      '#sof-head img{width:46px;height:46px;border-radius:50%;flex-shrink:0;background:rgba(255,255,255,.12)}',
      '#sof-head .t b{display:block;color:#fff;font-size:15.5px;font-weight:800}',
      '#sof-head .t span{display:flex;align-items:center;gap:6px;color:rgba(255,255,255,.85);font-size:11.5px;margin-top:2px}',
      '#sof-head .t span i{width:7px;height:7px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.25)}',
      '#sof-close{margin-left:auto;background:rgba(255,255,255,.12);border:none;color:#fff;width:32px;height:32px;border-radius:50%;font-size:20px;cursor:pointer;line-height:1;position:relative;z-index:1}',
      '#sof-close:hover{background:rgba(255,255,255,.22)}',

      '#sof-msgs{flex:1 1 auto;overflow-y:auto;overscroll-behavior:contain;padding:16px 12px 10px 14px;display:flex;flex-direction:column;gap:9px;background:linear-gradient(180deg,#edf3ff 0%,#f5f8ff 100%);scrollbar-width:thin;scrollbar-color:' + AZUL + ' #dbe6fb}',
      '#sof-msgs>*{flex-shrink:0}',
      '.sof-b{max-width:86%;padding:10px 13px;border-radius:18px;font-size:13.8px;line-height:1.55;word-break:break-word;white-space:pre-wrap;animation:sofIn .22s ease}',
      '.sof-b.bot{align-self:flex-start;background:#fff;color:#0f172a;border:1px solid rgba(0,87,200,.10);border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(0,87,200,.08)}',
      '.sof-b.cta{background:linear-gradient(135deg,#eaf2ff,#dfeaff);border-color:rgba(0,87,200,.22)}',
      '.sof-b.user{align-self:flex-end;background:linear-gradient(135deg,' + AZUL + ',' + AZUL_OSC + ');color:#fff;border-bottom-right-radius:4px;box-shadow:0 3px 10px rgba(0,87,200,.25)}',
      '.sof-b b{font-weight:800;color:' + AZUL_NOCHE + '}',
      '.sof-b.user b{color:#fff}',
      '.sof-b a{color:' + AZUL + ';font-weight:700;text-decoration:underline;word-break:break-all}',
      '.sof-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:#fff;border-radius:18px;border-bottom-left-radius:4px;box-shadow:0 2px 8px rgba(0,87,200,.08)}',
      '.sof-dot{width:7px;height:7px;border-radius:50%;background:' + AZUL + ';opacity:.4;animation:sofDot 1.2s ease-in-out infinite}',
      '.sof-dot:nth-child(2){animation-delay:.2s}.sof-dot:nth-child(3){animation-delay:.4s}',
      '@keyframes sofDot{0%,60%,100%{opacity:.3;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}',

      '.sof-card{align-self:flex-start;width:86%;background:#fff;border:1px solid rgba(0,87,200,.14);border-radius:16px;overflow:hidden;box-shadow:0 3px 12px rgba(0,87,200,.12);animation:sofIn .25s ease}',
      '.sof-card img{width:100%;height:150px;object-fit:contain;background:linear-gradient(180deg,#f5f8ff,#fff);display:block;padding:6px 0}',
      '.sof-card .cb{padding:10px 13px 12px}',
      '.sof-card .cn{font-size:14px;font-weight:800;color:' + AZUL_NOCHE + '}',
      '.sof-card .cl{font-size:11px;color:#64748b;font-weight:600;margin-top:1px}',
      '.sof-card .cp{font-size:16px;font-weight:900;color:' + AZUL + ';margin-top:4px}',
      '.sof-card .cp s{font-size:12px;color:#94a3b8;font-weight:600;margin-left:6px}',
      '.sof-card .cq{font-size:12px;color:#059669;font-weight:700;margin-top:1px}',
      '.sof-card .cg{display:inline-block;background:#fff1e6;color:#c2410c;font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:12px;margin-top:5px}',
      '.sof-card .cbtns{display:flex;gap:7px;margin-top:9px}',
      '.sof-card button{flex:1;padding:9px;border:none;border-radius:11px;font-family:inherit;font-size:12.5px;font-weight:800;cursor:pointer}',
      '.sof-card .quiero{background:linear-gradient(135deg,' + AZUL + ',' + AZUL_OSC + ');color:#fff;box-shadow:0 2px 8px rgba(0,87,200,.35)}',
      '.sof-card .ver{background:#eef4ff;color:' + AZUL + '}',

      '#sof-chipbar{display:flex;gap:5px;overflow-x:auto;padding:0 0 8px;scrollbar-width:none;-ms-overflow-style:none}',
      '#sof-chipbar::-webkit-scrollbar{display:none}',
      '#sof-chipbar:empty{display:none}',
      '.sof-chip{flex-shrink:0;white-space:nowrap;background:#fff;border:1px solid ' + AZUL + ';color:' + AZUL + ';border-radius:14px;padding:4px 10px;font:600 11.5px/1.3 system-ui,sans-serif;cursor:pointer;transition:background .15s,color .15s}',
      '.sof-chip:hover{background:' + AZUL + ';color:#fff}',

      '#sof-foot{background:#fff;border-top:1px solid #e5edfb;padding:10px 12px 6px;flex-shrink:0}',
      '#sof-row{display:flex;gap:8px;align-items:center}',
      '#sof-in{flex:1;background:#f1f5fd;border:1.5px solid #dbe6fb;border-radius:22px;padding:10px 15px;color:#0f172a;font-size:14px;outline:none;transition:border-color .15s,background .15s}',
      '#sof-in:focus{border-color:' + AZUL + ';background:#fff}',
      '#sof-send{width:42px;height:42px;border-radius:50%;border:none;background:linear-gradient(135deg,' + AZUL + ',' + AZUL_OSC + ');color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 3px 10px rgba(0,87,200,.35);transition:transform .1s}',
      '#sof-send:hover{transform:scale(1.06)}',
      '#sof-wa{display:block;text-align:center;color:#16a34a;font-size:11.5px;font-weight:600;padding:7px 0 3px;text-decoration:none}',
      '#sof-wa:hover{text-decoration:underline}',
      '#sof-legal{text-align:center;color:#94a3b8;font-size:10px;padding-bottom:3px}'
    ].join('');
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    var wrap = document.createElement('div');
    wrap.id = 'sof-wrap';
    wrap.innerHTML =
      '<button id="sof-fab" type="button" aria-label="Chatear con Sofía, asistente virtual">' +
      '<img src="' + AVATAR + '" alt="Sofía" onerror="this.src=\'/sofia-avatar.png\'"><span id="sof-badge">1</span></button>' +
      '<div id="sof-label">Asistente virtual</div>';

    var teaser = document.createElement('div');
    teaser.id = 'sof-teaser';
    teaser.innerHTML = '<button class="x" type="button" aria-label="Cerrar">&times;</button>Hola, soy <b>Sofía</b>. ¿Te ayudo a elegir tu moto y la mejor forma de pagarla?';

    var panel = document.createElement('div');
    panel.id = 'sof-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Chat con Sofía');
    panel.innerHTML =
      '<div id="sof-head"><img src="' + AVATAR + '" alt="" onerror="this.src=\'/sofia-avatar.png\'">' +
      '<div class="t"><b>Sofía</b><span><i></i>Asistente virtual · en línea</span></div>' +
      '<button id="sof-close" type="button" aria-label="Cerrar">&times;</button></div>' +
      '<div id="sof-msgs"></div>' +
      '<div id="sof-foot"><div id="sof-chipbar"></div><div id="sof-row"><input id="sof-in" type="text" placeholder="Escribí tu pregunta…" autocomplete="off" maxlength="600">' +
      '<button id="sof-send" type="button" aria-label="Enviar"><svg width="17" height="17" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg></button></div>' +
      '<a id="sof-wa" href="https://wa.me/' + WA + '" target="_blank" rel="noopener">¿Preferís WhatsApp? Escribinos al 4016-5239</a>' +
      '<div id="sof-legal">Sofía es una asistente con inteligencia artificial. Precios sujetos a cambio.</div></div>';

    document.body.appendChild(wrap);
    document.body.appendChild(teaser);
    document.body.appendChild(panel);

    var $ = function (id) { return document.getElementById(id); };
    var msgs = $('sof-msgs'), input = $('sof-in'), badge = $('sof-badge');
    var d = cargar(), enviando = false, rescate = null, rescatado = false;

    function cargar() {
      try { var r = sessionStorage.getItem(KEY); if (r) return JSON.parse(r); } catch (e) {}
      return { historial: [], vista: [], estado: {}, chips: [] };
    }
    function guardar() {
      d.historial = d.historial.slice(-24); d.vista = d.vista.slice(-50);
      try { sessionStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {}
    }
    function abajo() { setTimeout(function () { msgs.scrollTop = msgs.scrollHeight; }, 30); }
    function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function formato(t) {
      var s = esc(t);
      s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      return s.replace(/\*([^*\n]{1,80})\*/g, '<b>$1</b>');
    }
    function burbuja(t, c) {
      var el = document.createElement('div'); el.className = 'sof-b ' + c; el.innerHTML = formato(t);
      msgs.appendChild(el); abajo();
    }
    function tarjeta(m) {
      if (!m || !m.nombre) return;
      var el = document.createElement('div'); el.className = 'sof-card';
      el.innerHTML = (m.img ? '<img src="' + esc(m.img) + '" alt="' + esc(m.nombre) + '" loading="lazy">' : '') +
        '<div class="cb"><div class="cn">' + esc(m.nombre) + (m.anio ? ' ' + esc(m.anio) : '') + '</div>' +
        (m.linea ? '<div class="cl">Línea ' + esc(m.linea) + (m.colores && m.colores.length ? ' · ' + esc(m.colores.join(', ')) : '') + '</div>' : '') +
        '<div class="cp">' + esc(m.precio) + (m.antes ? '<s>' + esc(m.antes) + '</s>' : '') + '</div>' +
        (m.cuota ? '<div class="cq">o desde ' + esc(m.cuota) + '*</div>' : '') +
        (m.badge ? '<div class="cg">' + esc(m.badge) + '</div>' : '') +
        '<div class="cbtns"><button type="button" class="quiero">¡La quiero!</button><button type="button" class="ver">Ver ficha</button></div></div>';
      el.querySelector('.quiero').addEventListener('click', function () { enviar('Quiero la ' + m.nombre); });
      el.querySelector('.ver').addEventListener('click', function () { window.open(m.url, '_blank', 'noopener'); });
      var img = el.querySelector('img'); if (img) img.addEventListener('load', abajo);
      msgs.appendChild(el); abajo();
    }
    function quitarChips() { $('sof-chipbar').innerHTML = ''; }
    function chips(lista) {
      quitarChips();
      if (!lista || !lista.length) return;
      var w = $('sof-chipbar');
      lista.slice(0, 4).forEach(function (op) {
        var b = document.createElement('button'); b.type = 'button'; b.className = 'sof-chip'; b.textContent = op;
        b.addEventListener('click', function () { enviar(op); });
        w.appendChild(b);
      });
    }
    function typing(on) {
      var t = $('sof-typing');
      if (on && !t) {
        t = document.createElement('div'); t.className = 'sof-typing'; t.id = 'sof-typing';
        t.innerHTML = '<span class="sof-dot"></span><span class="sof-dot"></span><span class="sof-dot"></span>';
        msgs.appendChild(t); abajo();
      } else if (!on && t) t.remove();
    }
    function pintar() {
      msgs.innerHTML = '';
      d.vista.forEach(function (v) { if (v.card) tarjeta(v.card); else burbuja(v.t, v.c); });
      chips(d.chips);
    }
    function mostrarBot(r) {
      var resp = r.respuesta, cta = r.cta && r.cta !== '-' ? r.cta : '', cards = r.tarjetas || [], ops = r.opciones || [];
      if (resp) { burbuja(resp, 'bot'); d.vista.push({ t: resp, c: 'bot' }); }
      cards.forEach(function (m) { tarjeta(m); d.vista.push({ card: m }); });
      if (cta) { burbuja(cta, 'bot cta'); d.vista.push({ t: cta, c: 'bot cta' }); }
      chips(ops); d.chips = ops;
      d.historial.push({ role: 'assistant', content: resp + (cards.length ? '\n[Se mostraron tarjetas con foto de: ' + cards.map(function (c) { return c.nombre; }).join(', ') + ']' : '') + (cta ? '\n' + cta : '') });
      guardar();
      if (!panel.classList.contains('on')) { badge.style.display = 'block'; }
      programarRescate();
    }
    function programarRescate() {
      if (rescate) clearTimeout(rescate);
      if (rescatado) return;
      rescate = setTimeout(function () {
        if (enviando || !panel.classList.contains('on') || d.vista.length < 3) return;
        rescatado = true;
        var R = '¿Seguís ahí? Te ayudo a *apartar tu moto* o a *precalificar* en 1 minuto.';
        burbuja(R, 'bot cta');
        d.vista.push({ t: R, c: 'bot cta' });
        guardar();
      }, 75000);
    }
    function enviar(texto) {
      texto = String(texto || '').trim();
      if (!texto || enviando) return;
      enviando = true; input.value = '';
      if (rescate) clearTimeout(rescate);
      quitarChips(); d.chips = [];
      burbuja(texto, 'user'); d.vista.push({ t: texto, c: 'user' });
      var previo = d.historial.slice();
      d.historial.push({ role: 'user', content: texto }); guardar();
      typing(true);
      var ctrl = window.AbortController ? new AbortController() : null;
      var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 25000);
      fetch(ENDPOINT, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texto, history: previo, estado: d.estado }),
        signal: ctrl ? ctrl.signal : undefined
      })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          typing(false);
          if (r && r.estado) d.estado = r.estado;
          if (!r || !r.respuesta) r = { respuesta: 'Perdón, no pude responder. Escribinos al WhatsApp *4016-5239*.' };
          mostrarBot(r);
        })
        .catch(function () { typing(false); mostrarBot({ respuesta: 'Se me trabó la conexión. Escribinos al WhatsApp *4016-5239* y te ayudamos de inmediato.' }); })
        .finally(function () { clearTimeout(to); enviando = false; });
    }
    function abrir() {
      teaser.style.display = 'none'; badge.style.display = 'none';
      try { sessionStorage.setItem('sofia_teaser_visto', '1'); } catch (e) {}
      panel.classList.add('on');
      if (!d.vista.length) {
        var s1 = '¡Hola! Soy *Sofía*, tu asesora de *Vento Barberena*. ¿Con quién tengo el gusto?';
        d.vista.push({ t: s1, c: 'bot' });
        d.chips = ['Ver motos', 'Financiamiento', 'Contado', 'Tarjeta de crédito'];
        d.historial.push({ role: 'assistant', content: s1 });
        guardar();
      }
      pintar();
      setTimeout(function () { input.focus(); }, 150);
    }
    function cerrar() { panel.classList.remove('on'); }

    $('sof-fab').addEventListener('click', function () { panel.classList.contains('on') ? cerrar() : abrir(); });
    $('sof-label').addEventListener('click', abrir);
    $('sof-close').addEventListener('click', cerrar);
    $('sof-send').addEventListener('click', function () { enviar(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(input.value); } });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('on')) cerrar(); });
    teaser.addEventListener('click', function (e) {
      if (e.target.classList.contains('x')) { teaser.style.display = 'none'; try { sessionStorage.setItem('sofia_teaser_visto', '1'); } catch (er) {} return; }
      abrir();
    });

    // Invitación a los 8 segundos (una vez por visita) + contador de no leído
    var visto = false;
    try { visto = sessionStorage.getItem('sofia_teaser_visto') === '1'; } catch (e) {}
    if (!visto) setTimeout(function () { if (!panel.classList.contains('on')) { teaser.style.display = 'block'; badge.style.display = 'block'; } }, 8000);
  }
})();
