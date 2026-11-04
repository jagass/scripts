// Injectat la inceputul paginii si al fiecarui iframe (inclusiv playerul video).
// Inlocuieste fullscreen-ul site-ului cu un "mod cinema": video-ul umple ecranul pe vertical,
// iar aplicatia afiseaza propriile controale (derulare, pauza, episodul urmator).
(function () {
  if (window.__rfInjected) return;
  window.__rfInjected = true;

  var isTop = window.top === window;
  var bridge = window.RFBridge;
  var cinema = false;
  var target = null;      // elementul pus pe tot ecranul (video sau iframe-ul playerului)
  var marked = [];        // stramosii carora le-am anulat transform/z-index
  var timer = null;
  var lastVideo = null;

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
      'html.rf-cinema-on,html.rf-cinema-on body{overflow:hidden!important}' +
      '.rf-cinema-target{position:fixed!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;' +
      'width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;min-width:0!important;min-height:0!important;' +
      'margin:0!important;padding:0!important;border:0!important;border-radius:0!important;transform:none!important;' +
      'z-index:2147483600!important;background:#000!important;object-fit:contain!important;visibility:visible!important;opacity:1!important}' +
      '.rf-cinema-anc{transform:none!important;filter:none!important;perspective:none!important;contain:none!important;' +
      'will-change:auto!important;z-index:2147483600!important;overflow:visible!important}' +
      'html.rf-cinema-on #rf-btn,html.rf-cinema-on #rf-panel{display:none!important}' +
      'html.rf-cinema-on::after{content:"";position:fixed;inset:0;background:#000;z-index:2147483599}';
    (document.head || document.documentElement).appendChild(s);
  }

  function area(el) {
    var r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function bestVideo() {
    var vs = Array.prototype.slice.call(document.querySelectorAll('video'));
    var best = null, bestScore = -1;
    vs.forEach(function (v) {
      if (!v.isConnected) return;
      var sc = (v.paused ? 0 : 1e9) + (v.readyState > 0 ? 1e8 : 0) + area(v) + (v === target ? 1 : 0);
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

  function clearTarget() {
    if (target) target.classList.remove('rf-cinema-target');
    marked.forEach(function (el) { el.classList.remove('rf-cinema-anc'); });
    marked = [];
    target = null;
  }

  function setTarget(el) {
    if (el === target && el && el.isConnected) return;
    clearTarget();
    if (!el) return;
    target = el;
    el.classList.add('rf-cinema-target');
    for (var p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      p.classList.add('rf-cinema-anc');
      marked.push(p);
    }
  }

  function tick() {
    if (!cinema) return;
    ensureCss();
    document.documentElement.classList.add('rf-cinema-on');
    var v = bestVideo();
    var t = v || (isTop ? bestIframe() : null);
    setTarget(t);
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

  function setCinema(on) {
    if (on === cinema) return;
    cinema = on;
    clearInterval(timer);
    if (on) {
      lastVideo = null;
      tick();
      timer = setInterval(tick, 500);
    } else {
      clearTarget();
      document.documentElement.classList.remove('rf-cinema-on');
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

  window.__rfNext = function () {
    var el = findNext();
    if (!el) return false;
    if (el.tagName === 'LINK') { location.href = el.href; return true; }
    lastVideo = null;
    el.click();
    return true;
  };

  window.__rfSetCinema = setCinema; // folosit si la teste

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
