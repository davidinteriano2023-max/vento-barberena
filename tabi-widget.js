/* tabi-widget.js — Chat flotante de Sofía (IA con Claude) para Vento Barberena.
   JS puro, sin frameworks. Habla con /.netlify/functions/web-ia, que usa la
   misma base de conocimiento en vivo (sitio + precios de Firebase) que la IA de Kommo. */
(function () {
  var FIREBASE_PROJECT_ID = window.VENTO_FIREBASE_PROJECT_ID || 'ventobarberena-cotizador';
  var FIREBASE_API_KEY    = window.VENTO_FIREBASE_API_KEY    || '';

  // Interruptor en Firestore (config/asesor_ia.activo = false oculta el chat)
  fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/config/asesor_ia?key=' + FIREBASE_API_KEY)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var f = data && data.fields;
      var desactivado = !!(f && f.activo && f.activo.booleanValue === false);
      if (!desactivado) iniciarWidget();
    })
    .catch(function () { iniciarWidget(); });

  function iniciarWidget() {
    var ENDPOINT    = '/.netlify/functions/web-ia';
    var STORAGE_KEY = 'sofia_vento_v1';
    var WHATSAPP    = '50240165239';

    var css =
      '#liaBtn{position:fixed;right:18px;bottom:18px;z-index:9999;width:62px;height:62px;border-radius:50%;' +
      'background:#0057C8;display:flex;align-items:center;justify-content:center;cursor:pointer;border:none;' +
      'box-shadow:0 4px 20px rgba(0,87,200,.45),0 2px 8px rgba(0,0,0,.3);transition:transform .15s,box-shadow .15s}' +
      '#liaBtn:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(0,87,200,.55)}' +
      '#liaBtn svg{width:30px;height:30px}' +
      '#liaBtn .lia-badge{position:absolute;top:2px;right:2px;width:14px;height:14px;border-radius:50%;background:#25D366;border:2px solid #fff}' +

      '#liaTeaser{position:fixed;right:90px;bottom:30px;z-index:9999;max-width:230px;background:#fff;color:#111;' +
      'border-radius:14px 14px 4px 14px;padding:10px 14px;font:500 13px/1.45 system-ui,sans-serif;' +
      'box-shadow:0 6px 24px rgba(0,0,0,.25);cursor:pointer;display:none;animation:liaIn .35s ease}' +
      '#liaTeaser b{color:#0057C8}' +
      '#liaTeaser .x{position:absolute;top:-8px;left:-8px;width:20px;height:20px;border-radius:50%;background:#333;color:#fff;' +
      'font-size:12px;line-height:20px;text-align:center;border:none;cursor:pointer}' +
      '@keyframes liaIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +

      '#liaPanel{position:fixed;right:18px;bottom:90px;z-index:9998;width:350px;max-width:calc(100vw - 36px);' +
      'height:min(74vh,540px);background:#0d0d0d;border:1.5px solid #2a2a2a;border-radius:18px;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.6);display:none;flex-direction:column;overflow:hidden;font-family:system-ui,sans-serif}' +
      '#liaPanel.on{display:flex;animation:liaIn .25s ease}' +
      '#liaHead{background:#111;color:#fff;padding:13px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #222}' +
      '#liaHead .lia-avatar{width:38px;height:38px;border-radius:50%;background:#0057C8;display:flex;' +
      'align-items:center;justify-content:center;flex-shrink:0;font:700 17px system-ui,sans-serif;color:#fff}' +
      '#liaHead .lia-info b{display:block;font-size:14px;color:#fff}' +
      '#liaHead .lia-info span{font-size:11px;color:#25D366}' +
      '#liaClose{background:none;border:none;color:#888;font-size:22px;cursor:pointer;margin-left:auto;line-height:1;padding:2px 6px}' +
      '#liaClose:hover{color:#fff}' +
      '#liaMsgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:8px;' +
      'background:#0d0d0d;scrollbar-width:thin;scrollbar-color:#333 transparent}' +
      '.lia-msg{max-width:84%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.55;white-space:pre-wrap;word-wrap:break-word;animation:liaIn .25s ease}' +
      '.lia-msg.bot{align-self:flex-start;background:#1a1a1a;color:#eee;border-bottom-left-radius:4px}' +
      '.lia-msg.bot.cta{background:#0f2a52;color:#fff;border:1px solid #1f4f99}' +
      '.lia-msg.user{align-self:flex-end;background:#0057C8;color:#fff;border-bottom-right-radius:4px}' +
      '.lia-msg b{color:#fff;font-weight:700}' +
      '.lia-msg a{color:#7fb4ff;text-decoration:underline;word-break:break-all}' +
      '.lia-typing{display:flex;gap:4px;padding:10px 13px;background:#1a1a1a;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start}' +
      '.lia-dot{width:7px;height:7px;border-radius:50%;background:#666;animation:liaPulse 1.2s ease-in-out infinite}' +
      '.lia-dot:nth-child(2){animation-delay:.2s}.lia-dot:nth-child(3){animation-delay:.4s}' +
      '@keyframes liaPulse{0%,60%,100%{opacity:.3;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}' +
      '.lia-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}' +
      '.lia-chip{background:transparent;border:1.5px solid #0057C8;color:#7fb4ff;border-radius:20px;' +
      'padding:6px 13px;font-size:12.5px;cursor:pointer;transition:background .15s,color .15s}' +
      '.lia-chip:hover{background:#0057C8;color:#fff}' +
      '#liaInputRow{display:flex;gap:8px;padding:10px 12px;background:#111;border-top:1px solid #1e1e1e}' +
      '#liaInput{flex:1;background:#1a1a1a;border:1.5px solid #2a2a2a;border-radius:20px;' +
      'padding:9px 14px;color:#fff;font-size:13.5px;outline:none;transition:border-color .15s}' +
      '#liaInput:focus{border-color:#0057C8}' +
      '#liaInput::placeholder{color:#666}' +
      '#liaSend{background:#0057C8;color:#fff;border:none;border-radius:50%;width:38px;height:38px;' +
      'flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background .15s,transform .1s}' +
      '#liaSend:hover{background:#004aaa;transform:scale(1.05)}' +
      '#liaWa{display:flex;align-items:center;justify-content:center;gap:6px;color:#25D366;font-size:11.5px;' +
      'padding:6px 0 8px;background:#111;text-decoration:none}' +
      '#liaWa:hover{text-decoration:underline}';

    var styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);

    var btn = document.createElement('button');
    btn.id = 'liaBtn'; btn.type = 'button'; btn.setAttribute('aria-label', 'Chatear con Sofía');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z" fill="white"/></svg><span class="lia-badge"></span>';

    var teaser = document.createElement('div');
    teaser.id = 'liaTeaser';
    teaser.innerHTML = '<button class="x" type="button" aria-label="Cerrar">&times;</button>Hola, soy <b>Sofía</b>. ¿Te ayudo a elegir tu moto o a cotizar tu crédito?';

    var panel = document.createElement('div');
    panel.id = 'liaPanel';
    panel.innerHTML =
      '<div id="liaHead"><div class="lia-avatar">S</div>' +
      '<div class="lia-info"><b>Sofía — Vento Barberena</b><span>● En línea · responde al instante</span></div>' +
      '<button id="liaClose" type="button" aria-label="Cerrar">&times;</button></div>' +
      '<div id="liaMsgs"></div>' +
      '<div id="liaInputRow"><input id="liaInput" type="text" placeholder="Escribí tu pregunta…" autocomplete="off" maxlength="600">' +
      '<button id="liaSend" type="button" aria-label="Enviar"><svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg></button></div>' +
      '<a id="liaWa" href="https://wa.me/' + WHATSAPP + '" target="_blank" rel="noopener">¿Preferís WhatsApp? Escribinos al 4016-5239</a>';

    document.body.appendChild(btn);
    document.body.appendChild(teaser);
    document.body.appendChild(panel);

    var msgsEl = document.getElementById('liaMsgs');
    var inputEl = document.getElementById('liaInput');
    var sendBtn = document.getElementById('liaSend');
    var closeBtn = document.getElementById('liaClose');
    var datos = cargar();
    var enviando = false;

    function cargar() {
      try { var raw = sessionStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
      return { historial: [], vista: [], estado: {}, chips: [] };
    }
    function guardar() {
      datos.historial = datos.historial.slice(-24);
      datos.vista = datos.vista.slice(-40);
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(datos)); } catch (e) {}
    }
    function irAlFondo() { msgsEl.scrollTop = msgsEl.scrollHeight; }

    // Texto seguro: escapa HTML, *negritas* y enlaces clicables
    function formato(t) {
      var s = String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      s = s.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
      s = s.replace(/\*([^*\n]{1,80})\*/g, '<b>$1</b>');
      return s;
    }
    function burbuja(texto, clase) {
      var div = document.createElement('div');
      div.className = 'lia-msg ' + clase;
      div.innerHTML = formato(texto);
      msgsEl.appendChild(div);
      irAlFondo();
    }
    function quitarChips() { var c = msgsEl.querySelectorAll('.lia-chips'); for (var i = 0; i < c.length; i++) c[i].remove(); }
    function chips(lista) {
      quitarChips();
      if (!lista || !lista.length) return;
      var wrap = document.createElement('div');
      wrap.className = 'lia-chips';
      lista.forEach(function (op) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'lia-chip'; b.textContent = op;
        b.addEventListener('click', function () { enviar(op); });
        wrap.appendChild(b);
      });
      msgsEl.appendChild(wrap);
      irAlFondo();
    }
    function typing(on) {
      var t = document.getElementById('liaTyping');
      if (on && !t) {
        var div = document.createElement('div');
        div.className = 'lia-typing'; div.id = 'liaTyping';
        div.innerHTML = '<div class="lia-dot"></div><div class="lia-dot"></div><div class="lia-dot"></div>';
        msgsEl.appendChild(div); irAlFondo();
      } else if (!on && t) t.remove();
    }
    function pintarTodo() {
      msgsEl.innerHTML = '';
      datos.vista.forEach(function (v) { burbuja(v.t, v.c); });
      chips(datos.chips);
    }
    function mostrarBot(respuesta, cta, opciones) {
      if (respuesta) { burbuja(respuesta, 'bot'); datos.vista.push({ t: respuesta, c: 'bot' }); }
      if (cta && cta !== '-') {
        setTimeout(function () { burbuja(cta, 'bot cta'); chips(opciones); }, 650);
        datos.vista.push({ t: cta, c: 'bot cta' });
      } else {
        chips(opciones);
      }
      datos.chips = opciones || [];
      datos.historial.push({ role: 'assistant', content: respuesta + (cta && cta !== '-' ? '\n' + cta : '') });
      guardar();
    }

    function enviar(texto) {
      texto = String(texto || '').trim();
      if (!texto || enviando) return;
      enviando = true;
      inputEl.value = '';
      quitarChips(); datos.chips = [];
      burbuja(texto, 'user');
      datos.vista.push({ t: texto, c: 'user' });
      var historialPrevio = datos.historial.slice();
      datos.historial.push({ role: 'user', content: texto });
      guardar();
      typing(true);

      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: texto, history: historialPrevio, estado: datos.estado })
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          typing(false);
          if (d && d.estado) datos.estado = d.estado;
          mostrarBot((d && d.respuesta) || 'Perdón, no pude responder. Escribinos al WhatsApp *4016-5239*.', d && d.cta, (d && d.opciones) || []);
        })
        .catch(function () {
          typing(false);
          mostrarBot('Se me trabó la conexión. Escribinos al WhatsApp *4016-5239* y te ayudamos de inmediato.', '', []);
        })
        .finally(function () { enviando = false; });
    }

    function abrir() {
      teaser.style.display = 'none';
      try { sessionStorage.setItem('sofia_teaser_visto', '1'); } catch (e) {}
      panel.classList.add('on');
      if (!datos.vista.length) {
        var saludo = '¡Hola! Soy *Sofía*, tu asesora de *Vento Barberena*. Te ayudo a encontrar tu moto ideal y la mejor forma de pagarla.';
        var pregunta = '¿Qué *moto* te gustaría estrenar o cómo te puedo ayudar?';
        datos.vista.push({ t: saludo, c: 'bot' }, { t: pregunta, c: 'bot cta' });
        datos.chips = ['Ver modelos y precios', 'Quiero financiamiento', 'Pago de contado', 'Con tarjeta de crédito'];
        datos.historial.push({ role: 'assistant', content: saludo + '\n' + pregunta });
        guardar();
      }
      pintarTodo();
      setTimeout(function () { inputEl.focus(); }, 150);
    }

    btn.addEventListener('click', function () { if (panel.classList.contains('on')) panel.classList.remove('on'); else abrir(); });
    teaser.addEventListener('click', function (e) {
      if (e.target.classList.contains('x')) { teaser.style.display = 'none'; try { sessionStorage.setItem('sofia_teaser_visto', '1'); } catch (er) {} return; }
      abrir();
    });
    closeBtn.addEventListener('click', function () { panel.classList.remove('on'); });
    sendBtn.addEventListener('click', function () { enviar(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(inputEl.value); } });

    // Invitación suave a los 8 segundos (una vez por visita)
    var visto = false;
    try { visto = sessionStorage.getItem('sofia_teaser_visto') === '1'; } catch (e) {}
    if (!visto) setTimeout(function () { if (!panel.classList.contains('on')) teaser.style.display = 'block'; }, 8000);
  }
})();
