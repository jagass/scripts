// DramaFren pe desktop: lista comuna de filme de pe toate site-urile (aceeasi logica ca Hub.java din
// aplicatia Android). Primeste filmele gasite de agg.js, descopera site-uri noi, grupeaza posterele
// identice (dHash) pastrand varianta cu cele mai multe episoade, conduce robotul si cautarea pe site-uri.
'use strict';
const fs = require('fs');
const path = require('path');

const SEEDS = [
  'https://idrama.dramafren.org/', 'https://dramafren.org/', 'https://dramabox.dramafren.org/',
  'https://dramawave.dramafren.org/', 'https://flickreels.dramafren.org/', 'https://goodshort.dramafren.org/',
  'https://netshort.dramafren.org/', 'https://radreel.dramafren.org/', 'https://shortmax.dramafren.org/',
  'https://stardusttv.dramafren.org/', 'https://viglo.dramafren.org/',
];
const MAX_PAGES_PER_HOST = 150;
const SAME_DIST = 5;
const DEEP_WORDS = ['ceo', 'love', 'wife', 'husband', 'marriage', 'divorce', 'revenge', 'billionaire', 'boss', 'heir',
  'secret', 'baby', 'mafia', 'alpha', 'werewolf', 'vampire', 'princess', 'queen', 'king', 'doctor',
  'rich', 'return', 'reborn', 'betray', 'contract', 'pregnant', 'twins', 'daughter', 'son', 'mother',
  'bride', 'ex', 'regret', 'hidden', 'fake', 'destiny', 'dragon', 'god', 'war', 'lucky',
  'sweet', 'hate', 'fall', 'night', 'heart', 'girl', 'man', 'life', 'family', 'the'];
const ROMANCE_WORDS = ['passion', 'desire', 'seduce', 'seduction', 'lust', 'steamy', 'forbidden', 'affair', 'one night',
  'night stand', 'temptation', 'tempt', 'sinful', 'sin', 'bed', 'hot', 'kiss', 'lover', 'mistress',
  'obsession', 'obsessed', 'addicted', 'dirty', 'pleasure', 'sexy', 'intimate', 'erotic', 'crave',
  'possess', 'possessive', 'touch', 'naughty', 'wild', 'lingerie', 'spicy', 'night with', 'hookup',
  'bad boy', 'stepbrother', 'bodyguard', 'professor', 'my boss', 'secret lover', 'dangerous', 'claim',
  'pregnant by', 'contract lover', 'sugar daddy', 'heat', 'mate', 'submit', 'dominant', 'taboo'];

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; } }
function baseOf(host) { const p = String(host || '').split('.'); return p.length <= 2 ? host : p.slice(-2).join('.'); }

// amprenta pe 64 de biti, tinuta ca 16 caractere hex; comparatia pe doua jumatati de 32 de biti
function pop32(x) { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; }
function parts(hex) { return [parseInt(hex.slice(0, 8), 16) >>> 0, parseInt(hex.slice(8, 16), 16) >>> 0]; }
function bits(hex) { const p = parts(hex); return pop32(p[0]) + pop32(p[1]); }
function dist(a, b) { const x = parts(a), y = parts(b); return pop32((x[0] ^ y[0]) >>> 0) + pop32((x[1] ^ y[1]) >>> 0); }

class Hub {
  /**
   * owner: { createCrawler(), createSearcher(), loadWith(view, startJs, url), destroyHidden(view), closeTop(),
   *          toCatalog(msg), openUrl(url, openJs), allowHost(host), copyText(text), toast(text), fetchImage(url, referer) -> Promise<Buffer>,
   *          hashImage(buffer) -> Promise<hex|null> }
   */
  constructor(dir, owner) {
    this.owner = owner;
    this.file = path.join(dir, 'hub.json');
    this.sites = new Map();
    this.items = new Map();
    this.diag = new Map();
    // robot
    this.crawler = null; this.crawling = false; this.queue = []; this.visited = new Set(); this.perHost = new Map();
    this.current = ''; this.crawlPageAt = 0; this.pagesDone = 0; this.newThisRun = 0; this.timeout = null;
    // cautare
    this.searchers = []; this.searcherJob = new Map(); this.searcherFound = new Map(); this.searcherTimeout = new Map();
    this.searchQueue = []; this.deepEmpty = new Map(); this.searchQ = ''; this.searchTok = '';
    this.searchHits = new Set(); this.hitsQ = ''; this.searching = false; this.deep = false;
    this.searchTotal = 0; this.searchDone = 0; this.searchFound = 0;
    // amprente
    this.hashing = 0; this.hashQueue = []; this.hashActive = 0;
    this.pushTimer = null; this.saveTimer = null; this.lastPush = 0;
    this.lastOpened = ''; this.lastOpenAt = 0;
    // "Verifica toate": site-urile deschise pe rand pentru verificarea Cloudflare
    this.verifyQueue = []; this.verifyHost = ''; this.verifyTotal = 0; this.verifyDone = 0; this.verifyTimer = null;
    this.load();
    SEEDS.forEach((s) => this.addSite(s, '', false));
    this.removeJunkSites();
    for (const h of this.sites.keys()) owner.allowHost(h);
    for (const it of this.items.values()) if (it.hs === 0 || it.hs === 3) { it.hs = 0; this.queueHash(it); }
  }

