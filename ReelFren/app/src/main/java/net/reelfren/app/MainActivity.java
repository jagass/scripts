package net.reelfren.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.GestureDetector;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public class MainActivity extends Activity {

    // Site-ul vine din varianta aplicatiei (reelfren / shortmax), vezi app/build.gradle
    private static final String HOME_URL = BuildConfig.HOME_URL;

    /** Domenii in care aplicatia are voie sa navigheze. Restul (reclame, redirecturi) sunt blocate. */
    private static final String[] ALLOWED_DOMAINS = BuildConfig.ALLOWED_DOMAINS.split(",");

    /** DramaFren: lista comuna de filme de pe mai multe site-uri (pagina din aplicatie + robot). */
    private static final boolean HUB = BuildConfig.HUB;
    private static final String ASSET_HOST = "appassets.androidplatform.net";
    private static final String CATALOG_URL = "https://" + ASSET_HOST + "/catalog.html";
    private Hub hub;
    private WebView crawler;
    private String aggJs = "";

    private String homeUrl() { return HUB ? CATALOG_URL : HOME_URL; }

    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private View errorView;

    private ChromeClient chromeClient;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    /** Containerul de fullscreen clasic (folosit doar daca modul cinema nu e suportat). */
    private FrameLayout fullscreenBox;
    private View controls;

    /** Mod cinema: video-ul site-ului pe tot ecranul, vertical, cu controalele aplicatiei. */
    private boolean cinema = false;
    private boolean cinemaSupported = false;
    /** Mod cinema "usor": playerul site-ului e deja pe tot ecranul; swipe-urile merg direct la site. */
    private boolean cinemaLight = false;
    private Button filmButton;
    private float tapX, tapY;
    private long tapTime;
    private View tapCatcher;
    private View cinemaControls;
    private SeekBar seekBar;
    private TextView timeLabel;
    private Button playButton;
    private boolean userSeeking = false;
    private double videoDuration = 0;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hideControls = () -> { if (controls != null) controls.setVisibility(View.GONE); };

    private String playerJs = "";
    private String filterJs = "";
    private String adblockJs = "";
    private String epcheckJs = "";

    /** Blocarea reclamelor (unele episoade pornesc doar dupa reclama site-ului): se poate opri din pagina. */
    private boolean adblockOn = true;
    private final java.util.Map<WebView, androidx.webkit.ScriptHandler> adOffFlags = new java.util.HashMap<>();
    private static final String AD_OFF_JS = "window.__rfAdOff=true;";

    /** Backup: fisierul se salveaza unde alegi tu; la incarcare alegi fisierul. */
    private static final int REQ_SAVE_BACKUP = 41, REQ_OPEN_FILE = 42;
    private String pendingBackup = null;
    private android.webkit.ValueCallback<Uri[]> fileCallback = null;

    /** Retele de reclame cunoscute: cererile spre ele primesc un raspuns gol. */
    private static final String[] AD_HOSTS = {
            "doubleclick.net", "googlesyndication.com", "googleadservices.com", "adservice.google.com",
            "popads.net", "popcash.net", "propellerads.com", "propellerclick.com", "onclickads.net", "onclkds.com",
            "adsterra.com", "adsterratech.com", "monetag.com", "exoclick.com", "exosrv.com", "juicyads.com",
            "trafficjunky.net", "hilltopads.net", "hilltopads.com", "a-ads.com", "clickadu.com", "galaksion.com",
            "richpush.co", "pushhouse.io", "evadav.com", "adcash.com", "admaven.com", "ad-maven.com",
            "adskeeper.com", "mgid.com", "taboola.com", "outbrain.com", "revcontent.com", "zeropark.com",
            "adnium.com", "trafficstars.com", "tsyndicate.com", "realsrv.com", "a-mo.net", "bidvertiser.com",
            "pushame.com", "pushnow.net", "notix.io", "sendpulse.com", "onesignal.com", "highperformanceformat.com",
            "profitablegatecpm.com", "effectivegatecpm.com", "profitablecpmrate.com", "displaycontentnetwork.com",
            "adtrafficquality.google", "amazon-adsystem.com", "criteo.com", "pubmatic.com", "rubiconproject.com"
    };

    private static boolean isAdHost(String host) {
        if (host == null) return false;
        host = host.toLowerCase();
        for (String d : AD_HOSTS) {
            if (host.equals(d) || host.endsWith("." + d)) return true;
        }
        return false;
    }
    private boolean startScriptInjected = false;
    /** Canale catre fiecare frame (pagina + iframe-ul playerului), separat pentru fiecare pagina deschisa. */
    private final java.util.Map<WebView, List<JavaScriptReplyProxy>> framesByView = new java.util.HashMap<>();
    /** Paginile deschise, una peste alta: [0] = lista de seriale, ultima = cea vizibila (webView). */
    private final List<WebView> tabs = new ArrayList<>();

    private List<JavaScriptReplyProxy> framesOf(WebView v) {
        List<JavaScriptReplyProxy> l = framesByView.get(v);
        if (l == null) { l = new ArrayList<>(); framesByView.put(v, l); }
        return l;
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this) {
            @Override
            public boolean onInterceptTouchEvent(MotionEvent ev) {
                // in modul usor nu oprim atingerile (swipe-ul ajunge la site); doar recunoastem o atingere scurta
                if (cinema && cinemaLight) {
                    if (ev.getActionMasked() == MotionEvent.ACTION_DOWN) {
                        tapX = ev.getX(); tapY = ev.getY(); tapTime = ev.getEventTime();
                    } else if (ev.getActionMasked() == MotionEvent.ACTION_UP) {
                        boolean isTap = Math.abs(ev.getX() - tapX) < dp(12) && Math.abs(ev.getY() - tapY) < dp(12)
                                && ev.getEventTime() - tapTime < 350;
                        boolean onControls = cinemaControls.getVisibility() == View.VISIBLE
                                && ev.getY() >= cinemaControls.getTop();
                        if (isTap && !onControls) toggleCinemaControls();
                    }
                }
                return false;
            }
        };
        root.setBackgroundColor(Color.parseColor("#101014"));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        root.addView(progress, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(4), Gravity.TOP));

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        // Strat transparent peste pagina in modul cinema: o atingere arata/ascunde controalele.
        tapCatcher = new View(this);
        tapCatcher.setVisibility(View.GONE);
        // atingere = arata/ascunde controalele; swipe sus/jos = episodul urmator/anterior
        GestureDetector gestures = new GestureDetector(this, new GestureDetector.SimpleOnGestureListener() {
            @Override public boolean onDown(MotionEvent e) { return true; }
            @Override public boolean onSingleTapUp(MotionEvent e) { toggleCinemaControls(); return true; }
            @Override public boolean onFling(MotionEvent e1, MotionEvent e2, float vx, float vy) {
                if (e1 == null) return false;
                float dy = e2.getY() - e1.getY(), dx = e2.getX() - e1.getX();
                if (Math.abs(dy) < dp(80) || Math.abs(dy) < Math.abs(dx)) return false;
                changeEpisode(dy < 0);
                return true;
            }
        });
        tapCatcher.setOnTouchListener((v, ev) -> gestures.onTouchEvent(ev));
        root.addView(tapCatcher, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        cinemaControls = buildCinemaControls();
        cinemaControls.setVisibility(View.GONE);
        root.addView(cinemaControls, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));

        setContentView(root);

        adblockOn = getSharedPreferences("reelfren", MODE_PRIVATE).getBoolean("adblock", true);
        playerJs = readAsset("player.js");
        filterJs = readAsset("filter.js");
        adblockJs = readAsset("adblock.js");
        epcheckJs = readAsset("epcheck.js");
        if (HUB) {
            aggJs = readAsset("agg.js");
            hub = new Hub(this, hubOwner);
        }
        chromeClient = new ChromeClient();

        webView = createWebView();
        tabs.add(webView);
        root.addView(webView, 0, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(homeUrl());
        }
    }

    /** O pagina noua (WebView) cu toate setarile si scripturile aplicatiei. */
    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView() {
        WebView w = new WebView(this);
        w.setBackgroundColor(Color.parseColor("#101014"));
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
        // Pop-up-uri blocate: ferestrele noi ajung in onCreateWindow, unde le refuzam.
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        // Unele site-uri refuza WebView-ul; ne prezentam ca un Chrome obisnuit.
        s.setUserAgentString(s.getUserAgentString().replace("; wv", ""));

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(w, true);

        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(w, "RFBridge", Collections.singleton("*"),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> onBridgeMessage(view, message.getData(), replyProxy));
            cinemaSupported = true;
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, playerJs, Collections.singleton("*"));
            WebViewCompat.addDocumentStartJavaScript(w, adblockJs, Collections.singleton("*"));
            if (!adblockOn) adOffFlags.put(w, WebViewCompat.addDocumentStartJavaScript(w, AD_OFF_JS, Collections.singleton("*")));
            // Butonul "Filtru" doar pe paginile site-ului (nu si in iframe-uri straine)
            java.util.Set<String> site = new java.util.HashSet<>();
            for (String d : ALLOWED_DOMAINS) {
                site.add("https://" + d);
                site.add("https://*." + d);
            }
            if (HUB) {
                // cauta filmele pe orice site deschis (agg.js verifica singur unde ruleaza)
                WebViewCompat.addDocumentStartJavaScript(w, aggJs, Collections.singleton("*"));
            } else {
                WebViewCompat.addDocumentStartJavaScript(w, filterJs, site);
                WebViewCompat.addDocumentStartJavaScript(w, epcheckJs, site);
            }
            startScriptInjected = true;
        }

        w.setWebViewClient(new Client());
        w.setWebChromeClient(chromeClient);

        return w;
    }

    /** Porneste/opreste blocarea reclamelor (tinut minte) si reincarca pagina vizibila. */
    private void toggleAdblock() {
        adblockOn = !adblockOn;
        getSharedPreferences("reelfren", MODE_PRIVATE).edit().putBoolean("adblock", adblockOn).apply();
        for (WebView w : tabs) {
            if (adblockOn) {
                androidx.webkit.ScriptHandler h = adOffFlags.remove(w);
                if (h != null) h.remove();
                w.evaluateJavascript("window.__rfAdOff=false;", null);
            } else if (!adOffFlags.containsKey(w) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                adOffFlags.put(w, WebViewCompat.addDocumentStartJavaScript(w, AD_OFF_JS, Collections.singleton("*")));
            }
        }
        Toast.makeText(this, adblockOn ? "Blocare reclame pornit\u0103"
                : "Blocare reclame oprit\u0103. La ferestrele de reclam\u0103 ap\u0103s\u0103 Cancel / Close.", Toast.LENGTH_LONG).show();
        webView.reload();
    }

    /** Deschide un serial intr-o pagina noua, peste lista (care ramane incarcata). */
    private void openTab(String url) { openTab(url, null); }

    /** openJs: script rulat la inceputul paginii (ex. ce film sa deschida DramaFren pe un site fara linkuri). */
    private void openTab(String url, String openJs) {
        if (cinema) exitCinema();
        WebView w = createWebView();
        if (openJs != null && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(w, openJs, Collections.singleton("*"));
        }
        webView.setVisibility(View.GONE);
        root.addView(w, tabs.size(), new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        tabs.add(w);
        webView = w;
        errorView.setVisibility(View.GONE);
        w.loadUrl(url);
    }

    /** Inchide pagina de sus si revine la cea din spate (de ex. lista de seriale). */
    private boolean closeTab() {
        if (tabs.size() <= 1) return false;
        if (cinema) exitCinema();
        WebView top = tabs.remove(tabs.size() - 1);
        adOffFlags.remove(top);
        root.removeView(top);
        framesByView.remove(top);
        top.destroy();
        webView = tabs.get(tabs.size() - 1);
        webView.setVisibility(View.VISIBLE);
        errorView.setVisibility(View.GONE);
        progress.setVisibility(View.GONE);
        return true;
    }

    /** Site-uri deschise de tine printr-o atingere pe un link (ex. alta platforma din meniul site-ului). */
    private static final java.util.Set<String> userAllowedHosts = new java.util.HashSet<>();
    /** Momentul ultimei navigari pornite de tine (redirecturile imediat urmatoare sunt permise). */
    private long lastUserNav = 0;

    /** Cand a inceput sa se incarce pagina din fiecare WebView (redirecturile imediate ale site-ului sunt permise). */
    private final java.util.Map<WebView, Long> pageStarts = new java.util.WeakHashMap<>();

    private long pageStartOf(WebView v) {
        Long t = pageStarts.get(v);
        return t == null ? 0 : t;
    }

    private static boolean hostIn(String host, Iterable<String> domains) {
        for (String d : domains) {
            if (host.equals(d) || host.endsWith("." + d)) return true;
        }
        return false;
    }

    private static boolean isAllowed(Uri uri) {
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase();
        if (HUB && host.equals(ASSET_HOST)) return true;
        return hostIn(host, java.util.Arrays.asList(ALLOWED_DOMAINS)) || hostIn(host, userAllowedHosts);
    }

    private static boolean isWeb(Uri uri) {
        return "http".equals(uri.getScheme()) || "https".equals(uri.getScheme());
    }

    /** Linkul (text) pe care tocmai l-ai atins, sau null daca atingerea nu a fost pe un link. */
    private String tappedLink(WebView view) {
        WebView.HitTestResult r = view.getHitTestResult();
        if (r != null && r.getType() == WebView.HitTestResult.SRC_ANCHOR_TYPE) return r.getExtra();
        return null;
    }

    /** Pentru linkuri intent:// (deschide alta aplicatie): varianta de site, daca exista. */
    private static String webFallback(Uri uri) {
        if (!"intent".equals(uri.getScheme())) return null;
        try {
            android.content.Intent it = android.content.Intent.parseUri(uri.toString(), android.content.Intent.URI_INTENT_SCHEME);
            String fb = it.getStringExtra("browser_fallback_url");
            if (fb != null && isWeb(Uri.parse(fb))) return fb;
            Uri data = it.getData();
            if (data != null && isWeb(data)) return data.toString();
        } catch (Exception ignored) { }
        return null;
    }

    private void allowByUser(Uri uri) {
        String host = uri.getHost();
        if (host == null) return;
        host = host.toLowerCase();
        if (!isAllowed(uri)) {
            userAllowedHosts.add(host);
            Toast.makeText(this, "Deschid " + host, Toast.LENGTH_SHORT).show();
        }
        lastUserNav = SystemClock.uptimeMillis();
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Iframe-urile (de ex. playerul video) pot fi pe alte domenii; blocam doar pagina principala.
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            if (!isWeb(uri)) {
                // Link catre o alta aplicatie (intent://...): daca are si o varianta de site,
                // o deschidem aici, in aplicatie. Nu deschidem niciodata alte aplicatii sau Magazinul Play.
                String fallback = webFallback(uri);
                if (fallback != null && request.hasGesture()) {
                    allowByUser(Uri.parse(fallback));
                    view.loadUrl(fallback);
                    return true;
                }
                Toast.makeText(MainActivity.this, "Link c\u0103tre alt\u0103 aplica\u021bie blocat", Toast.LENGTH_SHORT).show();
                return true;
            }
            if (isAllowed(uri)) return false;
            // un link pe care l-ai atins tu (ex. alta platforma din meniul site-ului): il deschidem
            String tapped = request.hasGesture() ? tappedLink(view) : null;
            boolean userTap = tapped != null && uri.getHost() != null
                    && uri.getHost().equalsIgnoreCase(Uri.parse(tapped).getHost());
            // redirecturile imediat dupa un link atins de tine (ex. site -> www.site)
            boolean redirectAfterTap = request.isRedirect() && SystemClock.uptimeMillis() - lastUserNav < 5000;
            if (userTap || redirectAfterTap) {
                allowByUser(uri);
                return false;
            }
            // DramaFren: un site din lista care te muta singur pe alta adresa (ex. dupa verificarea Cloudflare
            // sau pe domeniul lui nou) - redirect al serverului sau imediat dupa incarcarea paginii
            if (HUB && !isAdHost(uri.getHost()) && isAllowed(Uri.parse(String.valueOf(view.getUrl())))
                    && (request.isRedirect() || SystemClock.uptimeMillis() - pageStartOf(view) < 20000)) {
                userAllowedHosts.add(uri.getHost().toLowerCase());
                hub.onMoved(view.getUrl(), uri.toString());
                return false;
            }
            Toast.makeText(MainActivity.this, "Link extern blocat: " + uri.getHost(), Toast.LENGTH_SHORT).show();
            return true;
        }

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            if (HUB && ASSET_HOST.equals(request.getUrl().getHost())) return serveHubAsset(request.getUrl());
            // robotul: fara video, fonturi si imagini (nu le vede nimeni), doar textul si listele
            if (HUB && view == crawler && !request.isForMainFrame()) {
                String path = request.getUrl().getPath() == null ? "" : request.getUrl().getPath().toLowerCase();
                if (path.matches(".*\\.(mp4|m3u8|ts|webm|mkv|woff2?|ttf|otf|eot|png|jpe?g|webp|gif|avif|svg|ico)$")) {
                    return new WebResourceResponse("text/plain", "utf-8", new java.io.ByteArrayInputStream(new byte[0]));
                }
            }
            if (adblockOn && isAdHost(request.getUrl().getHost())) {
                return new WebResourceResponse("text/plain", "utf-8",
                        new java.io.ByteArrayInputStream(new byte[0]));
            }
            return null;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            framesOf(view).clear();
            pageStarts.put(view, SystemClock.uptimeMillis());
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!startScriptInjected) view.evaluateJavascript(playerJs, null);
            if (!adblockOn) view.evaluateJavascript(AD_OFF_JS, null);
            view.evaluateJavascript(adblockJs, null);
            // scriptul se protejeaza singur de dubla rulare, deci e sigur sa-l rulam si aici
            if (HUB) {
                view.evaluateJavascript(aggJs, null);
            } else {
                view.evaluateJavascript(filterJs, null);
                view.evaluateJavascript(epcheckJs, null);
            }
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && view == webView) {
                errorView.setVisibility(View.VISIBLE);
            }
        }
    }

    private class ChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (view != webView) return;
            progress.setProgress(newProgress);
            progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
        }

        // <input type="file"> din pagina (ex. "Incarca backup")
        @Override
        public boolean onShowFileChooser(WebView view, android.webkit.ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT);
            i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
            i.setType("*/*");
            try { startActivityForResult(i, REQ_OPEN_FILE); }
            catch (Exception e) { fileCallback = null; return false; }
            return true;
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            // Ferestrele noi sunt blocate (pop-up-uri de reclame). Exceptie: un link de tip "deschide in
            // fereastra noua" pe care l-ai atins tu - il deschidem aici, in aceeasi fereastra.
            if (isUserGesture) {
                String href = tappedLink(view);
                if (href != null) {
                    Uri u = Uri.parse(href);
                    if (isWeb(u)) {
                        allowByUser(u);
                        view.loadUrl(href);
                    }
                }
            }
            return false;
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (cinemaSupported) {
                // nu folosim fullscreen-ul WebView (se rotea si ramanea negru la episodul urmator)
                callback.onCustomViewHidden();
                enterCinema();
                return;
            }
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            fullscreenBox = new FrameLayout(MainActivity.this) {
                @Override
                public boolean onInterceptTouchEvent(MotionEvent ev) {
                    if (ev.getActionMasked() == MotionEvent.ACTION_DOWN) showControls();
                    return false; // atingerea ajunge si la playerul site-ului
                }
            };
            fullscreenBox.setBackgroundColor(Color.BLACK);
            fullscreenBox.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            controls = buildControls();
            fullscreenBox.addView(controls, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                    Gravity.TOP | Gravity.CENTER_HORIZONTAL));
            root.addView(fullscreenBox, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            showControls();
            webView.setVisibility(View.GONE);
            setVideoFullscreen(true);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        }

        @Override
        public void onHideCustomView() {
            if (fullscreenView == null) return;
            handler.removeCallbacks(hideControls);
            fullscreenBox.removeAllViews();
            root.removeView(fullscreenBox);
            fullscreenBox = null;
            controls = null;
            fullscreenView = null;
            if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
            webView.setVisibility(View.VISIBLE);
            setVideoFullscreen(false);
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        }
    }

    @SuppressWarnings("deprecation")
    private void setVideoFullscreen(boolean on) {
        View decor = getWindow().getDecorView();
        if (on) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        } else {
            decor.setSystemUiVisibility(0);
            getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        }
    }

    // --- mod cinema ----------------------------------------------------------
    private void onBridgeMessage(WebView view, String data, JavaScriptReplyProxy proxy) {
        if (data == null) return;
        if (data.equals("hello")) {
            List<JavaScriptReplyProxy> fr = framesOf(view);
            if (!fr.contains(proxy)) fr.add(proxy);
            if (cinema && view == webView) try { proxy.postMessage("cinema:1"); } catch (Exception ignored) { }
            return;
        }
        if (data.startsWith("backup:save:")) {
            String json = data.substring("backup:save:".length());
            String name = "ReelFren-backup-"
                    + new java.text.SimpleDateFormat("yyyy-MM-dd_HHmm", java.util.Locale.US).format(new java.util.Date()) + ".json";
            // Android 10+: direct in Descarcari (fara fereastra de alegere, care pe unele telefoane opreste aplicatia)
            if (android.os.Build.VERSION.SDK_INT >= 29) {
                try {
                    android.content.ContentValues cv = new android.content.ContentValues();
                    cv.put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, name);
                    cv.put(android.provider.MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    cv.put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS);
                    Uri out = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (out == null) throw new java.io.IOException("insert");
                    try (java.io.OutputStream os = getContentResolver().openOutputStream(out)) {
                        os.write(json.getBytes(StandardCharsets.UTF_8));
                    }
                    Toast.makeText(this, "Backup salvat \u00een Desc\u0103rc\u0103ri: " + name
                            + " (" + Math.max(1, json.length() / 1024) + " KB)", Toast.LENGTH_LONG).show();
                    return;
                } catch (Exception e) {
                    // continuam cu fereastra de alegere
                }
            }
            // datele merg intr-un fisier temporar: raman chiar daca aplicatia e repornita cat alegi locul
            try (java.io.FileOutputStream fo = new java.io.FileOutputStream(new java.io.File(getCacheDir(), "pending-backup.json"))) {
                fo.write(json.getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) { pendingBackup = json; }
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(android.content.Intent.CATEGORY_OPENABLE);
            i.setType("application/json");
            i.putExtra(android.content.Intent.EXTRA_TITLE, name);
            try { startActivityForResult(i, REQ_SAVE_BACKUP); }
            catch (Exception e) { Toast.makeText(this, "Nu pot deschide salvarea de fi\u0219iere", Toast.LENGTH_LONG).show(); }
            return;
        }
        if (HUB && data.startsWith("hub:")) {
            if (data.startsWith("hub:report:")) hub.onReport(data.substring(11), view == crawler);
            else hub.onCommand(data.substring(4));
            return;
        }
        if (data.equals("adblock:toggle")) {
            toggleAdblock();
            return;
        }
        if (data.startsWith("open:")) {
            // un serial atins in lista: il deschidem intr-o pagina noua, lista ramane incarcata in spate
            Uri u = Uri.parse(data.substring(5));
            if (isWeb(u) && isAllowed(u)) openTab(u.toString());
            return;
        }
        if (view != webView) return; // mesajele paginilor din spate nu conteaza
        if (data.startsWith("mode:")) {
            // "none" = pe pagina nu e niciun video: ca la modul usor, atingerile ajung la pagina
            cinemaLight = data.equals("mode:light") || data.equals("mode:none");
            if (cinema) tapCatcher.setVisibility(cinemaLight ? View.GONE : View.VISIBLE);
        } else if (data.equals("auto:next")) {
            // Mod film: episodul s-a terminat si site-ul nu a trecut singur la urmatorul
            changeEpisode(true);
        } else if (data.equals("fs:enter")) {
            enterCinema();
        } else if (data.equals("fs:exit")) {
            exitCinema();
        } else if (data.startsWith("t:")) {
            String[] p = data.split(":");
            if (p.length < 4) return;
            try {
                double cur = Double.parseDouble(p[1]);
                double dur = Double.parseDouble(p[2]);
                boolean paused = "1".equals(p[3]);
                videoDuration = dur;
                if (!userSeeking && dur > 0) seekBar.setProgress((int) Math.round(cur / dur * 1000));
                timeLabel.setText(fmt(cur) + " / " + fmt(dur));
                playButton.setText(paused ? "\u25B6" : "\u23F8");
            } catch (NumberFormatException ignored) { }
        }
    }

    private void broadcast(String msg) {
        for (JavaScriptReplyProxy p : new ArrayList<>(framesOf(webView))) {
            try { p.postMessage(msg); } catch (Exception ignored) { }
        }
    }

    private void enterCinema() {
        if (cinema) return;
        cinema = true;
        broadcast("cinema:1");
        setVideoFullscreen(true);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        tapCatcher.setVisibility(View.VISIBLE);
        cinemaControls.setVisibility(View.GONE);
    }

    private void exitCinema() {
        if (!cinema) return;
        cinema = false;
        cinemaLight = false;
        broadcast("cinema:0");
        handler.removeCallbacks(hideCinemaControls);
        tapCatcher.setVisibility(View.GONE);
        cinemaControls.setVisibility(View.GONE);
        setVideoFullscreen(false);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
    }

    private final Runnable hideCinemaControls = () -> {
        if (!userSeeking) cinemaControls.setVisibility(View.GONE);
    };

    private void toggleCinemaControls() {
        if (cinemaControls.getVisibility() == View.VISIBLE) {
            cinemaControls.setVisibility(View.GONE);
        } else {
            showCinemaControls();
        }
    }

    /** Mod film: la finalul unui episod porneste automat urmatorul (setarea e tinuta in pagina). */
    private void toggleFilmMode() {
        webView.evaluateJavascript("window.__rfToggleAutoNext ? window.__rfToggleAutoNext() : null", r -> {
            updateFilmButton(r);
            if ("true".equals(r) || "false".equals(r)) {
                Toast.makeText(this, "Mod film " + ("true".equals(r) ? "pornit: episoadele merg unul dup\u0103 altul" : "oprit"),
                        Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void refreshFilmButton() {
        webView.evaluateJavascript("window.__rfAutoNextOn ? window.__rfAutoNextOn() : null", this::updateFilmButton);
    }

    private void updateFilmButton(String r) {
        if (filmButton == null) return;
        if ("true".equals(r)) filmButton.setText("\uD83C\uDFAC \u2713");
        else if ("false".equals(r)) filmButton.setText("\uD83C\uDFAC \u2717");
        else filmButton.setText("\uD83C\uDFAC");
    }

    private void showCinemaControls() {
        refreshFilmButton();
        cinemaControls.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideCinemaControls);
        handler.postDelayed(hideCinemaControls, 4000);
    }

    private View buildCinemaControls() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(12), dp(16), dp(24));
        box.setBackgroundColor(Color.parseColor("#B3000000"));
        box.setClickable(true); // atingerile pe bara nu ajung la stratul de dedesubt

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);
        timeLabel = new TextView(this);
        timeLabel.setTextColor(Color.WHITE);
        timeLabel.setTextSize(13);
        timeLabel.setText("0:00 / 0:00");
        top.addView(timeLabel, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        filmButton = cinemaButton("\uD83C\uDFAC", this::toggleFilmMode);
        top.addView(filmButton);
        LinearLayout.LayoutParams gap = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        gap.leftMargin = dp(8);
        Button diag = cinemaButton("\uD83D\uDEE0", this::showDiagnostic);
        top.addView(diag, gap);
        Button close = cinemaButton("\u2715 Ie\u0219i", this::exitCinema);
        LinearLayout.LayoutParams closeLp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        closeLp.leftMargin = dp(8);
        top.addView(close, closeLp);
        box.addView(top);

        seekBar = new SeekBar(this);
        seekBar.setMax(1000);
        seekBar.setPadding(dp(8), dp(12), dp(8), dp(12));
        seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int progress, boolean fromUser) {
                if (fromUser && videoDuration > 0) {
                    timeLabel.setText(fmt(progress / 1000.0 * videoDuration) + " / " + fmt(videoDuration));
                }
            }
            @Override public void onStartTrackingTouch(SeekBar sb) {
                userSeeking = true;
                handler.removeCallbacks(hideCinemaControls);
            }
            @Override public void onStopTrackingTouch(SeekBar sb) {
                userSeeking = false;
                if (videoDuration > 0) broadcast("seekto:" + (sb.getProgress() / 1000.0 * videoDuration));
                showCinemaControls();
            }
        });
        box.addView(seekBar, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.addView(cinemaButton("\u23EA 10", () -> broadcast("seek:-10")), weight());
        playButton = cinemaButton("\u23F8", () -> broadcast("toggle"));
        row.addView(playButton, weight());
        row.addView(cinemaButton("10 \u23E9", () -> broadcast("seek:10")), weight());
        row.addView(cinemaButton("\u23ED Urm\u0103torul", this::nextEpisode), weight());
        box.addView(row);
        return box;
    }

    /** Arata un text despre pagina de episod (butoane, video-uri), pe care il poti copia si trimite. */
    private void showDiagnostic() {
        webView.evaluateJavascript("window.__rfDiag ? window.__rfDiag() : 'diagnostic indisponibil'", result -> {
            String text;
            try {
                text = new org.json.JSONArray("[" + result + "]").getString(0);
            } catch (Exception e) {
                text = String.valueOf(result);
            }
            final String diag = appVersion() + " " + text;
            TextView tv = new TextView(this);
            tv.setText(diag);
            tv.setTextIsSelectable(true);
            tv.setTextSize(11);
            tv.setPadding(dp(16), dp(8), dp(16), dp(8));
            android.widget.ScrollView sv = new android.widget.ScrollView(this);
            sv.addView(tv);
            new android.app.AlertDialog.Builder(this)
                    .setTitle("Diagnostic " + appVersion())
                    .setView(sv)
                    .setPositiveButton("Copiaz\u0103", (d, w) -> {
                        android.content.ClipboardManager cm =
                                (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                        cm.setPrimaryClip(android.content.ClipData.newPlainText("ReelFren diagnostic", diag));
                        Toast.makeText(this, "Copiat. Lipe\u0219te-l \u00een chat.", Toast.LENGTH_LONG).show();
                    })
                    .setNegativeButton("\u00CEnchide", null)
                    .show();
        });
    }

    private String appVersion() {
        try {
            return "v" + getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private LinearLayout.LayoutParams weight() {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(48), 1);
        lp.setMargins(dp(4), dp(4), dp(4), 0);
        return lp;
    }

    private Button cinemaButton(String text, Runnable action) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(15);
        b.setBackgroundColor(Color.parseColor("#33FFFFFF"));
        b.setPadding(dp(8), 0, dp(8), 0);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        b.setMinHeight(0);
        b.setMinimumHeight(dp(40));
        b.setOnClickListener(v -> { action.run(); showCinemaControls(); });
        return b;
    }

    private static String fmt(double sec) {
        if (!(sec >= 0) || Double.isInfinite(sec)) sec = 0;
        int s = (int) sec;
        int h = s / 3600, m = (s % 3600) / 60, r = s % 60;
        return h > 0 ? String.format(java.util.Locale.US, "%d:%02d:%02d", h, m, r)
                : String.format(java.util.Locale.US, "%d:%02d", m, r);
    }

    private void showControls() {
        if (controls == null) return;
        controls.setVisibility(View.VISIBLE);
        handler.removeCallbacks(hideControls);
        handler.postDelayed(hideControls, 4000);
    }

    private View buildControls() {
        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setPadding(dp(8), dp(8), dp(8), dp(8));
        bar.setBackgroundColor(Color.parseColor("#99000000"));
        bar.addView(controlButton("\u23EA 10s", () -> seek(-10)));
        bar.addView(controlButton("10s \u23E9", () -> seek(10)));
        bar.addView(controlButton("\u23EA 1m", () -> seek(-60)));
        bar.addView(controlButton("1m \u23E9", () -> seek(60)));
        bar.addView(controlButton("Episodul urm\u0103tor \u23ED", this::nextEpisode));
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        bar.setLayoutParams(lp);
        return bar;
    }

    private Button controlButton(String text, Runnable action) {
        Button b = new Button(this);
        b.setText(text);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(14);
        b.setBackgroundColor(Color.parseColor("#33FFFFFF"));
        b.setPadding(dp(12), 0, dp(12), 0);
        b.setMinWidth(0);
        b.setMinimumWidth(0);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, dp(40));
        lp.setMargins(dp(4), 0, dp(4), 0);
        b.setLayoutParams(lp);
        b.setOnClickListener(v -> { action.run(); showControls(); });
        return b;
    }

    private void seek(int seconds) {
        String msg = "seek:" + seconds;
        for (JavaScriptReplyProxy p : new ArrayList<>(framesOf(webView))) {
            try { p.postMessage(msg); } catch (Exception ignored) { }
        }
        // si direct in pagina principala (daca video-ul e acolo)
        webView.evaluateJavascript(
                "(function(){var d=" + seconds + ";document.querySelectorAll('video').forEach(function(v){"
                + "if(!window.RFBridge){v.currentTime=Math.max(0,v.currentTime+d);}});})()", null);
        Toast.makeText(this, (seconds > 0 ? "+" : "") + seconds + "s", Toast.LENGTH_SHORT).show();
    }

    private void nextEpisode() { changeEpisode(true); }

    private boolean changing = false;

    /** Episodul urmator/anterior: intai lista de episoade a site-ului, apoi un swipe real in pagina. */
    private void changeEpisode(boolean next) {
        if (changing) return;
        changing = true;
        handler.postDelayed(() -> changing = false, 3000);
        Toast.makeText(this, next ? "Episodul urm\u0103tor\u2026" : "Episodul anterior\u2026", Toast.LENGTH_SHORT).show();
        if (fullscreenView != null) chromeClient.onHideCustomView();

        // in modul usor pagina ramane neatinsa, deci nu trebuie sa iesim din ecranul mare
        final boolean wasCinema = cinema && !cinemaLight;
        webView.evaluateJavascript("window.__rfState ? window.__rfState() : ''", before -> {
            // 1) ridicam pentru o clipa "ecranul mare", ca pagina sa aiba din nou aranjarea ei normala
            if (wasCinema) broadcast("cinema:0");
            handler.postDelayed(() -> {
                // 2) metodele directe: Swiper, lista EP, adresa, derulare
                String js = next ? "window.__rfNext ? window.__rfNext() : false" : "window.__rfPrev ? window.__rfPrev() : false";
                webView.evaluateJavascript(js, result -> {
                    final boolean handled = result != null && !"false".equals(result) && !"null".equals(result);
                    final String method = handled ? result.replace("\"", "") : "swipe simulat";
                    // 3) altfel: un swipe real in pagina, ca un deget
                    if (!handled) swipePage(next);
                    handler.postDelayed(() -> {
                        // 4) punem pe tot ecranul video-ul care se vede acum
                        if (wasCinema && cinema) broadcast("cinema:1");
                        // 5) verificam ca episodul chiar s-a schimbat
                        handler.postDelayed(() -> webView.evaluateJavascript(
                                "window.__rfState ? window.__rfState() : ''", after -> {
                                    if (after != null && after.equals(before)) {
                                        Toast.makeText(this, "Episodul nu s-a schimbat (metoda: " + method
                                                + "). Ap\u0103s\u0103 \uD83D\uDEE0 \u0219i trimite diagnosticul.", Toast.LENGTH_LONG).show();
                                    }
                                }), 800);
                    }, 1700);
                });
            }, wasCinema ? 350 : 0);
        });
    }

    private void swipePage(boolean next) {
        int w = webView.getWidth(), h = webView.getHeight();
        final float x = w / 2f;
        final float y0 = next ? h * 0.75f : h * 0.30f;
        final float y1 = next ? h * 0.30f : h * 0.75f;
        final long down = SystemClock.uptimeMillis();
        touch(MotionEvent.ACTION_DOWN, down, x, y0);
        final int steps = 10;
        for (int i = 1; i <= steps; i++) {
            final float y = y0 + (y1 - y0) * i / steps;
            handler.postDelayed(() -> touch(MotionEvent.ACTION_MOVE, down, x, y), i * 16L);
        }
        handler.postDelayed(() -> touch(MotionEvent.ACTION_UP, down, x, y1), (steps + 1) * 16L);
    }

    private void touch(int action, long downTime, float x, float y) {
        MotionEvent e = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, x, y, 0);
        e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
        webView.dispatchTouchEvent(e);
        e.recycle();
    }

    // ------------------------------------------------------------------ DramaFren

    private final Hub.Owner hubOwner = new Hub.Owner() {
        @Override public WebView createCrawler() {
            // robotul: o pagina ascunsa in spatele celorlalte, care trece pe rand prin site-uri
            crawler = createWebView();
            crawler.getSettings().setMediaPlaybackRequiresUserGesture(true);
            // robotul nu are nevoie de imagini: paginile se incarca mult mai repede
            crawler.getSettings().setBlockNetworkImage(true);
            if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                WebViewCompat.addDocumentStartJavaScript(crawler, "window.__dfCrawl=1;", Collections.singleton("*"));
            }
            root.addView(crawler, 0, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            return crawler;
        }

        @Override public void toCatalog(String msg) {
            if (tabs.isEmpty()) return;
            for (JavaScriptReplyProxy p : new ArrayList<>(framesOf(tabs.get(0)))) {
                try { p.postMessage(msg); } catch (Exception ignored) { }
            }
        }

        @Override public void openUrl(String url, String openJs) {
            Uri u = Uri.parse(url);
            if (u.getHost() != null) userAllowedHosts.add(u.getHost().toLowerCase());
            openTab(url, openJs);
        }

        @Override public void allowHost(String host) { userAllowedHosts.add(host); }

        @Override public void copyText(String label, String text) {
            android.content.ClipboardManager cm = (android.content.ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
            if (cm != null) cm.setPrimaryClip(android.content.ClipData.newPlainText(label, text));
        }

        @Override public void toast(String text) { Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show(); }
    };

    /** Pagina listei (din aplicatie) si posterele care nu se incarca direct (cerute cu adresa site-ului). */
    private WebResourceResponse serveHubAsset(Uri uri) {
        try {
            String path = uri.getPath() == null ? "" : uri.getPath();
            if (path.equals("/img")) {
                String img = uri.getQueryParameter("u"), k = uri.getQueryParameter("k");
                String host = k != null && k.contains("|") ? k.substring(0, k.indexOf('|')) : Uri.parse(img).getHost();
                byte[] b = Hub.download(img, "https://" + host + "/");
                return new WebResourceResponse("image/jpeg", null, new java.io.ByteArrayInputStream(b));
            }
            String name = path.length() > 1 ? path.substring(1) : "catalog.html";
            if (!name.equals("catalog.html")) return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    null, new java.io.ByteArrayInputStream(new byte[0]));
            return new WebResourceResponse("text/html", "utf-8", getAssets().open(name));
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    null, new java.io.ByteArrayInputStream(new byte[0]));
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (Exception e) {
            return "";
        }
    }

    private View buildErrorView() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(Color.parseColor("#101014"));
        box.setPadding(dp(32), dp(32), dp(32), dp(32));

        TextView msg = new TextView(this);
        msg.setText("Nu se poate incarca site-ul.\nVerifica conexiunea la internet.");
        msg.setTextColor(Color.WHITE);
        msg.setTextSize(16);
        msg.setGravity(Gravity.CENTER);
        box.addView(msg);

        Button retry = new Button(this);
        retry.setText("Reincearca");
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(24);
        retry.setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            String url = webView.getUrl();
            if (url == null || url.startsWith("about:")) webView.loadUrl(homeUrl());
            else webView.reload();
        });
        box.addView(retry, lp);
        return box;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (cinema) {
            exitCinema();
        } else if (fullscreenView != null) {
            chromeClient.onHideCustomView();
        } else if (errorView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            errorView.setVisibility(View.GONE);
            webView.goBack();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else if (closeTab()) {
            // inapoi la lista de seriale, exact cum era
        } else {
            super.onBackPressed();
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, android.content.Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        Uri uri = resultCode == RESULT_OK && data != null ? data.getData() : null;
        if (requestCode == REQ_SAVE_BACKUP) {
            java.io.File tmp = new java.io.File(getCacheDir(), "pending-backup.json");
            if (uri != null) {
                try (java.io.OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                    byte[] bytes;
                    if (tmp.exists()) {
                        bytes = new byte[(int) tmp.length()];
                        try (java.io.FileInputStream fi = new java.io.FileInputStream(tmp)) {
                            int off = 0, n;
                            while (off < bytes.length && (n = fi.read(bytes, off, bytes.length - off)) > 0) off += n;
                        }
                    } else if (pendingBackup != null) {
                        bytes = pendingBackup.getBytes(StandardCharsets.UTF_8);
                    } else {
                        throw new java.io.IOException("no data");
                    }
                    out.write(bytes);
                    Toast.makeText(this, "Backup salvat (" + Math.max(1, bytes.length / 1024) + " KB)", Toast.LENGTH_SHORT).show();
                } catch (Exception e) {
                    Toast.makeText(this, "Backup-ul nu s-a putut salva. \u00cencearc\u0103 din nou.", Toast.LENGTH_LONG).show();
                }
            }
            tmp.delete();
            pendingBackup = null;
        } else if (requestCode == REQ_OPEN_FILE) {
            if (fileCallback != null) fileCallback.onReceiveValue(uri != null ? new Uri[]{uri} : null);
            fileCallback = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (hub != null) hub.saveNow();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        if (hub != null) { hub.stopCrawl(); hub.saveNow(); }
        if (crawler != null) crawler.destroy();
        for (WebView w : tabs) w.destroy();
        super.onDestroy();
    }
}
