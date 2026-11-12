// Cliente del Panel Arcade. IMPORTANTE: aquí NO se decide nada. Apuestas, multiplicadores, bombas y premios los calcula y valida el
// servidor; este archivo solo muestra el estado que el servidor envía y manda las acciones del jugador.
(function () {
  'use strict';
  var es = /^es/i.test(navigator.language || '');
  var TX = es ? {
    tabCrash: 'Piggy Crash', tabMines: 'Buscaminas', tabLb: 'Ranking', needLogin: 'Abre el Arcade con el comando /arcade en Discord (tu enlace personal caduca a los 10 minutos).',
    bet: 'Apuesta', bombs: 'Bombas', mult: 'Multiplicador', next: 'Siguiente', cashNow: 'Cobras ahora', takeoff: '🚀 Despegar', cash: 'COBRAR', again: 'Empezar',
    lbMult: 'Mejor multiplicador', lbProfit: 'Mayor ganancia', lbMonth: 'Este mes', lbAll: 'Histórico', empty: 'Todavía no hay cobros. ¡Sé el primero!',
    hintCrash: 'Elige tu apuesta, despega y cobra antes de que el cerdito explote.', hintMines: 'Elige apuesta y bombas. Cada casilla segura sube el multiplicador; cobra cuando quieras.',
    flying: 'Volando… ¡cobra antes de que explote!', boom: '💥 ¡Explotó en {m}x! Perdiste {b}', won: '🎉 Cobraste {m}x → +{p} Coinks', bombHit: '💣 ¡Bomba! Perdiste {b}', 
    e_bet: 'Apuesta no válida (mín. {min}, máx. {max}).', e_funds: 'No tienes suficientes Coinks.', e_busy: 'Ya tienes una partida en curso.', e_nogame: 'No tienes una partida activa.',
    e_bombs: 'Elige entre 1 y 24 bombas.', e_cell: 'Casilla no válida.', e_norevealed: 'Descubre al menos una casilla antes de cobrar.', e_rate: 'Vas muy rápido, espera un momento.',
    e_auth: 'Sesión caducada. Usa /arcade otra vez.', e_csrf: 'Petición rechazada.', e_server: 'Error del servidor. Inténtalo de nuevo.', max: 'MAX', cashBtn: 'COBRAR +{p}'
  } : {
    tabCrash: 'Piggy Crash', tabMines: 'Mines', tabLb: 'Leaderboard', needLogin: 'Open the Arcade with the /arcade command on Discord (your personal link expires after 10 minutes).',
    bet: 'Bet', bombs: 'Bombs', mult: 'Multiplier', next: 'Next', cashNow: 'Cash out now', takeoff: '🚀 Take off', cash: 'CASH OUT', again: 'Start',
    lbMult: 'Best multiplier', lbProfit: 'Biggest win', lbMonth: 'This month', lbAll: 'All time', empty: 'No cash-outs yet. Be the first!',
    hintCrash: 'Pick your bet, take off and cash out before the piggy explodes.', hintMines: 'Pick a bet and bombs. Every safe tile raises the multiplier; cash out whenever you want.',
    flying: 'Flying… cash out before it explodes!', boom: '💥 It exploded at {m}x! You lost {b}', won: '🎉 You cashed {m}x → +{p} Coinks', bombHit: '💣 Bomb! You lost {b}',
    e_bet: 'Invalid bet (min {min}, max {max}).', e_funds: 'Not enough Coinks.', e_busy: 'You already have a game in progress.', e_nogame: 'No active game.',
    e_bombs: 'Pick between 1 and 24 bombs.', e_cell: 'Invalid tile.', e_norevealed: 'Reveal at least one tile before cashing out.', e_rate: 'Too fast, wait a moment.',
    e_auth: 'Session expired. Use /arcade again.', e_csrf: 'Request rejected.', e_server: 'Server error. Try again.', max: 'MAX', cashBtn: 'CASH OUT +{p}'
  };
  var $ = function (id) { return document.getElementById(id); };
  var fmt = function (n) { return Number(n).toLocaleString('en-US'); };
  var tpl = function (s, v) { return s.replace(/\{(\w+)\}/g, function (_, k) { return v && v[k] != null ? v[k] : ''; }); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-i]'), function (el) { el.textContent = TX[el.getAttribute('data-i')] || ''; });
  $('cGo').textContent = TX.takeoff; $('mGo').textContent = TX.again; $('cHint').textContent = TX.hintCrash; $('mHint').textContent = TX.hintMines;

  var limits = { minBet: 10, maxBet: 5000, maxBombs: 24 }, balance = 0, dead = false;

  // ===================== SPRITES (con respaldo en emoji/colores) =====================
  // Cambia aquí los nombres de archivo si quieres. Todos viven en /arcade/sprites/. Si falta uno, se usa su emoji.
  var SPRITE_FILES = { pig: 'piggy-fly.png', win: 'win.png', lose: 'lose.png', tileClosed: 'tile-closed.png', tileCoin: 'tile-coin.png', tileBomb: 'tile-bomb.png', crashBg: 'crash-bg.png' };
  var FALLBACK = { pig: '🐷', win: '🎉', lose: '💥', tileCoin: '🪙', tileBomb: '💣' };
  var S = {}; // key -> { img, url, frames, fps, fw, fh }  (solo los que existen)
  function loadSprites() {
    fetch('sprites/sprites.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }).then(function (cfg) {
      Object.keys(SPRITE_FILES).forEach(function (k) {
        var c = cfg[k] || {}, img = new Image();
        img.onload = function () {
          var frames = Math.max(1, parseInt(c.frames, 10) || 1);
          S[k] = { img: img, url: 'sprites/' + SPRITE_FILES[k], frames: frames, fps: Number(c.fps) || 8, fw: img.width / frames, fh: img.height };
          renderTiles();
        };
        img.src = 'sprites/' + SPRITE_FILES[k];
      });
    });
  }
  /** Dibuja el sprite (tira horizontal animada) centrado en (cx,cy) con lado `size`; si no existe, su emoji. */
  function drawSprite(ctx, key, cx, cy, size, t) {
    var s = S[key];
    ctx.imageSmoothingEnabled = false;
    if (s) {
      var f = Math.floor((t || 0) * s.fps) % s.frames, k = size / Math.max(s.fw, s.fh), w = s.fw * k, h = s.fh * k;
      ctx.drawImage(s.img, f * s.fw, 0, s.fw, s.fh, Math.round(cx - w / 2), Math.round(cy - h / 2), Math.round(w), Math.round(h));
    } else {
      ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = Math.round(size * 0.8) + 'px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(FALLBACK[key] || '❔', cx, cy);
    }
  }

  // ===================== API =====================
  function api(method, path, body) {
    return fetch('/api/arcade' + path, { method: method, credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json', 'X-Arcade': '1' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (x) {
        if (x.status === 401) { lockOut(); throw new Error('auth'); }
        if (typeof x.j.balance === 'number') setBalance(x.j.balance);
        if (!x.j.ok) { var e = new Error(x.j.error || 'server'); e.code = x.j.error || 'server'; throw e; }
        return x.j;
      });
  }
  function errMsg(e) { var c = e && e.code; return tpl(TX['e_' + c] || TX.e_server, { min: limits.minBet, max: limits.maxBet }); }
  function lockOut() { dead = true; $('authwall').hidden = false; ['crash', 'mines', 'lb'].forEach(function (id) { $(id).hidden = true; }); $('tabs').hidden = true; $('uname').textContent = '—'; }
  function setBalance(n) {
    var el = $('balance'), old = balance; balance = n; el.textContent = fmt(n);
    if (old !== n && el.dataset.s) { var b = el.parentNode; b.classList.remove('up', 'down'); void b.offsetWidth; b.classList.add(n > old ? 'up' : 'down'); }
    el.dataset.s = '1';
  }
  function setHint(id, text, kind) { var h = $(id); h.textContent = text || ''; h.className = 'hint' + (kind ? ' ' + kind : ''); }

  // ===================== Pestañas =====================
  Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (b) {
    b.addEventListener('click', function () {
      Array.prototype.forEach.call(document.querySelectorAll('#tabs button'), function (x) { x.classList.toggle('on', x === b); });
      ['crash', 'mines', 'lb'].forEach(function (id) { $(id).hidden = id !== b.dataset.tab; });
      if (b.dataset.tab === 'lb') loadLb();
    });
  });
  function showTab(name) { document.querySelector('#tabs [data-tab="' + name + '"]').click(); }

  // Botones rápidos de apuesta
  Array.prototype.forEach.call(document.querySelectorAll('.quick[data-for]'), function (q) {
    q.addEventListener('click', function (e) {
      var k = e.target.getAttribute('data-q'); if (!k) return;
      var inp = $(q.getAttribute('data-for')), v = parseInt(inp.value, 10) || limits.minBet;
      if (k === 'min') v = limits.minBet; if (k === 'half') v = Math.floor(v / 2); if (k === 'x2') v = v * 2; if (k === 'max') v = Math.min(limits.maxBet, balance);
      inp.value = Math.max(limits.minBet, Math.min(limits.maxBet, v));
    });
  });
  $('bombQuick').addEventListener('click', function (e) { var b = e.target.getAttribute('data-b'); if (b) $('mBombs').value = b; });
  var betOf = function (id) { return parseInt($(id).value, 10); };

  // Overlay de victoria/derrota (sprite animado o emoji)
  function showFx(kind, text) {
    var box = document.createElement('div');
    box.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;z-index:15;background:#000a;text-align:center';
    var cv = document.createElement('canvas'); cv.width = cv.height = 160; cv.style.cssText = 'width:160px;height:160px;image-rendering:pixelated';
    var p = document.createElement('div'); p.style.cssText = 'font-size:1.3rem;font-weight:800;margin-top:8px;max-width:90vw'; p.textContent = text;
    var wrap = document.createElement('div'); wrap.appendChild(cv); wrap.appendChild(p); box.appendChild(wrap); document.body.appendChild(box);
    var t0 = performance.now(), ctx = cv.getContext('2d'), alive = true;
    (function loop(now) { if (!alive) return; ctx.clearRect(0, 0, 160, 160); drawSprite(ctx, kind, 80, 80, 140, (now - t0) / 1000); requestAnimationFrame(loop); })(t0);
    var close = function () { alive = false; box.remove(); }; box.addEventListener('click', close); setTimeout(close, 2600);
  }

  // ===================== PIGGY CRASH =====================
  var cv = $('cv'), ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
  var GROWTH = 0.07; // mismo crecimiento que el servidor (solo para animar; el servidor manda)
  var crashMult = function (ms) { return Math.floor(Math.exp(GROWTH * Math.max(0, ms) / 1000) * 100) / 100; };
  var C = { st: null, off: 0, phase: 'idle', result: null, until: 0, poll: null, busy: false, trail: [], boomAt: null };
  var serverNow = function () { return Date.now() + C.off; };

  function crashApply(st) {
    if (!st || !st.game) { C.phase = 'idle'; C.st = null; syncCrashUi(); return; }
    C.off = st.serverNow - Date.now(); C.st = st;
    if (st.status === 'active') { if (C.phase !== 'flying') { C.phase = 'flying'; C.trail = []; } startPoll(); }
    else crashFinish(st);
    syncCrashUi();
  }
  function crashFinish(st) {
    stopPoll();
    var won = st.status === 'cashed';
    C.phase = won ? 'won' : 'crashed'; C.result = st; C.until = performance.now() + 3200; C.boomAt = C.trail.length ? C.trail[C.trail.length - 1] : { x: 120, y: H - 60 };
    if (won) { setHint('cHint', tpl(TX.won, { m: st.mult.toFixed(2), p: fmt(st.payout) }), 'ok'); showFx('win', '+' + fmt(st.payout) + ' 🪙 (' + st.mult.toFixed(2) + 'x)'); }
    else setHint('cHint', tpl(TX.boom, { m: Number(st.crashPoint).toFixed(2), b: fmt(st.bet) }), 'err');
    setTimeout(function () { if (C.phase === 'won' || C.phase === 'crashed') { C.phase = 'idle'; C.st = null; syncCrashUi(); } }, 3300);
  }
  function startPoll() { if (C.poll) return; C.poll = setInterval(function () { if (dead || C.busy) return; api('GET', '/crash/state').then(function (r) { crashApply(r.state); }).catch(function () {}); }, 350); }
  function stopPoll() { clearInterval(C.poll); C.poll = null; }
  function curMult() { return C.st && C.st.status === 'active' ? crashMult(serverNow() - C.st.startedAt) : 1; }

  function syncCrashUi() {
    var flying = C.phase === 'flying';
    $('cGo').hidden = flying; $('cCash').hidden = !flying; $('cBet').disabled = flying;
    $('cGo').disabled = C.phase === 'won' || C.phase === 'crashed';
    if (flying) setHint('cHint', TX.flying);
  }
  $('cGo').addEventListener('click', function () {
    if (C.busy) return; C.busy = true; setHint('cHint', '');
    api('POST', '/crash/start', { bet: betOf('cBet') }).then(function (r) { C.trail = []; crashApply(r.state); }).catch(function (e) { setHint('cHint', errMsg(e), 'err'); }).then(function () { C.busy = false; });
  });
  $('cCash').addEventListener('click', function () {
    if (C.busy) return; C.busy = true;
    api('POST', '/crash/cashout').then(function (r) { crashApply(r.state); }).catch(function (e) { setHint('cHint', errMsg(e), 'err'); if (e.code === 'nogame') crashApply(null); }).then(function () { C.busy = false; });
  });
  setInterval(function () { var b = $('cCash'); if (!b.hidden && C.st) b.textContent = TX.cash + ' ' + curMult().toFixed(2) + 'x (+' + fmt(Math.floor(C.st.bet * curMult())) + ')'; }, 80);

  function drawCrash(now) {
    var t = now / 1000, g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1a1347'); g.addColorStop(1, '#4a2a6e');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    if (S.crashBg) { ctx.imageSmoothingEnabled = false; ctx.drawImage(S.crashBg.img, 0, 0, S.crashBg.fw, S.crashBg.fh, 0, 0, W, H); }
    else { ctx.fillStyle = '#ffffff55'; for (var i = 0; i < 28; i++) ctx.fillRect((i * 97) % W, (i * 53 + t * 6 * (1 + i % 3)) % H, 2, 2); }
    ctx.strokeStyle = '#ffffff18'; ctx.lineWidth = 1; for (var y = 60; y < H; y += 60) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    var m = C.phase === 'flying' ? curMult() : (C.result && C.result.status === 'cashed' ? C.result.mult : C.result && C.result.crashPoint) || 1;
    if (C.phase === 'idle') m = 1;
    var p = Math.min(1, Math.log(Math.max(1, m)) / Math.log(30)), px = 90 + p * (W - 220), py = H - 70 - p * (H - 160);
    if (C.phase === 'flying') { C.trail.push({ x: px, y: py }); if (C.trail.length > 400) C.trail.shift(); }
    if (C.trail.length > 1) { ctx.strokeStyle = '#ff7eb6'; ctx.lineWidth = 4; ctx.beginPath(); C.trail.forEach(function (q, i) { i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); }); ctx.stroke(); }
    var wob = C.phase === 'flying' ? Math.sin(t * 9) * 4 : 0;
    if (C.phase === 'idle' || C.phase === 'flying' || C.phase === 'won') drawSprite(ctx, 'pig', px, py + wob, 96, t);
    if (C.phase === 'crashed' && C.boomAt) { var sh = Math.max(0, (C.until - now) / 3200); ctx.save(); ctx.translate((Math.random() - .5) * 8 * sh, (Math.random() - .5) * 8 * sh); drawSprite(ctx, 'lose', C.boomAt.x, C.boomAt.y, 120 + 30 * (1 - sh), t); ctx.restore(); }
    ctx.fillStyle = C.phase === 'crashed' ? '#ff5a6e' : C.phase === 'won' ? '#42d77d' : '#fff'; ctx.font = 'bold 54px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(Number(m).toFixed(2) + 'x', W / 2, 66);
  }
  (function loop(now) { drawCrash(now); requestAnimationFrame(loop); })(performance.now());

  // ===================== BUSCAMINAS =====================
  var board = $('board'), tiles = [], M = { st: null, busy: false };
  for (var i = 0; i < 25; i++) { var b = document.createElement('button'); b.className = 'tile'; b.dataset.i = i; board.appendChild(b); tiles.push(b); }
  board.addEventListener('click', function (e) {
    var t = e.target.closest('.tile'); if (!t || M.busy || !M.st || M.st.status !== 'active' || t.classList.contains('open')) return;
    M.busy = true;
    api('POST', '/mines/reveal', { idx: Number(t.dataset.i) }).then(function (r) { minesApply(r.state, true); }).catch(function (er) { setHint('mHint', errMsg(er), 'err'); }).then(function () { M.busy = false; });
  });
  function setTile(el, key) {
    el.textContent = ''; el.style.backgroundImage = '';
    if (key && S[key]) { el.style.backgroundImage = 'url(' + S[key].url + ')'; el.style.backgroundSize = (S[key].frames * 100) + '% 100%'; el.style.backgroundPosition = '0 0'; }
    else if (key && FALLBACK[key]) el.textContent = FALLBACK[key];
  }
  function renderTiles() {
    var st = M.st, over = st && st.status !== 'active';
    tiles.forEach(function (el, i) {
      el.className = 'tile'; el.disabled = !st || over;
      if (st && st.revealed.indexOf(i) >= 0) { el.classList.add('open'); setTile(el, 'tileCoin'); el.disabled = true; }
      else if (over && st.bombs && st.bombs.indexOf(i) >= 0) { el.classList.add(st.hit === i ? 'boom' : 'bomb'); setTile(el, 'tileBomb'); }
      else { setTile(el, 'tileClosed'); if (over) el.classList.add('dim'); }
    });
  }
  function minesApply(st, animate) {
    if (!st || !st.game) { M.st = null; renderTiles(); syncMinesUi(); return; }
    var prev = M.st; M.st = st; renderTiles(); syncMinesUi();
    if (animate && prev && prev.status === 'active' && st.status !== 'active') {
      if (st.status === 'cashed') { setHint('mHint', tpl(TX.won, { m: Number(st.mult).toFixed(2), p: fmt(st.payout) }), 'ok'); showFx('win', '+' + fmt(st.payout) + ' 🪙 (' + Number(st.mult).toFixed(2) + 'x)'); }
      else { setHint('mHint', tpl(TX.bombHit, { b: fmt(st.bet) }), 'err'); showFx('lose', TX.bombHit.replace('{b}', fmt(st.bet))); }
    }
  }
  function syncMinesUi() {
    var st = M.st, act = st && st.status === 'active';
    $('mGo').hidden = !!act; $('mCashBtn').hidden = !act; $('mBet').disabled = !!act; $('mBombs').disabled = !!act;
    if (st) { $('mMult').textContent = Number(st.mult).toFixed(2) + 'x'; $('mNext').textContent = act && st.next ? st.next.toFixed(2) + 'x' : '—'; $('mCash').textContent = act ? fmt(Math.floor(st.bet * st.mult)) : (st.payout ? fmt(st.payout) : '—'); }
    else { $('mMult').textContent = '1.00x'; $('mNext').textContent = '—'; $('mCash').textContent = '—'; }
    if (act) { $('mCashBtn').textContent = tpl(TX.cashBtn, { p: fmt(Math.floor(st.bet * st.mult)) }); $('mCashBtn').disabled = st.revealed.length < 1; }
  }
  $('mGo').addEventListener('click', function () {
    if (M.busy) return; M.busy = true; setHint('mHint', '');
    api('POST', '/mines/start', { bet: betOf('mBet'), bombs: parseInt($('mBombs').value, 10) }).then(function (r) { M.st = null; minesApply(r.state, false); }).catch(function (e) { setHint('mHint', errMsg(e), 'err'); }).then(function () { M.busy = false; });
  });
  $('mCashBtn').addEventListener('click', function () {
    if (M.busy) return; M.busy = true;
    api('POST', '/mines/cashout').then(function (r) { minesApply(r.state, true); }).catch(function (e) { setHint('mHint', errMsg(e), 'err'); }).then(function () { M.busy = false; });
  });

  // ===================== LEADERBOARD =====================
  var lbType = 'mult', lbRange = 'month';
  function segment(id, cb) { $(id).addEventListener('click', function (e) { var v = e.target.dataset.v; if (!v) return; Array.prototype.forEach.call($(id).children, function (x) { x.classList.toggle('on', x === e.target); }); cb(v); loadLb(); }); }
  segment('lbType', function (v) { lbType = v; }); segment('lbRange', function (v) { lbRange = v; });
  function loadLb() {
    api('GET', '/leaderboard?type=' + lbType + '&range=' + lbRange).then(function (r) {
      var ol = $('lbList'); ol.innerHTML = '';
      if (!r.rows.length) { var li = document.createElement('li'); li.textContent = TX.empty; li.style.gridTemplateColumns = '1fr'; ol.appendChild(li); return; }
      r.rows.forEach(function (row) {
        var li = document.createElement('li'), medal = ['🥇', '🥈', '🥉'][row.rank - 1] || ('#' + row.rank);
        var a = document.createElement('span'); a.className = 'r'; a.textContent = medal;
        var n = document.createElement('span'); n.className = 'n'; n.textContent = row.name; var sm = document.createElement('small'); sm.textContent = (row.game === 'crash' ? '🚀 ' : '💣 ') + fmt(row.bet) + ' → ' + fmt(row.payout); n.appendChild(sm);
        var v = document.createElement('span'); v.className = 'v'; v.textContent = lbType === 'profit' ? '+' + fmt(row.profit) + ' 🪙' : Number(row.mult).toFixed(2) + 'x';
        li.appendChild(a); li.appendChild(n); li.appendChild(v); ol.appendChild(li);
      });
    }).catch(function () {});
  }

  // ===================== Arranque =====================
  function refreshMe(first) {
    return api('GET', '/me').then(function (r) {
      limits = r.limits; $('uname').textContent = r.user.name;
      if (r.user.avatar) { var a = $('avatar'); a.src = r.user.avatar; a.hidden = false; }
      if (first) {
        ['cBet', 'mBet'].forEach(function (id) { $(id).min = limits.minBet; $(id).max = limits.maxBet; });
        if (r.active && r.active.game === 'crash') crashApply(r.active);
        if (r.active && r.active.game === 'mines') { showTab('mines'); minesApply(r.active, false); }
      }
    });
  }
  loadSprites(); renderTiles(); syncMinesUi();
  refreshMe(true).catch(function () {});
  setInterval(function () { if (!dead && !document.hidden) refreshMe(false).catch(function () {}); }, 3000);
})();