  // ---------------------------------------------------------------- date
  addSite(url, label, fromCrawl) {
    const h = hostOf(url);
    if (!h) return null;
    let s = this.sites.get(h);
    if (s) return s;
    s = { host: h, url, label: label || '', status: '', searchUrl: '', on: true, count: 0 };
    this.sites.set(h, s);
    this.owner.allowHost(h);
    if (fromCrawl && this.crawling) this.enqueue(url);
    return s;
  }

  onReport(json, from, wantedUrl, openedAt) {
    const fromCrawler = from != null && from === this.crawler;
    const fromSearch = from != null && this.searchers.includes(from);
    let r;
    try { r = JSON.parse(json); } catch (e) { return; }
    const host = r.host || '', page = r.url || '';
    let site = this.sites.get(host);
    if (!site) {
      if (!host.endsWith('dramafren.org')) return;
      site = this.addSite('https://' + host + '/', '', false);
    }
    const now = Date.now();
    const want = fromCrawler ? this.current : (fromSearch ? null : wantedUrl);
    if (fromCrawler) openedAt = this.crawlPageAt;
    if (want && now - openedAt < 60000) {
      const ws = this.sites.get(hostOf(want));
      if (ws && ws !== site && ws.status !== 'ok' && ws.status !== 'mutat:' + host) {
        ws.status = 'mutat:' + host; this.scheduleSave(); this.schedulePush();
      }
    }
    let changed = false;
    const its = Array.isArray(r.items) ? r.items : [];
    for (const o of its) {
      if (!o) continue;
      const n = o.key || '', img = o.img || '', title = String(o.title || '').trim();
      if (!n || !img || !title) continue;
      const k = host + '|' + n;
      let it = this.items.get(k);
      const eps = +o.eps || 0, href = o.href || '', oc = o.oc || '';
      if (!it) {
        it = { k, host, n, img, title, eps, href, oc, page, t: now, h: '', hs: 0, bad: false };
        this.items.set(k, it);
        this.newThisRun++;
        if (fromSearch) { this.searchFound++; this.searcherFound.set(from, (this.searcherFound.get(from) || 0) + 1); }
        changed = true;
        this.queueHash(it);
      } else {
        if (eps > it.eps) { it.eps = eps; changed = true; }
        if (!it.href && href) { it.href = href; changed = true; }
        if (!it.oc && oc) it.oc = oc;
        if (it.title.length < 3 && title.length >= 3) { it.title = title; changed = true; }
      }
    }
    for (const o of (Array.isArray(r.sites) ? r.sites : [])) {
      if (o && o.host && !this.sites.has(o.host)) { this.addSite(o.url, o.label, true); changed = true; }
    }
    if (fromCrawler && this.crawling) (r.pages || []).forEach((p) => this.enqueue(p));
    if (r.diag) {
      const d = Object.assign({}, r.diag, { url: page, title: r.title || '' });
      this.diag.set(host, d);
      if (d.cf) site.status = 'cf';
      else if ((d.domCards || 0) + (d.jsonItems || 0) > 0) site.status = 'ok';
      else if (r.done) site.status = 'gol';
      else if (site.status === 'cf') site.status = '';
      if (this.verifyHost && !fromCrawler && !fromSearch && !d.cf
        && (host === this.verifyHost || hostOf(wantedUrl || '') === this.verifyHost)) {
        const vh = this.verifyHost;
        setTimeout(() => this.verifyNext(vh, true), 1500);
      }
    }
    if (its.length > 0 && site.status !== 'ok') { site.status = 'ok'; changed = true; }
    const job = fromSearch ? this.searcherJob.get(from) : null;
    if (job && Array.isArray(r.hits) && !this.deep && job.q === this.hitsQ) {
      const before = this.searchHits.size;
      r.hits.forEach((h) => this.searchHits.add(host + '|' + h));
      if (this.searchHits.size !== before) changed = true;
    }
    if (fromSearch && r.done && job) {
      if (host === job.site.host) {
        const su = r.searchUrl || '';
        if (su && su.indexOf('{q}') >= 0 && hostOf(su) === host && su !== site.searchUrl) { site.searchUrl = su; changed = true; }
      }
      clearTimeout(this.searcherTimeout.get(from));
      this.searcherTimeout.delete(from);
      setTimeout(() => this.jobDone(from), 200);
    }
    if (changed) { this.scheduleSave(); this.schedulePush(); }
    if (fromCrawler && this.crawling && r.done) {
      clearTimeout(this.timeout);
      this.timeout = setTimeout(() => this.next(), 400);
    }
  }

