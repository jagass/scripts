// Pune in pagina scripturile ReelFren (filtru, reclame, ecran complet, tastatura).
// IMPORTANT: pe pagina de verificare Cloudflare ("Verify you are human") nu punem nimic:
// orice modificare a paginii o face pe Cloudflare sa creada ca e un robot si cere verificarea la nesfarsit.
const { ipcRenderer, webFrame } = require('electron');

function isChallengePage() {
  if (/^(just a moment|un moment|attention required|checking your browser|verifying|please wait)/i.test(document.title.trim())) return true;
  if (document.querySelector('#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running, ' +
      '#turnstile-wrapper, script[src*="challenges.cloudflare.com"], script[src*="/cdn-cgi/challenge-platform/"]')) return true;
  const html = document.documentElement ? document.documentElement.innerHTML.slice(0, 20000) : '';
  return html.indexOf('_cf_chl_opt') >= 0 || html.indexOf('cf-chl-') >= 0;
}

window.addEventListener('DOMContentLoaded', () => {
  if (isChallengePage()) return;
  const code = ipcRenderer.sendSync('rf:scripts');
  if (code) webFrame.executeJavaScript(code).catch(() => {});
});

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || typeof e.data.__rfOut !== 'string') return;
  const m = e.data.__rfOut;
  if (m === 'fs:enter') ipcRenderer.send('rf:fs', true);
  else if (m === 'fs:exit') ipcRenderer.send('rf:fs', false);
});
