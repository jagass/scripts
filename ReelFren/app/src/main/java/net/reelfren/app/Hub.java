package net.reelfren.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * DramaFren: lista comuna de filme de pe toate site-urile.
 * - primeste filmele gasite de agg.js (din paginile deschise de tine si de "robot");
 * - descopera site-uri noi din meniurile site-urilor;
 * - calculeaza amprenta fiecarui poster (dHash) si grupeaza posterele identice,
 *   pastrand varianta cu cele mai multe episoade;
 * - conduce robotul (un WebView ascuns) care trece pe rand prin toate site-urile.
 */
class Hub {

    interface Owner {
        WebView createCrawler();
        /** o pagina ascunsa pentru cautare pe site-uri */
        WebView createSearcher();
        /** incarca url in pagina ascunsa, cu startJs rulat la inceputul fiecarei pagini (null = fara) */
        void loadWith(WebView w, String startJs, String url);
        void destroyHidden(WebView w);
        void toCatalog(String msg);
        void openUrl(String url, String openJs);
        void allowHost(String host);
        void copyText(String label, String text);
        void toast(String text);
    }

    /** Site-urile de pornire (restul se descopera singure din meniuri). */
    static final String[] SEEDS = {
            "https://idrama.dramafren.org/",
            "https://dramafren.org/",
            "https://dramabox.dramafren.org/",
            "https://dramawave.dramafren.org/",
            "https://flickreels.dramafren.org/",
            "https://goodshort.dramafren.org/",
            "https://netshort.dramafren.org/",
            "https://radreel.dramafren.org/",
            "https://shortmax.dramafren.org/",
            "https://stardusttv.dramafren.org/",
            "https://viglo.dramafren.org/",
    };

    private static final int MAX_PAGES_PER_HOST = 150;
    private static final int SAME_DIST = 5; // posterele cu cel mult 5 biti diferiti (din 64) = acelasi poster
    private static final String UA = "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";

    static class Site {
        String host, url, label = "", status = "";
        /** adresa paginii de rezultate, cu {q} in locul cuvintelor cautate (invatata la prima cautare) */
        String searchUrl = "";
        boolean on = true;
        int count;
    }

    static class Item {
        String k, host, n, img, title, href = "", oc = "", page = "";
        int eps;
        long t;
        long h;
        int hs; // 0 = fara amprenta, 1 = gata, 2 = esuat, 3 = in lucru
    }

    private final Context ctx;
    private final Owner owner;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final ExecutorService hashPool = Executors.newFixedThreadPool(2);
    private final File file;

    final Map<String, Site> sites = new LinkedHashMap<>();
    final Map<String, Item> items = new LinkedHashMap<>();
    private final Map<String, String> diag = new LinkedHashMap<>();

    // robotul
    private WebView crawler;
    private boolean crawling = false;
    private final ArrayDeque<String> queue = new ArrayDeque<>();
    private final Set<String> visited = new HashSet<>();
    private final Map<String, Integer> perHost = new HashMap<>();
    private String current = "";
    private long crawlPageAt = 0;
    private int pagesDone = 0;
    private int newThisRun = 0;
    private final Runnable timeout = this::next;
    private final Runnable push = () -> pushData(false);
    private final Runnable save = this::saveNow;
    private int hashing = 0;

    Hub(Context ctx, Owner owner) {
        this.ctx = ctx;
        this.owner = owner;
        this.file = new File(ctx.getFilesDir(), "hub.json");
        load();
        for (String s : SEEDS) addSite(s, "", false);
        for (String h : sites.keySet()) owner.allowHost(h);
        hashMissing();
    }

    // ------------------------------------------------------------------ date

    private static String hostOf(String url) {
        try { return new URL(url).getHost().toLowerCase(); } catch (Exception e) { return ""; }
    }

    private Site addSite(String url, String label, boolean fromCrawl) {
        String h = hostOf(url);
        if (h.isEmpty()) return null;
        Site s = sites.get(h);
        if (s != null) return s;
        s = new Site();
        s.host = h;
        s.url = url;
        s.label = label == null ? "" : label;
        sites.put(h, s);
        owner.allowHost(h);
        if (fromCrawl && crawling) enqueue(url);
        return s;
    }