  // domeniile "de familie": cele de pornire + cele ale site-urilor care chiar au dat filme
  knownBases() {
    const b = new Set(SEEDS.map((s) => baseOf(hostOf(s))));
    for (const it of this.items.values()) b.add(baseOf(it.host));
    return b;
  }
  // mutarea pe alta adresa: doar spre un domeniu cunoscut (altfel e de obicei o reclama, ex. llmsitoken.com)
  acceptMove(toHost) { return !!toHost && this.knownBases().has(baseOf(toHost.toLowerCase())); }
  // scoate site-urile adaugate gresit dintr-o reclama: domeniu necunoscut, venite dintr-o "mutare", fara filme
  removeJunkSites() {
    const known = this.knownBases(), withItems = new Set([...this.items.values()].map((it) => it.host));
    const junk = [...this.sites.values()].filter((s) => this.sites.has(s.label) && !withItems.has(s.host)
      && s.status !== 'ok' && !known.has(baseOf(s.host))).map((s) => s.host);
    for (const h of junk) {
      this.sites.delete(h);
      for (const s of this.sites.values()) if (s.status === 'mutat:' + h) s.status = '';
    }
    if (junk.length) this.scheduleSave();
  }

  onMoved(fromUrl, toUrl) {
    const to = hostOf(toUrl);
    const from = this.sites.get(hostOf(fromUrl || ''));
    if (from && from.host !== to && from.status !== 'ok') from.status = 'mutat:' + to;
    if (!to || this.sites.has(to)) { this.scheduleSave(); this.schedulePush(); return; }
    const s = this.addSite(toUrl, from ? from.host : '', false);
    if (s) { s.url = toUrl; this.scheduleSave(); this.schedulePush(); }
  }

  // ---------------------------------------------------------------- robot
  enqueue(url) {
    if (!url || !/^http/.test(url)) return;
    url = url.split('#')[0];
    if (this.visited.has(url) || this.queue.includes(url)) return;
    const h = hostOf(url), s = this.sites.get(h);
    if (!s || !s.on) return;
    const c = this.perHost.get(h) || 0;
    if (c >= MAX_PAGES_PER_HOST) return;
    this.perHost.set(h, c + 1);
    this.queue.push(url);
  }
  startCrawl() {
    if (this.crawling) return;
    if (!this.crawler) this.crawler = this.owner.createCrawler();
    this.crawling = true;
    this.queue = []; this.visited.clear(); this.perHost.clear(); this.pagesDone = 0; this.newThisRun = 0;
    for (const s of this.sites.values()) if (s.on) this.enqueue(s.url);
    this.next();
  }
  stopCrawl() {
    if (!this.crawling) return;
    this.crawling = false;
    clearTimeout(this.timeout);
    if (this.crawler) this.owner.loadWith(this.crawler, null, 'about:blank');
    this.pushStatus('Oprit. ' + this.newThisRun + ' filme noi.');
  }
  next() {
    clearTimeout(this.timeout);
    if (!this.crawling) return;
    const url = this.queue.shift();
    if (!url) {
      this.crawling = false;
      if (this.crawler) this.owner.loadWith(this.crawler, null, 'about:blank');
      this.pushStatus('Gata: ' + this.pagesDone + ' pagini, ' + this.newThisRun + ' filme noi.');
      this.pushData();
      return;
    }
    this.visited.add(url);
    this.current = url; this.crawlPageAt = Date.now(); this.pagesDone++;
    this.owner.loadWith(this.crawler, 'window.__dfCrawl=1;', url);
    this.pushStatus(null);
    this.timeout = setTimeout(() => this.next(), 120000);
  }

