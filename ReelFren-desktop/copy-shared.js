// Copiaza scripturile comune (filtru, blocare reclame, player) din aplicatia Android.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'ReelFren', 'app', 'src', 'main', 'assets');
const dst = path.join(__dirname, 'shared');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['player.js', 'filter.js', 'adblock.js']) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
console.log('shared scripts copied');
