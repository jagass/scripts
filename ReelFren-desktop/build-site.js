// Construieste exe-ul portabil pentru un site: node build-site.js shortmax
const path = require('path');
const site = process.argv[2] || process.env.SITE || 'reelfren';
process.env.SITE = site;
require('./copy-shared.js');
const cfg = require(path.join(__dirname, 'sites', site + '.json'));
const builder = require('electron-builder');
builder.build({
  targets: builder.Platform.WINDOWS.createTarget('portable', builder.Arch.x64),
  config: {
    appId: cfg.appId,
    productName: cfg.productName,
    directories: { output: 'dist' },
    files: ['main.js', 'preload.js', 'desktop.js', 'hls-shim.js', 'hub.js', 'site.json', 'shared/**', cfg.icon],
    win: { target: 'portable', icon: cfg.icon },
    portable: { artifactName: cfg.productName + '.exe' },
  },
}).then((out) => console.log('built:', out.join(', ')))
  .catch((e) => { console.error(e); process.exit(1); });
