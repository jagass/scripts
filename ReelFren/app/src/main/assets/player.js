// Injectat in pagina si in toate iframe-urile (inclusiv playerul video).
(function () {
  if (window.__rfInjected) return;
  window.__rfInjected = true;

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

  var EP_TEXT = /(urm[aă]tor|next\s*ep|episodul\s*urm|ep\.?\s*urm|următorul|next)/i;
  var NOT = /(prev|preced|anterior|înapoi|inapoi)/i;

  function visible(el) {
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function label(el) {
    return ((el.innerText || '') + ' ' + (el.title || '') + ' ' +
      (el.getAttribute('aria-label') || '')).trim();
  }

  function findNext() {
    var els = document.querySelectorAll('a, button, [role=button], [onclick]');
    var byClass = null;
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var txt = label(el);
      if (NOT.test(txt)) continue;
      if (txt.length < 60 && EP_TEXT.test(txt) && visible(el)) return el;
      var cls = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      if (!byClass && /next/i.test(cls) && !/swiper|slick|carousel|slider|owl/i.test(cls) && visible(el)) byClass = el;
    }
    if (byClass) return byClass;
    var rel = document.querySelector('a[rel=next], link[rel=next]');
    return rel;
  }

  window.__rfNext = function () {
    var el = findNext();
    if (!el) return false;
    if (el.tagName === 'LINK') { location.href = el.href; return true; }
    el.click();
    return true;
  };

  if (window.RFBridge) {
    RFBridge.onmessage = function (e) {
      var m = String(e.data);
      if (m.indexOf('seek:') === 0) seek(parseFloat(m.slice(5)));
      else if (m === 'next' && window.top !== window) window.__rfNext();
    };
    RFBridge.postMessage('hello');
  }
})();
