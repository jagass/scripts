// Scurtaturi de tastatura pentru vizionare pe desktop.
(function () {
  if (window.top !== window || window.__rfDesktop) return;
  window.__rfDesktop = true;

  function msg(m) {
    var b = window.RFBridge;
    if (b && typeof b.onmessage === 'function') b.onmessage({ data: m });
  }

  var hint = null, hintTimer = null;
  function showHint(text, ms) {
    if (!document.body) return;
    if (!hint) {
      hint = document.createElement('div');
      hint.id = 'rf-hint';
      hint.style.cssText = 'position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:2147483647;' +
        'background:rgba(0,0,0,.78);color:#fff;font:15px system-ui,sans-serif;padding:10px 16px;border-radius:12px;' +
        'pointer-events:none;transition:opacity .3s;white-space:nowrap';
      document.body.appendChild(hint);
    }
    hint.textContent = text;
    hint.style.opacity = '1';
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { hint.style.opacity = '0'; }, ms || 1200);
  }

  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (!document.querySelector('video')) return; // doar pe paginile cu video
    var k = e.key;
    if (k === 'ArrowDown' || k === 'PageDown' || k === 'n' || k === 'N') {
      var r = window.__rfNext && window.__rfNext();
      showHint(r ? 'Episodul următor ⏭' : 'Nu am găsit episodul următor');
    } else if (k === 'ArrowUp' || k === 'PageUp' || k === 'p' || k === 'P') {
      var r2 = window.__rfPrev && window.__rfPrev();
      showHint(r2 ? '⏮ Episodul anterior' : 'Nu am găsit episodul anterior');
    } else if (k === 'ArrowRight') { msg('seek:10'); showHint('+10s'); }
    else if (k === 'ArrowLeft') { msg('seek:-10'); showHint('-10s'); }
    else if (k === ' ' || k === 'k' || k === 'K') { msg('toggle'); }
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  // clic real (al tau) pe un link: aplicatia afla unde vrei sa mergi, ca sa permita si alte site-uri
  // (ex. alta platforma din meniul site-ului). Redirecturile si pop-up-urile fara clic raman blocate.
  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (a && /^https?:/i.test(a.href) && window.RFBridge) window.RFBridge.postMessage('click:' + a.href);
  }, true);

  // la intrarea in ecran complet, aratam scurtaturile
  window.addEventListener('message', function (e) {
    if (e.source === window && e.data && e.data.__rfOut === 'fs:enter') {
      showHint('↑/↓ episod · ←/→ 10s · Space pauză · Esc ieșire', 4000);
    }
  });
})();
