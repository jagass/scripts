// Fereastra dedicata pentru un site de seriale (ReelFren, ShortMax...), cu aceleasi protectii
// ca aplicatia Android: linkuri externe, pop-up-uri si reclame blocate. Site-ul vine din site.json.
const { app, BrowserWindow, session, ipcMain, Menu, protocol, net, clipboard } = require('electron');
const { Hub } = require('./hub.js');
const path = require('path');
const fs = require('fs');

const SITE = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'site.json'), 'utf8')); } catch (e) {
    return { productName: 'ReelFren', home: 'https://reelfren.net/', domains: ['reelfren.net'], icon: 'build/icon.png' };
  }
})();
const HOME_URL = SITE.home;
const ALLOWED_DOMAINS = SITE.domains;
const APP_NAME = SITE.productName;
// DramaFren: lista comuna de filme din mai multe site-uri (pagina din aplicatie + robot), vezi hub.js
const HUB = !!SITE.hub;
const CATALOG_URL = 'dfapp://app/catalog.html';
if (HUB) {
  protocol.registerSchemesAsPrivileged([{ scheme: 'dfapp', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

// fiecare aplicatie are datele ei separate (login, cookie-uri, marimea ferestrei)
app.setName(APP_NAME);
app.setPath('userData', path.join(app.getPath('appData'), APP_NAME));
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
// Site-uri deschise de tine printr-un clic pe un link (ex. alta platforma din meniul site-ului).
const userAllowedHosts = new Set();
let lastClick = { host: '', at: 0 };   // ultimul link pe care ai dat clic (trimis din pagina)
let lastUserNav = 0;                   // redirecturile imediat dupa un clic al tau sunt permise

function isAllowed(url) {
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') &&
      (hostMatches(u.hostname, ALLOWED_DOMAINS) || hostMatches(u.hostname, [...userAllowedHosts]));
  } catch (e) {
    return false;
  }
}

// adresa vine dintr-un clic recent al tau pe un link catre acelasi site?
function fromUserClick(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    const now = Date.now();
    if (host === lastClick.host && now - lastClick.at < 4000) return true;
    return now - lastUserNav < 5000 && lastUserNav > 0 && lastClick.host !== '' && now - lastClick.at < 8000;
  } catch (e) {
    return false;
  }
}
function allowByUser(url) {
  try { userAllowedHosts.add(new URL(url).hostname.toLowerCase()); } catch (e) { /* ignore */ }
  lastUserNav = Date.now();
}

function readShared(name) {
  try { return fs.readFileSync(path.join(__dirname, 'shared', name), 'utf8'); } catch (e) { return ''; }
}
function readLocal(name) {
  try { return fs.readFileSync(path.join(__dirname, name), 'utf8'); } catch (e) { return ''; }
}

// Scripturile rulate in pagina, in ordine: puntea de mesaje, player, reclame, filtru, tastatura.
const BRIDGE_SHIM =
  'if(!window.RFBridge){window.RFBridge={onmessage:null,postMessage:function(m){window.postMessage({__rfOut:String(m)},"*");}};' +
  // mesajele de la aplicatie catre pagina (lista DramaFren)
  'window.addEventListener("message",function(e){if(e.data&&typeof e.data.__rfIn==="string"&&typeof window.RFBridge.onmessage==="function")window.RFBridge.onmessage({data:e.data.__rfIn});});}';
// hls.js e incarcat sub alt nume (__RfHls), ca sa nu se amestece cu un eventual hls.js al site-ului
const HLS_LIB = '(function(){var module={exports:{}};var exports=module.exports;var define;\n' +
  readShared('hls.min.js') + '\n;window.__RfHls=module.exports;})();';
const PAGE_SCRIPT = [BRIDGE_SHIM, HLS_LIB, readLocal('hls-shim.js'), readShared('player.js'), readShared('adblock.js')]
  .concat(HUB ? [readShared('agg.js')] : [readShared('filter.js'), readShared('epcheck.js')])
  .concat([readLocal('desktop.js')]).join('\n;\n');
// scripturi in plus pentru o anumita pagina (ex. robotul: window.__dfCrawl=1), rulate inaintea celorlalte
const extraByWc = new Map();
let catalogWcId = -1;

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
const challengeByWc = new Map();

// Blocarea reclamelor se poate opri din pagina (unele episoade pornesc doar dupa reclama site-ului).
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
let adblockOn = true;
function loadSettings() {
  try { adblockOn = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')).adblock !== false; } catch (e) { adblockOn = true; }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify({ adblock: adblockOn })); } catch (e) { /* nu e grav */ }
}

// Identificare exact ca un Chrome obisnuit pe Windows (fara "Electron" / numele aplicatiei,
// cu versiunea scurtata cum o trimite Chrome). Se aplica peste tot, inclusiv verificarii Cloudflare.
const CHROME_MAJOR = String(process.versions.chrome || '130').split('.')[0];
const CLEAN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
  CHROME_MAJOR + '.0.0.0 Safari/537.36';
app.userAgentFallback = CLEAN_UA;

// Fereastra principala (lista de seriale) sau o fereastra noua pentru un serial (isChild):
// lista ramane incarcata in fereastra principala cat timp te uiti la serial.
function createWindow(url, isChild, extraJs) {
  const b = loadBounds();
  const main = !isChild;
  let pos = {};
  if (isChild && win && !win.isDestroyed()) {
    const pb = win.getBounds();
    pos = { x: pb.x + 30, y: pb.y + 30, width: pb.width, height: pb.height };
  } else if (main) {
    pos = { x: b.x, y: b.y, width: b.width || 1280, height: b.height || 860 };
  }
  const w = new BrowserWindow({
    ...pos,
    minWidth: 400, minHeight: 500,
    title: APP_NAME,
    backgroundColor: '#101014',
    icon: path.join(__dirname, SITE.icon || 'build/icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (main) {
    win = w;
    if (b.maximized) w.maximize();
  } else if (win && !win.isDestroyed() && win.isMaximized()) {
    w.maximize();
  }

  const wc = w.webContents;
  if (extraJs) extraByWc.set(wc.id, extraJs);
  if (isChild) childWindows.push(w);
  attachGuards(wc);

  // Pop-up-uri: blocate. Linkurile din site deschise "in fereastra noua" se deschid aici.
  wc.setWindowOpenHandler(({ url: u }) => {
    if (isAllowed(u)) wc.loadURL(u);
    else if (fromUserClick(u)) { allowByUser(u); wc.loadURL(u); }
    return { action: 'deny' };
  });
  // F11 = ecran complet, Esc = iesire din ecran complet (in fereastra unui serial: inchide si revine la lista)
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') { w.setFullScreen(!w.isFullScreen()); e.preventDefault(); }
    else if (input.key === 'Escape' && w.isFullScreen()) { w.setFullScreen(false); e.preventDefault(); }
    else if (input.key === 'Escape' && isChild) { w.close(); e.preventDefault(); }
    else if (input.key === 'F5') { wc.reload(); e.preventDefault(); }
    else if (input.key === 'F12') { wc.toggleDevTools(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); e.preventDefault(); }
  });

  if (main) w.on('close', () => {
    saveBounds(w);
    if (hub) { hub.stopCrawl(); hub.saveNow(); }
    BrowserWindow.getAllWindows().forEach((o) => { if (o !== w) o.destroy(); });
  });
  w.on('closed', () => {
    const i = childWindows.indexOf(w);
    if (i >= 0) childWindows.splice(i, 1);
    if (isChild && win && !win.isDestroyed()) win.focus();
  });
  w.on('page-title-updated', (e) => { e.preventDefault(); w.setTitle(APP_NAME); });

  wc.loadURL(url || (HUB ? CATALOG_URL : HOME_URL));
  return w;
}

const childWindows = [];
const pageStart = new Map(); // wc.id -> cand a inceput pagina (redirecturile imediate ale site-ului sunt permise)

// Navigare spre alte domenii (reclame, redirecturi): blocata.
function attachGuards(wc) {
  wc.on('did-start-loading', () => pageStart.set(wc.id, Date.now()));
  const guard = (e, u) => {
    if (isAllowed(u)) return;
    if (fromUserClick(u)) { allowByUser(u); return; }
    // DramaFren: un site din lista care te muta singur pe alta adresa (ex. dupa verificarea Cloudflare)
    if (HUB && hub && isAllowed(wc.getURL()) && !hostMatches(hostOf(u), AD_HOSTS) &&
        Date.now() - (pageStart.get(wc.id) || 0) < 20000 && /^https?:/.test(u)) {
      userAllowedHosts.add(hostOf(u));
      hub.onMoved(wc.getURL(), u);
      return;
    }
    e.preventDefault();
    let host = u;
    try { host = new URL(u).hostname; } catch (err) { /* ignore */ }
    wc.executeJavaScript('(function(){var d=document.createElement("div");d.textContent=' + JSON.stringify('Link extern blocat: ' + host) +
      ';d.style.cssText="position:fixed;left:50%;top:16px;transform:translateX(-50%);z-index:2147483647;background:rgba(0,0,0,.8);color:#fff;' +
      'font:14px system-ui;padding:8px 14px;border-radius:10px;pointer-events:none";document.body.appendChild(d);setTimeout(function(){d.remove()},2500)})()')
      .catch(() => {});
  };
  wc.on('will-navigate', guard);
  wc.on('will-redirect', (e, u, isInPlace, isMainFrame) => { if (isMainFrame) guard(e, u); });
}

function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch (e) { return ''; } }

// ------------------------------------------------------------------ DramaFren (hub)
let hub = null;
const tabWanted = new Map(); // wc.id -> [url, cand] (ce site a cerut fereastra deschisa din lista)
let hasher = null, hashSeq = 0;
const hashWait = new Map();

// paginile ascunse (robotul si cautarea): ferestre invizibile, fara sunet
function createHidden() {
  const w = new BrowserWindow({
    show: false, width: 1100, height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
  });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // verificarea Cloudflare care nu trece singura (cere clic): dupa 25 s sarim site-ul
  w.webContents.on('did-finish-load', () => {
    const wc = w.webContents, url = wc.getURL();
    if (!challengeByWc.get(wc.id)) return;
    setTimeout(() => {
      if (!w.isDestroyed() && challengeByWc.get(wc.id) && wc.getURL() === url && hub) hub.skipStuck(w, url);
    }, 25000);
  });
  attachGuards(w.webContents);
  return w;
}

// amprenta posterului se calculeaza intr-o pagina ascunsa (decodeaza si webp/avif, ca browserul)
const HASHER_HTML = '<!doctype html><script>const {ipcRenderer}=require("electron");' +
  'ipcRenderer.on("hash",async(e,id,buf)=>{try{const b=await createImageBitmap(new Blob([buf]));' +
  'const m=new OffscreenCanvas(64,64),mx=m.getContext("2d");mx.imageSmoothingQuality="high";mx.drawImage(b,0,0,64,64);' +
  'const c=new OffscreenCanvas(9,8),x=c.getContext("2d");x.imageSmoothingQuality="high";x.drawImage(m,0,0,9,8);' +
  'const d=x.getImageData(0,0,9,8).data;let hi=0,lo=0;' +
  'for(let y=0;y<8;y++)for(let i=0;i<8;i++){const p=(y*9+i)*4,q=p+4;' +
  'const g1=(d[p]*299+d[p+1]*587+d[p+2]*114)/1000,g2=(d[q]*299+d[q+1]*587+d[q+2]*114)/1000;const bit=y*8+i;' +
  'if(g1>g2){if(bit<32)lo=(lo|(1<<bit))>>>0;else hi=(hi|(1<<(bit-32)))>>>0;}}' +
  'ipcRenderer.send("hashed",id,hi.toString(16).padStart(8,"0")+lo.toString(16).padStart(8,"0"));}' +
  'catch(err){ipcRenderer.send("hashed",id,null);}});</script>';
function hashImage(buf) {
  if (!hasher || hasher.isDestroyed()) {
    hasher = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false } });
    hasher.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(HASHER_HTML));
  }
  return new Promise((resolve) => {
    const id = ++hashSeq;
    hashWait.set(id, resolve);
    const send = () => hasher.webContents.send('hash', id, buf);
    if (hasher.webContents.isLoading()) hasher.webContents.once('did-finish-load', send); else send();
    setTimeout(() => { if (hashWait.has(id)) { hashWait.delete(id); resolve(null); } }, 20000);
  });
}
async function fetchImage(url, referer) {
  const r = await net.fetch(url, { headers: { Referer: referer, Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
  if (!r.ok) throw new Error('http ' + r.status);
  const b = Buffer.from(await r.arrayBuffer());
  if (b.length > 6000000) throw new Error('too big');
  return b;
}

function toCatalog(msg) {
  if (win && !win.isDestroyed()) win.webContents.send('rf:in', msg);
}

function setupHub() {
  let brokenWc = null;
  hub = new Hub(app.getPath('userData'), {
    createCrawler: () => createHidden(),
    createSearcher: () => createHidden(),
    loadWith: (w, startJs, url) => {
      if (!w || w.isDestroyed()) return;
      if (startJs) extraByWc.set(w.webContents.id, startJs); else extraByWc.delete(w.webContents.id);
      w.webContents.loadURL(url).catch(() => {});
    },
    destroyHidden: (w) => { if (w && !w.isDestroyed()) { extraByWc.delete(w.webContents.id); w.destroy(); } },
    closeTop: () => {
      const w = brokenWc ? BrowserWindow.fromWebContents(brokenWc) : childWindows[childWindows.length - 1];
      if (w && w !== win && !w.isDestroyed()) w.close();
    },
    toCatalog,
    openUrl: (url, openJs) => {
      userAllowedHosts.add(hostOf(url));
      const w = createWindow(url, true, openJs);
      tabWanted.set(w.webContents.id, [url, Date.now()]);
    },
    allowHost: (h) => userAllowedHosts.add(h),
    copyText: (t) => clipboard.writeText(t),
    toast: (t) => toCatalog('hub:toast:' + t),
    fetchImage,
    hashImage,
  });
  ipcMain.on('hashed', (e, id, hex) => { const r = hashWait.get(id); if (r) { hashWait.delete(id); r(hex); } });
  ipcMain.on('rf:hub', (e, m) => {
    const wc = e.sender;
    if (m.startsWith('hub:broken:')) {
      const w = BrowserWindow.fromWebContents(wc);
      if (w && childWindows.includes(w)) { brokenWc = wc; hub.onBroken(m.slice(11)); brokenWc = null; }
      return;
    }
    if (m.startsWith('hub:report:')) {
      const hw = BrowserWindow.fromWebContents(wc);
      const want = tabWanted.get(wc.id);
      hub.onReport(m.slice(11), hw, want ? want[0] : null, want ? want[1] : 0);
      return;
    }
    if (wc.id === catalogWcId || (win && !win.isDestroyed() && wc === win.webContents)) hub.onCommand(m.slice(4));
  });

  // pagina listei si posterele care nu se incarca direct (cerute cu adresa site-ului ca referinta)
  protocol.handle('dfapp', async (req) => {
    const u = new URL(req.url);
    if (u.pathname === '/img') {
      const img = u.searchParams.get('u') || '', k = u.searchParams.get('k') || '';
      const host = k.indexOf('|') > 0 ? k.slice(0, k.indexOf('|')) : hostOf(img);
      try { return new Response(await fetchImage(img, 'https://' + host + '/'), { headers: { 'content-type': 'image/jpeg' } }); }
      catch (e) { return new Response('', { status: 404 }); }
    }
    try {
      return new Response(fs.readFileSync(path.join(__dirname, 'shared', 'catalog.html')), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    } catch (e) { return new Response('', { status: 404 }); }
  });
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
    ses.setUserAgent(CLEAN_UA);
    // Cererile spre retele de reclame cunoscute sunt anulate. Filtrul e doar pe adresele lor,
    // ca restul (ex. sutele de bucati ale unui episod) sa nu treaca prin aplicatie si sa nu incetineasca.
    const adUrls = [];
    AD_HOSTS.forEach((h) => { adUrls.push('*://' + h + '/*', '*://*.' + h + '/*'); });
    loadSettings();
    ses.webRequest.onBeforeRequest({ urls: adUrls }, (details, cb) => cb({ cancel: adblockOn }));

    // 1) Pagina de verificare Cloudflare se recunoaste dupa raspunsul serverului ("cf-mitigated: challenge").
    //    Pe ea nu punem niciun script (altfel Cloudflare crede ca e un robot si cere verificarea la nesfarsit).
    // 2) Fisierele video (.m3u8 si bucatile episodului) sunt cerute de playerul HLS din pagina; serverele video
    //    nu trimit de obicei permisiunea CORS (pe telefon nu e nevoie de ea), asa ca o adaugam noi.
    const hasHeader = (h, name) => Object.keys(h).some((k) => k.toLowerCase() === name);
    ses.webRequest.onHeadersReceived({ urls: ['*://*/*'] }, (d, cb) => {
      const h = d.responseHeaders || {};
      if (d.resourceType === 'mainFrame') {
        if (isAllowed(d.url)) {
          const isChallenge = Object.keys(h).some((k) => k.toLowerCase() === 'cf-mitigated' &&
            String(h[k]).toLowerCase().indexOf('challenge') >= 0);
          challengeByWc.set(d.webContentsId, isChallenge);
        }
        return cb({});
      }
      if ((d.resourceType === 'xhr' || d.resourceType === 'fetch' || d.resourceType === 'media') &&
          !isAllowed(d.url) && !hasHeader(h, 'access-control-allow-origin')) {
        const nh = Object.assign({}, h);
        nh['Access-Control-Allow-Origin'] = ['*'];
        if (d.method === 'OPTIONS') {
          nh['Access-Control-Allow-Headers'] = ['*'];
          nh['Access-Control-Allow-Methods'] = ['GET, HEAD, OPTIONS'];
        }
        return cb({ responseHeaders: nh });
      }
      cb({});
    });

    // Notificari, locatie etc.: refuzate (site-urile de reclame le cer des).
    ses.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'fullscreen'));

    ipcMain.on('rf:scripts', (e) => {
      // lista DramaFren (pagina din aplicatie): doar puntea de mesaje
      if (HUB && (e.sender.getURL().startsWith('dfapp:') || (win && !win.isDestroyed() && e.sender === win.webContents))) {
        catalogWcId = e.sender.id; e.returnValue = BRIDGE_SHIM; return;
      }
      e.returnValue = challengeByWc.get(e.sender.id) ? '' : (extraByWc.get(e.sender.id) || '') + '\n;' +
        (adblockOn ? '' : 'window.__rfAdOff=true;\n') + PAGE_SCRIPT;
    });
    ipcMain.on('rf:fs', (e, on) => {
      const w = BrowserWindow.fromWebContents(e.sender);
      if (w) w.setFullScreen(!!on);
    });
    // un serial atins in lista: se deschide intr-o fereastra noua, lista ramane incarcata
    ipcMain.on('rf:open', (e, url) => { if (isAllowed(url)) createWindow(url, true); });
    ipcMain.on('rf:adblock', (e) => {
      adblockOn = !adblockOn;
      saveSettings();
      e.sender.reload();
    });
    ipcMain.on('rf:click', (e, url) => {
      try { lastClick = { host: new URL(url).hostname.toLowerCase(), at: Date.now() }; } catch (err) { /* ignore */ }
    });

    if (HUB) setupHub();
    createWindow(HUB ? CATALOG_URL : HOME_URL, false);
  });

  app.on('window-all-closed', () => app.quit());
}