  // ---------------------------------------------------------------- cautare pe site-uri
  searchableSites() { return [...this.sites.values()].filter((s) => s.on && !String(s.status).startsWith('mutat:')); }
  search(q) {
    q = String(q || '').trim();
    if (q.length < 2) return;
    if (this.searching && !this.deep && q.toLowerCase() === this.searchQ.toLowerCase()) return;
    this.cancelSearch();
    this.searchQ = q; this.hitsQ = q; this.searchHits.clear();
    this.searchableSites().forEach((s) => this.searchQueue.push({ site: s, q }));
    this.startSearch(false);
  }
  deepSearch(romanceOnly) {
    this.cancelSearch();
    this.searchQ = ''; this.deepEmpty.clear();
    const l = this.searchableSites();
    const words = romanceOnly ? ROMANCE_WORDS : ROMANCE_WORDS.concat(DEEP_WORDS);
    words.forEach((w) => l.forEach((s) => this.searchQueue.push({ site: s, q: w })));
    this.startSearch(true);
  }
  startSearch(isDeep) {
    this.deep = isDeep; this.searchTok = Date.now().toString(36); this.searching = true;
    this.searchTotal = this.searchQueue.length; this.searchDone = 0; this.searchFound = 0;
    const n = Math.min(3, this.searchTotal);
    while (this.searchers.length < n) this.searchers.push(this.owner.createSearcher());
    this.searchers.slice().forEach((w) => this.nextSearch(w));
    this.pushStatus(null);
  }
  cancelSearch() {
    this.searching = false; this.deep = false; this.searchQueue = [];
    for (const t of this.searcherTimeout.values()) clearTimeout(t);
    this.searcherTimeout.clear(); this.searcherJob.clear(); this.searcherFound.clear();
    this.searchers.forEach((w) => this.owner.destroyHidden(w));
    this.searchers = [];
  }
  stopSearch() {
    if (!this.searching) return;
    const found = this.searchFound;
    this.cancelSearch();
    this.pushStatus('Căutare oprită: ' + found + ' filme noi.');
    this.pushData();
  }
  jobDone(w) {
    const j = this.searcherJob.get(w);
    if (j && this.deep) {
      const f = this.searcherFound.get(w) || 0;
      if (f === 0) {
        const e = (this.deepEmpty.get(j.site.host) || 0) + 1;
        this.deepEmpty.set(j.site.host, e);
        if (e >= 3 && !j.site.searchUrl) {
          const before = this.searchQueue.length;
          this.searchQueue = this.searchQueue.filter((x) => x.site !== j.site);
          this.searchDone += before - this.searchQueue.length;
        }
      } else this.deepEmpty.set(j.site.host, -1000);
    }
    this.searchDone++;
    this.nextSearch(w);
    this.pushStatus(null);
  }
  nextSearch(w) {
    clearTimeout(this.searcherTimeout.get(w));
    this.searcherTimeout.delete(w);
    if (!this.searching) return;
    const j = this.searchQueue.shift();
    if (!j) {
      this.searcherJob.delete(w);
      if (this.searcherJob.size === 0) {
        const q = this.deep ? 'căutarea adâncă' : 'căutarea „' + this.searchQ + '”';
        const found = this.searchFound;
        this.cancelSearch();
        this.pushStatus('Gata ' + q + ' pe toate site-urile: ' + found + ' filme noi.');
        this.pushData();
      }
      return;
    }
    this.searcherJob.set(w, j);
    this.searcherFound.set(w, 0);
    const s = j.site;
    const url = s.searchUrl ? s.searchUrl.replace('{q}', encodeURIComponent(j.q).replace(/%20/g, '+')) : s.url;
    this.owner.loadWith(w, 'window.__dfSearch=' + JSON.stringify({ q: j.q, tok: this.searchTok + s.host + j.q }) + ';', url);
    this.searcherTimeout.set(w, setTimeout(() => this.jobDone(w), 40000));
  }

