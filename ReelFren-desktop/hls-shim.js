// Redare HLS (.m3u8) pe desktop. Site-urile de seriale scurte pun direct linkul .m3u8 in <video>,
// ceea ce merge pe telefon, dar motorul de browser de pe desktop nu stie sa-l redea singur
// ("eroare la episod"). Aici preluam aceste video-uri cu hls.js (inclus in aplicatie).
(function () {
  var Hls = window.__RfHls;
  if (!Hls || !Hls.isSupported() || window.__rfHlsShim) return;
  window.__rfHlsShim = true;
  // Nu ne bazam pe canPlayType: unele versiuni raspund "maybe" la HLS, dar redarea tot da eroare.
  // hls.js (prin MediaSource) merge sigur, asa ca il folosim mereu pentru .m3u8 pe desktop.

  var M3U8 = /\.m3u8?(\?|#|$)/i;
  var proto = HTMLMediaElement.prototype;
  var srcDesc = Object.getOwnPropertyDescriptor(proto, 'src');
  var setAttr = Element.prototype.setAttribute;
  var getAttr = Element.prototype.getAttribute;

  function detach(v) {
    if (v.__rfHls) { try { v.__rfHls.destroy(); } catch (e) {} }
    v.__rfHls = null;
    v.__rfHlsUrl = null;
  }

  function attach(v, url) {
    if (v.__rfHls && v.__rfHlsUrl === url) return;
    detach(v);
    var abs = url;
    try { abs = new URL(url, location.href).href; } catch (e) {}
    var h = new Hls({ enableWorker: false, maxBufferLength: 30, backBufferLength: 30 });
    v.__rfHls = h;
    v.__rfHlsUrl = url;
    var mediaErrors = 0;
    h.on(Hls.Events.ERROR, function (ev, d) {
      if (!d || !d.fatal) return;
      if (d.type === Hls.ErrorTypes.NETWORK_ERROR) h.startLoad();
      else if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErrors++ < 3) h.recoverMediaError();
    });
    h.loadSource(abs);
    h.attachMedia(v);
    if (v.autoplay) h.once(Hls.Events.MANIFEST_PARSED, function () { var p = v.play(); if (p && p.catch) p.catch(function () {}); });
  }

  // video.src = "...m3u8"
  Object.defineProperty(proto, 'src', {
    configurable: true,
    enumerable: srcDesc.enumerable,
    get: function () { return this.__rfHlsUrl || srcDesc.get.call(this); },
    set: function (val) {
      var s = String(val);
      if (M3U8.test(s)) { attach(this, s); return; }
      // blob: = hls.js insusi atasandu-se la video; orice alta sursa = sursa noua, oprim hls
      if (s.indexOf('blob:') !== 0) detach(this);
      srcDesc.set.call(this, val);
    },
  });

  // video.setAttribute("src", "...m3u8")  (React foloseste asta)
  Element.prototype.setAttribute = function (name, val) {
    if (this instanceof HTMLMediaElement && String(name).toLowerCase() === 'src' && M3U8.test(String(val))) {
      attach(this, String(val));
      return;
    }
    return setAttr.apply(this, arguments);
  };
  Element.prototype.getAttribute = function (name) {
    if (this.__rfHlsUrl && String(name).toLowerCase() === 'src') return this.__rfHlsUrl;
    return getAttr.apply(this, arguments);
  };

  // <video><source src="...m3u8"></video> si video-uri deja existente in pagina
  function scan(root) {
    var vids = root.querySelectorAll ? root.querySelectorAll('video') : [];
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i];
      var a = getAttr.call(v, 'src');
      if (a && M3U8.test(a) && v.__rfHlsUrl !== a) { v.removeAttribute('src'); attach(v, a); continue; }
      var srcEl = v.querySelector('source[src]');
      if (srcEl && M3U8.test(getAttr.call(srcEl, 'src')) && !v.__rfHls) {
        var u = getAttr.call(srcEl, 'src');
        srcEl.remove();
        attach(v, u);
      }
    }
  }
  function start() {
    scan(document);
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var n = muts[i].addedNodes;
        for (var j = 0; j < n.length; j++) if (n[j].nodeType === 1) scan(n[j].tagName === 'VIDEO' ? n[j].parentNode || n[j] : n[j]);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
