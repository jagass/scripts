/*
 * DramaFren: strange filmele de pe orice site (pagina + raspunsurile JSON ale site-ului),
 * descopera alte site-uri din meniuri si, in modul "robot" (window.__dfCrawl), deruleaza
 * singur pagina si trece prin paginile urmatoare. Totul se trimite aplicatiei (RFBridge).
 */
(function () {
  if (window.__dfAgg || window.top !== window) return;
  window.__dfAgg = 1;
  var HOST = location.hostname.toLowerCase();
  if (HOST === 'appassets.androidplatform.net') return;

  function send(msg) { try { if (window.RFBridge) window.RFBridge.postMessage(msg); } catch (e) { } }

  // ---------- utilitare ----------
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return ''; } }
  function normImg(u) {
    try {
      var x = new URL(u, location.href);
      var p = x.pathname.replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, '');
      return (x.hostname + p).toLowerCase();
    } catch (e) { return String(u || '').toLowerCase(); }
  }
  function goodImgUrl(s) {
    if (typeof s !== 'string' || s.length < 8 || s.length > 2000) return false;
    if (/^data:|\.svg(\?|$)|\.gif(\?|$)/i.test(s)) return false;
    return /^(https?:)?\/\//i.test(s) || /^\/[^\/]/.test(s);
  }
  function clean(t) { return String(t || '').replace(/\s+/g, ' ').trim().slice(0, 200); }
  var EP_RE = /(\d{1,4})\s*(?:EPs?\b|Episodes?|Episódios?|Episodios?|Episoden|集|話|Tập|Bölüm|Ep\.)/i;
  var EP_RE2 = /(?:Total|All|全)\s*[:：]?\s*(\d{1,4})|(?:EP|Ep|Episode)\s*[\.:]?\s*(?:1\s*[-~\/]\s*)?(\d{1,4})\s*(?:\/|of)?/;
  function epsFromText(t) {
    if (!t) return 0;
    var m = t.match(EP_RE);
    if (m) return +m[1];
    m = t.match(EP_RE2);
    if (m) return +(m[1] || m[2]) || 0;
    return 0;
  }

  // ---------- 1. date din raspunsurile JSON ale site-ului ----------
  var jsonItems = {};       // normImg -> {img,title,eps}
  var jsonCount = 0, jsonKeys = null, apiUrls = [];
  var IMG_KEY = /cover|poster|thumb|image|img|pic|photo|vertical/i;
  var BAD_IMG_KEY = /banner|avatar|icon|logo|background|bg_?|horizontal/i;
  var TITLE_KEY = /^(title|name|bookname|book_name|dramaname|drama_name|shortplayname|short_play_name|seriesname|series_name|videoname|video_name|playletname|playlet_name|showname|filmname|movie_name|moviename)$/i;
  var EPS_KEY = /^(episodes?_?(count|num|total|cnt)|(total|all)_?(episodes?|chapters?|eps)(_?(count|num))?|chapter_?(count|num|total|cnt)|eps(_?count)?|episodecount|chaptercount|episodenum|chapternum|totalepisode|totalchapter|ep_?count|ep_?total|series_?count|video_?count|count_?episodes?|lastepisode|last_episode|max_?episode|updateepisode|update_episode)$/i;

  function pickImg(o) {
    var best = '', bestScore = -1;
    for (var k in o) {
      var v = o[k];
      if (!IMG_KEY.test(k)) continue;
      var s = '';
      if (typeof v === 'string') s = v;
      else if (Array.isArray(v) && v.length) s = typeof v[0] === 'string' ? v[0] : (v[0] && (v[0].url || v[0].src)) || '';
      else if (v && typeof v === 'object') s = v.url || v.src || v.cover || '';
      if (!goodImgUrl(s)) continue;
      var score = BAD_IMG_KEY.test(k) ? 0 : (/cover|poster|vertical/i.test(k) ? 3 : 2);
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return best;
  }
  function pickTitle(o) {
    for (var k in o) if (TITLE_KEY.test(k) && typeof o[k] === 'string' && o[k].trim()) return clean(o[k]);
    for (var k2 in o) if (/title|name/i.test(k2) && !/author|actor|tag|genre|categ|user|nick|file|type|lang|channel|platform/i.test(k2)
      && typeof o[k2] === 'string' && o[k2].trim().length > 1) return clean(o[k2]);
    return '';
  }
  function pickEps(o) {
    var best = 0;
    for (var k in o) {
      var v = o[k];
      if (EPS_KEY.test(k)) {
        var n = typeof v === 'number' ? v : parseInt(v, 10);
        if (n > best && n < 5000) best = n;
      } else if (/^(episodes|chapters|episode_list|episodelist|chapterlist|chapter_list|videos)$/i.test(k) && Array.isArray(v) && v.length > best) {
        best = v.length;
      } else if (typeof v === 'string' && /episode|集|eps/i.test(v) && v.length < 40) {
        var e = epsFromText(v);
        if (e > best) best = e;
      }
    }
    return best;
  }
  // etichetele filmului (gen, categorie, limba, tara...): pentru filtrele AI / fara asiatice / fara anime
  var TAG_KEY = /genre|tag|categor|label|type|class|theme|style|lang|region|country|area|origin|kind|badge|corner|mark|subtitle|dub/i;
  function addTag(list, v) {
    if (typeof v === 'number') return;
    v = clean(v);
    if (v.length < 2 || v.length > 30 || /^https?:|^\d+$/.test(v)) return;
    v = v.toLowerCase();
    if (list.indexOf(v) < 0 && list.length < 15) list.push(v);
  }
  function pickTags(o) {
    var tags = [];
    for (var k in o) {
      if (!TAG_KEY.test(k)) continue;
      var v = o[k];
      if (typeof v === 'string') v.split(/[,|\/;]/).forEach(function (x) { addTag(tags, x); });
      else if (Array.isArray(v)) v.slice(0, 15).forEach(function (x) {
        if (typeof x === 'string') addTag(tags, x);
        else if (x && typeof x === 'object') addTag(tags, x.title || x.name || x.tagName || x.tag_name || x.genreName || x.label || x.value || x.text || '');
      });
      else if (v && typeof v === 'object') addTag(tags, v.title || v.name || v.label || v.value || '');
    }
    return tags;
  }
  function mergeTags(a, b) { (b || []).forEach(function (t) { if (a.indexOf(t) < 0 && a.length < 15) a.push(t); }); return a; }
  var tagStats = {};

  function scan(obj, depth) {
    if (!obj || depth > 9) return 0;
    var found = 0;
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length && i < 2000; i++) found += scan(obj[i], depth + 1);
      return found;
    }
    if (typeof obj !== 'object') return 0;
    var img = pickImg(obj), title = img ? pickTitle(obj) : '';
    if (img && title) {
      var key = normImg(img), eps = pickEps(obj), tags = pickTags(obj);
      tags.forEach(function (t) { tagStats[t] = (tagStats[t] || 0) + 1; });
      var prev = jsonItems[key];
      if (!prev) { jsonItems[key] = { img: abs(img), title: title, eps: eps, tags: tags }; jsonCount++; found++; }
      else { if (eps > prev.eps) prev.eps = eps; mergeTags(prev.tags, tags); }
      if (!jsonKeys) jsonKeys = Object.keys(obj).slice(0, 40);
    }
    for (var k in obj) {
      var v = obj[k];
      if (v && typeof v === 'object') found += scan(v, depth + 1);
    }
    return found;
  }
  var pageApis = {}; // url -> true (raspunsuri cu liste de filme si parametru de pagina)
  function onJson(url, text) {
    if (!text || text.length < 20) return;
    var c = text.charAt(0);
    if (c !== '{' && c !== '[') return;
    var data;
    try { data = JSON.parse(text); } catch (e) { return; }
    var n = scan(data, 0);
    if (n > 0) {
      if (apiUrls.length < 8 && apiUrls.indexOf(url) < 0) apiUrls.push(url);
      if (n >= 4 && /[?&](page|pageNo|page_no|pageNum|page_num|p|pg|offset|start|current)=\d+/i.test(url)) pageApis[url] = true;
      dirty = true;
    }
  }
  try {
    var ofetch = window.fetch;
    if (ofetch) {
      window.fetch = function (input, init) {
        var p = ofetch.apply(this, arguments);
        try {
          var url = abs(typeof input === 'string' ? input : (input && input.url) || '');
          p.then(function (r) {
            try {
              var ct = (r.headers.get('content-type') || '');
              if (/json|text\/plain|javascript/i.test(ct) || ct === '') r.clone().text().then(function (t) { onJson(url, t); }).catch(function () { });
            } catch (e) { }
          }).catch(function () { });
        } catch (e) { }
        return p;
      };
    }
    var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__dfUrl = abs(u); return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      var x = this;
      x.addEventListener('load', function () {
        try {
          if (x.responseType === '' || x.responseType === 'text') onJson(x.__dfUrl, x.responseText);
          else if (x.responseType === 'json' && x.response) onJson(x.__dfUrl, JSON.stringify(x.response));
        } catch (e) { }
      });
      return XS.apply(this, arguments);
    };
  } catch (e) { }

  // ---------- 2. filmele din pagina (postere) ----------
  function imgSrc(im) {
    var s = im.getAttribute('data-src') || im.getAttribute('data-original') || im.getAttribute('data-lazy-src')
      || im.getAttribute('data-lazy') || im.currentSrc || im.src || '';
    if (!goodImgUrl(s) && im.srcset) s = im.srcset.split(',')[0].trim().split(' ')[0];
    if (!goodImgUrl(s)) return '';
    s = abs(s);
    try { if (new URL(s).pathname.length < 5) return ''; } catch (e) { return ''; } // nu e o imagine (ex. adresa site-ului)
    return s;
  }
  function cardOf(im) {
    var el = im, best = null;
    for (var i = 0; i < 7 && el && el !== document.body; i++, el = el.parentElement) {
      if (el.tagName === 'A' && el.getAttribute('href')) return el;
      if (el.getAttribute && el.getAttribute('onclick')) return el;
      if (!best && el.querySelectorAll && el.querySelectorAll('img').length === 1 && el.textContent.trim().length > 2 && i >= 1) best = el;
    }
    // cardul poate avea linkul in alta parte (titlul)
    if (best) {
      var a = best.querySelector('a[href]');
      if (a) return a.closest('a');
      var up = best.parentElement;
      if (up && up.querySelectorAll('img').length === 1) { a = up.querySelector('a[href]'); if (a) return a; }
    }
    return best;
  }
  function titleOf(card, im) {
    var h = card.querySelector('h1,h2,h3,h4,h5,[class*=title],[class*=name]');
    var t = h && clean(h.textContent);
    if (!t && card.getAttribute('title')) t = clean(card.getAttribute('title'));
    if (!t) t = clean(im.alt || im.title);
    if (!t) {
      var lines = (card.innerText || '').split('\n').map(clean).filter(function (x) { return x.length > 2 && !/^\d+$/.test(x) && !EP_RE.test(x); });
      lines.sort(function (a, b) { return b.length - a.length; });
      t = lines[0] || '';
    }
    return t;
  }
  var domItems = {}; // key -> item
  function harvestDom() {
    var imgs = document.images, added = 0;
    for (var i = 0; i < imgs.length; i++) {
      var im = imgs[i];
      if (im.__dfSeen === 2) continue;
      var src = imgSrc(im);
      if (!src) continue;
      // marimea reala (daca s-a incarcat) sau cea din pagina; posterele sunt verticale
      var w = im.naturalWidth, h = im.naturalHeight;
      if (!w || !h) { w = im.offsetWidth; h = im.offsetHeight; if (w < 40 || h < 40) w = h = 0; }
      if (w && h && (w < 60 || h < w * 1.05)) { if (im.naturalWidth) im.__dfSeen = 2; continue; } // nu e poster (iconita, banner lat)
      if (/logo|icon|avatar|flag|banner|sprite|placeholder|loading/i.test(src)) { im.__dfSeen = 2; continue; }
      var card = cardOf(im);
      if (!card) continue;
      if (card.closest('header,nav') || (!w && card.closest(NAV))) continue; // marime necunoscuta (imaginile oprite la robot) intr-un meniu: nu e film
      var key = normImg(src);
      var href = card.tagName === 'A' ? abs(card.getAttribute('href')) : '';
      if (href && (/^javascript:/i.test(href) || href.split('#')[0] === location.href.split('#')[0])) href = '';
      var oc = !href && card.getAttribute('onclick') ? card.getAttribute('onclick').slice(0, 300) : '';
      var title = titleOf(card, im);
      var eps = epsFromText(card.innerText || '');
      // etichetele scurte de pe card (ex. "AI", "Anime", "Dubbed"), fara titlu si episoade
      var tags = [];
      (card.innerText || '').split('\n').forEach(function (line) {
        line = clean(line);
        if (line && line !== title && line.length <= 20 && !EP_RE.test(line) && !/^\d+(\.\d+)?[km]?$/i.test(line)) addTag(tags, line);
      });
      var tg = card.querySelectorAll('[class*=tag],[class*=badge],[class*=label],[class*=genre],[class*=corner]');
      for (var q = 0; q < tg.length && q < 8; q++) addTag(tags, tg[q].textContent);
      var j = jsonItems[key];
      if (j) { if (!title || title.length < 3) title = j.title; if (j.eps > eps) eps = j.eps; mergeTags(tags, j.tags); }
      tags.forEach(function (t) { tagStats[t] = (tagStats[t] || 0) + 1; });
      if (!title) continue;
      var it = domItems[key];
      if (!it) { domItems[key] = it = { key: key, img: src, title: title, eps: eps, href: href, oc: oc, tags: tags }; added++; dirty = true; }
      else if (eps > it.eps || (!it.href && href)) { it.eps = Math.max(eps, it.eps); it.href = it.href || href; dirty = true; }
      im.__dfSeen = 2;
    }
    return added;
  }

  // ---------- 3. alte site-uri (meniuri) si paginile urmatoare ----------
  var SOCIAL = /(^|\.)(facebook|fb|twitter|x|t|telegram|whatsapp|wa|pinterest|instagram|youtube|youtu|tiktok|discord|google|gstatic|apple|play\.google|reddit|linkedin|tumblr|vk|ok|weibo|line|gmpg|wordpress|wp|gravatar|cloudflare|jsdelivr|bit|tinyurl|linktr|patreon|paypal|ko-fi|buymeacoffee|dmca|creativecommons|apps\.apple|microsoft|bing|yandex|baidu)\.[a-z.]+$/i;
  var NAV = 'header,nav,aside,footer,[class*=menu],[class*=Menu],[class*=nav],[id*=menu],[id*=nav],[class*=drawer],[class*=sidebar],[class*=side-bar],[role=navigation]';
  function baseDomain(h) { var p = h.split('.'); return p.slice(-2).join('.'); }
  var sites = {}, pages = {};
  var PAGE_RE = /\/page\/\d+\/?$|[?&](page|pg|p|paged|pageNo|page_no)=\d+/i;
  function harvestLinks() {
    var as = document.querySelectorAll('a[href]');
    for (var i = 0; i < as.length; i++) {
      var a = as[i], u;
      try { u = new URL(a.getAttribute('href'), location.href); } catch (e) { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      var h = u.hostname.toLowerCase();
      if (h !== HOST) {
        if (SOCIAL.test(h)) continue;
        var inNav = !!a.closest(NAV);
        if (inNav || baseDomain(h) === baseDomain(HOST)) {
          if (!sites[h]) { sites[h] = { url: u.origin + u.pathname + u.search, host: h, label: clean(a.textContent).slice(0, 40) }; dirty = true; }
        }
      } else if (PAGE_RE.test(u.pathname + u.search) || (a.closest(NAV) && u.pathname.length > 1 && !a.querySelector('img'))) {
        var pu = u.origin + u.pathname + u.search;
        if (!pages[pu]) { pages[pu] = 1; dirty = true; }
      }
    }
  }

  // ---------- 4. trimiterea catre aplicatie ----------
  var dirty = false, sentKeys = {}, sentSites = {}, sentPages = {}, done = false;
  function report(final) {
    harvestDom(); harvestLinks();
    var items = [];
    for (var k in domItems) {
      var it = domItems[k];
      if (jsonItems[k]) mergeTags(it.tags, jsonItems[k].tags);
      var sig = it.eps + '|' + (it.href ? 1 : 0) + '|' + it.title.length + '|' + it.tags.length;
      if (sentKeys[k] === sig) continue;
      sentKeys[k] = sig;
      items.push(it);
    }
    // filme gasite doar in JSON (ex. paginile urmatoare citite de robot): se deschid cautandu-le pe site
    for (var j in jsonItems) {
      if (domItems[j]) continue;
      var ji = jsonItems[j], s2 = ji.eps + '|j|' + ji.tags.length;
      if (sentKeys[j] === s2) continue;
      sentKeys[j] = s2;
      items.push({ key: j, img: ji.img, title: ji.title, eps: ji.eps, href: '', oc: '', tags: ji.tags });
    }
    var st = [], pg = [];
    for (var h in sites) if (!sentSites[h]) { sentSites[h] = 1; st.push(sites[h]); }
    for (var p in pages) if (!sentPages[p]) { sentPages[p] = 1; pg.push(p); }
    if (!items.length && !st.length && !pg.length && !final) return;
    var msg = { url: location.href, host: HOST, title: document.title, items: items, sites: st, pages: pg, done: !!final };
    if (final || !window.__dfDiagSent) {
      window.__dfDiagSent = 1;
      msg.diag = {
        cf: /just a moment|attention required|un moment/i.test(document.title),
        domCards: Object.keys(domItems).length, jsonItems: jsonCount, jsonKeys: jsonKeys,
        tags: Object.keys(tagStats).sort(function (a, b) { return tagStats[b] - tagStats[a]; }).slice(0, 40)
          .map(function (t) { return t + ':' + tagStats[t]; }),
        apis: apiUrls, images: document.images.length, links: document.links.length
      };
    }
    send('hub:report:' + JSON.stringify(msg));
  }

  // ---------- 5. robotul: deruleaza, apasa "mai mult", citeste paginile API urmatoare ----------
  var crawlStarted = false;
  function crawl() {
    crawlStarted = true;
    var rounds = 0, still = 0, lastCount = -1, apiDone = {}, replaying = 0;
    var MORE = /^(load more|show more|more|view more|see more|mai mult|xem thêm|lihat lebih|muat lebih|ver más|cargar más|mais|carregar mais|더보기|もっと見る|加载更多|查看更多|next|›|»)$/i;
    function step() {
      if (done) return;
      if (/just a moment|attention required/i.test(document.title)) { // verificarea Cloudflare: asteptam
        if (++rounds > 20) { done = true; report(true); return; }
        return setTimeout(step, 1000);
      }
      rounds++;
      window.scrollTo(0, document.documentElement.scrollHeight);
      var bs = document.querySelectorAll('button,a,[role=button],div[class*=more],span[class*=more]');
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i], t = clean(b.textContent);
        if (t.length < 20 && MORE.test(t) && b.offsetParent) {
          if (b.tagName === 'A') { var hh = b.getAttribute('href') || ''; if (hh && hh.charAt(0) !== '#' && !/^javascript/i.test(hh)) continue; }
          try { b.click(); } catch (e) { }
          break;
        }
      }
      replayApis();
      harvestDom();
      var count = Object.keys(domItems).length + jsonCount;
      if (count === lastCount) still++; else { still = 0; lastCount = count; }
      report(false);
      // gata cand nu mai apar filme noi (3 secunde) si nu mai citim pagini din API
      if ((still >= 3 && !replaying) || rounds > 150) {
        done = true;
        setTimeout(function () { report(true); }, 300);
        return;
      }
      setTimeout(step, 1000);
    }
    // listele din API cu numar de pagina: cerem si paginile urmatoare (pana nu mai vin filme noi)
    function replayApis() {
      Object.keys(pageApis).forEach(function (u) {
        if (apiDone[u]) return;
        apiDone[u] = 1;
        var m = u.match(/([?&](?:page|pageNo|page_no|pageNum|page_num|p|pg|offset|start|current)=)(\d+)/i);
        if (!m) return;
        var isOffset = /offset|start/i.test(m[1]);
        var lim = u.match(/[?&](?:limit|size|pageSize|page_size|per_page|count|num)=(\d+)/i);
        var stepN = isOffset ? (lim ? +lim[1] : 20) : 1;
        var n = +m[2], misses = 0, pagesRead = 0;
        replaying++;
        (function next() {
          if (pagesRead++ > 300 || misses >= 2) { replaying--; return; }
          n += stepN;
          var nu = u.replace(m[0], m[1] + n);
          apiDone[nu] = 1;
          var before = jsonCount;
          var f = ofetch || window.fetch;
          f(nu, { credentials: 'include' }).then(function (r) { return r.text(); }).then(function (t) {
            var data; try { data = JSON.parse(t); } catch (e) { misses++; return next(); }
            scan(data, 0);
            if (jsonCount === before) misses++; else { misses = 0; dirty = true; }
            next();
          }).catch(function () { misses++; setTimeout(next, 300); });
        })();
      });
    }
    setTimeout(step, 1200);
  }

  // ---------- 6. deschiderea unui film ales din lista (pagina fara link direct) ----------
  function openRequested() {
    var o = window.__dfOpen;
    if (!o) return;
    var mark = 'dfopen_' + o.tok;
    try { if (sessionStorage.getItem(mark)) return; sessionStorage.setItem(mark, '1'); } catch (e) { }
    var target = o.key, tries = 0, searched = false;
    function findCard() {
      var imgs = document.images;
      for (var i = 0; i < imgs.length; i++) {
        var s = imgSrc(imgs[i]);
        if (s && normImg(s) === target) return cardOf(imgs[i]) || imgs[i];
      }
      if (o.oc) {
        var els = document.querySelectorAll('[onclick]');
        for (var j = 0; j < els.length; j++) if (els[j].getAttribute('onclick').slice(0, 300) === o.oc) return els[j];
      }
      return null;
    }
    function trySearch() {
      searched = true;
      var inp = document.querySelector('input[type=search],input[placeholder*=earch i],input[placeholder*=cari i],input[name*=search i],input[id*=search i],input[name=s],input[type=text]');
      if (!inp || !o.title) return false;
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(inp, o.title);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      ['keydown', 'keypress', 'keyup'].forEach(function (t) {
        inp.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      });
      var btn = inp.parentElement && inp.parentElement.querySelector('button');
      if (btn) btn.click();
      else if (inp.form) { try { inp.form.requestSubmit ? inp.form.requestSubmit() : inp.form.submit(); } catch (e) { } }
      return true;
    }
    function tick() {
      if (/just a moment/i.test(document.title)) return setTimeout(tick, 1000);
      var c = findCard();
      if (c) { try { c.scrollIntoView({ block: 'center' }); } catch (e) { } c.click(); return; }
      tries++;
      if (o.oc && tries === 10) { try { (new Function(o.oc))(); return; } catch (e) { } }
      if (!searched && tries === 6) trySearch();
      if (tries < 12 && !searched) window.scrollTo(0, document.documentElement.scrollHeight);
      if (tries < 40) setTimeout(tick, 700);
    }
    setTimeout(tick, 800);
  }

  // ---------- pornire ----------
  function boot() {
    openRequested();
    report(false);
    setInterval(function () {
      if (window.__dfCrawl && !crawlStarted) crawl();
      if (!crawlStarted) { dirty = false; report(false); }
    }, 2000);
    setTimeout(function () { if (window.__dfCrawl && !crawlStarted) crawl(); }, 300);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