  /** Pagina ascunsa a ramas la verificarea Cloudflare: marcam site-ul si trecem mai departe. */
  skipStuck(view, url) {
    const s = this.sites.get(hostOf(url));
    if (s && s.status !== 'ok') { s.status = 'cf'; this.scheduleSave(); this.schedulePush(); }
    if (view === this.crawler && this.crawling) this.next();
    else if (this.searchers.includes(view) && this.searcherJob.has(view)) {
      clearTimeout(this.searcherTimeout.get(view)); this.searcherTimeout.delete(view);
      this.jobDone(view);
    }
  }

  pushStatus(text) {
    const cur = this.searcherJob.size ? this.searcherJob.values().next().value : null;
    this.owner.toCatalog('hub:status:' + JSON.stringify({
      crawling: this.crawling, host: this.crawling ? hostOf(this.current) : '', done: this.pagesDone,
      left: this.queue.length, added: this.newThisRun, hashing: this.hashing, text: text || '',
      searching: this.searching, deep: this.deep, sq: this.deep ? (cur ? cur.q : '') : this.searchQ,
      sdone: this.searchDone, stotal: this.searchTotal, sfound: this.searchFound,
      verifying: !!this.verifyHost || this.verifyQueue.length > 0, vhost: this.verifyHost,
      vdone: this.verifyDone, vtotal: this.verifyTotal,
    }));
  }

  // ---------------------------------------------------------------- amprenta posterelor
  queueHash(it) {
    if (it.hs !== 0) return;
    it.hs = 3; this.hashing++;
    this.hashQueue.push(it);
    this.pumpHash();
  }
  pumpHash() {
    while (this.hashActive < 3 && this.hashQueue.length) {
      const it = this.hashQueue.shift();
      this.hashActive++;
      this.owner.fetchImage(it.img, 'https://' + it.host + '/')
        .then((buf) => this.owner.hashImage(buf))
        .then((hex) => { it.h = hex || ''; it.hs = hex ? 1 : 2; })
        .catch(() => { it.hs = 2; })
        .then(() => { this.hashActive--; this.hashing--; this.scheduleSave(); this.schedulePush(); this.pumpHash(); });
    }
  }

  // ---------------------------------------------------------------- grupare
  buildGroups() {
    const list = [...this.items.values()];
    const n = list.length;
    const parent = new Int32Array(n);
    for (let i = 0; i < n; i++) parent[i] = i;
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
    const byImg = new Map();
    const bands = Array.from({ length: 8 }, () => new Map());
    for (let i = 0; i < n; i++) {
      const it = list[i];
      const prev = byImg.get(it.n);
      byImg.set(it.n, i);
      if (prev !== undefined) union(prev, i);
      if (it.hs !== 1) continue;
      const b = bits(it.h);
      if (b < 6 || b > 58) continue;
      for (let k = 0; k < 8; k++) {
        const key = it.h.substr(k * 2, 2);
        let bucket = bands[k].get(key);
        if (!bucket) { bucket = []; bands[k].set(key, bucket); }
        for (let j = Math.max(0, bucket.length - 400); j < bucket.length; j++) {
          if (dist(list[bucket[j]].h, it.h) <= SAME_DIST) union(bucket[j], i);
        }
        bucket.push(i);
      }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(list[i]);
    }
    for (const s of this.sites.values()) s.count = 0;
    const out = [];
    for (const g of groups.values()) {
      let best = null, first = Infinity;
      for (const it of g) {
        const s = this.sites.get(it.host);
        if (s) s.count++;
        if (s && !s.on) continue;
        first = Math.min(first, it.t);
        if (!best || (best.bad && !it.bad) || (it.bad === best.bad && (it.eps > best.eps || (it.eps === best.eps && it.href && !best.href)))) best = it;
      }
      if (!best) continue;
      const ks = best.hs === 1 ? ['h' + best.h] : [];
      const al = [];
      for (const it of g) {
        ks.push(it.k);
        if (it === best) continue;
        const s = this.sites.get(it.host);
        if (s && !s.on) continue;
        al.push([it.k, it.host, it.eps, it.title]);
      }
      const o = { k: best.k, ti: best.title, im: best.img, ep: best.eps, ho: best.host, t: first, ks };
      if (best.bad) o.bd = 1;
      if (al.length) o.al = al;
      out.push(o);
    }
    return out;
  }
  sitesJson() {
    return [...this.sites.values()].map((s) => ({ host: s.host, url: s.url, label: s.label, on: s.on, n: s.count, st: s.status }));
  }
  schedulePush() {
    clearTimeout(this.pushTimer);
    const base = this.searching ? (this.deep ? 10000 : 2500) : this.crawling ? 15000 : 3000;
    this.pushTimer = setTimeout(() => this.pushData(), Math.max(800, base - (Date.now() - this.lastPush)));
  }
  pushData() {
    clearTimeout(this.pushTimer);
    this.lastPush = Date.now();
    const o = { groups: this.buildGroups(), sites: this.sitesJson(), items: this.items.size, hq: this.hitsQ, hits: [...this.searchHits] };
    this.owner.toCatalog('hub:data:' + JSON.stringify(o));
    this.pushStatus(null);
  }

