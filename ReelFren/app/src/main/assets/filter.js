// Filtru si sortare pentru listele de seriale de pe reelfren.net.
// Ruleaza doar in pagina principala. Citeste cardurile (EP, nota, platforma, titlu) direct din pagina.
(function () {
  if (window.top !== window) return;
  if (!/(^|\.)reelfren\.net$/i.test(location.hostname)) return;
  if (window.__rfFilter) return;
  window.__rfFilter = true;

  var KEY = 'rfFilter.v1';
  var EP_RX = /^\s*(\d{1,4})\s*(EP|Episode|Episodes|Episoade)\s*$/i;
  var RATING_RX = /^\s*(\d(?:[.,]\d)?)\s*$/;

  var state = load();
  var cards = [];
  var btn, panel, countEl, platBox;

  function load() {
    var d = { sort: 'default', min: '', max: '', plats: [], q: '' };
    try { var s = JSON.parse(localStorage.getItem(KEY)); if (s) for (var k in d) if (k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  function isActive() {
    return state.sort !== 'default' || state.min !== '' || state.max !== '' || state.plats.length || state.q.trim();
  }

  // --- detectare carduri (rapid: fiecare card e citit o singura data) ------
  var SHORT_RX = /^(\d{1,4}|\d{1,4}\s*(EP|Episodes?|Episoade)|EP|Episodes?|Episoade)$/i;

  function findBadges() {
    var out = [], seen = new Set(), w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      var v = w.currentNode.nodeValue;
      if (v.length > 20) continue;
      var t = v.trim();
      if (!t || !SHORT_RX.test(t)) continue;
      var el = w.currentNode.parentElement;
      if (!el || seen.has(el)) continue;
      // "52 EP" poate fi impartit in mai multe noduri de text: verificam textul elementului (doar daca e scurt)
      var pt = el.textContent;
      if (pt.length > 30) continue;
      if (EP_RX.test(pt.replace(/\s+/g, ' ')) && !(panel && panel.contains(el))) { seen.add(el); out.push(el); }
    }
    return out;
  }

  function scan() {
    var badges = findBadges();
    // cate badge-uri contine fiecare stramos: O(n * adancime), nu O(n^2)
    var count = new Map();
    badges.forEach(function (b) {
      for (var p = b.parentElement; p && p !== document.body; p = p.parentElement) count.set(p, (count.get(p) || 0) + 1);
    });
    var found = [], seen = new Set();
    badges.forEach(function (b) {
      var card = b, p = b.parentElement;
      while (p && p !== document.body && count.get(p) === 1) { card = p; p = p.parentElement; }
      if (!seen.has(card)) { seen.add(card); found.push(card); }
    });
    cards = found.map(function (el) {
      if (!el.__rfInfo) el.__rfInfo = parseCard(el, nextIdx++);
      return el.__rfInfo;
    });
    return cards.length;
  }

  var nextIdx = 0;
  function parseCard(el, idx) {
    var info = { el: el, idx: idx, ep: 0, rating: 0, plat: '', title: '' };
    var longest = '', w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      var t = w.currentNode.nodeValue.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      var te = w.currentNode.parentElement, m;
      var pt = te.textContent.length <= 30 ? te.textContent.replace(/\s+/g, ' ').trim() : t;
      if ((m = pt.match(EP_RX))) { info.ep = parseInt(m[1], 10); continue; }
      if (/^(EP|Episodes?)$/i.test(t)) continue;
      if ((m = t.match(RATING_RX)) && parseFloat(m[1].replace(',', '.')) <= 10) { info.rating = parseFloat(m[1].replace(',', '.')); continue; }
      if (/watch now|vizioneaz|^play$/i.test(t)) continue;
      var upper = /^[A-Z0-9+ ]{3,20}$/.test(t);
      if (!upper && !info.plat && t.length >= 3 && t.length <= 20 && t.split(' ').length <= 3) {
        try { upper = getComputedStyle(te).textTransform === 'uppercase'; } catch (e) {}
      }
      if (upper && !info.plat) { info.plat = t.toUpperCase(); continue; }
      if (t.length > longest.length) longest = t;
    }
    var img = el.querySelector('img[alt]');
    info.title = (longest || (img && img.alt) || '').toLowerCase();
    return info;
  }

  // --- aplicare ------------------------------------------------------------
  var gridCache = new WeakMap();
  function isGrid(parent) {
    if (!parent) return false;
    if (!gridCache.has(parent)) gridCache.set(parent, /grid|flex/.test(getComputedStyle(parent).display));
    return gridCache.get(parent);
  }

  function apply() {
    scan();
    if (cards.length < 3) { if (btn) btn.style.display = 'none'; return; }
    ensureUi();
    btn.style.display = 'flex';

    var min = state.min === '' ? -1 : parseInt(state.min, 10);
    var max = state.max === '' ? 1e9 : parseInt(state.max, 10);
    var words = state.q.toLowerCase().split(/[,\s]+/).filter(Boolean);
    var shown = 0;

    cards.forEach(function (c) {
      var ok = c.ep >= min && c.ep <= max;
      if (ok && state.plats.length) ok = state.plats.indexOf(c.plat) >= 0;
      if (ok && words.length) ok = words.some(function (w) { return c.title.indexOf(w) >= 0; });
      var d = ok ? '' : 'none';
      if (c.el.style.display !== d) c.el.style.display = d;
      if (ok) shown++;
    });

    var sorted = cards.slice().sort(function (a, b) {
      switch (state.sort) {
        case 'ep-asc': return a.ep - b.ep || a.idx - b.idx;
        case 'ep-desc': return b.ep - a.ep || a.idx - b.idx;
        case 'rating': return b.rating - a.rating || a.idx - b.idx;
        default: return a.idx - b.idx;
      }
    });
    // CSS order: nu mutam elementele in DOM (site-ul e o aplicatie React si s-ar strica)
    sorted.forEach(function (c, i) {
      var o = state.sort === 'default' ? '' : String(i);
      if (c.el.style.order !== o && isGrid(c.el.parentElement)) c.el.style.order = o;
    });

    btn.classList.toggle('on', !!isActive());
    countEl.textContent = shown + ' din ' + cards.length + ' seriale incarcate';
    renderPlatforms();
  }

  var timer = null, lastRun = 0;
  function schedule() {
    clearTimeout(timer);
    // cand site-ul adauga mult continut, nu reprocesam mai des de o data la ~1s
    var wait = Math.max(500, 1000 - (Date.now() - lastRun));
    timer = setTimeout(function () { lastRun = Date.now(); apply(); }, wait);
  }

  // --- "Incarca tot": deruleaza si apasa "Load more" pana nu mai apar seriale ---
  var loading = false;
  var MORE_RX = /^(load more|show more|see more|view more|more|incarca mai mult|încarcă mai mult|mai mult|mai multe)$/i;
  function clickMore() {
    var els = document.querySelectorAll('button, a, [role=button]');
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (panel.contains(e) || e === btn) continue;
      var txt = (e.innerText || '').trim();
      if (!MORE_RX.test(txt)) continue;
      if (e.tagName === 'A') { var h = e.getAttribute('href'); if (h && h !== '#' && h.indexOf('javascript') !== 0) continue; }
      var r = e.getBoundingClientRect();
      if (r.width && r.height) { e.click(); return true; }
    }
    return false;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function loadAll() {
    if (loading) { loading = false; return; }
    loading = true;
    var lb = panel.querySelector('#rf-load');
    var last = -1, same = 0;
    while (loading && same < 4 && cards.length < 3000) {
      clickMore();
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(1300);
      scan();
      if (cards.length === last) same++; else { same = 0; last = cards.length; }
      lb.textContent = '⏹ Opreste (' + cards.length + ' incarcate)';
    }
    loading = false;
    lb.textContent = '⬇️ Incarca tot';
    apply();
    window.scrollTo(0, 0);
  }

  // --- interfata -----------------------------------------------------------
  function ensureUi() {
    if (btn) return;
    var css = document.createElement('style');
    css.textContent =
      '#rf-btn{position:fixed;right:16px;bottom:96px;z-index:2147483646;display:flex;align-items:center;gap:6px;' +
      'padding:10px 16px;border-radius:24px;border:1px solid #2dd4bf;background:#0b1220ee;color:#e6fffb;' +
      'font:600 15px system-ui,sans-serif;box-shadow:0 4px 16px #0008}' +
      '#rf-btn.on{background:#0f766e;border-color:#5eead4}' +
      '#rf-panel{position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:80vh;overflow:auto;' +
      'background:#0b1220;color:#e5e7eb;border-top:1px solid #2dd4bf;border-radius:16px 16px 0 0;' +
      'padding:16px 16px 24px;font:15px system-ui,sans-serif;box-shadow:0 -8px 24px #000a;display:none}' +
      '#rf-panel h3{margin:0 0 4px;font-size:18px;color:#fff}' +
      '#rf-panel .rf-l{margin:14px 0 6px;font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em}' +
      '#rf-panel .rf-row{display:flex;flex-wrap:wrap;gap:8px}' +
      '#rf-panel .rf-chip{padding:8px 12px;border-radius:18px;border:1px solid #334155;background:#111827;color:#e5e7eb;font-size:14px}' +
      '#rf-panel .rf-chip.sel{background:#0f766e;border-color:#5eead4;color:#fff}' +
      '#rf-panel input{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid #334155;background:#111827;color:#fff;font-size:15px}' +
      '#rf-panel .rf-two{display:flex;gap:8px}' +
      '#rf-panel .rf-act{display:flex;gap:8px;margin-top:18px}' +
      '#rf-panel .rf-act button{flex:1;padding:12px;border-radius:12px;border:0;font:600 15px system-ui}' +
      '#rf-count{font-size:13px;color:#94a3b8}';
    document.head.appendChild(css);

    btn = document.createElement('button');
    btn.id = 'rf-btn';
    btn.textContent = '⚙️ Filtru';
    btn.onclick = function () { panel.style.display = 'block'; };
    document.body.appendChild(btn);

    panel = document.createElement('div');
    panel.id = 'rf-panel';
    panel.innerHTML =
      '<h3>Filtru</h3><div id="rf-count"></div>' +
      '<button class="rf-chip" id="rf-load" style="margin-top:10px;width:100%">\u2B07\uFE0F Incarca tot</button>' +
      '<div class="rf-l">Sortare</div><div class="rf-row" id="rf-sort">' +
      chip('default', 'Implicit') + chip('ep-asc', 'Episoade ↑') + chip('ep-desc', 'Episoade ↓') + chip('rating', 'Nota ↓') +
      '</div>' +
      '<div class="rf-l">Episoade</div><div class="rf-two">' +
      '<input id="rf-min" type="number" inputmode="numeric" placeholder="minim">' +
      '<input id="rf-max" type="number" inputmode="numeric" placeholder="maxim"></div>' +
      '<div class="rf-row" style="margin-top:8px">' +
      quick('', '30', 'Scurte (≤30)') + quick('31', '60', 'Medii (31–60)') + quick('61', '', 'Lungi (60+)') +
      '</div>' +
      '<div class="rf-l">Cuvinte in titlu (gen / tema)</div>' +
      '<input id="rf-q" placeholder="ex: alpha, ceo, billionaire, mate">' +
      '<div class="rf-row" style="margin-top:8px" id="rf-tags">' +
      ['alpha', 'ceo', 'billionaire', 'mate', 'wife', 'revenge', 'boss', 'king', 'love'].map(function (t) {
        return '<button class="rf-chip" data-tag="' + t + '">' + t + '</button>';
      }).join('') +
      '</div>' +
      '<div class="rf-l">Platforma</div><div class="rf-row" id="rf-plats"></div>' +
      '<div class="rf-act"><button id="rf-reset" style="background:#1f2937;color:#e5e7eb">Reseteaza</button>' +
      '<button id="rf-close" style="background:#14b8a6;color:#04201d">Gata</button></div>';
    document.body.appendChild(panel);
    countEl = panel.querySelector('#rf-count');
    platBox = panel.querySelector('#rf-plats');

    function chip(v, label) { return '<button class="rf-chip" data-sort="' + v + '">' + label + '</button>'; }
    function quick(a, b, label) { return '<button class="rf-chip" data-min="' + a + '" data-max="' + b + '">' + label + '</button>'; }

    panel.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.sort) state.sort = t.dataset.sort;
      else if (t.hasAttribute('data-min')) { state.min = t.dataset.min; state.max = t.dataset.max; }
      else if (t.dataset.tag) {
        var words = state.q.split(/[,\s]+/).filter(Boolean);
        var i = words.indexOf(t.dataset.tag);
        if (i >= 0) words.splice(i, 1); else words.push(t.dataset.tag);
        state.q = words.join(', ');
      }
      else if (t.dataset.plat) {
        var j = state.plats.indexOf(t.dataset.plat);
        if (j >= 0) state.plats.splice(j, 1); else state.plats.push(t.dataset.plat);
      }
      else if (t.id === 'rf-reset') state = { sort: 'default', min: '', max: '', plats: [], q: '' };
      else if (t.id === 'rf-close') { panel.style.display = 'none'; return; }
      else if (t.id === 'rf-load') { loadAll(); return; }
      save(); syncInputs(); apply();
    });
    ['rf-min', 'rf-max', 'rf-q'].forEach(function (id) {
      panel.querySelector('#' + id).addEventListener('input', function (e) {
        state[id === 'rf-min' ? 'min' : id === 'rf-max' ? 'max' : 'q'] = e.target.value;
        save(); schedule();
      });
    });
    syncInputs();
  }

  function syncInputs() {
    panel.querySelector('#rf-min').value = state.min;
    panel.querySelector('#rf-max').value = state.max;
    panel.querySelector('#rf-q').value = state.q;
    panel.querySelectorAll('[data-sort]').forEach(function (b) { b.classList.toggle('sel', b.dataset.sort === state.sort); });
    panel.querySelectorAll('[data-min]').forEach(function (b) {
      b.classList.toggle('sel', b.dataset.min === state.min && b.dataset.max === state.max);
    });
    var words = state.q.toLowerCase().split(/[,\s]+/);
    panel.querySelectorAll('[data-tag]').forEach(function (b) { b.classList.toggle('sel', words.indexOf(b.dataset.tag) >= 0); });
  }

  function renderPlatforms() {
    var seen = {};
    cards.forEach(function (c) { if (c.plat) seen[c.plat] = (seen[c.plat] || 0) + 1; });
    state.plats.forEach(function (p) { if (!(p in seen)) seen[p] = 0; });
    var names = Object.keys(seen).sort();
    var html = names.map(function (p) {
      return '<button class="rf-chip' + (state.plats.indexOf(p) >= 0 ? ' sel' : '') + '" data-plat="' + p.replace(/"/g, '') + '">' +
        p + ' (' + seen[p] + ')</button>';
    }).join('') || '<span id="rf-count">Nicio platforma gasita pe pagina</span>';
    if (platBox.innerHTML !== html) platBox.innerHTML = html;
  }

  // --- pornire si urmarire schimbari (scroll infinit, navigare in site) ---
  function start() {
    apply();
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var t = muts[i].target;
        if (panel && panel.contains(t)) continue;
        if (btn && (t === btn || btn.contains(t))) continue;
        schedule();
        return;
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
