// Pune in pagina scripturile aplicatiei (redare HLS, filtru, reclame, ecran complet, tastatura)
// inainte de scripturile site-ului. Pe pagina de verificare Cloudflare aplicatia nu trimite nimic
// (vezi main.js), ca verificarea sa treaca normal.
const { ipcRenderer, webFrame } = require('electron');

const code = ipcRenderer.sendSync('rf:scripts');
if (code) webFrame.executeJavaScript(code).catch(() => {});

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || typeof e.data.__rfOut !== 'string') return;
  const m = e.data.__rfOut;
  if (m === 'fs:enter') ipcRenderer.send('rf:fs', true);
  else if (m === 'fs:exit') ipcRenderer.send('rf:fs', false);
  else if (m.indexOf('click:') === 0) ipcRenderer.send('rf:click', m.slice(6));
  else if (m.indexOf('open:') === 0) ipcRenderer.send('rf:open', m.slice(5));
});