  // ---------------------------------------------------------------- comenzi din lista
  onCommand(cmd) {
    if (cmd === 'get') this.pushData();
    else if (cmd.startsWith('search:')) this.search(cmd.slice(7));
    else if (cmd === 'deep') this.deepSearch(false);
    else if (cmd === 'deepromance') this.deepSearch(true);
    else if (cmd === 'searchstop') this.stopSearch();
    else if (cmd === 'crawl') this.startCrawl();
    else if (cmd === 'stop') this.stopCrawl();
    else if (cmd.startsWith('open:')) { if (this.searching) this.stopSearch(); const it = this.items.get(cmd.slice(5)); if (it) this.openItem(it); }
    else if (cmd.startsWith('site:')) {
      const p = cmd.split(':');
      const act = p[1], s = this.sites.get(p.slice(2).join(':'));
      if (!s) return;
      if (act === 'on') s.on = true;
      else if (act === 'off') s.on = false;
      else if (act === 'open') { this.owner.openUrl(s.url, null); return; }
      else if (act === 'del') {
        this.sites.delete(s.host);
        for (const [k, it] of this.items) if (it.host === s.host) this.items.delete(k);
      }
      this.scheduleSave(); this.pushData();
    } else if (cmd.startsWith('addsite:')) {
      let url = cmd.slice(8).trim();
      if (!/^http/.test(url)) url = 'https://' + url;
      const s = this.addSite(url, '', false);
      if (s) { s.on = true; this.owner.toast('Site adăugat: ' + s.host); }
      this.scheduleSave(); this.pushData();
    } else if (cmd === 'diag') {
      this.owner.copyText(this.diagText());
      this.owner.toast('Diagnosticul e copiat. Lipește-l în chat.');
    } else if (cmd === 'verify') {
      this.startVerify();
    } else if (cmd === 'verifystop') {
      this.stopVerify(); this.owner.toast('Am oprit verificarea site-urilor.');
    } else if (cmd === 'clear' || cmd.startsWith('clear:')) {
      // filmele de la "De vazut" / "Vazute" (cheile trimise de lista) raman
      let keep = new Set();
      if (cmd.startsWith('clear:')) { try { keep = new Set(JSON.parse(cmd.slice(6))); } catch (e) { } }
      for (const k of [...this.items.keys()]) if (!keep.has(k)) this.items.delete(k);
      this.scheduleSave(); this.pushData();
    }
  }