    /** Un raport de la agg.js (pagina vizibila sau robotul). */
    // cautarea pe toate site-urile (si "cautarea adanca": multe cuvinte, pentru site-urile care au doar cautare)
    static final String[] DEEP_WORDS = {
            "ceo", "love", "wife", "husband", "marriage", "divorce", "revenge", "billionaire", "boss", "heir",
            "secret", "baby", "mafia", "alpha", "werewolf", "vampire", "princess", "queen", "king", "doctor",
            "rich", "return", "reborn", "betray", "contract", "pregnant", "twins", "daughter", "son", "mother",
            "bride", "ex", "regret", "hidden", "fake", "destiny", "dragon", "god", "war", "lucky",
            "sweet", "hate", "fall", "night", "heart", "girl", "man", "life", "family", "the"
    };

    /** Cuvinte din titlurile cu scene de iubire explicite / romantism pentru adulti. */
    static final String[] ROMANCE_WORDS = {
            "passion", "desire", "seduce", "seduction", "lust", "steamy", "forbidden", "affair", "one night",
            "night stand", "temptation", "tempt", "sinful", "sin", "bed", "hot", "kiss", "lover", "mistress",
            "obsession", "obsessed", "addicted", "dirty", "pleasure", "sexy", "intimate", "erotic", "crave",
            "possess", "possessive", "touch", "naughty", "wild", "lingerie", "spicy", "night with", "hookup",
            "bad boy", "stepbrother", "bodyguard", "professor", "my boss", "secret lover", "dangerous", "claim",
            "pregnant by", "contract lover", "sugar daddy", "heat", "mate", "submit", "dominant", "taboo"
    };

    private static class Job {
        final Site site; final String q;
        Job(Site site, String q) { this.site = site; this.q = q; }
    }

    private final List<WebView> searchers = new ArrayList<>();
    private final Map<WebView, Job> searcherJob = new HashMap<>();
    private final Map<WebView, Integer> searcherFound = new HashMap<>();
    private final Map<WebView, Runnable> searcherTimeout = new HashMap<>();
    private final ArrayDeque<Job> searchQueue = new ArrayDeque<>();
    private final Map<String, Integer> deepEmpty = new HashMap<>(); // site -> cautari fara niciun film
    private String searchQ = "", searchTok = "";
    private boolean searching = false, deep = false;
    private int searchTotal = 0, searchDone = 0, searchFound = 0;

    private List<Site> searchableSites() {
        List<Site> l = new ArrayList<>();
        for (Site s : sites.values()) if (s.on && !s.status.startsWith("mutat:")) l.add(s);
        return l;
    }

    void search(String q) {
        q = q.trim();
        if (q.length() < 2) return;
        if (searching && !deep && q.equalsIgnoreCase(searchQ)) return;
        cancelSearch();
        searchQ = q;
        for (Site s : searchableSites()) searchQueue.add(new Job(s, q));
        startSearch(false);
    }

    /** Cautare adanca: toate cuvintele din DEEP_WORDS pe toate site-urile (dureaza mult, merge in fundal). */
    void deepSearch(boolean romanceOnly) {
        cancelSearch();
        searchQ = "";
        deepEmpty.clear();
        List<Site> l = searchableSites();
        List<String> words = new ArrayList<>(java.util.Arrays.asList(ROMANCE_WORDS));
        if (!romanceOnly) words.addAll(java.util.Arrays.asList(DEEP_WORDS));
        for (String w : words) for (Site s : l) searchQueue.add(new Job(s, w));
        startSearch(true);
    }

    private void startSearch(boolean isDeep) {
        deep = isDeep;
        searchTok = Long.toString(System.nanoTime(), 36);
        searching = true;
        searchTotal = searchQueue.size();
        searchDone = 0;
        searchFound = 0;
        int n = Math.min(3, searchTotal);
        while (searchers.size() < n) searchers.add(owner.createSearcher());
        for (WebView w : new ArrayList<>(searchers)) nextSearch(w);
        pushStatus(null);
    }

    private void cancelSearch() {
        searching = false;
        deep = false;
        searchQueue.clear();
        for (Runnable r : searcherTimeout.values()) ui.removeCallbacks(r);
        searcherTimeout.clear();
        searcherJob.clear();
        searcherFound.clear();
        for (WebView w : searchers) owner.destroyHidden(w);
        searchers.clear();
    }

