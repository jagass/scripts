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
    // setarile tin doar cat e deschisa aplicatia (nu raman "agatate" si nu ascund rezultatele cautarii
    // la urmatoarea pornire); stergem si filtrul vechi salvat permanent de versiunile anterioare
    try { localStorage.removeItem(KEY); } catch (e) {}
    try { var s = JSON.parse(sessionStorage.getItem(KEY)); if (s) for (var k in d) if (k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

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

  function cardKey(a) {
    var m = (a.getAttribute('href') || '').match(/\/drama\/([^\/?#]+)\/([^\/?#]+)/);
    return m ? m[1] + '/' + m[2] : null;
  }

  // Card = cel mai mare stramos al linkului care contine un singur serial (un singur /drama/<id>).
  function cardsFromLinks() {
    var links = document.querySelectorAll('a[href*="/drama/"]');
    var owner = new Map(); // element -> cheia serialului, sau '*' daca are mai multe
    var items = [];
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      if (panel && panel.contains(a)) continue;
      var key = cardKey(a);
      if (!key) continue;
      items.push([a, key]);
      for (var p = a; p && p !== document.body; p = p.parentElement) {
        var k = owner.get(p);
        if (k === undefined) owner.set(p, key);
        else if (k !== key) { owner.set(p, '*'); }
      }
    }
    var found = [], seen = new Set();
    items.forEach(function (it) {
      var card = it[0], p = card.parentElement;
      while (p && p !== document.body && owner.get(p) === it[1]) { card = p; p = p.parentElement; }
      if (!seen.has(card)) { seen.add(card); found.push({ el: card, key: it[1] }); }
    });
    return found;
  }

  function cardsFromBadges() {
    var badges = findBadges();
    var count = new Map();
    badges.forEach(function (b) {
      for (var p = b.parentElement; p && p !== document.body; p = p.parentElement) count.set(p, (count.get(p) || 0) + 1);
    });
    var found = [], seen = new Set();
    badges.forEach(function (b) {
      var card = b, p = b.parentElement;
      while (p && p !== document.body && count.get(p) === 1) { card = p; p = p.parentElement; }
      if (!seen.has(card)) { seen.add(card); found.push({ el: card, key: null }); }
    });
    return found;
  }

  var mode = '';
  function scan() {
    var found = cardsFromLinks();
    mode = 'link';
    if (found.length < 3) { found = cardsFromBadges(); mode = 'badge'; }
    cards = [];
    found.forEach(function (f) {
      var info = f.el.__rfInfo;
      if (!info || info.key !== f.key) info = f.el.__rfInfo = parseCard(f.el, nextIdx++, f.key);
      // in modul "link" pastram si cardurile la care nu am gasit numarul de episoade (ep = 0):
      // la un filtru de episoade minim sunt ascunse, ca sa nu ramana "scapari"
      if (mode === 'link' || info.ep > 0) cards.push(info);
    });
    return cards.length;
  }

  var nextIdx = 0;
  function parseCard(el, idx, key) {
    var info = { el: el, key: key, idx: idx, ep: 0, rating: 0, plat: '', title: '' };
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
    // numarul de episoade poate fi impartit in elemente diferite ("52" + "EP"): cautam in tot textul cardului
    if (!info.ep || !info.rating) {
      var parts = [], w2 = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (w2.nextNode()) { var v = w2.currentNode.nodeValue.trim(); if (v) parts.push(v); }
      var all = ' ' + parts.join(' ') + ' ', mm;
      if (!info.ep && (mm = all.match(/\s(\d{1,4})\s*(EP|Eps?\.?|Episodes?|Episoade)(?=\s|$)/i))) info.ep = parseInt(mm[1], 10);
      if (!info.rating && (mm = all.match(/[\u2605\u2B50]\s*(\d(?:[.,]\d)?)\b/))) info.rating = parseFloat(mm[1].replace(',', '.'));
    }
    // platforma din link (/drama/<platforma>/...) e mai sigura decat textul de pe card
    if (key) info.plat = key.split('/')[0].toUpperCase();
    var img = el.querySelector('img[alt]');
    info.title = ((longest || '') + ' ' + ((img && img.alt) || '') + ' ' + (key ? key.split('/')[1].replace(/^\d+-?/, '').replace(/-/g, ' ') : '')).toLowerCase();
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
    // pe pagina unui serial (prezentare / vizionare) filtrul n-are rost si ar acoperi butoanele site-ului
    if (/^\/(drama|watch)\//.test(location.pathname)) {
      if (btn) btn.style.display = 'none';
      if (panel) panel.style.display = 'none';
      cards.forEach(function (c) { c.el.removeAttribute('data-rf-hide'); });
      return;
    }
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
      if (ok) { if (c.el.hasAttribute('data-rf-hide')) c.el.removeAttribute('data-rf-hide'); }
      else if (!c.el.hasAttribute('data-rf-hide')) c.el.setAttribute('data-rf-hide', '');
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
      if (c.el.style.order !== o && isGrid(c.el.parentElement)) c.el.style.setProperty('order', o, o ? 'important' : '');
    });

    btn.classList.toggle('on', !!isActive());
    var hiddenCount = cards.length - shown;
    var label = isActive() && hiddenCount > 0 ? '\u2699\uFE0F Filtru \u00B7 ' + hiddenCount + ' ascunse' : '\u2699\uFE0F Filtru';
    if (btn.textContent !== label) btn.textContent = label;
    countEl.textContent = shown + ' din ' + cards.length + ' seriale incarcate';
    showAllHiddenNotice(isActive() && cards.length > 0 && shown === 0);
    renderPlatforms();
  }

  // Daca filtrul ascunde TOATE serialele (ex. la o cautare), spunem clar asta, cu buton de resetare,
  // in loc sa lasam pagina goala (site-ul ar crede ca s-a terminat lista si ar tot incarca).
  var notice = null;
  function showAllHiddenNotice(on) {
    if (!on) { if (notice) notice.style.display = 'none'; return; }
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'rf-notice';
      notice.style.cssText = 'position:fixed;left:12px;right:12px;top:72px;z-index:2147483646;background:#0b1220f2;color:#e5e7eb;' +
        'border:1px solid #f59e0b;border-radius:14px;padding:14px;font:15px system-ui,sans-serif;box-shadow:0 6px 20px #0009;text-align:center';
      notice.innerHTML = '<div id="rf-notice-text" style="margin-bottom:10px"></div>' +
        '<button id="rf-notice-reset" style="padding:10px 18px;border-radius:10px;border:0;background:#f59e0b;color:#1f1300;font:600 15px system-ui">Reseteaz\u0103 filtrul</button>';
      document.body.appendChild(notice);
      tap(notice, function (e) {
        if (e.target.closest('#rf-notice-reset')) {
          state = { sort: 'default', min: '', max: '', plats: [], q: '' };
          save(); if (panel) syncInputs(); apply();
        }
      });
    }
    notice.querySelector('#rf-notice-text').textContent =
      'Filtrul t\u0103u ascunde toate cele ' + cards.length + ' seriale de pe pagin\u0103.';
    notice.style.display = 'block';
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
      '#rf-count{font-size:13px;color:#94a3b8}' +
      '[data-rf-hide]{display:none!important}' +
      '#rf-btn,#rf-panel button{touch-action:manipulation;-webkit-tap-highlight-color:transparent}' +
      '#rf-diag{width:100%;height:160px;margin-top:8px;font:11px monospace;background:#020617;color:#a7f3d0;border:1px solid #334155;border-radius:8px}';
    document.head.appendChild(css);

    btn = document.createElement('button');
    btn.id = 'rf-btn';
    btn.textContent = '⚙️ Filtru';
    tap(btn, function () { panel.style.display = 'block'; syncInputs(); renderPlatforms(); });
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
      '<button id="rf-close" style="background:#14b8a6;color:#04201d">Gata</button></div>' +
      '<button class="rf-chip" id="rf-diag-btn" style="margin-top:14px;width:100%;opacity:.7">\uD83D\uDCCB Diagnostic (pentru depanare)</button>' +
      '<div id="rf-diag-box"></div>';
    document.body.appendChild(panel);
    countEl = panel.querySelector('#rf-count');
    platBox = panel.querySelector('#rf-plats');

    function chip(v, label) { return '<button class="rf-chip" data-sort="' + v + '">' + label + '</button>'; }
    function quick(a, b, label) { return '<button class="rf-chip" data-min="' + a + '" data-max="' + b + '">' + label + '</button>'; }

    tap(panel, function (e) {
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
      else if (t.id === 'rf-diag-btn') { showDiag(); return; }
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

  // Raspunde la atingere imediat; ignora click-ul "fantoma" care vine dupa touchend.
  function tap(el, fn) {
    var lastTouch = 0, sx = 0, sy = 0;
    el.addEventListener('touchstart', function (e) {
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
    }, { passive: true });
    el.addEventListener('touchend', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      var ct = e.changedTouches[0];
      if (Math.abs(ct.clientX - sx) > 12 || Math.abs(ct.clientY - sy) > 12) return; // a fost scroll, nu apasare
      lastTouch = Date.now();
      e.preventDefault();
      e.stopPropagation();
      fn(e);
    }, { passive: false });
    el.addEventListener('click', function (e) {
      if (Date.now() - lastTouch < 700) return;
      e.stopPropagation();
      fn(e);
    });
  }

  function showDiag() {
    var box = panel.querySelector('#rf-diag-box');
    var sample = cards.slice(0, 2).map(function (c) {
      return { ep: c.ep, rating: c.rating, plat: c.plat, title: c.title.slice(0, 60), hidden: c.el.hasAttribute('data-rf-hide'),
        display: getComputedStyle(c.el).display, html: c.el.outerHTML.replace(/\s+/g, ' ').slice(0, 1500) };
    });
    var d = { url: location.href, mode: mode, cards: cards.length, links: document.querySelectorAll('a[href*="/drama/"]').length,
      state: state, sample: sample };
    box.innerHTML = '<div class="rf-l">Copiaza textul de mai jos si trimite-l</div><textarea id="rf-diag" readonly></textarea>';
    var ta = box.querySelector('#rf-diag');
    ta.value = JSON.stringify(d, null, 1);
    ta.focus(); ta.select();
    try { navigator.clipboard.writeText(ta.value); } catch (e) {}
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
        var added = muts[i].addedNodes;
        for (var j = 0; j < added.length; j++) {
          var n = added[j];
          if (n.nodeType !== 1) continue;
          if ((n.matches && n.matches('a[href*="/drama/"]')) || (n.querySelector && n.querySelector('a[href*="/drama/"]')) ||
              /\d\s*EP/i.test(n.textContent || '')) { schedule(); return; }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
