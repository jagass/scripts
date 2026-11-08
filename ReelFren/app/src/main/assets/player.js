// Injectat la inceputul paginii si al fiecarui iframe (inclusiv playerul video).
// Inlocuieste fullscreen-ul site-ului cu un "mod cinema": video-ul umple ecranul pe vertical,
// iar aplicatia afiseaza propriile controale (derulare, pauza, episodul urmator).
(function () {
  if (window.__rfInjected) return;
  if (location.hostname === 'appassets.androidplatform.net') return; // lista DramaFren din aplicatie
  window.__rfInjected = true;

  var isTop = window.top === window;
  var bridge = window.RFBridge;
  var cinema = false;
  var target = null;      // elementul pus pe tot ecranul (video sau iframe-ul playerului)
  var marked = [];        // stramosii carora le-am anulat transform/z-index
  var timer = null;
  var lastVideo = null;
  // 'light' = playerul site-ului ocupa deja tot ecranul (ex. reelfren): nu mutam video-ul si nu atingem
  //           Swiper-ul (swipe-ul site-ului merge normal), ascundem doar ce e in jur.
  // 'full'  = video mic in pagina: il punem noi pe tot ecranul.
  var mode = null;

  function send(m) { try { if (bridge) bridge.postMessage(m); } catch (e) {} }

  // --- fullscreen-ul site-ului -> mod cinema --------------------------------
  function fakeEnter() { send('fs:enter'); return Promise.resolve(); }
  function fakeExit() { send('fs:exit'); return Promise.resolve(); }
  try {
    ['requestFullscreen', 'webkitRequestFullscreen', 'webkitRequestFullScreen', 'mozRequestFullScreen', 'msRequestFullscreen']
      .forEach(function (n) { if (Element.prototype[n]) Element.prototype[n] = fakeEnter; });
    if (window.HTMLVideoElement) {
      HTMLVideoElement.prototype.webkitEnterFullscreen = fakeEnter;
      HTMLVideoElement.prototype.webkitEnterFullScreen = fakeEnter;
    }
    ['exitFullscreen', 'webkitExitFullscreen', 'webkitCancelFullScreen', 'mozCancelFullScreen', 'msExitFullscreen']
      .forEach(function (n) { if (n in Document.prototype || document[n]) Document.prototype[n] = fakeExit; });
  } catch (e) {}

  // --- stiluri ---------------------------------------------------------------
  function ensureCss() {
    if (document.getElementById('rf-cinema-css')) return;
    var s = document.createElement('style');
    s.id = 'rf-cinema-css';
    s.textContent =
      'html[data-rf-cinema=full],html[data-rf-cinema=full] body{overflow:hidden!important}' +
      '[data-rf-target]{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;' +
      'width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;' +
      'margin:0!important;padding:0!important;border:0!important;border-radius:0!important;transform:none!important;' +
      'z-index:2147483600!important;background:#000!important;object-fit:contain!important;visibility:visible!important;opacity:1!important}' +
      '[data-rf-anc]{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;' +
      'will-change:auto!important;z-index:2147483600!important;overflow:visible!important}' +
      'html[data-rf-cinema] #rf-btn,html[data-rf-cinema] #rf-panel,html[data-rf-cinema] #rf-notice{display:none!important}' +
      'html[data-rf-cinema=full]::after{content:"";position:fixed;inset:0;background:#000;z-index:2147483599}' +
      // in modul cinema nu se vede nimic altceva decat video-ul (nici reclame puse peste el)
      'html[data-rf-cinema=full] body *:not([data-rf-anc]):not([data-rf-target]){visibility:hidden!important;pointer-events:none!important}' +
      'html[data-rf-cinema=full] [data-rf-target]{visibility:visible!important}';
    (document.head || document.documentElement).appendChild(s);
  }

  function area(el) {
    var r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function visibleArea(el) {
    var r = el.getBoundingClientRect();
    var w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    var h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function bestVideo() {
    var vs = Array.prototype.slice.call(document.querySelectorAll('video'));
    var best = null, bestScore = -1;
    vs.forEach(function (v) {
      if (!v.isConnected) return;
      // conteaza in primul rand cat din video se vede pe ecran (dupa swipe, episodul nou e cel vizibil),
      // apoi daca ruleaza; asa nu revenim din greseala la episodul vechi
      var sc = visibleArea(v) * 10 + (v.paused ? 0 : 5000) + (v.readyState > 0 ? 1000 : 0) + (v === target ? 1 : 0);
      if (sc > bestScore) { bestScore = sc; best = v; }
    });
    return best;
  }

  function bestIframe() {
    var fs = Array.prototype.slice.call(document.querySelectorAll('iframe'));
    var best = null, a = 0;
    fs.forEach(function (f) { var x = area(f); if (x > a) { a = x; best = f; } });
    return a > 20000 ? best : null;
  }

  // In modul cinema ascundem direct (stil inline cu !important) tot ce sta langa video, pe tot lantul
  // de parinti. Asta bate si reclamele care isi pun singure stiluri "forțate" ca sa nu poata fi ascunse.
  var hiddenByUs = [];
  function enforce(el) {
    var st = el.style;
    if (st.getPropertyValue('display') !== 'none' || st.getPropertyPriority('display') !== 'important') {
      st.setProperty('display', 'none', 'important');
    }
  }
  // reactioneaza imediat daca cineva incearca sa reafiseze un element ascuns de noi
  var guard = window.MutationObserver ? new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) if (muts[i].target.__rfHid) enforce(muts[i].target);
  }) : null;
  var SKIP_TAGS = { HEAD: 1, SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, TITLE: 1, NOSCRIPT: 1 };
  function hideOthers() {
    if (!target) return;
    var parents = marked.concat([document.documentElement]);
    for (var i = 0; i < parents.length; i++) {
      var kids = parents[i].children;
      for (var j = 0; j < kids.length; j++) {
        var k = kids[j];
        if (k === target || k.__rfHid || SKIP_TAGS[k.tagName] || k.hasAttribute('data-rf-anc')) continue;
        if (mode === 'light') {
          // nu atingem slide-urile Swiper-ului si nici alte video-uri (episoadele vecine)
          if (marked.indexOf(k) >= 0) continue;
          if (k.classList.contains('swiper-slide') || k.tagName === 'VIDEO' || k.querySelector('video')) continue;
          // blocarea reclamelor oprita: lasam vizibile ferestrele puse peste pagina (site-ul asteapta raspunsul la ele)
          if (window.__rfAdOff && k.parentElement === document.body && getComputedStyle(k).position === 'fixed') continue;
        }
        k.__rfHid = true;
        hiddenByUs.push([k, k.style.getPropertyValue('display'), k.style.getPropertyPriority('display')]);
        k.style.setProperty('display', 'none', 'important');
        if (guard) guard.observe(k, { attributes: true, attributeFilter: ['style', 'class', 'hidden'] });
      }
    }
    // daca o reclama si-a rescris stilul, il punem la loc
    for (var h = 0; h < hiddenByUs.length; h++) enforce(hiddenByUs[h][0]);
  }
  function restoreOthers() {
    hiddenByUs.forEach(function (h) { h[0].__rfHid = false; });
    if (guard) guard.disconnect();
    hiddenByUs.forEach(function (h) {
      var el = h[0];
      el.__rfHid = false;
      if (h[1]) el.style.setProperty('display', h[1], h[2]); else el.style.removeProperty('display');
    });
    hiddenByUs = [];
  }

  function clearTarget() {
    restoreOthers();
    if (target) target.removeAttribute('data-rf-target');
    marked.forEach(function (el) { el.removeAttribute('data-rf-anc'); });
    marked = [];
    target = null;
  }

  function chainOf(el) {
    var out = [];
    for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) out.push(p);
    return out;
  }

  function setTarget(el) {
    if (mode === 'light') {
      if (el && el === target && el.isConnected) {
        var c = chainOf(el);
        if (c.length === marked.length && c.every(function (p, i) { return p === marked[i]; })) return;
      }
      restoreOthers();
      target = el || null;
      marked = el ? chainOf(el) : [];
      return;
    }
    if (el && el === target && el.isConnected) {
      // site-ul isi redeseneaza playerul si poate sterge marcajele sau muta video-ul: le refacem
      var chain = chainOf(el);
      var same = chain.length === marked.length && chain.every(function (p, i) { return p === marked[i]; });
      if (same) {
        if (!el.hasAttribute('data-rf-target')) el.setAttribute('data-rf-target', '');
        marked.forEach(function (p) { if (!p.hasAttribute('data-rf-anc')) p.setAttribute('data-rf-anc', ''); });
        return;
      }
    }
    clearTarget();
    if (!el) return;
    target = el;
    el.setAttribute('data-rf-target', '');
    marked = chainOf(el);
    marked.forEach(function (p) { p.setAttribute('data-rf-anc', ''); });
  }

  function decideMode() {
    var v = bestVideo();
    if (!v) {
      // niciun video pe pagina (ex. site-ul arata "Video cannot be loaded"): nu acoperim nimic si lasam
      // atingerile sa ajunga la pagina (Reload, butonul de reclame); reincercam cand apare un video
      if (isTop && bestIframe()) { mode = 'full'; send('mode:full'); return; }
      if (isTop) { mode = 'none'; send('mode:none'); }
      return;
    }
    var big = visibleArea(v) >= 0.6 * innerWidth * innerHeight;
    mode = big ? 'light' : 'full';
    send('mode:' + mode);
    if (mode === 'light') document.addEventListener('click', blockTap, true);
  }

  // In modul usor, o atingere pe video e pentru controalele aplicatiei: nu o lasam sa ajunga la
  // playerul site-ului (care ar pune pauza). Swipe-ul (evenimente touch) nu e afectat.
  function blockTap(e) {
    if (!cinema || mode !== 'light' || !e.isTrusted) return;
    var t = e.target;
    if (t && t.closest && (t.closest('.swiper') || t.tagName === 'VIDEO' || (target && target.parentElement && target.parentElement.contains(t)))) {
      e.stopPropagation();
      e.preventDefault();
    }
  }

  function tick() {
    if (!cinema) return;
    ensureCss();
    if (mode === 'none' && bestVideo()) mode = null; // a aparut video-ul: alegem modul potrivit
    if (mode === null) decideMode();
    if (mode === 'none') { document.documentElement.removeAttribute('data-rf-cinema'); return; }
    if (mode && document.documentElement.getAttribute('data-rf-cinema') !== mode) document.documentElement.setAttribute('data-rf-cinema', mode);
    var v = bestVideo();
    var t = v || (isTop ? bestIframe() : null);
    setTarget(t);
    hideOthers();
    if (v) {
      // episod nou (video inlocuit de site): il pornim automat
      if (v !== lastVideo) {
        lastVideo = v;
        if (v.paused) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); }
      }
      if (isFinite(v.duration) && v.duration > 0) {
        send('t:' + v.currentTime.toFixed(1) + ':' + v.duration.toFixed(1) + ':' + (v.paused ? 1 : 0));
      }
    }
  }

  // reactie imediata (la urmatorul cadru) cand site-ul schimba ceva in pagina in timpul modului cinema
  var rafPending = false;
  function quickFix() {
    rafPending = false;
    if (!cinema || mode === null || mode === 'none') return; // modul se alege in tick()
    var v = bestVideo();
    setTarget(v || (isTop ? bestIframe() : null));
    hideOthers();
  }
  var watcher = window.MutationObserver ? new MutationObserver(function () {
    if (rafPending || !cinema) return;
    rafPending = true;
    requestAnimationFrame(quickFix);
  }) : null;

  function setCinema(on) {
    if (on === cinema) return;
    cinema = on;
    clearInterval(timer);
    if (on) {
      lastVideo = null;
      tick();
      timer = setInterval(tick, 500);
      if (watcher) watcher.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    } else {
      if (watcher) watcher.disconnect();
      clearTarget();
      document.removeEventListener('click', blockTap, true);
      mode = null;
      document.documentElement.removeAttribute('data-rf-cinema');
    }
  }

  // --- comenzi de la aplicatie ---------------------------------------------
  function videos() {
    return Array.prototype.slice.call(document.querySelectorAll('video'))
      .filter(function (v) { return v.readyState > 0 || v.duration > 0; });
  }

  function seek(delta) {
    videos().forEach(function (v) {
      try {
        var t = v.currentTime + delta;
        if (isFinite(v.duration)) t = Math.min(t, v.duration - 0.5);
        v.currentTime = Math.max(0, t);
      } catch (e) {}
    });
  }

  function seekTo(sec) {
    var v = bestVideo();
    if (v) try { v.currentTime = Math.max(0, sec); } catch (e) {}
  }

  function toggle() {
    var v = bestVideo();
    if (!v) return;
    if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } else v.pause();
  }

  var EP_TEXT = /(urm[aă]tor|next\s*ep|episodul\s*urm|ep\.?\s*urm|următorul|next)/i;
  var NOT = /(prev|preced|anterior|înapoi|inapoi)/i;

  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function label(el) {
    return ((el.innerText || '') + ' ' + (el.title || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
  }

  function findNext() {
    var els = document.querySelectorAll('a, button, [role=button], [onclick]');
    var byClass = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var txt = label(el);
      if (NOT.test(txt)) continue;
      if (txt.length < 60 && EP_TEXT.test(txt)) return el;
      var cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      if (!byClass && /next/i.test(cls) && !/swiper|slick|carousel|slider|owl/i.test(cls)) byClass = el;
    }
    if (byClass) return byClass;
    return document.querySelector('a[rel=next], link[rel=next]');
  }

  // Lista de episoade (1, 2, 3... sau "EP 2"): gaseste episodul activ si apasa pe urmatorul/anteriorul.
  var NUM_RX = /^(ep\.?\s*|episode\s*|episodul\s*)?(\d{1,4})$/i;
  var ACTIVE_RX = /(^|[\s_-])(active|current|selected|playing|is-active|on)([\s_-]|$)/i;
  function byNumber(step) {
    var els = document.querySelectorAll('a, button, li, [role=button], [role=tab], div, span');
    var cands = [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (e.children.length > 3 || e.closest('[id^=rf-]')) continue;
      var t = (e.textContent || '').replace(/\s+/g, ' ').trim();
      var m = t.match(NUM_RX);
      if (!m) continue;
      var cls = (typeof e.className === 'string' ? e.className : '');
      var isAct = ACTIVE_RX.test(cls) || !!e.getAttribute('aria-current') || e.getAttribute('aria-selected') === 'true';
      if (!isAct && e.parentElement) {
        var pc = typeof e.parentElement.className === 'string' ? e.parentElement.className : '';
        isAct = ACTIVE_RX.test(pc) && e.parentElement.children.length === 1;
      }
      // "sigur episod": textul incepe cu EP/Episode sau clasa contine "episode"
      var strong = !!m[1] || /episode|(^|[\s_-])ep([\s_-]|$)/i.test(cls);
      cands.push({ e: e, n: parseInt(m[2], 10), act: isAct, strong: strong });
    }
    // daca exista butoane clare "EP N", ignoram alte numere din pagina (like-uri, notificari...)
    if (cands.some(function (c) { return c.strong; })) cands = cands.filter(function (c) { return c.strong; });
    var map = {}, active = null;
    cands.forEach(function (c) {
      // preferam elementul cel mai din interior (butonul, nu <li>-ul din jurul lui)
      if (!(c.n in map) || map[c.n].contains(c.e)) map[c.n] = c.e;
      if (c.act && active === null) active = c.n;
    });
    if (active === null) return false;
    var target = map[active + step];
    if (!target) return false;
    lastVideo = null;
    // daca am gasit un <li> cu un buton/link inauntru, apasam butonul
    (target.querySelector('button, a, [role=button]') || target).click();
    return true;
  }

  // Daca adresa paginii contine numarul episodului (?ep=3, /episode/3, /ep-3), mergem direct la urmatorul.
  function byUrl(step) {
    var u = location.href, pats = [
      /([?&](?:ep|episode|eps|e|episodeNumber|episode_number|episodeNo|index|num|no)=)(\d+)/i,
      /(\/(?:ep|episode|episodes|eps|e|chapter)[\/_-]?)(\d+)(?=[\/?#]|$)/i
    ];
    for (var i = 0; i < pats.length; i++) {
      var m = u.match(pats[i]);
      if (!m) continue;
      var n = parseInt(m[2], 10) + step;
      if (n < 0) return false;
      location.href = u.replace(pats[i], m[1] + n);
      return true;
    }
    return false;
  }

  // Componenta "Swiper" (folosita des pentru episoade cu swipe) are o metoda directa slideNext/slidePrev.
  function bySwiper(step) {
    var els = Array.prototype.slice.call(document.querySelectorAll('.swiper-vertical, .swiper, .swiper-container, [class*=swiper]'));
    // swiper-ul care contine video-ul are prioritate (nu un carusel oarecare din pagina)
    els.sort(function (a, b) { return (b.querySelector('video') ? 1 : 0) - (a.querySelector('video') ? 1 : 0); });
    for (var i = 0; i < els.length; i++) {
      var sw = els[i].swiper;
      if (!sw || typeof sw.slideNext !== 'function') continue;
      if (!els[i].querySelector('video') && !/vertical/.test(els[i].className)) continue;
      var before = sw.activeIndex;
      if (step > 0) {
        if (sw.isEnd) return false;
        sw.slideNext();
      } else {
        if (sw.isBeginning) return false;
        sw.slidePrev();
      }
      if (sw.activeIndex === before) return false; // nu s-a miscat: incercam alta metoda
      lastVideo = null;
      return true;
    }
    return false;
  }

  // Lista de episoade derulabila (TikTok-style): derulam containerul cu exact un ecran.
  function byScroll(step) {
    var vs = Array.prototype.slice.call(document.querySelectorAll('video'));
    var v = null, best = 0;
    vs.forEach(function (x) { var a = visibleArea(x); if (a > best) { best = a; v = x; } });
    var start = v || document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    for (var p = start; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight + 20) {
        p.scrollBy({ top: step * p.clientHeight, behavior: 'smooth' });
        lastVideo = null;
        return true;
      }
    }
    // pagina intreaga cu "scroll snap" (cate un episod pe ecran)
    var snap = getComputedStyle(document.documentElement).scrollSnapType + ' ' + getComputedStyle(document.body).scrollSnapType;
    if (/(y|both|block|mandatory)/.test(snap) && document.scrollingElement.scrollHeight > innerHeight + 20) {
      window.scrollBy({ top: step * innerHeight, behavior: 'smooth' });
      lastVideo = null;
      return true;
    }
    return false;
  }

  // Pe reelfren.net pagina de episod e un Swiper vertical (un episod pe slide) + lista "EP 1, EP 2..."
  // + adresa cu ?ep=N. Ordinea: swiper (ca un swipe), lista de episoade, adresa, derulare.
  window.__rfPrev = function () {
    var r = bySwiper(-1) ? 'swiper' : byNumber(-1) ? 'lista EP' : byUrl(-1) ? 'adresa' : byScroll(-1) ? 'derulare' : false;
    window.__rfLast = { dir: 'prev', method: r, at: Date.now() };
    return r;
  };

  // intoarce numele metodei folosite (pentru verificare), sau false
  window.__rfNext = function () {
    var r = bySwiper(1) ? 'swiper' : byNumber(1) ? 'lista EP' : byUrl(1) ? 'adresa' : byScroll(1) ? 'derulare' : false;
    if (!r) {
      var el = findNext();
      if (el) {
        lastVideo = null;
        if (el.tagName === 'LINK') location.href = el.href; else el.click();
        r = 'buton next';
      }
    }
    window.__rfLast = { dir: 'next', method: r, at: Date.now() };
    return r;
  };

  // starea curenta: adresa + video-ul vizibil (ca aplicatia sa verifice daca episodul chiar s-a schimbat)
  window.__rfState = function () {
    var v = null, best = 0;
    Array.prototype.slice.call(document.querySelectorAll('video')).forEach(function (x) {
      var a = visibleArea(x) + (x.hasAttribute('data-rf-target') ? 1e9 : 0);
      if (a > best) { best = a; v = x; }
    });
    return location.href + ' | ' + (v ? (v.currentSrc || v.src || '') : '');
  };

  window.__rfSetCinema = setCinema; // folosit si la teste

  // --- Mod film: la finalul unui episod porneste automat urmatorul ------------------------
  var AUTO_KEY = 'rfAutoNext';
  function autoNextOn() {
    try { return localStorage.getItem(AUTO_KEY) !== '0'; } catch (e) { return true; } // implicit pornit
  }
  window.__rfAutoNextOn = autoNextOn;
  window.__rfToggleAutoNext = function () {
    var on = !autoNextOn();
    try { localStorage.setItem(AUTO_KEY, on ? '1' : '0'); } catch (e) {}
    return on;
  };

  var autoPending = false;
  document.addEventListener('ended', function (e) {
    var v = e.target;
    if (!(v instanceof HTMLMediaElement) || v.tagName !== 'VIDEO' || !autoNextOn() || autoPending) return;
    if (visibleArea(v) < 0.2 * innerWidth * innerHeight && !v.hasAttribute('data-rf-target')) return; // nu un video mic/ascuns
    autoPending = true;
    var src = v.currentSrc || v.src || '';
    // lasam site-ul sa treaca singur la urmatorul (daca stie); daca nu, o facem noi
    setTimeout(function () {
      autoPending = false;
      var cur = bestVideo();
      var advanced = cur && (cur !== v || (cur.currentSrc || cur.src || '') !== src) && !cur.ended;
      if (advanced) return;
      if (window.__rfDesktop || !bridge) { if (isTop && window.__rfNext) window.__rfNext(); }
      else send('auto:next'); // pe telefon: aplicatia schimba episodul (stie si de ecranul mare)
    }, 1500);
  }, true);

  // Diagnostic: o descriere scurta a paginii de episod, ca sa putem adapta "episodul urmator".
  window.__rfDiag = function () {
    function cls(e) { return (typeof e.className === 'string' ? e.className : '').slice(0, 60); }
    function path(e) {
      var out = [];
      for (var p = e, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) {
        out.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + (cls(p) ? '.' + cls(p).trim().replace(/\s+/g, '.') : ''));
      }
      return out.join(' < ');
    }
    var d = { url: location.href, title: document.title.slice(0, 80) };
    d.videos = Array.prototype.slice.call(document.querySelectorAll('video')).slice(0, 6).map(function (v) {
      var r = v.getBoundingClientRect();
      return { src: (v.currentSrc || v.src || '').slice(0, 90), paused: v.paused, t: Math.round(v.currentTime), dur: Math.round(v.duration || 0),
        rect: [Math.round(r.top), Math.round(r.height)], path: path(v) };
    });
    d.iframes = Array.prototype.slice.call(document.querySelectorAll('iframe')).slice(0, 6).map(function (f) {
      return (f.src || '').slice(0, 90);
    });
    d.swiper = !!document.querySelector('[class*=swiper],[class*=slick],[class*=carousel],[class*=snap]');
    var swEl = document.querySelector('.swiper-vertical') || document.querySelector('.swiper');
    d.swiperApi = swEl ? (swEl.swiper ? { index: swEl.swiper.activeIndex, slides: (swEl.swiper.slides || []).length,
      isEnd: swEl.swiper.isEnd, allowNext: swEl.swiper.allowSlideNext } : 'fara-api') : 'lipsa';
    d.last = window.__rfLast || null;
    d.cinema = document.documentElement.getAttribute('data-rf-cinema') || false;
    d.frames = !!window.RFBridge;
    var seen = {}, btns = [];
    Array.prototype.slice.call(document.querySelectorAll('a,button,[role=button],[onclick],li')).forEach(function (e) {
      var t = (e.innerText || e.getAttribute('aria-label') || e.title || '').replace(/\s+/g, ' ').trim().slice(0, 30);
      var key = t + '|' + e.tagName;
      if (seen[key] || btns.length >= 70) return;
      seen[key] = 1;
      var h = e.getAttribute && e.getAttribute('href');
      btns.push(e.tagName.toLowerCase() + ' "' + t + '"' + (cls(e) ? ' .' + cls(e).slice(0, 40) : '') + (h ? ' ' + h.slice(0, 60) : ''));
    });
    d.buttons = btns;
    var s = JSON.stringify(d);
    return s.length > 7000 ? s.slice(0, 7000) : s;
  };

  if (bridge) {
    bridge.onmessage = function (e) {
      var m = String(e.data);
      if (m.indexOf('seek:') === 0) seek(parseFloat(m.slice(5)));
      else if (m.indexOf('seekto:') === 0) seekTo(parseFloat(m.slice(7)));
      else if (m === 'toggle') toggle();
      else if (m === 'cinema:1') setCinema(true);
      else if (m === 'cinema:0') setCinema(false);
      else if (m === 'next' && !isTop) window.__rfNext();
    };
    send('hello');
  }
})();