    void stopSearch() {
        if (!searching) return;
        int found = searchFound;
        cancelSearch();
        pushStatus("C\u0103utare oprit\u0103: " + found + " filme noi.");
        pushData(false);
    }

    /** Pagina ascunsa w a terminat (sau a expirat) cautarea curenta: trecem la urmatoarea. */
    private void jobDone(WebView w) {
        Job j = searcherJob.get(w);
        if (j != null && deep) {
            Integer f = searcherFound.get(w);
            if (f == null || f == 0) {
                int e = deepEmpty.getOrDefault(j.site.host, 0) + 1;
                deepEmpty.put(j.site.host, e);
                if (e >= 3 && j.site.searchUrl.isEmpty()) {
                    // site fara cautare (sau care nu raspunde): nu-l mai incercam cu celelalte cuvinte
                    final Site dead = j.site;
                    int before = searchQueue.size();
                    searchQueue.removeIf(x -> x.site == dead);
                    searchDone += before - searchQueue.size();
                }
            } else {
                deepEmpty.put(j.site.host, -1000); // a mers macar o data
            }
        }
        searchDone++;
        nextSearch(w);
        pushStatus(null);
    }

    private void nextSearch(WebView w) {
        Runnable old = searcherTimeout.remove(w);
        if (old != null) ui.removeCallbacks(old);
        if (!searching) return;
        Job j = searchQueue.poll();
        if (j == null) {
            searcherJob.remove(w);
            if (searcherJob.isEmpty()) {
                String q = deep ? "c\u0103utarea ad\u00e2nc\u0103" : "c\u0103utarea \u201e" + searchQ + "\u201d";
                int found = searchFound;
                cancelSearch();
                pushStatus("Gata " + q + " pe toate site-urile: " + found + " filme noi.");
                pushData(false);
            }
            return;
        }
        searcherJob.put(w, j);
        searcherFound.put(w, 0);
        Site s = j.site;
        String url = s.url;
        if (!s.searchUrl.isEmpty()) {
            try { url = s.searchUrl.replace("{q}", java.net.URLEncoder.encode(j.q, "UTF-8")); } catch (Exception ignored) { }
        }
        try {
            JSONObject o = new JSONObject().put("q", j.q).put("tok", searchTok + s.host + j.q);
            owner.loadWith(w, "window.__dfSearch=" + o + ";", url);
        } catch (Exception e) {
            owner.loadWith(w, null, "about:blank");
        }
        Runnable t = () -> jobDone(w);
        searcherTimeout.put(w, t);
        ui.postDelayed(t, 40_000);
    }

    void onReport(String json, boolean fromCrawler) { onReport(json, fromCrawler ? crawler : null, null, 0); }

