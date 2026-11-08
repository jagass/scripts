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
    var d = { sort: 'default', min: '', max: '', plats: [], q: '', health: 'all' };
    // setarile tin doar cat e deschisa aplicatia (nu raman "agatate" si nu ascund rezultatele cautarii
    // la urmatoarea pornire); stergem si filtrul vechi salvat permanent de versiunile anterioare
    try { localStorage.removeItem(KEY); } catch (e) {}
    try { var s = JSON.parse(sessionStorage.getItem(KEY)); if (s) for (var k in d) if (k in s) d[k] = s[k]; } catch (e) {}
    return d;
  }
  function save() { try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }

  // cautare: TOATE cuvintele trebuie sa fie in titlu (fara diferenta intre litere mari/mici sau diacritice)
  function norm(t) {
    t = String(t || '').toLowerCase();
    try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
    return t.replace(/[^a-z0-9]+/g, ' ');
  }
  function searchWords() { return norm(state.q).split(' ').filter(Boolean); }
  function titleMatches(title, words) {
    if (!words.length) return true;
    var t = ' ' + norm(title) + ' ';
    return words.every(function (w) { return t.indexOf(w) >= 0; });
  }

  function isActive() {
    return state.sort !== 'default' || state.min !== '' || state.max !== '' || state.plats.length || state.q.trim() ||
      (state.health && state.health !== 'all');
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
      if (a.closest('[id^="rf-"]')) continue; // elementele aplicatiei (lista din memorie, panouri)
      var key = cardKey(a);
      if (!key) continue;
      items.push([a, key, a.href]);
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
      if (!seen.has(card)) { seen.add(card); found.push({ el: card, key: it[1], href: it[2] }); }
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
      if (!info || info.key !== f.key) info = f.el.__rfInfo = parseCard(f.el, nextIdx++, f.key, f.href);
      // in modul "link" pastram si cardurile la care nu am gasit numarul de episoade (ep = 0):
      // la un filtru de episoade minim sunt ascunse, ca sa nu ramana "scapari"
      if (mode === 'link' || info.ep > 0) cards.push(info);
    });
    return cards.length;
  }

  var nextIdx = 0;
  function imgOf(el) {
    function good(u) { return u && u.indexOf('data:') !== 0 && u.indexOf('blob:') !== 0; }
    function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return u; } }
    var imgs = el.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) {
      var img = imgs[i];
      var cands = [img.currentSrc, img.getAttribute('src'), img.getAttribute('data-src'), img.getAttribute('data-lazy-src'),
        img.getAttribute('data-original'), (img.getAttribute('srcset') || img.getAttribute('data-srcset') || '').split(',')[0].trim().split(' ')[0]];
      for (var j = 0; j < cands.length; j++) if (good(cands[j])) return abs(cands[j]);
    }
    var srcEl = el.querySelector('picture source[srcset], source[data-srcset]');
    if (srcEl) { var u = (srcEl.getAttribute('srcset') || srcEl.getAttribute('data-srcset') || '').split(',')[0].trim().split(' ')[0]; if (good(u)) return abs(u); }
    var bg = el.querySelector('[style*="background-image"]');
    if (bg) { var m = bg.getAttribute('style').match(/url\(["']?([^"')]+)/); if (m && good(m[1])) return abs(m[1]); }
    return '';
  }

  // titlul din adresa: /drama/flextv2/14912-bad-eyes-sweet-lies -> "Bad Eyes Sweet Lies"
  function slugTitle(key) {
    var slug = key ? (key.split('/')[1] || '') : '';
    return slug.replace(/^\d+-?/, '').split('-').filter(Boolean).map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(' ');
  }

  // titlul afisat pe card (NU descrierea): element de titlu, apoi textul pozei, apoi adresa
  function cardTitle(el, key) {
    var cands = el.querySelectorAll('h1, h2, h3, h4, h5, h6, [class*="title" i], [class*="name" i]');
    for (var i = 0; i < cands.length; i++) {
      var t = (cands[i].textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length >= 2 && t.length <= 120 && !EP_RX.test(t) && !/^watch now$/i.test(t)) return t;
    }
    var img = el.querySelector('img[alt]');
    var alt = img ? (img.getAttribute('alt') || '').trim() : '';
    if (alt.length >= 2 && alt.length <= 120 && !/^(poster|cover|image|thumbnail|img)$/i.test(alt)) return alt;
    return slugTitle(key);
  }

  function parseCard(el, idx, key, href) {
    var info = { el: el, key: key, href: href || '', idx: idx, ep: 0, rating: 0, plat: '', title: '', name: '', img: '' };
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
    info.name = cardTitle(el, key) || longest;
    info.img = imgOf(el);
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
      var fb = document.getElementById('rf-load-fab'); if (fb) fb.style.display = 'none';
      if (panel) panel.style.display = 'none';
      cards.forEach(function (c) { c.el.removeAttribute('data-rf-hide'); });
      if (catalogVisible()) hideCatalog(false);
      var ob = document.getElementById('rf-cat-open'); if (ob) ob.style.display = 'none';
      return;
    }
    scan();
    if (cards.length < 3 && !catalogReady()) { if (btn) btn.style.display = 'none'; return; }
    ensureUi();
    btn.style.display = 'flex';
    updateCatalogVisibility();
    if (cards.length >= 3) maybeAutoLoad();
    var fabEl = document.getElementById('rf-load-fab');
    if (fabEl) fabEl.style.display = !catalogVisible() && isListPage() && cards.length >= 3 ? 'block' : 'none';
    if (catalogVisible()) {
      // pagina site-ului e ascunsa sub lista: nu mai ascundem/sortam mii de carduri invizibile
      if (JSON.stringify(state) !== lastCatSig) renderCatalogSoon();
      btn.classList.toggle('on', !!isActive());
      if (!loading) btn.textContent = '\u2699\uFE0F Filtru';
      return;
    }

    var min = state.min === '' ? -1 : parseInt(state.min, 10);
    var max = state.max === '' ? 1e9 : parseInt(state.max, 10);
    var words = searchWords();
    var shown = 0;

    cards.forEach(function (c) {
      var ok = c.ep >= min && c.ep <= max;
      if (ok && c.key && !showSeen && isSeen(c.key)) ok = false; // serial marcat ca vazut
      if (ok && c.key && !healthOk(c.key)) ok = false;
      if (ok && state.plats.length) ok = state.plats.indexOf(c.plat) >= 0;
      if (ok && words.length) ok = titleMatches(c.name || c.title, words);
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
    if (!loading && btn.textContent !== label) btn.textContent = label;
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
          state = { sort: 'default', min: '', max: '', plats: [], q: '', health: 'all' };
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
    if (loading) return; // in timpul incarcarii lucreaza doar loadAll (incremental), ca telefonul sa nu se blocheze
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
  var openedCard = false;
  // asteapta (cel mult maxMs) sa apara seriale noi in pagina, apoi continua imediat
  async function waitMore(before, maxMs) {
    var t0 = Date.now();
    while (Date.now() - t0 < maxMs) {
      if (!loading) return false; // "Opreste": iesim imediat
      await sleep(150);
      if (document.querySelectorAll('a[href*="/drama/"]').length > before) { await sleep(120); return true; }
    }
    return false;
  }

  // --- citire incrementala: la fiecare pas doar serialele noi din pagina (nu toate miile) ---
  var processedLinks = new WeakSet(), learnedDepth = -1, pendingImg = [], linkCount = 0;
  function learnDepth() {
    var found = cardsFromLinks();
    for (var i = 0; i < found.length && learnedDepth < 0; i++) {
      var f = found[i], a = f.el.matches && f.el.matches('a[href*="/drama/"]') ? f.el : f.el.querySelector('a[href*="/drama/"]');
      if (!a) continue;
      var d = 0, p = a;
      while (p && p !== f.el) { p = p.parentElement; d++; }
      if (p === f.el) learnedDepth = d;
    }
  }
  function cardOf(a) {
    var el = a;
    for (var i = 0; i < learnedDepth && el.parentElement && el.parentElement !== document.body; i++) el = el.parentElement;
    return el;
  }
  function collectNew() {
    if (learnedDepth < 0) learnDepth();
    var as = document.querySelectorAll('a[href*="/drama/"]'), out = [], keys = {};
    linkCount = as.length;
    for (var i = 0; i < as.length; i++) {
      var a = as[i];
      if (processedLinks.has(a)) continue;
      processedLinks.add(a);
      if (a.closest('[id^="rf-"]')) continue;
      var key = cardKey(a);
      if (!key || keys[key]) continue;
      keys[key] = 1;
      var el = learnedDepth >= 0 ? cardOf(a) : a;
      var info = el.__rfInfo && el.__rfInfo.key === key ? el.__rfInfo : (el.__rfInfo = parseCard(el, nextIdx++, key, a.href));
      if (!info.img) { info.img = imgOf(el); if (!info.img && pendingImg.length < 3000) pendingImg.push(info); }
      out.push(info);
    }
    return out;
  }
  // pozele apar abia cand cardul trece prin ecran: le recitim pe cele care inca lipsesc
  function fillPendingImages() {
    if (!pendingImg.length) return;
    catLoad();
    var keep = [];
    for (var i = 0; i < pendingImg.length; i++) {
      var info = pendingImg[i];
      var u = info.el && info.el.isConnected ? imgOf(info.el) : '';
      if (u) {
        info.img = u;
        var it = catMap[info.key];
        if (it && !it.i) { it.i = u; catDirty = true; }
      } else if (info.el && info.el.isConnected) keep.push(info);
    }
    pendingImg = keep;
  }

  // mode: 'full' = toata lista; 'new' = doar pana dam de seriale deja cunoscute (lista din memorie)
  async function loadAll(mode) {
    if (loading) { loading = false; return; }
    loading = true;
    openedCard = false;
    mode = mode || 'full';
    var lb = panel.querySelector('#rf-load');
    var same = 0, knownSteps = 0;
    processedLinks = new WeakSet(); pendingImg = []; learnedDepth = -1;
    window.scrollTo(0, 0);
    var gotNew = catalogMerge(false, collectNew());
    var total = linkCount;
    loadButtons(true, 0);
    if (mode === 'new' && catalogReady() && gotNew === 0) knownSteps = 1;
    while (loading && same < 4 && total < 100000) {
      if (mode === 'new' && knownSteps >= 2) break; // am ajuns la seriale cunoscute: restul sunt in memorie
      // derulam cate un ecran, ca fiecare serial sa treaca prin ecran (site-ul ii pune poza abia atunci)
      while (loading && window.scrollY + innerHeight < document.documentElement.scrollHeight - 20) {
        window.scrollBy(0, Math.round(innerHeight * 0.9));
        await sleep(70);
        fillPendingImages();
      }
      if (!loading) break;
      var before = document.querySelectorAll('a[href*="/drama/"]').length;
      clickMore();
      var grew = await waitMore(before, 2500);
      await sleep(80);
      fillPendingImages();
      var n = catalogMerge(false, collectNew());
      total = linkCount;
      // la prima incarcare, lista ta apare imediat ce are primele seriale (si cu ea butonul "Opreste")
      if (!catalogVisible()) {
        updateCatalogVisibility();
        var fb = document.getElementById('rf-load-fab'); if (fb && catalogVisible()) fb.style.display = 'none';
      }
      if (!grew) same++; else same = 0;
      if (mode === 'new') knownSteps = n === 0 ? knownSteps + 1 : 0;
      var count = catalogReady() ? cat.items.length : total;
      lb.textContent = '\u23F9 Opreste (' + count + ')';
      btn.textContent = mode === 'new' ? '\uD83D\uDD04 Caut seriale noi\u2026 ' + count : '\u23F3 Se \u00EEncarc\u0103 toate\u2026 ' + count;
      loadButtons(true, count);
      catalogStatus(mode === 'new' ? '\uD83D\uDD04 caut seriale noi\u2026' : '\u23F3 actualizez lista\u2026 ' + count);
    }
    fillPendingImages();
    var finished = loading; // false = oprit de tine
    loading = false;
    if (finished && mode === 'full' && same >= 4) catalogMarkFull();
    lb.textContent = '⬇️ Incarca tot';
    btn.textContent = '';
    loadButtons(false);
    catalogMerge(true, []);
    catalogStatus(null);
    if (catalogVisible() && catNeedsRender) renderCatalog();
    apply();
    if (!openedCard && !catalogVisible()) window.scrollTo(0, 0); // inapoi sus, la inceputul listei complete
  }

  // Pagina cu liste (pagina principala, Explore, cautare): se incarca automat toate serialele, o data.
  var autoLoadedFor = null;
  function isListPage() {
    return location.pathname === '/' || /explore|search|category|categories|genre|platform|browse|list|trending|new/i.test(location.pathname);
  }
  function maybeAutoLoad() {
    return; // incarcarea porneste doar din butoane (la cererea ta), nu automat
    var key = location.pathname + location.search;
    if (autoLoadedFor === key || loading || !isListPage()) return;
    autoLoadedFor = key;
    // cu lista in memorie: cautam doar serialele noi (si o verificare completa o data la 12 ore)
    var mode = catalogReady() && !catalogStale() && isHomeList() ? 'new' : 'full';
    setTimeout(function () { if (!loading) loadAll(mode); }, 600);
  }

  // Un serial atins in lista se deschide intr-o pagina noua (aplicatia), ca lista sa ramana incarcata.
  document.addEventListener('click', function (e) {
    if (!e.isTrusted || !window.RFBridge) return;
    if (/^\/(drama|watch)\//.test(location.pathname)) return;
    var a = e.target && e.target.closest && e.target.closest('a[href*="/drama/"], a[href*="/watch/"]');
    if (!a || (panel && panel.contains(a))) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (loading) { loading = false; openedCard = true; }
    window.RFBridge.postMessage('open:' + a.href);
  }, true);

  // --- Lista din memorie (catalog) ---------------------------------------------------------
  // Toate serialele vazute vreodata pe paginile de liste sunt tinute in memoria aplicatiei
  // (localStorage), ca la urmatoarea deschidere lista completa sa apara imediat. Serialele noi
  // gasite la verificare sunt puse deasupra, cu eticheta NOU.
  var CAT_KEY = 'rfCatalog.v1';
  var NEW_DAYS = 3;
  var cat = null, catMap = null, catDirty = false, catSaveTimer = null;

  function catLoad() {
    if (cat) return;
    try { cat = JSON.parse(localStorage.getItem(CAT_KEY)); } catch (e) { cat = null; }
    if (!cat || !cat.items) cat = { items: [], lastFull: 0 };
    catMap = {};
    cat.items.forEach(function (it) {
      // versiunile anterioare salvau uneori descrierea in loc de titlu: o inlocuim cu titlul din adresa
      if (!it.n || it.n.length > 90) { it.n = slugTitle(it.k); catDirty = true; }
      catMap[it.k] = it;
    });
    if (catDirty) setTimeout(catSave, 0);
  }
  function catSave() {
    catDirty = false;
    try { localStorage.setItem(CAT_KEY, JSON.stringify(cat)); }
    catch (e) { // prea mare: pastram lista fara poze
      try { localStorage.setItem(CAT_KEY, JSON.stringify({ items: cat.items.map(function (it) { var c = Object.assign({}, it); c.i = ''; return c; }), lastFull: cat.lastFull })); } catch (e2) {}
    }
  }
  // salvare imediata cand iesi din aplicatie / pagina (ca lista sa nu ramana incompleta)
  function saveNow() { if (catDirty) { clearTimeout(catSaveTimer); catSave(); } }
  document.addEventListener('visibilitychange', function () { if (document.hidden) saveNow(); });
  window.addEventListener('pagehide', saveNow);

  // --- seriale vazute (ascunse din liste, la cererea ta) ---
  var SEEN_KEY = 'rfSeen.v1';
  var seen = null, showSeen = false;
  function seenKey(k) {           // "platforma/id" (fara titlu), la fel pentru /drama/ si /watch/
    var parts = String(k || '').split('/');
    var id = (parts[1] || '').match(/^\d+/);
    return parts[0] + '/' + (id ? id[0] : parts[1]);
  }
  function seenLoad() { if (!seen) { try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch (e) { seen = {}; } } return seen; }
  function seenSave() { try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)); } catch (e) {} }
  function isSeen(k) { return !!seenLoad()[seenKey(k)]; }
  function seenCount() { return Object.keys(seenLoad()).length; }
  // --- lista "De vazut" (serialele puse deoparte pentru mai tarziu) ---
  var WATCH_KEY = 'rfWatch.v1', watch = null, showWatch = false;
  function watchLoad() { if (!watch) { try { watch = JSON.parse(localStorage.getItem(WATCH_KEY)) || {}; } catch (e) { watch = {}; } } return watch; }
  function watchSave() { try { localStorage.setItem(WATCH_KEY, JSON.stringify(watch)); } catch (e) {} }
  function inWatch(k) { return !!watchLoad()[seenKey(k)]; }
  function watchCount() { return Object.keys(watchLoad()).length; }
  function toggleWatch(k) {
    watchLoad();
    var sk = seenKey(k);
    if (watch[sk]) delete watch[sk]; else watch[sk] = Date.now();
    watchSave();
    return !!watch[sk];
  }

  function toggleSeen(k) {
    seenLoad();
    var sk = seenKey(k);
    if (seen[sk]) delete seen[sk]; else seen[sk] = Date.now();
    seenSave();
    if (seen[sk] && watchLoad()[sk]) { delete watch[sk]; watchSave(); } // vazut -> iese din "De vazut"
    return !!seen[sk];
  }
  window.addEventListener('storage', function (e) {
    if (e.key === SEEN_KEY) { seen = null; schedule(); }
    if (e.key === WATCH_KEY) { watch = null; schedule(); }
  });

  // --- rezultatele verificarii episoadelor (salvate de "Verifica episoadele") ---
  var epStatus = null;
  function epLoad() { if (!epStatus) { try { epStatus = JSON.parse(localStorage.getItem('rfEpStatus.v1')) || {}; } catch (e) { epStatus = {}; } } return epStatus; }
  // -1 = neverificat, 0 = toate merg, >0 = cate episoade nu merg
  function healthOf(k) { var r = epLoad()[seenKey(k)]; return r && r.at ? (r.bad && r.bad.length ? r.bad.length : 0) : -1; }
  // serial incomplet: pe site sunt mai putine episoade decat anunta, sau l-ai marcat tu
  function incompleteOf(k) {
    var r = epLoad()[seenKey(k)];
    if (!r) return null;
    if (r.inc) return { t: r.t || 0, total: r.total || 0 };
    if (r.total && r.t && r.t < r.total) return { t: r.t, total: r.total };
    return null;
  }
  function healthOk(k) {
    if (!state.health || state.health === 'all') return true;
    var h = healthOf(k), inc = incompleteOf(k);
    if (state.health === 'nobroken') return h <= 0 && !inc;   // ascunde serialele cu episoade stricate sau incomplete
    return h === 0 && !inc;                                    // 'verified': verificate, toate merg, complete
  }
  window.addEventListener('storage', function (e) { if (e.key === 'rfEpStatus.v1') { epStatus = null; schedule(); } });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { epStatus = null; seen = null; if (catalogVisible()) renderCatalogSoon(); } });

  function catalogReady() { catLoad(); return cat.items.length >= 30; }
  function catalogStale() { catLoad(); return Date.now() - (cat.lastFull || 0) > 12 * 3600 * 1000; }
  function catalogMarkFull() { catLoad(); cat.lastFull = Date.now(); catDirty = true; catSave(); }
  function isHomeList() { return location.pathname === '/' || /^\/explore\/?$/.test(location.pathname); }

  // adauga in memorie serialele din pagina; intoarce cate sunt noi
  function catalogMerge(forceSave, list) {
    if (!isHomeList()) return 0;
    catLoad();
    // pana la prima incarcare completa terminata, totul se adauga in ordinea site-ului, fara "NOU"
    var first = !cat.lastFull, now = Date.now(), fresh = [];
    (list || cards).forEach(function (c) {
      if (!c.key || !c.href) return;
      var it = catMap[c.key];
      if (!it) {
        it = { k: c.key, u: c.href, n: c.name, i: c.img, e: c.ep, r: c.rating, p: c.plat, f: first ? 0 : now };
        catMap[c.key] = it;
        fresh.push(it);
      } else {
        if (c.ep) it.e = c.ep;
        if (c.rating) it.r = c.rating;
        if (!c.img && c.el && c.el.isConnected) c.img = imgOf(c.el);
        if (c.img && !it.i) { it.i = c.img; catDirty = true; }
        if (c.name && c.name !== it.n) { it.n = c.name; catDirty = true; }
      }
    });
    if (fresh.length) {
      // la prima incarcare pastram ordinea site-ului; dupa aceea, serialele noi merg deasupra
      if (first) Array.prototype.push.apply(cat.items, fresh); else cat.items = fresh.concat(cat.items);
      catDirty = true;
      if (!first) catNewCount += fresh.length;
      if (catalogVisible()) {
        // NU redesenam lista (pozele s-ar reincarca si derularea ar sari); doar:
        if (first && !isActive() && !seenCount()) catList = cat.items;  // la final de lista apar singure cand derulezi
        else catNeedsRender = true;                     // serialele noi de deasupra: o data, la final
        updateCatalogCount();
      }
    }
    if (catDirty) {
      clearTimeout(catSaveTimer);
      if (forceSave) catSave(); else catSaveTimer = setTimeout(catSave, 8000);
    }
    return fresh.length;
  }

  var catEl = null, catGrid = null, catShown = 0, catList = [], catNewCount = 0, catHiddenByUser = false, catRenderTimer = null;
  var catNeedsRender = false, lastCatSig = '';
  function updateCatalogCount() {
    if (!catEl) return;
    catEl.querySelector('#rf-cat-count').textContent = showWatch
      ? catList.length + ' de v\u0103zut'
      : showSeen
      ? catList.length + ' v\u0103zute'
      : (catList.length === cat.items.length ? cat.items.length : catList.length + ' din ' + cat.items.length) + ' seriale';
  }
  function catalogVisible() { return !!catEl && catEl.style.display !== 'none'; }

  // cautarea din lista ta (separata de filtrul paginilor site-ului): cuvintele de aici + cele din Filtru
  var catQuery = '';
  function catalogFiltered() {
    var min = state.min === '' ? -1 : parseInt(state.min, 10);
    var max = state.max === '' ? 1e9 : parseInt(state.max, 10);
    var words = searchWords().concat(norm(catQuery).split(' ').filter(Boolean));
    var list = cat.items.filter(function (it) {
      // lista mare: fara serialele vazute; "Vazute": DOAR cele vazute; "De vazut": DOAR cele puse deoparte
      if (showWatch) { if (!inWatch(it.k) || isSeen(it.k)) return false; }
      else if (showSeen !== isSeen(it.k)) return false;
      if (!healthOk(it.k)) return false;
      var e = it.e || 0;
      if (e && (e < min || e > max)) return false;
      if (!e && state.min !== '') return false;
      if (state.plats.length && state.plats.indexOf(it.p) < 0) return false;
      if (words.length && !titleMatches(it.n || it.k.split('/')[1].replace(/^\d+-?/, ''), words)) return false;
      return true;
    });
    if (state.sort === 'ep-asc') list.sort(function (a, b) { return (a.e || 0) - (b.e || 0); });
    else if (state.sort === 'ep-desc') list.sort(function (a, b) { return (b.e || 0) - (a.e || 0); });
    else if (state.sort === 'rating') list.sort(function (a, b) { return (b.r || 0) - (a.r || 0); });
    return list;
  }

  function esc(t) { return String(t || '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function cardHtml(it, now) {
    var isNew = it.f && now - it.f < NEW_DAYS * 86400000;
    var sn = isSeen(it.k);
    return '<a class="rf-c' + (sn ? ' rf-was' : '') + '" href="' + esc(it.u) + '" data-k="' + esc(it.k) + '">' +
      '<div class="rf-ci">' + (it.i ? '<img loading="lazy" src="' + esc(it.i) + '" alt="">' : '<div class="rf-noimg">' + esc(it.n || '') + '</div>') +
      (isNew ? '<span class="rf-new">NOU</span>' : '') +
      (it.e ? '<span class="rf-ep">' + it.e + ' EP</span>' : '') +
      (it.r ? '<span class="rf-rt">★ ' + it.r + '</span>' : '') +
      (it.p ? '<span class="rf-pl">' + esc(it.p) + '</span>' : '') +
      (function () {
        var inc = incompleteOf(it.k);
        if (inc) return '<span class="rf-bad">\u26A0 incomplet' + (inc.total && inc.t ? ' ' + inc.t + '/' + inc.total : '') + '</span>';
        var h = healthOf(it.k);
        return h === 0 ? '<span class="rf-ok">\u2713 toate merg</span>' : h > 0 ? '<span class="rf-bad">\u26A0 ' + h + ' stricate</span>' : '';
      })() +
      '</div>' +
      '<div class="rf-cn">' + esc(it.n || it.k) + '</div>' +
      '<div class="rf-btns"><button class="rf-seen" type="button">' + (sn ? '\u21A9 Nev\u0103zut' : '\uD83D\uDC41 V\u0103zut') + '</button>' +
      '<button class="rf-watch' + (inWatch(it.k) ? ' on' : '') + '" type="button">' + (inWatch(it.k) ? '\uD83D\uDCCC \u00CEn list\u0103' : '\uD83D\uDCCC De v\u0103zut') + '</button></div></a>';
  }

  function renderMore() {
    if (catShown >= catList.length) return;
    var now = Date.now(), html = '';
    var end = Math.min(catList.length, catShown + 90);
    for (var i = catShown; i < end; i++) html += cardHtml(catList[i], now);
    catGrid.insertAdjacentHTML('beforeend', html);
    catShown = end;
  }

  function renderCatalog() {
    if (!catEl) return;
    catNeedsRender = false;
    lastCatSig = JSON.stringify(state);
    catList = isActive() || catQuery.trim() || seenCount() || showSeen || showWatch ? catalogFiltered() : cat.items;
    catShown = 0;
    catGrid.innerHTML = '';
    renderMore();
    updateCatalogCount();
    if (countEl) countEl.textContent = catList.length + ' din ' + cat.items.length + ' seriale (lista din memorie)';
  }
  function renderCatalogSoon() { clearTimeout(catRenderTimer); catRenderTimer = setTimeout(renderCatalog, 300); }

  function catalogStatus(text) {
    if (!catEl) return;
    var el = catEl.querySelector('#rf-cat-status');
    if (text) el.textContent = text;
    else el.textContent = catNewCount ? '✨ ' + catNewCount + ' noi' : '✓ la zi';
  }

  function showCatalog() {
    catLoad();
    if (!catEl) {
      var css = document.createElement('style');
      css.textContent =
        '#rf-cat{position:fixed;left:0;right:0;top:0;bottom:0;z-index:2147483600;background:#0b0f19;color:#e5e7eb;font:14px system-ui,sans-serif;display:flex;flex-direction:column}' +
        '#rf-cat-top{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #1f2937;background:#0b1220}' +
        '#rf-cat-top b{font-size:16px;color:#fff}#rf-cat-count{color:#94a3b8;font-size:12px}#rf-cat-status{margin-left:auto;font-size:12px;color:#5eead4}' +
        '#rf-cat-site{padding:7px 10px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e5e7eb;font:600 13px system-ui}' +
        '#rf-cat-q{margin:8px 12px;padding:10px;border-radius:10px;border:1px solid #334155;background:#111827;color:#fff;font-size:15px}' +
        '#rf-cat-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:0 8px 90px}' +
        '#rf-cat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:8px}' +
        '.rf-c{display:block;color:#e5e7eb;text-decoration:none}' +
        '.rf-ci{position:relative;aspect-ratio:3/4;border-radius:10px;overflow:hidden;background:#1f2937}' +
        '.rf-ci img{width:100%;height:100%;object-fit:cover;display:block}' +
        '.rf-ci span{position:absolute;font:600 10px system-ui;padding:2px 6px;border-radius:6px;background:#000a;color:#fff}' +
        '.rf-new{top:4px;left:4px;background:#e11d48!important}.rf-ep{top:4px;right:4px}.rf-rt{bottom:4px;right:4px}.rf-pl{bottom:4px;left:4px;color:#5eead4!important}' +
        '.rf-cn{font-size:12px;line-height:1.3;margin:4px 2px 4px;max-height:3.9em;overflow:hidden}' +
        '.rf-seen{display:block;width:100%;margin:0 0 8px;padding:5px 0;border-radius:8px;border:1px solid #334155;background:#111827;color:#cbd5e1;font:600 11px system-ui}' +
        '.rf-c.rf-was{opacity:.45}' +
        '.rf-ci .rf-ok{top:24px;left:4px;background:#15803d!important}.rf-ci .rf-bad{top:24px;left:4px;background:#b91c1c!important}' +
        '#rf-cat-bar{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px}' +
        '#rf-cat-bar button{flex:1 1 30%!important}' +
        '.rf-btns{display:flex;gap:4px;margin:0 0 8px}.rf-btns .rf-seen{margin:0;flex:1}' +
        '.rf-watch{flex:1;padding:5px 0;border-radius:8px;border:1px solid #334155;background:#111827;color:#cbd5e1;font:600 11px system-ui}' +
        '.rf-watch.on{background:#1e3a8a;border-color:#60a5fa;color:#fff}' +
        '#rf-cat-bar button{flex:1;padding:8px 4px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e5e7eb;font:600 12px system-ui}' +
        '#rf-cat-bar button.on{background:#0f766e;border-color:#5eead4;color:#fff}' +

        '#rf-cat-open{position:fixed;right:16px;bottom:150px;z-index:2147483646;padding:9px 14px;border-radius:20px;border:1px solid #2dd4bf;' +
        'background:#0b1220ee;color:#e6fffb;font:600 14px system-ui;display:none}' +
        'html[data-rf-cinema] #rf-cat,html[data-rf-cinema] #rf-cat-open{display:none!important}' +
        // in spatele listei, pagina site-ului nu-si mai afiseaza (si nu mai descarca) pozele
        '.rf-noimg{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:8px;' +
        'font:600 12px/1.3 system-ui;color:#e5e7eb;background:linear-gradient(160deg,#1e3a5f,#4c1d95)}' +
        '';
      document.head.appendChild(css);
      catEl = document.createElement('div');
      catEl.id = 'rf-cat';
      catEl.innerHTML = '<div id="rf-cat-top"><div><b>📚 Toate serialele</b><br><span id="rf-cat-count"></span></div>' +
        '<span id="rf-cat-status"></span><button id="rf-cat-site">🌐 Site</button></div>' +
        '<div id="rf-cat-bar"><button id="rf-cat-new">\uD83D\uDD04 Caut\u0103 noi</button><button id="rf-cat-all">\u2B07\uFE0F \u00CEncarc\u0103 tot</button>' +
        '<button id="rf-cat-seen"></button><button id="rf-cat-watch"></button><button id="rf-cat-backup">\uD83D\uDCBE Backup</button></div>' +
        '<input id="rf-cat-q" type="search" placeholder="Caută după titlu…">' +
        '<div id="rf-cat-scroll"><div id="rf-cat-grid"></div></div>';
      document.body.appendChild(catEl);
      catGrid = catEl.querySelector('#rf-cat-grid');
      var sc = catEl.querySelector('#rf-cat-scroll');
      sc.addEventListener('scroll', function () {
        if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 1200) renderMore();
      }, { passive: true });
      var q = catEl.querySelector('#rf-cat-q');
      // rezultatele apar pe loc, in timp ce scrii (doar in lista ta; paginile site-ului nu sunt afectate)
      q.addEventListener('input', function () {
        catQuery = q.value;
        clearTimeout(catRenderTimer);
        catRenderTimer = setTimeout(function () { renderCatalog(); catEl.querySelector('#rf-cat-scroll').scrollTop = 0; }, 120);
      });
      catEl.querySelector('#rf-cat-site').addEventListener('click', function () { hideCatalog(true); });
      // incarcare doar la cererea ta: serialele noi / toata lista; acelasi buton opreste
      catEl.querySelector('#rf-cat-new').addEventListener('click', function () { loadAll(loading ? null : 'new'); });
      catEl.querySelector('#rf-cat-all').addEventListener('click', function () { loadAll(loading ? null : 'full'); });
      catEl.querySelector('#rf-cat-watch').addEventListener('click', function () {
        showWatch = !showWatch; showSeen = false; renderCatalog(); updateSeenButton(); updateCatalogCount();
        catEl.querySelector('#rf-cat-scroll').scrollTop = 0;
      });
      catEl.querySelector('#rf-cat-seen').addEventListener('click', function () {
        showSeen = !showSeen; showWatch = false; renderCatalog(); updateSeenButton(); updateCatalogCount();
        catEl.querySelector('#rf-cat-scroll').scrollTop = 0;
      });
      catEl.querySelector('#rf-cat-backup').addEventListener('click', showBackup);
      catGrid.addEventListener('click', function (e) {
        var a = e.target.closest('a.rf-c');
        if (!a) return;
        e.preventDefault();
        if (e.target.closest('.rf-seen')) {
          var nowSeen = toggleSeen(a.dataset.k);
          if (showWatch ? nowSeen : nowSeen !== showSeen) {
            // nu mai apartine listei afisate (vazut in lista mare / nevazut in lista de vazute)
            // il scoatem din lista fara sa redesenam tot (derularea ramane pe loc)
            if (catList === cat.items) catList = catalogFiltered();
            else { var idx = catList.indexOf(catMap[a.dataset.k]); if (idx >= 0) catList.splice(idx, 1); }
            catShown = Math.max(0, catShown - 1);
            a.remove();
          } else {
            a.classList.toggle('rf-was', nowSeen);
            a.querySelector('.rf-seen').textContent = nowSeen ? '\u21A9 Nev\u0103zut' : '\uD83D\uDC41 V\u0103zut';
          }
          updateSeenButton(); updateCatalogCount();
          return;
        }
        if (e.target.closest('.rf-watch')) {
          var nowIn = toggleWatch(a.dataset.k);
          if (showWatch && !nowIn) {
            var ix = catList.indexOf(catMap[a.dataset.k]); if (ix >= 0) catList.splice(ix, 1);
            catShown = Math.max(0, catShown - 1);
            a.remove();
          } else {
            var wb = a.querySelector('.rf-watch');
            wb.classList.toggle('on', nowIn);
            wb.textContent = nowIn ? '\uD83D\uDCCC \u00CEn list\u0103' : '\uD83D\uDCCC De v\u0103zut';
          }
          updateSeenButton(); updateCatalogCount();
          return;
        }
        if (window.RFBridge) window.RFBridge.postMessage('open:' + a.href); else location.href = a.href;
      });
      var openBtn = document.createElement('button');
      openBtn.id = 'rf-cat-open';
      openBtn.textContent = '📚 Lista mea';
      openBtn.addEventListener('click', function () { catHiddenByUser = false; showCatalog(); });
      document.body.appendChild(openBtn);
    }
    catEl.querySelector('#rf-cat-q').value = catQuery;
    updateSeenButton();
    loadButtons(loading, cards.length);
    catEl.style.display = 'flex';
    document.documentElement.setAttribute('data-rf-catalog', '');
    fitAboveSiteMenu();
    document.getElementById('rf-cat-open').style.display = 'none';
    renderCatalog();
    catalogStatus(loading ? '🔄 caut seriale noi…' : null);
  }

  // lasam vizibila bara de meniu de jos a site-ului (Home, Search, Explore...)
  function siteBottomBar() {
    var stack = document.elementsFromPoint ? document.elementsFromPoint(innerWidth / 2, innerHeight - 4) : [];
    for (var i = 0; i < stack.length; i++) {
      for (var p = stack[i]; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
        if (p.id && p.id.indexOf('rf-') === 0) break;
        var cs = getComputedStyle(p);
        if (cs.position === 'fixed' || cs.position === 'sticky') {
          var r = p.getBoundingClientRect();
          if (r.height > 30 && r.height < 160 && r.width > innerWidth * 0.6 && r.bottom >= innerHeight - 2) return r.height;
          break;
        }
      }
    }
    return 0;
  }
  function fitAboveSiteMenu() {
    if (!catEl) return;
    var prev = catEl.style.display;
    catEl.style.display = 'none';           // ca sa "vedem" ce e sub lista
    var h = siteBottomBar();
    catEl.style.display = prev;
    catEl.style.bottom = h ? Math.ceil(h) + 'px' : '0';
    var ob = document.getElementById('rf-cat-open');
    if (btn) btn.style.bottom = (h ? Math.ceil(h) + 12 : 96) + 'px';
    if (ob) ob.style.bottom = (h ? Math.ceil(h) + 66 : 150) + 'px';
  }
  setInterval(function () { if (catalogVisible()) fitAboveSiteMenu(); }, 4000);

  // --- Backup: lista, serialele vazute, verificarile si setarile intr-un fisier (si inapoi) ---
  var BACKUP_KEYS = ['rfCatalog.v1', 'rfSeen.v1', 'rfWatch.v1', 'rfEpStatus.v1', 'rfAutoNext'];
  function backupData() {
    saveNow();
    var d = { app: 'ReelFren', v: 1, at: new Date().toISOString(), data: {} };
    BACKUP_KEYS.forEach(function (k) { try { var v = localStorage.getItem(k); if (v !== null) d.data[k] = v; } catch (e) {} });
    return JSON.stringify(d);
  }
  function restoreData(text) {
    var d = JSON.parse(text);
    if (!d || d.app !== 'ReelFren' || !d.data) throw new Error('nu e un backup ReelFren');
    BACKUP_KEYS.forEach(function (k) { if (typeof d.data[k] === 'string') localStorage.setItem(k, d.data[k]); });
    cat = null; catMap = null; seen = null; watch = null; epStatus = null;
    catLoad();
    return cat.items.length;
  }
  function showBackup() {
    var box = document.getElementById('rf-backup');
    if (!box) {
      box = document.createElement('div');
      box.id = 'rf-backup';
      box.style.cssText = 'position:fixed;left:12px;right:12px;top:90px;z-index:2147483647;background:#0b1220;color:#e5e7eb;border:1px solid #2dd4bf;' +
        'border-radius:14px;padding:16px;font:14px system-ui,sans-serif;box-shadow:0 10px 30px #000c';
      box.innerHTML = '<b style="font-size:16px">\uD83D\uDCBE Backup</b>' +
        '<div style="margin:6px 0 12px;color:#94a3b8;font-size:13px">Lista de seriale, serialele v\u0103zute, verific\u0103rile \u0219i set\u0103rile, \u00EEntr-un fi\u0219ier. ' +
        'Dup\u0103 o reinstalare le aduci \u00EEnapoi cu \u201E\u00CEncarc\u0103 backup\u201D.</div>' +
        '<button id="rf-bk-save" style="width:100%;padding:12px;border-radius:10px;border:0;background:#14b8a6;color:#04201d;font:600 15px system-ui;margin-bottom:8px">\u2B07\uFE0F Salveaz\u0103 backup (fi\u0219ier)</button>' +
        '<button id="rf-bk-load" style="width:100%;padding:12px;border-radius:10px;border:1px solid #334155;background:#111827;color:#e5e7eb;font:600 15px system-ui;margin-bottom:8px">\u2B06\uFE0F \u00CEncarc\u0103 backup</button>' +
        '<input id="rf-bk-file" type="file" accept=".json,application/json,text/plain" style="display:none">' +
        '<div id="rf-bk-msg" style="min-height:18px;color:#5eead4;font-size:13px"></div>' +
        '<button id="rf-bk-close" style="width:100%;padding:10px;border-radius:10px;border:0;background:#1f2937;color:#e5e7eb;font:600 14px system-ui;margin-top:6px">\u00CEnchide</button>';
      document.body.appendChild(box);
      var msg = box.querySelector('#rf-bk-msg');
      box.querySelector('#rf-bk-close').addEventListener('click', function () { box.style.display = 'none'; });
      box.querySelector('#rf-bk-save').addEventListener('click', function () {
        var data = backupData();
        if (window.RFBridge && /Android/i.test(navigator.userAgent)) {
          window.RFBridge.postMessage('backup:save:' + data); // aplicatia te intreaba unde sa salveze fisierul
          msg.textContent = 'Se salveaz\u0103 \u00EEn Desc\u0103rc\u0103ri (' + Math.round(data.length / 1024) + ' KB)\u2026 ' +
            'La \u00EEnc\u0103rcare alege fi\u0219ierul ReelFren-backup-\u2026json din Desc\u0103rc\u0103ri.';
        } else {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
          a.download = 'ReelFren-backup-' + new Date().toISOString().slice(0, 10) + '.json';
          document.body.appendChild(a); a.click(); a.remove();
          msg.textContent = 'Backup salvat (' + Math.round(data.length / 1024) + ' KB).';
        }
      });
      var file = box.querySelector('#rf-bk-file');
      box.querySelector('#rf-bk-load').addEventListener('click', function () { file.value = ''; file.click(); });
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        if (!f) return;
        var r = new FileReader();
        r.onload = function () {
          try {
            var n = restoreData(String(r.result));
            msg.textContent = '\u2713 Backup \u00EEnc\u0103rcat: ' + n + ' seriale.';
            if (catEl) { renderCatalog(); updateSeenButton(); catalogStatus(null); }
            updateCatalogVisibility();
          } catch (e) { msg.textContent = 'Fi\u0219ierul nu e un backup ReelFren valid.'; }
        };
        r.readAsText(f);
      });
    }
    box.querySelector('#rf-bk-msg').textContent = '';
    box.style.display = 'block';
  }
  window.__rfBackupData = backupData; window.__rfRestoreData = restoreData; // pentru teste

  function updateSeenButton() {
    if (!catEl) return;
    var b = catEl.querySelector('#rf-cat-seen');
    var n = seenCount();
    b.textContent = showSeen ? '\u2190 Toate serialele' : '\uD83D\uDC41 V\u0103zute (' + n + ')';
    b.classList.toggle('on', showSeen);
    var w = catEl.querySelector('#rf-cat-watch');
    w.textContent = showWatch ? '\u2190 Toate serialele' : '\uD83D\uDCCC De v\u0103zut (' + watchCount() + ')';
    w.classList.toggle('on', showWatch);
    var title = catEl.querySelector('#rf-cat-top b');
    if (title) title.textContent = showSeen ? '\uD83D\uDC41 Seriale v\u0103zute' : showWatch ? '\uD83D\uDCCC De v\u0103zut' : '\uD83D\uDCDA Toate serialele';
  }

  // butoanele de incarcare: pe lista ta (sus) si pe paginile site-ului (langa Filtru)
  function loadButtons(isLoading, n) {
    var stop = '\u23F9 Opre\u0219te' + (n ? ' (' + n + ')' : '');
    if (catEl) {
      var bn = catEl.querySelector('#rf-cat-new'), ba = catEl.querySelector('#rf-cat-all');
      bn.textContent = isLoading ? stop : '\uD83D\uDD04 Caut\u0103 noi';
      ba.textContent = isLoading ? stop : '\u2B07\uFE0F \u00CEncarc\u0103 tot';
      bn.classList.toggle('on', !!isLoading); ba.classList.toggle('on', !!isLoading);
    }
    var fab = document.getElementById('rf-load-fab');
    if (fab) fab.textContent = isLoading ? stop : '\u2B07\uFE0F \u00CEncarc\u0103 toate';
  }

  function hideCatalog(byUser) {
    if (!catEl) return;
    catHiddenByUser = !!byUser;
    catEl.style.display = 'none';
    document.documentElement.removeAttribute('data-rf-catalog');
    var ob = document.getElementById('rf-cat-open');
    if (ob) ob.style.display = isHomeList() && catalogReady() ? 'block' : 'none';
  }

  function isSearchPage() { return /^\/search/.test(location.pathname); }
  var searchPathShown = null;
  function updateCatalogVisibility() {
    var onSearch = isSearchPage();
    if ((isHomeList() || onSearch) && catalogReady() && !catHiddenByUser) {
      if (!catalogVisible()) showCatalog();
      // butonul de cautare al site-ului: deschidem lista ta cu cursorul in casuta de cautare (rezultate instant)
      if (onSearch && searchPathShown !== location.href) {
        searchPathShown = location.href;
        var u = new URLSearchParams(location.search), qv = u.get('q') || u.get('keyword') || u.get('query') || u.get('s') || '';
        var box = catEl.querySelector('#rf-cat-q');
        if (qv) { box.value = qv; catQuery = qv; renderCatalog(); }
        setTimeout(function () { try { box.focus(); } catch (e) {} }, 50);
      }
    }
    else if (catalogVisible() && !isHomeList() && !onSearch) hideCatalog(false);
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
      // butonul "Incarca toate" (deasupra lui Filtru); stilul e aici ca sa existe si fara lista din memorie
      '#rf-load-fab{position:fixed;right:16px;bottom:150px;z-index:2147483646;padding:10px 16px;border-radius:22px;border:1px solid #2dd4bf;' +
      'background:#0f766e;color:#fff;font:600 15px system-ui,sans-serif;box-shadow:0 4px 16px #0008;display:none}' +
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

    var fab = document.createElement('button');
    fab.id = 'rf-load-fab';
    fab.textContent = '\u2B07\uFE0F \u00CEncarc\u0103 toate';
    tap(fab, function () { loadAll(loading ? null : 'full'); });
    document.body.appendChild(fab);

    btn = document.createElement('button');
    btn.id = 'rf-btn';
    btn.textContent = '⚙️ Filtru';
    tap(btn, function () {
      panel.style.display = 'block'; syncInputs(); renderPlatforms(); // incarcarea se opreste din panou
    });
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
      '<div class="rf-l">Episoade func\u021bionale</div><div class="rf-row">' +
      '<button class="rf-chip" data-health="all">Toate</button><button class="rf-chip" data-health="nobroken">F\u0103r\u0103 stricate/incomplete</button>' +
      '<button class="rf-chip" data-health="verified">Doar verificate complete</button></div>' +
      '<div style="font-size:12px;color:#94a3b8;margin-top:6px">Se \u0219tie doar pentru serialele verificate cu \uD83D\uDD0D Verific\u0103 episoadele (pe pagina serialului).</div>' +
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
      if (t.dataset.health) state.health = t.dataset.health;
      else if (t.dataset.sort) state.sort = t.dataset.sort;
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
      else if (t.id === 'rf-reset') state = { sort: 'default', min: '', max: '', plats: [], q: '', health: 'all' };
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
    panel.querySelectorAll('[data-health]').forEach(function (b) { b.classList.toggle('sel', b.dataset.health === (state.health || 'all')); });
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
