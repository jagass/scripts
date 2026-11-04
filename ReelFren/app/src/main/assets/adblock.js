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

  function isOurs(el) {
    return (el.id && el.id.indexOf('rf-') === 0) ||
      (el.classList && (el.classList.contains('rf-cinema-target') || el.classList.contains('rf-cinema-anc')));
  }

  function textOf(el) {
    var t = el.innerText || '';
    if (el.shadowRoot) t += ' ' + (el.shadowRoot.textContent || '');
    return t.slice(0, 600);
  }

  function check(el) {
    if (!el || el.nodeType !== 1 || isOurs(el) || el.hasAttribute('data-rf-ad')) return;
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

  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    setTimeout(function () { pending = false; sweep(); }, 250);
  }

  function start() {
    sweep();
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    setInterval(sweep, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