    /**
     * wantedUrl/openedAt: ce site ai deschis in pagina respectiva (sau ce a cerut robotul). Daca raportul vine
     * de pe alta adresa imediat dupa deschidere, site-ul cerut s-a mutat acolo (ex. reelfren.com -> reelfren.net).
     */
    void onReport(String json, WebView from, String wantedUrl, long openedAt) {
        boolean fromCrawler = from != null && from == crawler;
        boolean fromSearch = from != null && searchers.contains(from);
        JSONObject r;
        try { r = new JSONObject(json); } catch (Exception e) { return; }
        String host = r.optString("host"), page = r.optString("url");
        Site site = sites.get(host);
        if (site == null) {
            // pagini de pe site-uri noi: doar daca le-am descoperit (sau sunt pe acelasi domeniu)
            if (!host.endsWith("dramafren.org")) return;
            site = addSite("https://" + host + "/", "", false);
        }
        long now = System.currentTimeMillis();
        String want = fromCrawler ? current : (fromSearch ? null : wantedUrl);
        if (fromCrawler) openedAt = crawlPageAt;
        if (want != null && !want.isEmpty() && now - openedAt < 60_000) {
            Site ws = sites.get(hostOf(want));
            if (ws != null && ws != site && !"ok".equals(ws.status) && !("mutat:" + host).equals(ws.status)) {
                ws.status = "mutat:" + host;
                scheduleSave();
                schedulePush();
            }
        }
        JSONArray its = r.optJSONArray("items");
        boolean changed = false;
        if (its != null) {
            for (int i = 0; i < its.length(); i++) {
                JSONObject o = its.optJSONObject(i);
                if (o == null) continue;
                String n = o.optString("key"), img = o.optString("img"), title = o.optString("title").trim();
                if (n.isEmpty() || img.isEmpty() || title.isEmpty()) continue;
                String k = host + "|" + n;
                Item it = items.get(k);
                int eps = o.optInt("eps", 0);
                String href = o.optString("href"), oc = o.optString("oc");
                if (it == null) {
                    it = new Item();
                    it.k = k; it.host = host; it.n = n; it.img = img; it.title = title;
                    it.eps = eps; it.href = href; it.oc = oc; it.page = page; it.t = now;
                    items.put(k, it);
                    newThisRun++;
                    if (fromSearch) { searchFound++; searcherFound.merge(from, 1, Integer::sum); }
                    changed = true;
                    queueHash(it);
                } else {
                    if (eps > it.eps) { it.eps = eps; changed = true; }
                    if (it.href.isEmpty() && !href.isEmpty()) { it.href = href; changed = true; }
                    if (it.oc.isEmpty() && !oc.isEmpty()) it.oc = oc;
                    if (it.title.length() < 3 && title.length() >= 3) { it.title = title; changed = true; }
                }
            }
        }
        JSONArray st = r.optJSONArray("sites");
        if (st != null) {
            for (int i = 0; i < st.length(); i++) {
                JSONObject o = st.optJSONObject(i);
                if (o == null) continue;
                String h = o.optString("host");
                if (!sites.containsKey(h)) {
                    addSite(o.optString("url"), o.optString("label"), true);
                    changed = true;
                }
            }
        }
        if (fromCrawler && crawling) {
            JSONArray pg = r.optJSONArray("pages");
            if (pg != null) for (int i = 0; i < pg.length(); i++) enqueue(pg.optString(i));
        }
        JSONObject d = r.optJSONObject("diag");
        if (d != null) {
            try {
                d.put("url", page);
                d.put("title", r.optString("title"));
            } catch (Exception ignored) { }
            diag.put(host, d.toString());
            if (d.optBoolean("cf")) site.status = "cf";
            else if (d.optInt("domCards") + d.optInt("jsonItems") > 0) site.status = "ok";
            else if (r.optBoolean("done")) site.status = "gol";
            else if ("cf".equals(site.status)) site.status = ""; // verificarea a trecut, pagina se incarca
        }
        // orice film primit = site-ul merge (verificarea a trecut)
        if (its != null && its.length() > 0 && !"ok".equals(site.status)) { site.status = "ok"; changed = true; }
        Job job = fromSearch ? searcherJob.get(from) : null;
        if (fromSearch && r.optBoolean("done") && job != null && host.equals(job.site.host)) {
            String su = r.optString("searchUrl");
            if (!su.isEmpty() && su.contains("{q}") && hostOf(su).equals(host) && !su.equals(site.searchUrl)) {
                site.searchUrl = su;
                changed = true;
            }
            final WebView w = from;
            Runnable t = searcherTimeout.remove(w);
            if (t != null) ui.removeCallbacks(t);
            ui.postDelayed(() -> jobDone(w), 200);
        } else if (fromSearch && r.optBoolean("done") && job != null) {
            // site-ul cautat s-a mutat pe alta adresa: raportul final vine de acolo
            final WebView w = from;
            Runnable t = searcherTimeout.remove(w);
            if (t != null) ui.removeCallbacks(t);
            ui.postDelayed(() -> jobDone(w), 200);
        }
        if (changed) { scheduleSave(); schedulePush(); }
        if (fromCrawler && crawling && r.optBoolean("done")) {
            ui.removeCallbacks(timeout);
            ui.postDelayed(timeout, 400);
        }
    }

    /** Un site din lista s-a mutat singur pe alta adresa: o adaugam ca site (cu filmele ei). */
    void onMoved(String fromUrl, String toUrl) {
        String to = hostOf(toUrl);
        Site from = sites.get(hostOf(fromUrl == null ? "" : fromUrl));
        if (from != null && !from.host.equals(to) && !"ok".equals(from.status)) from.status = "mutat:" + to;
        if (to.isEmpty() || sites.containsKey(to)) { scheduleSave(); schedulePush(); return; }
        Site s = addSite(toUrl, from != null ? from.host : "", false);
        if (s != null) {
            s.url = toUrl;
            scheduleSave();
            schedulePush();
        }
    }

