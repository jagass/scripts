// Ruleaza inainte de scripturile site-ului: pune in pagina scripturile ReelFren
// si transmite cererile de "ecran complet" catre fereastra.
const { ipcRenderer, webFrame } = require('electron');

const code = ipcRenderer.sendSync('rf:scripts');
if (code) webFrame.executeJavaScript(code).catch(() => {});

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || typeof e.data.__rfOut !== 'string') return;
  const m = e.data.__rfOut;
  if (m === 'fs:enter') ipcRenderer.send('rf:fs', true);
  else if (m === 'fs:exit') ipcRenderer.send('rf:fs', false);
});
