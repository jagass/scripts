// Ascunde ferestrele de reclama false ("VPN Toggle Recommended", "virus", "Allow notifications"...).
// Ruleaza in pagina si in toate iframe-urile.
(function () {
  if (window.__rfAd) return;
  window.__rfAd = true;

  var RX = new RegExp([
    'vpn', 'click to download', 'download (now|app)', 'install (now|app)', 'toggle recommended',
    'your (phone|device|android|browser) (is|has|may)', 'virus', 'infected', 'malware', 'battery',
    'allow notifications', 'press allow', 'click allow', 'tap allow', 'update required', 'update now',
    'you (have )?won', 'congratulations', 'claim (your )?(prize|reward)', 'are you (a )?human',
    'speed up your', 'clean(er)? your', 'security (alert|warning)'
  ].join('|'), 'i');

  // Continutul site-ului (liste de seriale, rezultate de cautare, campul de cautare) nu e niciodata reclama,
  // chiar daca un titlu contine un cuvant ca "virus" sau "you won".
  function isSiteContent(el) {
    try {
      return !!(el.querySelector && el.querySelector('a[href*="/drama/"], a[href*="/watch/"], input, textarea, video'));
    } catch (e) { return false; }
  }

  function isOurs(el) {
    return (el.id && el.id.indexOf('rf-') === 0) ||
      (el.hasAttribute && (el.hasAttribute('data-rf-target') || el.hasAttribute('data-rf-anc')));
  }

  function textOf(el) {
    var t = el.innerText || '';
    if (el.shadowRoot) t += ' ' + (el.shadowRoot.textContent || '');
    return t.slice(0, 600);
  }

  function check(el) {
    if (!el || el.nodeType !== 1 || isOurs(el) || el.hasAttribute('data-rf-ad')) return;
    if (isSiteContent(el)) return;
    if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'LINK') return;
    var cs;
    try { cs = getComputedStyle(el); } catch (e) { return; }
    if (cs.position !== 'fixed' && cs.position !== 'absolute' && cs.position !== 'sticky') return;
    var z = parseInt(cs.zIndex, 10) || 0;
    if (z < 10 && cs.position !== 'fixed') return;
    var t = textOf(el);
    if (t.length > 0 && t.length < 500 && RX.test(t)) {
      el.setAttribute('data-rf-ad', '');
      el.style.setProperty('display', 'none', 'important');
    }
  }

  function sweep() {
    var b = document.body;
    if (!b) return;
    var kids = b.children;
    for (var i = 0; i < kids.length; i++) {
      check(kids[i]);
      var g = kids[i].children;
      for (var j = 0; j < g.length && j < 50; j++) check(g[j]);
    }
    // si elementele direct sub <html> (unele reclame se pun acolo)
    var top = document.documentElement.children;
    for (var k = 0; k < top.length; k++) if (top[k] !== b && top[k].tagName !== 'HEAD') check(top[k]);
  }

  // Cautare in toata pagina dupa textele tipice reclamelor-capcana; ascunde fereastra care le contine
  // (oricat de adanc ar fi pusa), chiar daca isi forteaza singura stilurile.
  var STRONG = /(vpn\s*toggle|vpn\s*recommended|install\s*vpn|use\s*(a\s*)?vpn|click to download|allow notifications|press allow|tap allow|click allow|virus (detected|found)|your (phone|device|android) (is|has|may)|security (alert|warning))/i;
  var hiddenAds = [];
  function deepSweep() {
    if (!document.body) return;
    var w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), seen = new Set();
    while (w.nextNode()) {
      var v = w.currentNode.nodeValue;
      if (v.length > 200 || !STRONG.test(v)) continue;
      var el = w.currentNode.parentElement, box = null;
      for (var p = el; p && p !== document.body; p = p.parentElement) {
        if (isOurs(p)) { box = null; break; }
        if ((p.innerText || '').length > 700) break;
        var cs = getComputedStyle(p);
        var z = parseInt(cs.zIndex, 10) || 0;
        if (p.tagName === 'DIALOG' || cs.position === 'fixed' || z >= 1000) box = p;
      }
      if (box && isSiteContent(box)) box = null;
      if (box && !seen.has(box)) {
        seen.add(box);
        if (box.tagName === 'DIALOG' && box.open) try { box.close(); } catch (e) {}
        if (hiddenAds.indexOf(box) < 0) hiddenAds.push(box);
      }
    }
    // fereastra de reclama e scoasa cu totul din pagina (nu doar ascunsa)
    hiddenAds.forEach(function (b) { try { b.remove(); } catch (e) {} });
    hiddenAds = [];
  }

  // cautarea in toata pagina e mai costisitoare: cel mult o data pe secunda
  var lastDeep = 0;
  function deepThrottled() {
    var now = Date.now();
    if (now - lastDeep < 1000) return;
    lastDeep = now;
    deepSweep();
  }

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; sweep(); deepThrottled(); }, 250);
  }

  function start() {
    sweep();
    deepSweep();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(function () { sweep(); deepThrottled(); }, 3000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