    // ------------------------------------------------------------------ robot

    private void enqueue(String url) {
        if (url == null || url.isEmpty() || !url.startsWith("http")) return;
        int hash = url.indexOf('#');
        if (hash > 0) url = url.substring(0, hash);
        if (visited.contains(url) || queue.contains(url)) return;
        String h = hostOf(url);
        Site s = sites.get(h);
        if (s == null || !s.on) return;
        int c = perHost.getOrDefault(h, 0);
        if (c >= MAX_PAGES_PER_HOST) return;
        perHost.put(h, c + 1);
        queue.add(url);
    }

    void startCrawl() {
        if (crawling) return;
        if (crawler == null) crawler = owner.createCrawler();
        crawling = true;
        queue.clear(); visited.clear(); perHost.clear();
        pagesDone = 0; newThisRun = 0;
        for (Site s : sites.values()) if (s.on) enqueue(s.url);
        next();
    }

    void stopCrawl() {
        if (!crawling) return;
        crawling = false;
        ui.removeCallbacks(timeout);
        if (crawler != null) crawler.loadUrl("about:blank");
        pushStatus("Oprit. " + newThisRun + " filme noi.");
    }

    private void next() {
        ui.removeCallbacks(timeout);
        if (!crawling) return;
        String url = queue.poll();
        if (url == null) {
            crawling = false;
            if (crawler != null) crawler.loadUrl("about:blank");
            pushStatus("Gata: " + pagesDone + " pagini, " + newThisRun + " filme noi.");
            pushData(true);
            return;
        }
        visited.add(url);
        current = url;
        crawlPageAt = System.currentTimeMillis();
        pagesDone++;
        crawler.loadUrl(url);
        pushStatus(null);
        // o pagina are cel mult 2 minute (derulare + paginile API); verificarea Cloudflare intra aici
        ui.postDelayed(timeout, 120_000);
    }

    boolean isCrawling() { return crawling; }

    private void pushStatus(String text) {
        try {
            JSONObject o = new JSONObject();
            o.put("crawling", crawling);
            o.put("host", crawling ? hostOf(current) : "");
            o.put("done", pagesDone);
            o.put("left", queue.size());
            o.put("added", newThisRun);
            o.put("hashing", hashing);
            o.put("text", text == null ? "" : text);
            o.put("searching", searching);
            o.put("deep", deep);
            Job cur = searcherJob.isEmpty() ? null : searcherJob.values().iterator().next();
            o.put("sq", deep ? (cur != null ? cur.q : "") : searchQ);
            o.put("sdone", searchDone);
            o.put("stotal", searchTotal);
            o.put("sfound", searchFound);
            owner.toCatalog("hub:status:" + o);
        } catch (Exception ignored) { }
    }

    // ------------------------------------------------------------------ amprenta posterelor

    private void hashMissing() {
        for (Item it : items.values()) if (it.hs == 0 || it.hs == 3) { it.hs = 0; queueHash(it); }
    }

    private void queueHash(Item it) {
        if (it.hs != 0) return;
        it.hs = 3;
        hashing++;
        final String img = it.img, ref = "https://" + it.host + "/";
        hashPool.execute(() -> {
            long h = 0;
            boolean ok = false;
            try {
                h = dhash(download(img, ref));
                ok = true;
            } catch (Throwable ignored) { }
            final long fh = h;
            final boolean fok = ok;
            ui.post(() -> {
                hashing--;
                it.h = fh;
                it.hs = fok ? 1 : 2;
                scheduleSave();
                schedulePush();
            });
        });
    }

