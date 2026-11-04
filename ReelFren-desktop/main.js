// ReelFren pentru Windows: o fereastra dedicata pentru reelfren.net,
// cu aceleasi protectii ca aplicatia Android (linkuri externe, pop-up-uri, reclame).
const { app, BrowserWindow, session, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const HOME_URL = 'https://reelfren.net/';
const ALLOWED_DOMAINS = ['reelfren.net'];
const AD_HOSTS = [
  'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
  'popads.net', 'popcash.net', 'propellerads.com', 'propellerclick.com', 'onclickads.net', 'onclkds.com',
  'adsterra.com', 'adsterratech.com', 'monetag.com', 'exoclick.com', 'exosrv.com', 'juicyads.com',
  'trafficjunky.net', 'hilltopads.net', 'hilltopads.com', 'a-ads.com', 'clickadu.com', 'galaksion.com',
  'richpush.co', 'pushhouse.io', 'evadav.com', 'adcash.com', 'admaven.com', 'ad-maven.com',
  'adskeeper.com', 'mgid.com', 'taboola.com', 'outbrain.com', 'revcontent.com', 'zeropark.com',
  'adnium.com', 'trafficstars.com', 'tsyndicate.com', 'realsrv.com', 'a-mo.net', 'bidvertiser.com',
  'pushame.com', 'pushnow.net', 'notix.io', 'sendpulse.com', 'onesignal.com', 'highperformanceformat.com',
  'profitablegatecpm.com', 'effectivegatecpm.com', 'profitablecpmrate.com', 'displaycontentnetwork.com',
  'adtrafficquality.google', 'amazon-adsystem.com', 'criteo.com', 'pubmatic.com', 'rubiconproject.com'
];

function hostMatches(host, list) {
  host = (host || '').toLowerCase();
  return list.some((d) => host === d || host.endsWith('.' + d));
}
function isAllowed(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') && hostMatches(u.hostname, ALLOWED_DOMAINS);
  } catch (e) {
    return false;
  }
}

function readShared(name) {
  try { return fs.readFileSync(path.join(__dirname, 'shared', name), 'utf8'); } catch (e) { return ''; }
}
function readLocal(name) {
  try { return fs.readFileSync(path.join(__dirname, name), 'utf8'); } catch (e) { return ''; }
}

// Scripturile rulate in pagina, in ordine: puntea de mesaje, player, reclame, filtru, tastatura.
const BRIDGE_SHIM =
  'if(!window.RFBridge){window.RFBridge={onmessage:null,postMessage:function(m){window.postMessage({__rfOut:String(m)},"*");}};}';
const PAGE_SCRIPT = [BRIDGE_SHIM, readShared('player.js'), readShared('adblock.js'),
  readShared('filter.js'), readLocal('desktop.js')].join('\n;\n');

// Fereastra isi aminteste marimea si pozitia.
const stateFile = () => path.join(app.getPath('userData'), 'window.json');
function loadBounds() {
  try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return { width: 1280, height: 860 }; }
}
function saveBounds(win) {
  try {
    if (!win.isFullScreen() && !win.isMinimized()) {
      fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getBounds(), maximized: win.isMaximized() }));
    }
  } catch (e) { /* nu e grav */ }
}

let win = null;

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width || 1280, height: b.height || 860,
    minWidth: 400, minHeight: 500,
    title: 'ReelFren',
    backgroundColor: '#101014',
    icon: path.join(__dirname, 'build', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (b.maximized) win.maximize();

  const wc = win.webContents;

  // Pop-up-uri: blocate. Linkurile din site deschise "in fereastra noua" se deschid aici.
  wc.setWindowOpenHandler(({ url }) => {
    if (isAllowed(url)) wc.loadURL(url);
    return { action: 'deny' };
  });
  // Navigare spre alte domenii (reclame, redirecturi): blocata.
  const guard = (e, url) => { if (!isAllowed(url)) e.preventDefault(); };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', (e, url, isInPlace, isMainFrame) => { if (isMainFrame) guard(e, url); });

  // F11 = ecran complet, Esc = iesire din ecran complet
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'Escape' && win.isFullScreen()) { win.setFullScreen(false); e.preventDefault(); }
    else if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); e.preventDefault(); }
  });

  win.on('close', () => saveBounds(win));
  win.on('page-title-updated', (e) => { e.preventDefault(); win.setTitle('ReelFren'); });

  wc.loadURL(HOME_URL);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    const ses = session.defaultSession;
    // Ne prezentam ca un Chrome obisnuit (unele site-uri refuza aplicatiile).
    ses.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
      process.versions.chrome + ' Safari/537.36');
    // Cererile spre retele de reclame cunoscute sunt anulate.
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
      let host = '';
      try { host = new URL(details.url).hostname; } catch (e) { /* ignore */ }
      cb({ cancel: hostMatches(host, AD_HOSTS) });
    });
    // Notificari, locatie etc.: refuzate (site-urile de reclame le cer des).
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'fullscreen'));

    ipcMain.on('rf:scripts', (e) => { e.returnValue = PAGE_SCRIPT; });
    ipcMain.on('rf:fs', (e, on) => { if (win) win.setFullScreen(!!on); });

    createWindow();
  });

  app.on('window-all-closed', () => app.quit());
}
