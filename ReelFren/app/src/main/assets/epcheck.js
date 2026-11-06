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
    var summary = stopRequested
      ? 'Oprit. Verificate: ' + results.length + ' episoade, ' + bad.length + ' nu merg.'
      : (bad.length === 0
        ? '✅ Toate cele ' + results.length + ' episoade pornesc.'
        : '⚠️ ' + (results.length - bad.length) + ' din ' + results.length + ' pornesc. Nu merg: ' +
          bad.map(function (r) { return 'EP ' + r.n; }).join(', '));
    render(results, summary);
  }

  // --- interfata -------------------------------------------------------------------------
  var btn = null, panel = null;

  function ensureUi() {
    if (btn) return;
    var css = document.createElement('style');
    css.textContent =
      '#rf-epcheck-btn{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483645;padding:7px 14px;' +
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
      'html[data-rf-cinema] #rf-epcheck-btn,html[data-rf-cinema] #rf-epcheck{display:none!important}';
    document.head.appendChild(css);

    btn = document.createElement('button');
    btn.id = 'rf-epcheck-btn';
    btn.textContent = '🔍 Verifică episoadele';
    btn.addEventListener('click', function (e) {
      e.stopPropagation(); e.preventDefault();
      panel.style.display = 'block';
      if (!running) checkAll();
    }, true);
    document.body.appendChild(btn);

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
  function refresh() {
    var has = document.querySelector('video') && episodes().nums.length >= 2;
    if (has) { ensureUi(); btn.style.display = ''; }
    else if (btn && !running) { btn.style.display = 'none'; panel.style.display = 'none'; }
  }

  window.__rfCheckEpisodes = checkAll; // pentru teste

  function start() { refresh(); setInterval(refresh, 3000); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