    static byte[] download(String url, String referer) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", UA);
        c.setRequestProperty("Accept", "image/avif,image/webp,image/*,*/*;q=0.8");
        if (referer != null) c.setRequestProperty("Referer", referer);
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 6_000_000) throw new Exception("too big");
            }
            return out.toByteArray();
        } finally {
            c.disconnect();
        }
    }

    /** dHash pe 64 de biti: acelasi poster (alta marime, alta compresie) da aproape aceeasi amprenta. */
    static long dhash(byte[] data) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(data, 0, data.length, o);
        if (o.outWidth <= 0) throw new Exception("not an image");
        int sample = 1;
        while (o.outWidth / (sample * 2) >= 64 && o.outHeight / (sample * 2) >= 64) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        Bitmap b = BitmapFactory.decodeByteArray(data, 0, data.length, o2);
        if (b == null) throw new Exception("decode");
        Bitmap s = Bitmap.createScaledBitmap(b, 9, 8, true);
        long h = 0;
        int bit = 0;
        for (int y = 0; y < 8; y++) {
            for (int x = 0; x < 8; x++) {
                if (gray(s.getPixel(x, y)) > gray(s.getPixel(x + 1, y))) h |= 1L << bit;
                bit++;
            }
        }
        if (s != b) s.recycle();
        b.recycle();
        return h;
    }

    private static int gray(int p) {
        return (((p >> 16) & 0xff) * 299 + ((p >> 8) & 0xff) * 587 + (p & 0xff) * 114) / 1000;
    }

    // ------------------------------------------------------------------ grupare + lista pentru ecran

    private static int find(int[] parent, int x) {
        while (parent[x] != x) { parent[x] = parent[parent[x]]; x = parent[x]; }
        return x;
    }

    private static void union(int[] parent, int a, int b) {
        a = find(parent, a); b = find(parent, b);
        if (a != b) parent[b] = a;
    }

    /** Posterele identice (dupa amprenta sau aceeasi adresa de imagine) intr-un singur film. */
    private static JSONArray buildGroups(List<Item> list, Map<String, Site> sites) {
        int n = list.size();
        int[] parent = new int[n];
        for (int i = 0; i < n; i++) parent[i] = i;
        Map<String, Integer> byImg = new HashMap<>();
        @SuppressWarnings("unchecked")
        Map<Integer, List<Integer>>[] bands = new HashMap[8];
        for (int b = 0; b < 8; b++) bands[b] = new HashMap<>();
        for (int i = 0; i < n; i++) {
            Item it = list.get(i);
            String path = it.n;
            Integer prev = byImg.put(path, i);
            if (prev != null) union(parent, prev, i);
            if (it.hs != 1) continue;
            int bits = Long.bitCount(it.h);
            if (bits < 6 || bits > 58) continue; // imagine goala/uniforma: nu o comparam
            // cu cel mult 5 diferente din 8 benzi de 8 biti, macar 3 benzi sunt identice: ajunge una
            for (int b = 0; b < 8; b++) {
                int key = (int) ((it.h >>> (b * 8)) & 0xff);
                List<Integer> bucket = bands[b].get(key);
                if (bucket == null) { bucket = new ArrayList<>(); bands[b].put(key, bucket); }
                for (int j = Math.max(0, bucket.size() - 400); j < bucket.size(); j++) {
                    int other = bucket.get(j);
                    if (Long.bitCount(list.get(other).h ^ it.h) <= SAME_DIST) union(parent, other, i);
                }
                bucket.add(i);
            }
        }
        Map<Integer, List<Item>> groups = new LinkedHashMap<>();
        for (int i = 0; i < n; i++) {
            int r = find(parent, i);
            List<Item> g = groups.get(r);
            if (g == null) { g = new ArrayList<>(); groups.put(r, g); }
            g.add(list.get(i));
        }
        for (Site s : sites.values()) s.count = 0;
        JSONArray out = new JSONArray();
        for (List<Item> g : groups.values()) {
            Item best = null;
            long first = Long.MAX_VALUE;
            for (Item it : g) {
                Site s = sites.get(it.host);
                if (s != null) s.count++;
                if (s != null && !s.on) continue;
                first = Math.min(first, it.t);
                if (best == null || it.eps > best.eps
                        || (it.eps == best.eps && !it.href.isEmpty() && best.href.isEmpty())) best = it;
            }
            if (best == null) continue;
            try {
                JSONObject o = new JSONObject();
                o.put("k", best.k);
                o.put("ti", best.title);
                o.put("im", best.img);
                o.put("ep", best.eps);
                o.put("ho", best.host);
                o.put("t", first);
                JSONArray ks = new JSONArray();
                if (best.hs == 1) ks.put("h" + Long.toHexString(best.h));
                JSONArray alts = new JSONArray();
                for (Item it : g) {
                    ks.put(it.k);
                    if (it == best) continue;
                    Site s = sites.get(it.host);
                    if (s != null && !s.on) continue;
                    alts.put(new JSONArray().put(it.k).put(it.host).put(it.eps).put(it.title));
                }
                o.put("ks", ks);
                if (alts.length() > 0) o.put("al", alts);
                out.put(o);
            } catch (Exception ignored) { }
        }
        return out;
    }

    private static JSONArray sitesJson(Map<String, Site> sites) {
        JSONArray a = new JSONArray();
        for (Site s : sites.values()) {
            try {
                a.put(new JSONObject().put("host", s.host).put("url", s.url).put("label", s.label)
                        .put("on", s.on).put("n", s.count).put("st", s.status));
            } catch (Exception ignored) { }
        }
        return a;
    }

    private long lastPush = 0;

    private void schedulePush() {
        ui.removeCallbacks(push);
        // cat lucreaza robotul, lista se reimprospateaza rar (sa poti derula linistit)
        long wait = Math.max(800, (searching ? (deep ? 10000 : 2500) : crawling ? 15000 : 3000) - (System.currentTimeMillis() - lastPush));
        ui.postDelayed(push, wait);
    }

    private final ExecutorService grouper = Executors.newSingleThreadExecutor();
    private boolean grouping = false, regroup = false;

    /** Lista pentru ecran se calculeaza in fundal (nu blocheaza aplicatia cand sunt multe filme). */
    void pushData(boolean statusToo) {
        ui.removeCallbacks(push);
        lastPush = System.currentTimeMillis();
        if (grouping) { regroup = true; return; }
        grouping = true;
        final List<Item> list = new ArrayList<>(items.values());
        final Map<String, Site> ss = new LinkedHashMap<>(sites);
        final int total = list.size();
        grouper.execute(() -> {
            String msg = null;
            try {
                JSONObject o = new JSONObject();
                o.put("groups", buildGroups(list, ss));
                o.put("sites", sitesJson(ss));
                o.put("items", total);
                msg = "hub:data:" + o;
            } catch (Throwable ignored) { }
            final String m = msg;
            ui.post(() -> {
                grouping = false;
                if (m != null) owner.toCatalog(m);
                pushStatus(null);
                if (regroup) { regroup = false; schedulePush(); }
            });
        });
    }

    // ------------------------------------------------------------------ comenzi din lista

    void onCommand(String cmd) {
        if (cmd.equals("get")) {
            pushData(true);
        } else if (cmd.startsWith("search:")) {
            search(cmd.substring(7));
        } else if (cmd.equals("deep")) {
            deepSearch(false);
        } else if (cmd.equals("deepromance")) {
            deepSearch(true);
        } else if (cmd.equals("searchstop")) {
            stopSearch();
        } else if (cmd.equals("crawl")) {
            startCrawl();
        } else if (cmd.equals("stop")) {
            stopCrawl();
        } else if (cmd.startsWith("open:")) {
            open(cmd.substring(5));
        } else if (cmd.startsWith("site:")) {
            String[] p = cmd.split(":", 3);
            if (p.length < 3) return;
            Site s = sites.get(p[2]);
            if (s == null) return;
            if (p[1].equals("on")) s.on = true;
            else if (p[1].equals("off")) s.on = false;
            else if (p[1].equals("open")) { owner.openUrl(s.url, null); return; }
            else if (p[1].equals("del")) {
                sites.remove(s.host);
                items.values().removeIf(it -> it.host.equals(s.host));
            }
            scheduleSave();
            pushData(false);
        } else if (cmd.startsWith("addsite:")) {
            String url = cmd.substring(8).trim();
            if (!url.startsWith("http")) url = "https://" + url;
            Site s = addSite(url, "", false);
            if (s != null) { s.on = true; owner.toast("Site adăugat: " + s.host); }
            scheduleSave();
            pushData(false);
        } else if (cmd.equals("diag")) {
            owner.copyText("DramaFren diagnostic", diagText());
            owner.toast("Diagnosticul e copiat. Lipește-l în chat.");
        } else if (cmd.equals("clear")) {
            items.clear();
            scheduleSave();
            pushData(false);
        }
    }

    private void open(String k) {
        Item it = items.get(k);
        if (it == null) return;
        if (!it.href.isEmpty()) {
            owner.openUrl(it.href, null);
            return;
        }
        try {
            JSONObject o = new JSONObject();
            o.put("tok", Long.toString(System.nanoTime(), 36));
            o.put("key", it.n);
            o.put("title", it.title);
            o.put("oc", it.oc);
            String page = it.page.isEmpty() ? "https://" + it.host + "/" : it.page;
            owner.openUrl(page, "window.__dfOpen=" + o + ";");
        } catch (Exception ignored) { }
    }

    private String diagText() {
        try {
            JSONObject o = new JSONObject();
            o.put("app", "DramaFren");
            o.put("items", items.size());
            JSONObject perSite = new JSONObject();
            for (Site s : sites.values()) {
                JSONObject x = new JSONObject();
                x.put("on", s.on).put("n", s.count).put("st", s.status).put("url", s.url);
                String d = diag.get(s.host);
                if (d != null) x.put("diag", new JSONObject(d));
                perSite.put(s.host, x);
            }
            o.put("sites", perSite);
            int noHash = 0, noHref = 0;
            for (Item it : items.values()) { if (it.hs == 2) noHash++; if (it.href.isEmpty()) noHref++; }
            o.put("hashFailed", noHash);
            o.put("noLink", noHref);
            return o.toString(1);
        } catch (Exception e) {
            return "diag error " + e;
        }
    }

    // ------------------------------------------------------------------ salvare

    private void scheduleSave() {
        ui.removeCallbacks(save);
        ui.postDelayed(save, 5000);
    }

    void saveNow() {
        ui.removeCallbacks(save);
        final String data;
        try {
            JSONObject o = new JSONObject();
            JSONArray ss = new JSONArray();
            for (Site s : sites.values()) {
                ss.put(new JSONObject().put("host", s.host).put("url", s.url).put("label", s.label)
                        .put("on", s.on).put("st", s.status).put("su", s.searchUrl));
            }
            o.put("sites", ss);
            JSONArray is = new JSONArray();
            for (Item it : items.values()) {
                is.put(new JSONArray().put(it.k).put(it.host).put(it.n).put(it.img).put(it.title)
                        .put(it.eps).put(it.href).put(it.oc).put(it.page).put(it.t)
                        .put(it.hs == 1 ? Long.toHexString(it.h) : (it.hs == 2 ? "x" : "")));
            }
            o.put("items", is);
            data = o.toString();
        } catch (Exception e) {
            return;
        }
        io.execute(() -> {
            File tmp = new File(file.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(data.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            } catch (Exception e) {
                return;
            }
            //noinspection ResultOfMethodCallIgnored
            tmp.renameTo(file);
        });
    }

    private void load() {
        if (!file.exists()) return;
        try (FileInputStream in = new FileInputStream(file)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            JSONObject o = new JSONObject(out.toString(StandardCharsets.UTF_8.name()));
            JSONArray ss = o.optJSONArray("sites");
            if (ss != null) for (int i = 0; i < ss.length(); i++) {
                JSONObject x = ss.getJSONObject(i);
                Site s = new Site();
                s.host = x.getString("host"); s.url = x.optString("url"); s.label = x.optString("label");
                s.on = x.optBoolean("on", true); s.status = x.optString("st"); s.searchUrl = x.optString("su");
                sites.put(s.host, s);
            }
            JSONArray is = o.optJSONArray("items");
            if (is != null) for (int i = 0; i < is.length(); i++) {
                JSONArray a = is.getJSONArray(i);
                Item it = new Item();
                it.k = a.getString(0); it.host = a.getString(1); it.n = a.getString(2); it.img = a.getString(3);
                it.title = a.getString(4); it.eps = a.optInt(5); it.href = a.optString(6); it.oc = a.optString(7);
                it.page = a.optString(8); it.t = a.optLong(9);
                String h = a.optString(10);
                if (h.equals("x")) it.hs = 2;
                else if (!h.isEmpty()) { it.h = Long.parseUnsignedLong(h, 16); it.hs = 1; }
                items.put(it.k, it);
            }
        } catch (Exception ignored) { }
    }
}
