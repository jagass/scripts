// "Verifica episoadele": pe pagina unui serial trece prin toate episoadele (EP 1, EP 2, ...), fara sunet,
// si verifica daca fiecare porneste. La final arata lista cu ce merge si ce nu.
(function () {
  if (window.top !== window || window.__rfEpCheck) return;
  window.__rfEpCheck = true;

  var EP_RX = /^(?:ep\.?|episode|episodul)\s*(\d{1,4})$/i;
  var ACTIVE_RX = /(^|[\s_-])(active|current|selected|playing|is-active)([\s_-]|$)/i;
  var TIMEOUT = 15000;

  // --- lista de episoade de pe pagina ("EP 1", "EP 2", ...) -------------------------------
  function episodes() {
    var els = document.querySelectorAll('button, a, li, [role=button], [role=tab]');
    var map = {}, active = null;
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.closest('[id^=rf-]')) continue;
      var m = (e.textContent || '').replace(/\s+/g, ' ').trim().match(EP_RX);
      if (!m) continue;
      var n = parseInt(m[1], 10);
      if (!(n in map) || map[n].contains(e)) map[n] = e;
      var cls = typeof e.className === 'string' ? e.className : '';
      if (active === null && (ACTIVE_RX.test(cls) || e.getAttribute('aria-current') || e.getAttribute('aria-selected') === 'true')) active = n;
    }
    var nums = Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
    return { nums: nums, map: map, active: active };
  }

  function clickEp(map, n) {
    var el = map[n];
    if (!el) return false;
    (el.querySelector('button, a, [role=button]') || el).click();
    return true;
  }

  function visibleArea(el) {
    var r = el.getBoundingClientRect();
    var w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    var h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function currentVideo() {
    var best = null, score = -1;
    Array.prototype.forEach.call(document.querySelectorAll('video'), function (v) {
      var s = visibleArea(v) * 10 + (v.paused ? 0 : 5000) + (v.readyState > 0 ? 1000 : 0);
      if (s > score) { score = s; best = v; }
    });
    return best;
  }

  // mesajul de eroare al site-ului ("Video cannot be loaded. Try another episode" etc.), daca e afisat
  var SITE_ERR = /(cannot be loaded|can.t be loaded|try another (episode|server)|failed to load|unable to (load|play)|video (is )?unavailable|playback error)/i;
  function siteError() {
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      var t = w.currentNode.nodeValue;
      if (t.length > 200 || !SITE_ERR.test(t)) continue;
      var el = w.currentNode.parentElement;
      if (el && !el.closest('[id^=rf-]') && visibleArea(el) > 0) return { el: el, text: t.replace(/\s+/g, ' ').trim().slice(0, 80) };
    }
    return null;
  }

  function srcOf(v) { return v ? (v.__rfHlsUrl || v.currentSrc || v.src || '') : ''; }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // asteapta ca episodul nou sa porneasca: alt video / alta sursa, cu imagine incarcata
  async function waitEpisode(prevSrc, prevEl, prevHlsErr, prevSiteErr) {
    var t0 = Date.now();
    while (Date.now() - t0 < TIMEOUT) {
      if (stopRequested) return { ok: false, why: 'oprit' };
      await sleep(300);
      // eroarea site-ului conteaza doar daca a aparut dupa ce am deschis episodul (nu cea ramasa de la cel anterior)
      var se = siteError();
      if (se && Date.now() - t0 > 900 && (!prevSiteErr || se.el !== prevSiteErr.el || !prevSiteErr.el.isConnected)) {
        return { ok: false, why: 'site: \u201E' + se.text + '\u201D' };
      }
      var v = currentVideo();
      if (!v) continue;
      v.muted = true;
      var changed = srcOf(v) !== prevSrc || v !== prevEl;
      if (!changed) continue;
      if (v.error) return { ok: false, why: 'eroare video (cod ' + v.error.code + ')' };
      if (window.__rfHlsLastError && window.__rfHlsLastError !== prevHlsErr) return { ok: false, why: 'eroare video: ' + window.__rfHlsLastError };
      if (v.readyState >= 2 && (v.videoWidth > 0 || v.currentTime > 0 || !v.paused)) {
        return { ok: true, secs: Math.round((Date.now() - t0) / 100) / 10 };
      }
    }
    var cur = currentVideo();
    if (!cur || (srcOf(cur) === prevSrc && cur === prevEl)) return { ok: false, why: 'episodul nu s-a deschis' };
    return { ok: false, why: 'nu pornește în ' + (TIMEOUT / 1000) + 's' };
  }

  var running = false, stopRequested = false;

  async function checkAll() {
    if (running) { stopRequested = true; return; }
    var eps = episodes();
    if (eps.nums.length < 1) { render([], 'Nu am găsit lista de episoade pe pagină.'); return; }
    running = true; stopRequested = false;
    var startEp = eps.active || eps.nums[0];
    var results = [];
    var wasMuted = Array.prototype.map.call(document.querySelectorAll('video'), function (v) { return [v, v.muted]; });
    setBusy(true);
    for (var i = 0; i < eps.nums.length && !stopRequested; i++) {
      var n = eps.nums[i];
      progress(n, i + 1, eps.nums.length, results);
      var before = currentVideo();
      var prevSrc = srcOf(before), prevHlsErr = window.__rfHlsLastError, prevSiteErr = siteError();
      var fresh = episodes();                       // lista se poate re-randa: luam elementele din nou
      if (n === fresh.active && before && before.readyState >= 2 && !before.error) {
        results.push({ n: n, ok: true, secs: 0 });  // episodul deschis acum merge deja
        continue;
      }
      if (!clickEp(fresh.map, n)) { results.push({ n: n, ok: false, why: 'buton negasit' }); continue; }
      var r = await waitEpisode(prevSrc, before, prevHlsErr, prevSiteErr);
      if (r.why === 'oprit') break;
      r.n = n;
      results.push(r);
    }
    // inapoi la episodul de la care am pornit, cu sunetul cum era
    clickEp(episodes().map, startEp);
    setTimeout(function () {
      wasMuted.forEach(function (p) { if (p[0].isConnected) p[0].muted = p[1]; });
      var v = currentVideo(); if (v) v.muted = false;
    }, 1500);
    running = false;
    setBusy(false);
    var bad = results.filter(function (r) { return !r.ok; });
    // rezultatul unei verificari complete se tine minte (pentru eticheta si filtrul din lista)
    var sk = pageSeenKey();
    var avail = eps.nums.length ? eps.nums[eps.nums.length - 1] : results.length;
    var declared = declaredTotal();
    var incomplete = declared && avail < declared ? declared : 0;
    if (sk && !stopRequested && results.length) {
      try {
        var st = JSON.parse(localStorage.getItem('rfEpStatus.v1') || '{}');
        var prev = st[sk] || {};
        st[sk] = { t: avail, total: declared || 0, bad: bad.map(function (r) { return r.n; }), at: Date.now(), inc: !!prev.inc };
        localStorage.setItem('rfEpStatus.v1', JSON.stringify(st));
      } catch (e) {}
    }
    var incText = incomplete ? '<br>\u26A0 Incomplet: pe site sunt doar ' + avail + ' din ' + declared + ' episoade anun\u021bate.' : '';
    var summary = stopRequested
      ? 'Oprit. Verificate: ' + results.length + ' episoade, ' + bad.length + ' nu merg.'
      : (bad.length === 0
        ? '✅ Toate cele ' + results.length + ' episoade pornesc.'
        : '⚠️ ' + (results.length - bad.length) + ' din ' + results.length + ' pornesc. Nu merg: ' +
          bad.map(function (r) { return 'EP ' + r.n; }).join(', '));
    render(results, summary + (stopRequested ? '' : incText));
    if (incBtn) incBtn.textContent = incLabel();
  }

  // cate episoade anunta serialul ("56 Episode" pe pagina, sau numarul de pe card din lista salvata)
  function declaredTotal() {
    var best = 0, w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      var t = w.currentNode.nodeValue;
      if (t.length > 40 || (w.currentNode.parentElement && w.currentNode.parentElement.closest('[id^=rf-]'))) continue;
      var m = t.match(/^\s*(\d{1,4})\s*(Episodes?|Episoade|EP)\s*$/i);
      if (m) best = Math.max(best, parseInt(m[1], 10));
    }
    if (best) return best;
    try {
      var k = pageSeenKey(), cat = JSON.parse(localStorage.getItem('rfCatalog.v1') || '{}');
      var it = (cat.items || []).find(function (x) {
        var p = x.k.split('/'), id = (p[1] || '').match(/^\d+/);
        return p[0] + '/' + (id ? id[0] : p[1]) === k;
      });
      return it && it.e ? it.e : 0;
    } catch (e) { return 0; }
  }

  // --- interfata -------------------------------------------------------------------------
  var btn = null, panel = null, filmBtn = null, seenBtn = null, incBtn = null;

  // --- "Marcheaza incomplet": serialul se opreste la mijlocul povestii (lipsesc episoade pe site) ---
  function epStatusMap() { try { return JSON.parse(localStorage.getItem('rfEpStatus.v1')) || {}; } catch (e) { return {}; } }
  function incLabel() {
    var k = pageSeenKey(), r = k ? epStatusMap()[k] : null;
    var auto = r && r.total && r.t < r.total;
    if (r && r.inc) return '\u21A9 Nu e incomplet';
    return auto ? '\u26A0 Incomplet (' + r.t + '/' + r.total + ')' : '\u26A0 Marcheaz\u0103 incomplet';
  }

  // --- "Am vazut serialul": il ascunde din liste (aceeasi memorie ca lista din filter.js) ---
  var SEEN_KEY = 'rfSeen.v1';
  function pageSeenKey() {
    var m = location.pathname.match(/^\/(?:drama|watch)\/([^\/?#]+)\/([^\/?#]+)/);
    if (!m) return null;
    var id = m[2].match(/^\d+/);
    return m[1] + '/' + (id ? id[0] : m[2]);
  }
  function seenMap() { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) { return {}; } }
  function seenLabel() {
    var k = pageSeenKey();
    return k && seenMap()[k] ? '\u21A9 Nu l-am v\u0103zut' : '\u2713 Am v\u0103zut serialul';
  }

  function filmLabel() {
    var on = window.__rfAutoNextOn ? window.__rfAutoNextOn() : true;
    return '\uD83C\uDFAC Mod film: ' + (on ? 'Pornit' : 'Oprit');
  }

  function ensureUi() {
    if (btn) return;
    var css = document.createElement('style');
    css.textContent =
      '#rf-epcheck-btn{position:fixed;left:50%;top:64px;transform:translateX(-50%);z-index:2147483645;padding:7px 14px;' +
      'border-radius:18px;border:1px solid #2dd4bf;background:#0b1220d9;color:#e6fffb;font:600 13px system-ui,sans-serif;opacity:.85}' +
      '#rf-epcheck{position:fixed;left:0;right:0;bottom:0;max-height:75vh;overflow:auto;z-index:2147483647;background:#0b1220;' +
      'color:#e5e7eb;border-top:1px solid #2dd4bf;border-radius:16px 16px 0 0;padding:16px;font:14px system-ui,sans-serif;display:none}' +
      '#rf-epcheck h3{margin:0 0 6px;font-size:17px;color:#fff}' +
      '#rf-epcheck .rf-sum{margin:6px 0 10px;line-height:1.4}' +
      '#rf-epcheck .rf-grid{display:flex;flex-wrap:wrap;gap:6px}' +
      '#rf-epcheck .rf-ep{padding:7px 10px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e5e7eb;font-size:13px}' +
      '#rf-epcheck .rf-ep.ok{border-color:#16a34a}#rf-epcheck .rf-ep.bad{border-color:#dc2626;background:#3b0d0d}' +
      '#rf-epcheck .rf-bad{margin-top:10px;font-size:13px;color:#fca5a5}' +
      '#rf-epcheck .rf-act{display:flex;gap:8px;margin-top:14px}' +
      '#rf-epcheck .rf-act button{flex:1;padding:11px;border-radius:12px;border:0;font:600 14px system-ui}' +
      '#rf-seen-btn{position:fixed;left:50%;top:140px;transform:translateX(-50%);z-index:2147483645;padding:6px 12px;' +
      'border-radius:16px;border:1px solid #64748b;background:#0b1220d9;color:#e5e7eb;font:600 12px system-ui,sans-serif;opacity:.85}' +
      'html[data-rf-cinema] #rf-seen-btn{display:none!important}' +
      '#rf-inc-btn{position:fixed;left:50%;top:178px;transform:translateX(-50%);z-index:2147483645;padding:6px 12px;' +
      'border-radius:16px;border:1px solid #b45309;background:#0b1220d9;color:#fde68a;font:600 12px system-ui,sans-serif;opacity:.85}' +
      'html[data-rf-cinema] #rf-inc-btn{display:none!important}' +
      '#rf-film-btn{position:fixed;left:50%;top:102px;transform:translateX(-50%);z-index:2147483645;padding:6px 12px;' +
      'border-radius:16px;border:1px solid #64748b;background:#0b1220d9;color:#e5e7eb;font:600 12px system-ui,sans-serif;opacity:.85}' +
      'html[data-rf-cinema] #rf-epcheck-btn,html[data-rf-cinema] #rf-epcheck,html[data-rf-cinema] #rf-film-btn{display:none!important}';
    document.head.appendChild(css);

    btn = document.createElement('button');
    btn.id = 'rf-epcheck-btn';
    btn.textContent = '🔍 Verifică episoadele';
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      if (btn.dataset.go) {
        // pagina de prezentare a serialului: deschidem pagina de vizionare si pornim acolo verificarea
        try { sessionStorage.setItem(AUTO_KEY, String(Date.now())); } catch (err) {}
        location.href = btn.dataset.go;
        return;
      }
      panel.style.display = 'block';
      if (!running) checkAll();
    }, true);
    document.body.appendChild(btn);

    filmBtn = document.createElement('button');
    filmBtn.id = 'rf-film-btn';
    filmBtn.textContent = filmLabel();
    filmBtn.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      if (window.__rfToggleAutoNext) window.__rfToggleAutoNext();
      filmBtn.textContent = filmLabel();
    }, true);
    document.body.appendChild(filmBtn);

    incBtn = document.createElement('button');
    incBtn.id = 'rf-inc-btn';
    incBtn.textContent = incLabel();
    incBtn.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      var k = pageSeenKey(); if (!k) return;
      var st = epStatusMap(), r = st[k] || { t: 0, total: 0, bad: [], at: 0 };
      r.inc = !r.inc;
      st[k] = r;
      try { localStorage.setItem('rfEpStatus.v1', JSON.stringify(st)); } catch (err) {}
      incBtn.textContent = incLabel();
    }, true);
    document.body.appendChild(incBtn);

    seenBtn = document.createElement('button');
    seenBtn.id = 'rf-seen-btn';
    seenBtn.textContent = seenLabel();
    seenBtn.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      var k = pageSeenKey(); if (!k) return;
      var m = seenMap();
      if (m[k]) delete m[k]; else m[k] = Date.now();
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch (err) {}
      seenBtn.textContent = seenLabel();
    }, true);
    document.body.appendChild(seenBtn);

    panel = document.createElement('div');
    panel.id = 'rf-epcheck';
    document.body.appendChild(panel);
    panel.addEventListener('click', function (e) {
      e.stopPropagation();
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.ep) { clickEp(episodes().map, parseInt(t.dataset.ep, 10)); panel.style.display = 'none'; }
      else if (t.id === 'rf-ec-stop') stopRequested = true;
      else if (t.id === 'rf-ec-again') checkAll();
      else if (t.id === 'rf-ec-close') { if (running) stopRequested = true; panel.style.display = 'none'; }
    }, true);
  }

  function setBusy(on) { if (btn) btn.textContent = on ? '⏳ Verific…' : '🔍 Verifică episoadele'; }

  function chips(results) {
    return results.map(function (r) {
      return '<button class="rf-ep ' + (r.ok ? 'ok' : 'bad') + '" data-ep="' + r.n + '">' + (r.ok ? '✓' : '✗') + ' EP ' + r.n + '</button>';
    }).join('');
  }

  function progress(n, i, total, results) {
    panel.innerHTML = '<h3>Verific episoadele</h3><div class="rf-sum">Verific EP ' + n + ' (' + i + ' din ' + total +
      ')… fără sunet. Lasă aplicația deschisă.</div><div class="rf-grid">' + chips(results) + '</div>' +
      '<div class="rf-act"><button id="rf-ec-stop" style="background:#1f2937;color:#e5e7eb">Oprește</button></div>';
  }

  function render(results, summary) {
    var bad = results.filter(function (r) { return !r.ok; });
    panel.innerHTML = '<h3>Verificare episoade</h3><div class="rf-sum">' + summary + '</div>' +
      '<div class="rf-grid">' + chips(results) + '</div>' +
      (bad.length ? '<div class="rf-bad">' + bad.map(function (r) { return 'EP ' + r.n + ': ' + r.why; }).join('<br>') + '</div>' : '') +
      '<div style="margin-top:8px;font-size:12px;color:#94a3b8">Apasă pe un episod ca să sari la el.</div>' +
      '<div class="rf-act"><button id="rf-ec-again" style="background:#1f2937;color:#e5e7eb">Verifică din nou</button>' +
      '<button id="rf-ec-close" style="background:#14b8a6;color:#04201d">Închide</button></div>';
  }

  // butonul apare doar pe paginile cu video si lista de episoade
  var AUTO_KEY = 'rfEpCheckAuto';

  // linkul spre pagina de vizionare ("Start Episode 1"), pe pagina de prezentare a serialului
  function watchLink() {
    var a = document.querySelector('a[href*="/watch/"]');
    return a ? a.href : null;
  }

  function refresh() {
    var onWatch = document.querySelector('video') && episodes().nums.length >= 2;
    var go = onWatch ? null : watchLink();
    if (onWatch || go) {
      ensureUi();
      btn.style.display = '';
      if (go) btn.dataset.go = go; else delete btn.dataset.go;
      filmBtn.style.display = onWatch && window.__rfAutoNextOn ? '' : 'none';
      filmBtn.textContent = filmLabel();
      seenBtn.style.display = pageSeenKey() ? '' : 'none';
      seenBtn.style.top = onWatch ? '140px' : '102px';
      incBtn.style.display = pageSeenKey() ? '' : 'none';
      incBtn.style.top = onWatch ? '178px' : '140px';
      incBtn.textContent = incLabel();
      seenBtn.textContent = seenLabel();
    } else if (btn && !running) { btn.style.display = 'none'; panel.style.display = 'none'; filmBtn.style.display = 'none'; seenBtn.style.display = 'none'; incBtn.style.display = 'none'; }

    // pornire automata dupa ce am venit de pe pagina de prezentare
    if (onWatch && !running) {
      var t = 0;
      try { t = parseInt(sessionStorage.getItem(AUTO_KEY) || '0', 10); } catch (e) {}
      if (t && Date.now() - t < 60000) {
        try { sessionStorage.removeItem(AUTO_KEY); } catch (e) {}
        panel.style.display = 'block';
        setTimeout(checkAll, 1500); // lasam primul episod sa porneasca
      }
    }
  }

  // --- la finalul ultimului episod disponibil: "Povestea s-a terminat sau lipsesc episoade?" ---
  var askedFor = null;
  document.addEventListener('ended', function (e) {
    var v = e.target;
    if (!v || v.tagName !== 'VIDEO' || running) return;
    var eps = episodes();
    if (!eps.nums.length) return;
    var last = eps.nums[eps.nums.length - 1];
    if (eps.active !== last) return;
    var k = pageSeenKey();
    if (!k || askedFor === k) return;
    askedFor = k;
    setTimeout(function () { askAtEnd(k, last); }, 1800); // dupa "Mod film" (care ar incerca episodul urmator)
  }, true);

  function askAtEnd(k, last) {
    // iesim din ecranul mare ca intrebarea sa se vada
    try { if (window.RFBridge) window.RFBridge.postMessage('fs:exit'); } catch (e) {}
    ensureUi();
    panel.style.display = 'block';
    panel.innerHTML = '<h3>Ai ajuns la ultimul episod disponibil (EP ' + last + ')</h3>' +
      '<div class="rf-sum">Povestea s-a terminat sau ar mai trebui s\u0103 fie episoade?</div>' +
      '<div class="rf-act" style="flex-direction:column">' +
      '<button id="rf-end-inc" style="background:#b45309;color:#fff">\u26A0 Nu, lipsesc episoade (marcheaz\u0103 incomplet)</button>' +
      '<button id="rf-end-done" style="background:#15803d;color:#fff">\u2713 Da, s-a terminat</button>' +
      '<button id="rf-end-seen" style="background:#1f2937;color:#e5e7eb">\uD83D\uDC41 Marcheaz\u0103 ca v\u0103zut</button>' +
      '<button id="rf-end-close" style="background:#111827;color:#94a3b8">\u00CEnchide</button></div>';
  }

  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('#rf-end-inc, #rf-end-done, #rf-end-seen, #rf-end-close');
    if (!t) return;
    e.stopPropagation(); e.preventDefault();
    var k = pageSeenKey();
    if (k && (t.id === 'rf-end-inc' || t.id === 'rf-end-done')) {
      var st = epStatusMap(), r = st[k] || { t: 0, total: 0, bad: [], at: 0 };
      r.inc = t.id === 'rf-end-inc';
      st[k] = r;
      try { localStorage.setItem('rfEpStatus.v1', JSON.stringify(st)); } catch (err) {}
      if (incBtn) incBtn.textContent = incLabel();
    }
    if (k && t.id === 'rf-end-seen') {
      var m = seenMap(); m[k] = Date.now();
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(m)); } catch (err) {}
      if (seenBtn) seenBtn.textContent = seenLabel();
    }
    if (t.id === 'rf-end-seen' || t.id === 'rf-end-close' || t.id === 'rf-end-done' || t.id === 'rf-end-inc') {
      if (t.id === 'rf-end-close' || t.id === 'rf-end-seen') panel.style.display = 'none';
      else t.textContent = '\u2713 Salvat';
    }
  }, true);

  // --- buton "Blocare reclame": unele episoade pornesc doar dupa ce site-ul isi arata reclama ---
  var adBtn = null;
  function adLabel(err) {
    if (window.__rfAdOff) return '\uD83D\uDEE1 Blocare reclame: Oprit\u0103 (atinge pentru a o porni)';
    return err ? '\u25B6 Video nu porne\u0219te? Opre\u0219te blocarea reclamelor' : '\uD83D\uDEE1 Blocare reclame: Pornit\u0103';
  }
  function adRefresh() {
    var onSeries = /^\/(drama|watch)\//.test(location.pathname);
    if (!onSeries || !window.RFBridge) { if (adBtn) adBtn.style.display = 'none'; return; }
    if (!adBtn) {
      var css = document.createElement('style');
      css.textContent = '#rf-ad-btn{position:fixed;left:50%;bottom:84px;transform:translateX(-50%);z-index:2147483645;padding:8px 14px;' +
        'border-radius:18px;border:1px solid #64748b;background:#0b1220e6;color:#e5e7eb;font:600 12px system-ui,sans-serif;max-width:92vw}' +
        '#rf-ad-btn.hl{background:#b45309;border-color:#fbbf24;color:#fff;font-size:14px;padding:10px 16px}' +
        'html[data-rf-cinema] #rf-ad-btn{display:none!important}';
      document.head.appendChild(css);
      adBtn = document.createElement('button');
      adBtn.id = 'rf-ad-btn';
      adBtn.addEventListener('click', function (e) {
        e.stopPropagation(); e.preventDefault();
        adBtn.textContent = '\u23F3 Re\u00EEncarc pagina\u2026';
        window.RFBridge.postMessage('adblock:toggle'); // aplicatia schimba setarea si reincarca pagina
      }, true);
      document.body.appendChild(adBtn);
    }
    var err = !window.__rfAdOff && !!siteError();
    adBtn.style.display = '';
    adBtn.classList.toggle('hl', err);
    var l = adLabel(err);
    if (adBtn.textContent !== l && adBtn.textContent.indexOf('\u23F3') !== 0) adBtn.textContent = l;
  }
  setInterval(adRefresh, 1500);

  window.__rfCheckEpisodes = checkAll; // pentru teste

  function start() { refresh(); setInterval(refresh, 1500); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
