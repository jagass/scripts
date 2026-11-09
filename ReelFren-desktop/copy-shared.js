// Pregateste aplicatia pentru un site: copiaza scripturile comune (din aplicatia Android)
// si configuratia site-ului ales (SITE=reelfren | shortmax) in site.json.
const fs = require('fs');
const path = require('path');
const site = process.env.SITE || process.argv[2] || 'reelfren';
const src = path.join(__dirname, '..', 'ReelFren', 'app', 'src', 'main', 'assets');
const dst = path.join(__dirname, 'shared');
fs.mkdirSync(dst, { recursive: true });
for (const f of ['player.js', 'filter.js', 'adblock.js', 'epcheck.js', 'agg.js', 'catalog.html']) {
  fs.copyFileSync(path.join(src, f), path.join(dst, f));
}
fs.copyFileSync(path.join(__dirname, 'sites', site + '.json'), path.join(__dirname, 'site.json'));
// hls.js: redarea episoadelor .m3u8 pe desktop
fs.copyFileSync(require.resolve('hls.js/dist/hls.min.js'), path.join(dst, 'hls.min.js'));
console.log('prepared for site:', site);