  // ---------------------------------------------------------------- verifica toate site-urile
  startVerify() {
    this.stopVerify();
    const all = [...this.sites.values()].filter((s) => s.on && !String(s.status).startsWith('mutat:'));
    this.verifyQueue = all.filter((s) => s.status === 'cf').concat(all.filter((s) => s.status !== 'cf')).map((s) => s.host);
    this.verifyTotal = this.verifyQueue.length; this.verifyDone = 0;
    if (!this.verifyTotal) { this.owner.toast('Niciun site pornit.'); return; }
    this.owner.toast('Deschid pe rând ' + this.verifyTotal + ' site-uri. Dacă apare căsuța de verificare, bifeaz-o; trec singur la următorul.');
    this.verifyOpenNext();
  }
  verifyOpenNext() {
    clearTimeout(this.verifyTimer);
    let s = null;
    while (this.verifyQueue.length && !s) { s = this.sites.get(this.verifyQueue.shift()); if (!s) this.verifyDone++; }
    if (!s) {
      this.verifyHost = '';
      this.owner.toast('Gata: am trecut prin toate cele ' + this.verifyTotal + ' site-uri.');
      this.pushStatus(null); this.pushData();
      return;
    }
    this.verifyHost = s.host;
    this.owner.openUrl(s.url, null);
    this.verifyTimer = setTimeout(() => this.verifyNext(s.host, false), 60000);
    this.pushStatus(null);
  }
  verifyNext(h, ok) {
    if (!h || h !== this.verifyHost) return;
    clearTimeout(this.verifyTimer);
    this.verifyHost = ''; this.verifyDone++;
    if (!ok) this.owner.toast(h + ' nu s-a deschis în 60 de secunde. Trec la următorul.');
    this.owner.closeTop();
    setTimeout(() => this.verifyOpenNext(), 500);
  }
  stopVerify() {
    this.verifyQueue = []; clearTimeout(this.verifyTimer); this.verifyHost = ''; this.pushStatus(null);
  }
  openItem(it) {
    this.lastOpened = it.k; this.lastOpenAt = Date.now();
    if (it.href) { this.owner.openUrl(it.href, null); return; }
    const o = { tok: Date.now().toString(36), key: it.n, title: it.title, oc: it.oc };
    this.owner.openUrl(it.page || 'https://' + it.host + '/', 'window.__dfOpen=' + JSON.stringify(o) + ';');
  }
  sameDrama(it) {
    const l = [];
    for (const o of this.items.values()) {
      if (o === it || o.bad) continue;
      const s = this.sites.get(o.host);
      if (s && !s.on) continue;
      const same = o.n === it.n || (o.hs === 1 && it.hs === 1 && dist(o.h, it.h) <= SAME_DIST && bits(it.h) >= 6 && bits(it.h) <= 58);
      if (same) l.push(o);
    }
    return l.sort((a, b) => b.eps - a.eps);
  }
  onBroken(url) {
    let it = Date.now() - this.lastOpenAt < 600000 ? this.items.get(this.lastOpened) : null;
    if (!it) for (const o of this.items.values()) if (o.href && o.href === url) { it = o; break; }
    if (!it || it.bad) return;
    it.bad = true;
    this.scheduleSave(); this.schedulePush();
    const alts = this.sameDrama(it);
    this.owner.closeTop();
    if (alts.length) {
      this.owner.toast('Filmul nu e disponibil pe ' + it.host + '. Îl deschid de pe ' + alts[0].host + '.');
      this.openItem(alts[0]);
    } else {
      this.owner.toast('Filmul nu e disponibil pe ' + it.host + '. Îl caut pe celelalte site-uri…');
      this.owner.toCatalog('hub:setq:' + it.title);
      this.search(it.title);
    }
  }
  diagText() {
    const perSite = {};
    for (const s of this.sites.values()) perSite[s.host] = { on: s.on, n: s.count, st: s.status, url: s.url, diag: this.diag.get(s.host) };
    let noHash = 0, noLink = 0;
    for (const it of this.items.values()) { if (it.hs === 2) noHash++; if (!it.href) noLink++; }
    return JSON.stringify({ app: 'DramaFren desktop', items: this.items.size, sites: perSite, hashFailed: noHash, noLink }, null, 1);
  }

  // ---------------------------------------------------------------- salvare
  scheduleSave() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.saveNow(), 5000); }
  saveNow() {
    clearTimeout(this.saveTimer);
    const o = {
      sites: [...this.sites.values()].map((s) => ({ host: s.host, url: s.url, label: s.label, on: s.on, st: s.status, su: s.searchUrl })),
      items: [...this.items.values()].map((it) => [it.k, it.host, it.n, it.img, it.title, it.eps, it.href, it.oc, it.page, it.t,
        it.hs === 1 ? it.h : (it.hs === 2 ? 'x' : ''), it.bad ? 1 : 0]),
    };
    try {
      fs.writeFileSync(this.file + '.tmp', JSON.stringify(o));
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (e) { /* nu e grav */ }
  }
  load() {
    let o;
    try { o = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (e) { return; }
    (o.sites || []).forEach((x) => this.sites.set(x.host, { host: x.host, url: x.url || '', label: x.label || '', on: x.on !== false, status: x.st || '', searchUrl: x.su || '', count: 0 }));
    (o.items || []).forEach((a) => {
      const h = a[10] || '';
      this.items.set(a[0], { k: a[0], host: a[1], n: a[2], img: a[3], title: a[4], eps: a[5] || 0, href: a[6] || '', oc: a[7] || '',
        page: a[8] || '', t: a[9] || 0, h: h === 'x' ? '' : h, hs: h === 'x' ? 2 : (h ? 1 : 0), bad: a[11] === 1 });
    });
  }
}

module.exports = { Hub, hostOf };
