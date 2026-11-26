/*!
 * AI Receptionist website chat widget.
 * Add to any page (best just before </body>, e.g. in the footer):
 *   <script src="https://YOUR-BACKEND/widget/chatbot.js" data-key="SITE_KEY" async></script>
 * Visitors enter their email, then chat live with the AI agent (or a
 * member of the team who takes over from the dashboard).
 */
(function () {
  'use strict';
  if (window.__aiReceptionistWidget) return;
  window.__aiReceptionistWidget = true;

  var script = document.currentScript || (function () {
    var all = document.querySelectorAll('script[src*="/widget/chatbot.js"]');
    return all[all.length - 1];
  })();
  if (!script) return;
  var KEY = script.getAttribute('data-key') || '';
  var BASE = new URL(script.src, location.href).origin;
  var STORE = 'aiw_' + KEY;
  var POLL_OPEN = 1500, POLL_CLOSED = 15000;
  var TYPING_PING = 1500;          // how often "still typing" is sent while the visitor types
  var lastTypingPing = 0, teamTyping = false;

  var cfg = null, session = null, lastId = 0, open = false, sending = false, unread = 0, pollTimer = null;
  var visitorSpoke = false, chipsRow = null, ended = false, endBtn = null;

  // ---- storage (may be blocked: private mode, cookie settings) ----
  function load() { try { return JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { return null; } }
  function save(v) { try { v ? localStorage.setItem(STORE, JSON.stringify(v)) : localStorage.removeItem(STORE); } catch (e) {} }

  // ---- API (text/plain bodies: no CORS preflight) ----
  function api(path, body) {
    var opts = body ? { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) } : {};
    return fetch(BASE + '/widget' + path, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error(d.detail || ('Error ' + r.status)); e.status = r.status; throw e; }
        return d;
      });
    });
  }

  // ---- UI ----
  var host = document.createElement('div');
  host.id = 'ai-receptionist-widget';
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

  function css(color, side) {
    return '' +
      ':host{all:initial}*{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}' +
      '.wrap{position:fixed;bottom:20px;' + side + ':20px;z-index:2147483000;display:flex;flex-direction:column;align-items:' + (side === 'left' ? 'flex-start' : 'flex-end') + ';gap:12px}' +
      '.launcher{display:flex;align-items:center;gap:10px;border:0;cursor:pointer;background:' + color + ';color:#fff;border-radius:999px;padding:14px 20px 14px 16px;font-size:15px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.22);transition:transform .15s,box-shadow .15s;position:relative}' +
      '.launcher:hover{transform:translateY(-2px);box-shadow:0 12px 28px rgba(0,0,0,.28)}.launcher:focus-visible{outline:3px solid rgba(0,0,0,.35);outline-offset:3px}' +
      '.launcher svg{width:24px;height:24px;flex:none}.launcher.icon-only{padding:16px;border-radius:50%}' +
      '.badge{position:absolute;top:-4px;' + (side === 'left' ? 'left' : 'right') + ':-4px;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:#ef4444;color:#fff;font-size:12px;font-weight:700;display:none;align-items:center;justify-content:center;border:2px solid #fff}' +
      '.panel{width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 110px);background:#fff;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.25);display:none;flex-direction:column;overflow:hidden;color:#111827;animation:pop .18s ease-out}' +
      '.panel.open{display:flex}@keyframes pop{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}' +
      '.head{background:' + color + ';color:#fff;padding:16px 16px 18px;display:flex;align-items:center;gap:12px}' +
      '.avatar{width:42px;height:42px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;flex:none;position:relative}' +
      '.avatar:after{content:"";position:absolute;bottom:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid ' + color + '}' +
      '.head .t{flex:1;min-width:0}.head h2{margin:0;font-size:16px;font-weight:700;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.head p{margin:2px 0 0;font-size:12.5px;opacity:.85}' +
      '.x{background:rgba(255,255,255,.15);border:0;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:18px;line-height:1;flex:none}.x:hover{background:rgba(255,255,255,.28)}' +
      '.body{flex:1;overflow-y:auto;padding:18px 14px;background:#f7f7fb;display:flex;flex-direction:column;gap:10px}' +
      '.gate{background:#fff;border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.08)}.gate p.w{margin:0 0 14px;font-size:14px;line-height:1.5;color:#374151}' +
      '.gate label{display:block;font-size:12.5px;font-weight:600;color:#374151;margin:10px 0 5px}.gate label span{color:#9ca3af;font-weight:400}' +
      '.gate input{width:100%;padding:11px 12px;border:1px solid #d1d5db;border-radius:10px;font-size:14px;outline:none;background:#fff;color:#111827}.gate input:focus{border-color:' + color + ';box-shadow:0 0 0 3px ' + color + '22}' +
      '.btn{width:100%;margin-top:16px;padding:12px;border:0;border-radius:10px;background:' + color + ';color:#fff;font-size:15px;font-weight:600;cursor:pointer}.btn:disabled{opacity:.6;cursor:default}' +
      '.note{font-size:11.5px;color:#6b7280;margin:10px 0 0;line-height:1.45}.err{color:#dc2626;font-size:12.5px;margin:8px 0 0;min-height:1em}' +
      '.row{display:flex;gap:8px;align-items:flex-end}.row.me{flex-direction:row-reverse}' +
      '.avatar.logo,.mini.logo{background:#fff;padding:3px;overflow:hidden}.avatar.logo{padding:5px}.mini.logo{border:1px solid #e5e7eb}' +
      '.avatar img,.mini img{width:100%;height:100%;object-fit:contain;border-radius:50%;display:block}' +
      '.typing-who{font-size:11px;color:#6b7280;margin:0 0 3px 2px}' +
      '.mini{width:28px;height:28px;border-radius:50%;background:' + color + ';color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;flex:none}.mini.op{background:#0f766e}.mini.hide{visibility:hidden}' +
      '.bubble{max-width:78%;padding:10px 13px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere}' +
      '.bubble.fmt{white-space:normal}.bubble.fmt p{margin:0 0 6px}.bubble.fmt p:last-child{margin-bottom:0}.bubble.fmt .lh{font-weight:600;margin-bottom:4px}' +
      '.bubble.fmt ul,.bubble.fmt ol{margin:0 0 6px;padding-left:18px}.bubble.fmt ul:last-child,.bubble.fmt ol:last-child{margin-bottom:0}.bubble.fmt li{margin:2px 0}' +
      '.bubble.fmt ul li::marker{color:' + color + '}.bubble.fmt .more{font-size:12.5px;opacity:.7}' +
      '.them .bubble{background:#fff;color:#111827;border-bottom-left-radius:5px;box-shadow:0 1px 2px rgba(0,0,0,.07)}.me .bubble{background:' + color + ';color:#fff;border-bottom-right-radius:5px}' +
      '.who{font-size:11px;color:#6b7280;margin:0 0 3px 2px}.meta{font-size:10.5px;color:#9ca3af;margin:3px 4px 0}.me .meta{text-align:right}' +
      '.sys{align-self:center;font-size:12px;color:#6b7280;background:#eceef3;padding:5px 11px;border-radius:999px;text-align:center;max-width:90%}' +
      '.typing{display:flex;gap:4px;padding:13px 14px}.typing i{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:b 1.2s infinite}.typing i:nth-child(2){animation-delay:.15s}.typing i:nth-child(3){animation-delay:.3s}' +
      '@keyframes b{0%,60%,100%{transform:none;opacity:.5}30%{transform:translateY(-4px);opacity:1}}' +
      '.foot{border-top:1px solid #e5e7eb;padding:10px 12px 8px;background:#fff}.compose{display:flex;gap:8px;align-items:flex-end}' +
      '.compose textarea{flex:1;resize:none;border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;font-size:14px;max-height:110px;min-height:42px;outline:none;color:#111827;background:#fff;line-height:1.4}.compose textarea:focus{border-color:' + color + '}' +
      '.send{width:42px;height:42px;border:0;border-radius:12px;background:' + color + ';color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none}.send:disabled{opacity:.45;cursor:default}.send svg{width:18px;height:18px}' +
      /* Quick replies: a tidy list of suggestions under the agent's message. Dark text on
         white stays readable whatever the brand colour; the colour is the accent. */
      '.chips{display:flex;flex-direction:column;align-items:stretch;gap:6px;margin:-2px 0 4px 36px;max-width:calc(100% - 52px)}' +
      '.chips-label{font-size:11px;font-weight:600;letter-spacing:.02em;color:#6b7280;margin:0 0 1px 2px}' +
      '.chip{display:flex;align-items:center;gap:10px;width:100%;border:1px solid #e5e7eb;background:#fff;color:#1f2937;border-radius:12px;'
        + 'padding:10px 12px;font-size:13.5px;font-weight:500;line-height:1.3;text-align:left;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.05);'
        + 'transition:border-color .15s,background .15s,color .15s,transform .15s,box-shadow .15s;animation:chipin .25s ease-out}' +
      '.chip span{flex:1;min-width:0}' +
      '.chip svg{width:16px;height:16px;flex:none;color:' + color + ';transition:transform .15s,color .15s}' +
      '.chip:hover{border-color:' + color + ';background:' + color + ';color:#fff;transform:translateY(-1px);box-shadow:0 4px 12px ' + color + '33}' +
      '.chip:hover svg{color:#fff;transform:translateX(2px)}' +
      '.chip:active{transform:translateY(0)}' +
      '.chip:focus-visible{outline:2px solid ' + color + ';outline-offset:2px}' +
      '@keyframes chipin{from{opacity:.4;transform:translateY(4px)}to{opacity:1;transform:none}}' +
      '@media (prefers-reduced-motion:reduce){.chip,.panel,.chips{animation:none!important}}' +
      '.endbtn{background:rgba(255,255,255,.15);border:0;color:#fff;height:32px;padding:0 12px;border-radius:999px;cursor:pointer;font-size:12.5px;font-weight:600;flex:none;white-space:nowrap}.endbtn:hover{background:rgba(255,255,255,.28)}' +
      '.confirm{display:flex;align-items:center;gap:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:10px 12px;margin-bottom:8px;font-size:13px;color:#7f1d1d;animation:pop .15s ease-out}' +
      '.confirm span{flex:1}.confirm button{border:0;border-radius:8px;padding:7px 11px;font-size:12.5px;font-weight:600;cursor:pointer}' +
      '.confirm .yes{background:#dc2626;color:#fff}.confirm .no{background:#fff;color:#374151;border:1px solid #e5e7eb}' +
      '.ended{text-align:center;padding:4px 2px 2px}.ended .done{font-size:13px;color:#374151;font-weight:600;margin:2px 0 2px}.ended p{font-size:12px;color:#6b7280;margin:0 0 10px}.ended .btn{margin-top:0}' +
      '.me-line{font-size:11px;color:#9ca3af;margin-top:6px;display:flex;justify-content:space-between;gap:8px}.me-line button{background:none;border:0;color:#6b7280;cursor:pointer;font-size:11px;text-decoration:underline;padding:0}' +
      '@media (max-width:480px){.wrap{bottom:12px;' + side + ':12px}.panel{position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0}.wrap.is-open .launcher{display:none}}';
  }

  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  var ICON_ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>';

  // An avatar: the company logo (Widget setup) or the agent's initial.
  function avatarEl(cls, who) {
    if (who === 'operator') return el('div', cls + ' op', 'T');
    if (cfg.logo_url) {
      var a = el('div', cls + ' logo');
      var img = document.createElement('img');
      img.src = BASE + cfg.logo_url; img.alt = cfg.title + ' logo';
      img.onerror = function () { a.className = cls; a.textContent = initial(cfg.agent_name); };
      a.appendChild(img);
      return a;
    }
    return el('div', cls, initial(cfg.agent_name));
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function initial(s) { return (s || 'A').trim().charAt(0).toUpperCase(); }
  function hhmm(iso) { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } }

  var wrap, launcher, badge, panel, body, foot, input, sendBtn, typingRow, meLine;

  function build() {
    var style = el('style'); style.textContent = css(cfg.color, cfg.position);
    root.appendChild(style);
    wrap = el('div', 'wrap');

    panel = el('div', 'panel');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', cfg.title + ' chat');
    var head = el('div', 'head');
    var av = avatarEl('avatar', 'agent');
    var t = el('div', 't');
    t.appendChild(el('h2', null, cfg.title));
    t.appendChild(el('p', null, cfg.subtitle));
    var x = el('button', 'x'); x.innerHTML = '&times;'; x.setAttribute('aria-label', 'Close chat');
    x.onclick = toggle;
    x.setAttribute('title', 'Minimise (the chat stays open)');
    endBtn = el('button', 'endbtn', 'End chat');
    endBtn.type = 'button';
    endBtn.setAttribute('aria-label', 'End this chat');
    endBtn.onclick = askEnd;
    endBtn.style.display = 'none';
    head.appendChild(av); head.appendChild(t); head.appendChild(endBtn); head.appendChild(x);
    body = el('div', 'body'); body.setAttribute('aria-live', 'polite');
    foot = el('div', 'foot');
    panel.appendChild(head); panel.appendChild(body); panel.appendChild(foot);

    launcher = el('button', 'launcher');
    launcher.setAttribute('aria-label', 'Open chat');
    if (!cfg.launcher_text) launcher.classList.add('icon-only');
    setLauncher(false);
    badge = el('span', 'badge');
    launcher.appendChild(badge);
    launcher.onclick = toggle;

    wrap.appendChild(panel); wrap.appendChild(launcher);
    root.appendChild(wrap);
    (document.body || document.documentElement).appendChild(host);
  }

  function setLauncher(isOpen) {
    var b = badge;
    launcher.innerHTML = isOpen ? ICON_CLOSE : ICON_CHAT + (cfg.launcher_text ? '<span>' + escapeHtml(cfg.launcher_text) + '</span>' : '');
    if (cfg.launcher_text && isOpen) launcher.classList.add('icon-only'); else if (cfg.launcher_text) launcher.classList.remove('icon-only');
    if (b) launcher.appendChild(b);
    launcher.setAttribute('aria-label', isOpen ? 'Close chat' : 'Open chat');
  }
  function escapeHtml(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  function setUnread(n) {
    unread = n;
    badge.textContent = n > 9 ? '9+' : String(n);
    badge.style.display = n > 0 ? 'flex' : 'none';
  }

  function toggle() {
    open = !open;
    panel.classList.toggle('open', open);
    wrap.classList.toggle('is-open', open);
    setLauncher(open);
    if (open) {
      setUnread(0);
      if (!body.childNodes.length) render();
      setTimeout(function () { var f = input || root.querySelector('input'); if (f) f.focus(); scroll(); }, 60);
    }
    schedulePoll();
  }

  // ---- email gate ----
  function renderGate(error) {
    body.innerHTML = ''; foot.innerHTML = ''; foot.style.display = 'none';
    var g = el('form', 'gate'); g.noValidate = true;
    g.appendChild(el('p', 'w', cfg.welcome));
    var nameInput = null;
    if (cfg.ask_name) {
      var l1 = el('label', null, 'Your name '); l1.appendChild(el('span', null, '(optional)'));
      nameInput = el('input'); nameInput.type = 'text'; nameInput.autocomplete = 'name'; nameInput.maxLength = 80; nameInput.placeholder = 'Jane Smith';
      l1.htmlFor = nameInput.id = 'aiw-name';
      g.appendChild(l1); g.appendChild(nameInput);
    }
    var l2 = el('label', null, 'Email address');
    var emailInput = el('input'); emailInput.type = 'email'; emailInput.required = true; emailInput.autocomplete = 'email'; emailInput.placeholder = 'you@example.com';
    l2.htmlFor = emailInput.id = 'aiw-email';
    g.appendChild(l2); g.appendChild(emailInput);
    var err = el('p', 'err', error || '');
    var btn = el('button', 'btn', 'Start chat'); btn.type = 'submit';
    g.appendChild(err); g.appendChild(btn);
    g.appendChild(el('p', 'note', 'We use your email to keep track of this conversation and to follow up if needed.'));
    g.onsubmit = function (e) {
      e.preventDefault();
      var email = emailInput.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { err.textContent = 'Please enter a valid email address.'; emailInput.focus(); return; }
      btn.disabled = true; btn.textContent = 'Starting…'; err.textContent = '';
      api('/session', { key: KEY, email: email, name: nameInput ? nameInput.value.trim() : '', page_url: location.href })
        .then(function (d) {
          session = { session_id: d.session_id, token: d.token, email: d.email, name: d.name };
          save(session);
          start(d.messages);
        })
        .catch(function (e2) { btn.disabled = false; btn.textContent = 'Start chat'; err.textContent = e2.message; });
    };
    body.appendChild(g);
    setTimeout(function () { (nameInput || emailInput).focus(); }, 30);
  }

  // ---- chat ----
  function renderChat() {
    body.innerHTML = ''; foot.innerHTML = ''; foot.style.display = 'block';
    var c = el('div', 'compose');
    input = el('textarea'); input.rows = 1; input.placeholder = 'Type your message…'; input.maxLength = 1000;
    input.setAttribute('aria-label', 'Message');
    sendBtn = el('button', 'send'); sendBtn.innerHTML = ICON_SEND; sendBtn.setAttribute('aria-label', 'Send message'); sendBtn.disabled = true;
    input.oninput = function () {
      sendBtn.disabled = !input.value.trim() || sending;
      sendTyping(!!input.value.trim());
      input.style.height = 'auto'; input.style.height = Math.min(110, input.scrollHeight) + 'px';
    };
    input.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } };
    sendBtn.onclick = send;
    c.appendChild(input); c.appendChild(sendBtn);
    meLine = el('div', 'me-line');
    meLine.appendChild(el('span', null, 'Chatting as ' + session.email));
    var notYou = el('button', null, 'Not you?');
    notYou.onclick = function () { save(null); session = null; lastId = 0; ended = false; updateEndBtn(); renderGate(); };
    meLine.appendChild(notYou);
    foot.appendChild(c); foot.appendChild(meLine);
  }

  // ---- ending the chat ----
  function updateEndBtn() { if (endBtn) endBtn.style.display = session && !ended ? '' : 'none'; }

  function askEnd() {
    if (!session || ended || root.querySelector('.confirm')) return;
    var box = el('div', 'confirm');
    box.setAttribute('role', 'alertdialog');
    box.appendChild(el('span', null, 'End this chat?'));
    var yes = el('button', 'yes', 'End chat'); yes.type = 'button';
    var no = el('button', 'no', 'Cancel'); no.type = 'button';
    no.onclick = function () { box.parentNode && box.parentNode.removeChild(box); if (input) input.focus(); };
    yes.onclick = function () {
      yes.disabled = true; yes.textContent = 'Ending…';
      api('/end', { key: KEY, session_id: session.session_id, token: session.token, after: lastId })
        .then(function (d) { addMessages(d.messages || []); showEnded(); })
        .catch(function (e) { yes.disabled = false; yes.textContent = 'End chat'; box.firstChild.textContent = e.message || 'Could not end the chat.'; });
    };
    box.appendChild(yes); box.appendChild(no);
    foot.insertBefore(box, foot.firstChild);
    yes.focus();
  }

  function showEnded() {
    ended = true;
    clearTimeout(pollTimer);
    hideChips();
    typing(false);
    updateEndBtn();
    foot.innerHTML = ''; foot.style.display = 'block';
    var box = el('div', 'ended');
    box.appendChild(el('div', 'done', 'This chat has ended'));
    box.appendChild(el('p', null, 'Thanks for chatting with us. You can start a new chat any time.'));
    var again = el('button', 'btn', 'Start a new chat'); again.type = 'button';
    again.onclick = function () {
      again.disabled = true; again.textContent = 'Starting…';
      api('/session', { key: KEY, email: session.email, name: session.name || '', page_url: location.href })
        .then(function (d) {
          session = { session_id: d.session_id, token: d.token, email: d.email, name: d.name };
          save(session);
          body.innerHTML = ''; lastSender = null;
          start(d.messages);
        })
        .catch(function (e) { again.disabled = false; again.textContent = 'Start a new chat'; box.lastChild.textContent = e.message; });
    };
    box.appendChild(again);
    var other = el('div', 'me-line');
    other.appendChild(el('span', null, 'Chatted as ' + session.email));
    var notYou = el('button', null, 'Use a different email');
    notYou.onclick = function () { save(null); session = null; lastId = 0; ended = false; updateEndBtn(); renderGate(); };
    other.appendChild(notYou);
    box.appendChild(other);
    foot.appendChild(box);
    scroll();
  }

  function start(messages) {
    lastId = 0;
    ended = false;
    visitorSpoke = false;
    renderChat();
    addMessages(messages || []);
    showChips();
    updateEndBtn();
    if (open) input.focus();
    schedulePoll();
  }

  // ---- quick replies: tap instead of typing ----
  function showChips() {
    hideChips();
    var list = (cfg.quick_replies || []).filter(Boolean);
    if (visitorSpoke || !list.length) return;
    chipsRow = el('div', 'chips');
    chipsRow.setAttribute('role', 'group');
    chipsRow.setAttribute('aria-label', 'Suggested questions');
    chipsRow.appendChild(el('div', 'chips-label', 'Suggested questions'));
    list.forEach(function (q) {
      var c = el('button', 'chip');
      c.type = 'button';
      c.appendChild(el('span', null, q));
      c.insertAdjacentHTML('beforeend', ICON_ARROW);
      c.onclick = function () { send(q); };
      chipsRow.appendChild(c);
    });
    body.appendChild(chipsRow);
    scroll();
  }
  function hideChips() {
    if (chipsRow && chipsRow.parentNode) chipsRow.parentNode.removeChild(chipsRow);
    chipsRow = null;
  }

  // How long "typing..." shows before a reply appears, so the agent
  // doesn't answer inhumanly fast: a base pause plus a little per character.
  function typingPause(messages) {
    var d = cfg.typing_delay || {};
    if (!d.base && !d.per_char) return 0;
    var chars = 0;
    messages.forEach(function (m) { if (m.sender === 'agent' || m.sender === 'operator') chars += (m.text || '').length; });
    if (!chars) return 0;
    return Math.min(d.max || 2500, (d.base || 0) + (d.per_char || 0) * chars);
  }

  // AI answers: show lists as bullets. The knowledge base writes one spoken
  // style sentence ("Main Responsibilities: a, b, c and more.") so the same
  // text works on calls; here it becomes a heading with bullets. Lines that
  // start with "-", "•", "*" or "1." are bullets too. Same rules as the
  // dashboard (src/utils/messageFormat.tsx). Built with textContent only.
  var BULLET = /^\s*(?:[-•*▪●]|(\d+)[.)])\s+(.*)$/;
  function nWords(s) { return s.replace(/^\s+|\s+$/g, '').split(/\s+/).length; }
  function inlineList(sentence) {
    var m = /^([^:]{2,60}):\s+(.+?)\.?$/.exec(sentence.replace(/^\s+|\s+$/g, ''));
    if (!m || nWords(m[1]) > 6) return null;
    var parts = m[2].split(/,\s+/), more = false, last = parts.pop(), i, items = [];
    if (/\s+and more$/i.test(last)) { more = true; parts.push(last.replace(/\s+and more$/i, '')); }
    else { i = last.lastIndexOf(' and '); if (i > 0) { parts.push(last.slice(0, i)); parts.push(last.slice(i + 5)); } else parts.push(last); }
    for (i = 0; i < parts.length; i++) {
      var x = parts[i].replace(/^\s*(?:and|or)\s+/i, '').replace(/[.;]\s*$/, '').replace(/^\s+|\s+$/g, '');
      if (!x) continue;
      if (nWords(x) > 14) return null;
      items.push(x.charAt(0).toUpperCase() + x.slice(1));
    }
    if (items.length < 3) return null;
    return { list: true, heading: m[1].replace(/^\s+|\s+$/g, ''), items: items, more: more, ordered: false };
  }
  function sentences(text) {
    var out = [], start = 0, i, ch, rest;
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(text.charAt(i + 1))) {
        rest = text.slice(i + 1).replace(/^\s+/, '');
        if (/^[A-Z"'(]/.test(rest) && !/\b(?:e\.g|i\.e|etc|Mr|Mrs|Ms|Dr|St|No)$/i.test(text.slice(start, i))) {
          out.push(text.slice(start, i + 1).replace(/^\s+|\s+$/g, '')); start = i + 1;
        }
      }
    }
    if (text.slice(start).replace(/\s+/g, '')) out.push(text.slice(start).replace(/^\s+|\s+$/g, ''));
    return out;
  }
  function parseMessage(text) {
    var blocks = [], para = [], lines = text.split(/\r?\n/), k;
    function flush() {
      if (!para.length) return;
      var prose = [], ss = sentences(para.join(' ')), j, l;
      for (j = 0; j < ss.length; j++) {
        l = inlineList(ss[j]);
        if (l) { if (prose.length) blocks.push({ text: prose.join(' ') }); prose = []; blocks.push(l); } else prose.push(ss[j]);
      }
      if (prose.length) blocks.push({ text: prose.join(' ') });
      para = [];
    }
    for (k = 0; k < lines.length; k++) {
      var b = BULLET.exec(lines[k]), cur = blocks[blocks.length - 1];
      if (b) {
        if (!para.length && cur && cur.list && !cur.more) { cur.items.push(b[2]); continue; }
        var heading = '';
        if (para.length && /:\s*$/.test(para[para.length - 1])) heading = para.pop().replace(/:\s*$/, '');
        flush();
        blocks.push({ list: true, heading: heading, items: [b[2]], more: false, ordered: !!b[1] });
      } else if (lines[k].replace(/\s+/g, '')) para.push(lines[k].replace(/^\s+|\s+$/g, ''));
      else flush();
    }
    flush();
    return blocks;
  }
  function fillFormatted(bubble, text) {
    var blocks = parseMessage(text);
    if (blocks.length === 1 && !blocks[0].list) { bubble.textContent = text; return; }
    bubble.classList.add('fmt');
    blocks.forEach(function (bl) {
      if (!bl.list) { bubble.appendChild(el('p', null, bl.text)); return; }
      if (bl.heading) bubble.appendChild(el('p', 'lh', bl.heading));
      var ul = el(bl.ordered ? 'ol' : 'ul');
      bl.items.forEach(function (it) { ul.appendChild(el('li', null, it)); });
      bubble.appendChild(ul);
      if (bl.more) bubble.appendChild(el('p', 'more', '…and more'));
    });
  }

  var lastSender = null;
  function addMessages(list) {
    list.forEach(function (m) {
      if (m.id <= lastId) return;
      lastId = m.id;
      if (m.sender === 'system') { body.insertBefore(el('div', 'sys', m.text), typingRow && typingRow.parentNode ? typingRow : null); lastSender = 'system'; return; }
      var me = m.sender === 'visitor';
      if (me && !visitorSpoke) { visitorSpoke = true; hideChips(); }
      var row = el('div', 'row ' + (me ? 'me' : 'them'));
      var col = el('div');
      col.style.display = 'flex'; col.style.flexDirection = 'column'; col.style.alignItems = me ? 'flex-end' : 'flex-start'; col.style.maxWidth = '100%';
      if (!me) {
        var mini = avatarEl('mini', m.sender === 'operator' ? 'operator' : 'agent');
        if (lastSender === m.sender) mini.classList.add('hide');
        row.appendChild(mini);
        if (lastSender !== m.sender) col.appendChild(el('div', 'who', m.sender === 'operator' ? 'Team member' : cfg.agent_name));
      }
      var b = el('div', 'bubble');
      if (m.sender === 'agent') fillFormatted(b, m.text || ''); else b.textContent = m.text;
      col.appendChild(b);
      col.appendChild(el('div', 'meta', hhmm(m.at)));
      row.appendChild(col);
      body.insertBefore(row, typingRow && typingRow.parentNode ? typingRow : null);
      lastSender = m.sender;
      if (!open && !me) setUnread(unread + 1);
    });
    scroll();
  }

  function typing(on, who) {
    who = who || 'agent';
    if (on) {
      if (!typingRow || typingRow.getAttribute('data-who') !== who) {
        if (typingRow && typingRow.parentNode) typingRow.parentNode.removeChild(typingRow);
        typingRow = el('div', 'row them');
        typingRow.setAttribute('data-who', who);
        typingRow.appendChild(avatarEl('mini', who));
        var col = el('div');
        if (who === 'operator') col.appendChild(el('div', 'typing-who', 'Team member is typing…'));
        var b = el('div', 'bubble'); b.className = 'bubble typing';
        b.innerHTML = '<i></i><i></i><i></i>';
        b.setAttribute('aria-label', (who === 'operator' ? 'A team member' : cfg.agent_name) + ' is typing');
        col.appendChild(b);
        typingRow.appendChild(col);
      }
      if (typingRow.parentNode !== body || body.lastChild !== typingRow) body.appendChild(typingRow);
    } else if (typingRow && typingRow.parentNode) {
      typingRow.parentNode.removeChild(typingRow);
    }
    scroll();
  }

  // Tell the team the visitor is typing (at most every TYPING_PING ms),
  // and that they stopped when the box is emptied.
  function sendTyping(on) {
    if (!session || ended) return;
    var now = Date.now();
    if (on && now - lastTypingPing < TYPING_PING) return;
    if (!on && !lastTypingPing) return;
    lastTypingPing = on ? now : 0;
    api('/typing', { key: KEY, session_id: session.session_id, token: session.token, typing: !!on })
      .then(function (d) { showTeamTyping(d.team_typing); })
      .catch(function () { /* typing signals are best-effort */ });
  }

  function showTeamTyping(on) {
    if (sending) return;                 // the agent's own typing dots are showing
    if (on && !teamTyping) typing(true, 'operator');
    if (!on && teamTyping) typing(false);
    teamTyping = !!on;
  }

  function scroll() { if (body) body.scrollTop = body.scrollHeight; }

  function send(chipText) {
    var text = typeof chipText === 'string' ? chipText : input.value.trim();
    if (!text || sending || !session) return;
    sending = true; sendBtn.disabled = true;
    lastTypingPing = 0;
    if (teamTyping) { typing(false); teamTyping = false; }
    if (typeof chipText !== 'string') { input.value = ''; input.style.height = 'auto'; }
    var startedAt = Date.now();
    var temp = { id: lastId + 0.5, sender: 'visitor', text: text, at: new Date().toISOString() };
    var before = lastId;
    addMessages([temp]);
    lastId = before;                // the server's copy replaces the local one
    var pending = body.lastChild;
    typing(true);
    api('/message', { key: KEY, session_id: session.session_id, token: session.token, text: text, page_url: location.href, after: before })
      .then(function (d) {
        // Keep "typing..." up for the rest of the natural pause.
        var wait = Math.max(0, typingPause(d.messages) - (Date.now() - startedAt));
        return new Promise(function (r) { setTimeout(r, wait); }).then(function () {
          typing(false);
          if (pending && pending.parentNode) pending.parentNode.removeChild(pending);
          lastSender = null;
          addMessages(d.messages);
          if (d.ended) showEnded();
        });
      })
      .catch(function (e) {
        typing(false);
        if (e.status === 401) { save(null); session = null; renderGate('Your chat session expired. Please start again.'); return; }
        if (e.status === 409) { showEnded(); return; }
        addMessages([{ id: lastId + 0.25, sender: 'system', text: e.message || 'Message not sent. Please try again.' }]);
        lastId = Math.floor(lastId);
        input.value = text; input.oninput();
      })
      .then(function () { sending = false; if (input && !ended) { sendBtn.disabled = !input.value.trim(); input.focus(); } });
  }

  // ---- new messages from a team member ----
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!session || ended) return;
    pollTimer = setTimeout(poll, open ? POLL_OPEN : POLL_CLOSED);
  }
  function poll() {
    if (!session || sending) return schedulePoll();
    var q = '?key=' + encodeURIComponent(KEY) + '&session_id=' + encodeURIComponent(session.session_id) +
      '&token=' + encodeURIComponent(session.token) + '&after=' + lastId;
    api('/messages' + q).then(function (d) {
      if (d.messages && d.messages.length) {
        if (teamTyping) { typing(false); teamTyping = false; }   // their message has arrived
        addMessages(d.messages);
      }
      if (d.ended && !ended) showEnded();     // closed by the team
      else showTeamTyping(d.team_typing);
    }).catch(function (e) {
      if (e.status === 401) { save(null); session = null; }
    }).then(schedulePoll);
  }

  function render() {
    if (session) return;          // already showing the chat
    renderGate();
  }

  // ---- start ----
  function init() {
    api('/config?key=' + encodeURIComponent(KEY)).then(function (c) {
      if (!c.enabled) return;
      cfg = c;
      build();
      var saved = load();
      if (saved && saved.session_id) {
        api('/session', { key: KEY, session_id: saved.session_id, token: saved.token, page_url: location.href })
          .then(function (d) { session = saved; start(d.messages); setUnread(0); if (d.ended) showEnded(); })
          .catch(function () { save(null); session = null; });
      }
    }).catch(function (e) {
      if (window.console) console.warn('[chat widget] not loaded:', e.message);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
