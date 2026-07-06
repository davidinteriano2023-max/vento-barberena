/* tabi-widget.js — Chat flotante LIA para Vento Barberena. JS puro sin frameworks. */
(function () {
  var FIREBASE_PROJECT_ID = window.VENTO_FIREBASE_PROJECT_ID || 'ventobarberena-cotizador';
  var FIREBASE_API_KEY    = window.VENTO_FIREBASE_API_KEY    || 'AIzaSyD8MUzezXAT9EFy2RMKGyRSCaMfJIBmwIU';

  // Verificar si el bot está activo en Firestore antes de mostrar el widget
  fetch('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/config/asesor_ia?key=' + FIREBASE_API_KEY)
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      var f = data && data.fields;
      var desactivado = !!(f && f.activo && f.activo.booleanValue === false);
      if (!desactivado) iniciarWidget();
    })
    .catch(function () { iniciarWidget(); }); // si falla, mostrar igual

  function iniciarWidget() {
    var ENDPOINT    = '/.netlify/functions/tabi-chat';
    var STORAGE_KEY = 'lia_vento_historial_v1';

    // ── Estilos (tema rojo/negro de Vento Barberena) ─────────────────────────
    var css =
      '#liaBtn{position:fixed;right:18px;bottom:18px;z-index:9999;width:62px;height:62px;border-radius:50%;' +
      'background:#E8142B;display:flex;align-items:center;justify-content:center;cursor:pointer;border:none;' +
      'box-shadow:0 4px 20px rgba(232,20,43,.45),0 2px 8px rgba(0,0,0,.3);transition:transform .15s,box-shadow .15s}' +
      '#liaBtn:hover{transform:scale(1.08);box-shadow:0 6px 28px rgba(232,20,43,.55)}' +
      '#liaBtn svg{width:30px;height:30px}' +

      '#liaPanel{position:fixed;right:18px;bottom:90px;z-index:9998;width:340px;max-width:calc(100vw - 36px);' +
      'height:min(72vh,500px);background:#0d0d0d;border:1.5px solid #2a2a2a;border-radius:18px;' +
      'box-shadow:0 8px 40px rgba(0,0,0,.6),0 2px 0 rgba(232,20,43,.4);' +
      'display:none;flex-direction:column;overflow:hidden;font-family:system-ui,sans-serif}' +
      '#liaPanel.on{display:flex}' +

      '#liaHead{background:#111;color:#fff;padding:13px 16px;display:flex;align-items:center;gap:10px;' +
      'border-bottom:1px solid #222}' +
      '#liaHead .lia-avatar{width:36px;height:36px;border-radius:50%;background:#E8142B;display:flex;' +
      'align-items:center;justify-content:center;flex-shrink:0;font-size:18px}' +
      '#liaHead .lia-info b{display:block;font-size:14px;color:#fff}' +
      '#liaHead .lia-info span{font-size:11px;color:#25D366}' +
      '#liaClose{background:none;border:none;color:#888;font-size:22px;cursor:pointer;margin-left:auto;line-height:1;padding:2px 6px}' +
      '#liaClose:hover{color:#fff}' +

      '#liaMsgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;' +
      'background:#0d0d0d;scrollbar-width:thin;scrollbar-color:#333 transparent}' +
      '.lia-msg{max-width:82%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.55;white-space:pre-wrap}' +
      '.lia-msg.bot{align-self:flex-start;background:#1a1a1a;color:#eee;border-bottom-left-radius:4px}' +
      '.lia-msg.user{align-self:flex-end;background:#E8142B;color:#fff;border-bottom-right-radius:4px}' +
      '.lia-typing{display:flex;gap:4px;padding:10px 13px;background:#1a1a1a;border-radius:14px;' +
      'border-bottom-left-radius:4px;align-self:flex-start}' +
      '.lia-dot{width:7px;height:7px;border-radius:50%;background:#666;animation:liaPulse 1.2s ease-in-out infinite}' +
      '.lia-dot:nth-child(2){animation-delay:.2s}.lia-dot:nth-child(3){animation-delay:.4s}' +
      '@keyframes liaPulse{0%,60%,100%{opacity:.3;transform:scale(.8)}30%{opacity:1;transform:scale(1.1)}}' +
      '.lia-chips{display:flex;flex-wrap:wrap;gap:6px}' +
      '.lia-chip{background:transparent;border:1.5px solid #E8142B;color:#E8142B;border-radius:20px;' +
      'padding:6px 13px;font-size:12.5px;cursor:pointer;transition:background .15s,color .15s}' +
      '.lia-chip:hover{background:#E8142B;color:#fff}' +

      '#liaInputRow{display:flex;gap:8px;padding:10px 12px;background:#111;border-top:1px solid #1e1e1e}' +
      '#liaInput{flex:1;background:#1a1a1a;border:1.5px solid #2a2a2a;border-radius:20px;' +
      'padding:9px 14px;color:#fff;font-size:13.5px;outline:none;transition:border-color .15s}' +
      '#liaInput:focus{border-color:#E8142B}' +
      '#liaInput::placeholder{color:#555}' +
      '#liaSend{background:#E8142B;color:#fff;border:none;border-radius:50%;width:38px;height:38px;' +
      'flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;' +
      'transition:background .15s,transform .1s}' +
      '#liaSend:hover{background:#c0101f;transform:scale(1.05)}' +

      '#liaWa{display:flex;align-items:center;justify-content:center;gap:6px;' +
      'color:#25D366;font-size:11.5px;padding:6px 0 2px;cursor:pointer;text-decoration:none}' +
      '#liaWa:hover{text-decoration:underline}';

    var styleTag = document.createElement('style');
    styleTag.textContent = css;
    document.head.appendChild(styleTag);

    // ── Botón flotante ───────────────────────────────────────────────────────
    var btn = document.createElement('button');
    btn.id   = 'liaBtn';
    btn.type = 'button';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M20 2H4a2 2 0 00-2 2v18l4-4h14a2 2 0 002-2V4a2 2 0 00-2-2z" fill="white"/>' +
      '</svg>';

    // ── Panel de chat ────────────────────────────────────────────────────────
    var panel = document.createElement('div');
    panel.id = 'liaPanel';
    panel.innerHTML =
      '<div id="liaHead">' +
      '<div class="lia-avatar">🏍️</div>' +
      '<div class="lia-info"><b>LIA — Vento Barberena</b><span>● En línea</span></div>' +
      '<button id="liaClose" type="button">&times;</button>' +
      '</div>' +
      '<div id="liaMsgs"></div>' +
      '<div id="liaInputRow">' +
      '<input id="liaInput" type="text" placeholder="Escribe tu pregunta…" autocomplete="off">' +
      '<button id="liaSend" type="button">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="white"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>' +
      '</button>' +
      '</div>' +
      '<a id="liaWa" href="https://wa.me/50238978935" target="_blank" rel="noopener">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.105.549 4.082 1.51 5.8L0 24l6.388-1.674A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.6c-1.944 0-3.77-.538-5.328-1.472l-.38-.227-3.795.994 1.012-3.694-.248-.381A9.554 9.554 0 012.4 12c0-5.295 4.305-9.6 9.6-9.6 5.295 0 9.6 4.305 9.6 9.6 0 5.295-4.305 9.6-9.6 9.6z"/></svg>' +
      ' Escribir por WhatsApp al 3897-8935' +
      '</a>';

    document.body.appendChild(btn);
    document.body.appendChild(panel);

    var msgsEl  = document.getElementById('liaMsgs');
    var inputEl = document.getElementById('liaInput');
    var sendBtn = document.getElementById('liaSend');
    var closeBtn = document.getElementById('liaClose');
    var historial = cargarHistorial();
    var enviando  = false;

    // ── Helpers ──────────────────────────────────────────────────────────────
    function cargarHistorial() {
      try { var raw = sessionStorage.getItem(STORAGE_KEY); if (raw) return JSON.parse(raw); } catch (e) {}
      return [];
    }
    function guardarHistorial() {
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(historial.slice(-30))); } catch (e) {}
    }
    function irAlFondo() { msgsEl.scrollTop = msgsEl.scrollHeight; }

    function agregarBurbuja(texto, quien) {
      var div = document.createElement('div');
      div.className = 'lia-msg ' + quien;
      div.textContent = texto;
      msgsEl.appendChild(div);
      irAlFondo();
      return div;
    }

    function mostrarTyping() {
      var div = document.createElement('div');
      div.className = 'lia-typing';
      div.id = 'liaTyping';
      div.innerHTML = '<div class="lia-dot"></div><div class="lia-dot"></div><div class="lia-dot"></div>';
      msgsEl.appendChild(div);
      irAlFondo();
    }
    function ocultarTyping() {
      var t = document.getElementById('liaTyping');
      if (t) t.remove();
    }

    function agregarChips(opciones) {
      var wrap = document.createElement('div');
      wrap.className = 'lia-chips';
      opciones.forEach(function (op) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'lia-chip'; b.textContent = op.trim();
        b.addEventListener('click', function () { setTimeout(function () { wrap.remove(); }, 0); enviarMensaje(op.trim()); });
        wrap.appendChild(b);
      });
      msgsEl.appendChild(wrap);
      irAlFondo();
    }

    function renderRespuesta(texto) {
      var restante   = texto;
      var chipsMatch = restante.match(/\[\[CHIPS:([^\]]+)\]\]/);
      var chips      = null;
      if (chipsMatch) { chips = chipsMatch[1].split('|'); restante = restante.replace(chipsMatch[0], '').trim(); }
      restante = restante.replace(/\[\[PRODUCTO:[A-Z0-9]+\]\]/g, '').trim();
      if (restante) agregarBurbuja(restante, 'bot');
      if (chips) agregarChips(chips);
    }

    // ── Enviar mensaje ────────────────────────────────────────────────────────
    function enviarMensaje(texto) {
      texto = (texto || '').trim();
      if (!texto || enviando) return;
      enviando = true;
      inputEl.value = '';
      agregarBurbuja(texto, 'user');
      historial.push({ role: 'user', content: texto });
      guardarHistorial();
      mostrarTyping();

      fetch(ENDPOINT, {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ message: texto, history: historial.slice(0, -1) })
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          ocultarTyping();
          var reply = (data && data.reply) || 'Perdona, no pude responder. Escribinos al WhatsApp 3897-8935.';
          renderRespuesta(reply);
          historial.push({ role: 'assistant', content: reply });
          guardarHistorial();
        })
        .catch(function () {
          ocultarTyping();
          agregarBurbuja('Se me trabó la conexión. Escribinos al WhatsApp 3897-8935 para ayudarte. 📲', 'bot');
        })
        .finally(function () { enviando = false; });
    }

    // ── Abrir panel ───────────────────────────────────────────────────────────
    function abrirPanel() {
      panel.classList.add('on');
      if (!historial.length) {
        var saludo = '¡Hola! 👋 Soy LIA, la asistente de Vento Barberena. ¿Te interesa alguna moto o querés cotizar? [[CHIPS:Ver catálogo|Precios y planes|Hablar con asesor]]';
        renderRespuesta(saludo);
        var textoLimpio = saludo.replace(/\[\[CHIPS:[^\]]+\]\]/g, '').trim();
        historial.push({ role: 'assistant', content: textoLimpio });
        guardarHistorial();
      } else {
        msgsEl.innerHTML = '';
        historial.forEach(function (m) {
          if (m.role === 'user') agregarBurbuja(m.content, 'user');
          else renderRespuesta(m.content);
        });
      }
      setTimeout(function () { inputEl.focus(); }, 150);
    }

    // ── Eventos ────────────────────────────────────────────────────────────────
    btn.addEventListener('click', function () {
      if (panel.classList.contains('on')) {
        panel.classList.remove('on');
      } else {
        msgsEl.innerHTML = '';
        abrirPanel();
      }
    });
    closeBtn.addEventListener('click', function () { panel.classList.remove('on'); });
    sendBtn.addEventListener('click', function () { enviarMensaje(inputEl.value); });
    inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensaje(in