package net.reelfren.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.ActivityInfo;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.MotionEvent;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
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

    private static final String HOME_URL = "https://reelfren.net/";

    /** Domenii in care aplicatia are voie sa navigheze. Restul (reclame, redirecturi) sunt blocate. */
    private static final String[] ALLOWED_DOMAINS = { "reelfren.net" };

    private FrameLayout root;
    private WebView webView;
    private ProgressBar progress;
    private View errorView;

    private ChromeClient chromeClient;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    /** Containerul de fullscreen: video + butoanele noastre (derulare / episod urmator). */
    private FrameLayout fullscreenBox;
    private View controls;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable hideControls = () -> { if (controls != null) controls.setVisibility(View.GONE); };

    private String playerJs = "";
    private boolean startScriptInjected = false;
    /** Canale catre fiecare frame (pagina + iframe-ul playerului), ca sa putem derula video-ul. */
    private final List<JavaScriptReplyProxy> frames = new ArrayList<>();

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#101014"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#101014"));
        root.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setVisibility(View.GONE);
        root.addView(progress, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(4), Gravity.TOP));

        errorView = buildErrorView();
        errorView.setVisibility(View.GONE);
        root.addView(errorView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);

        WebSettings s = webView.getSettings();
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
        cookies.setAcceptThirdPartyCookies(webView, true);

        playerJs = readAsset("player.js");
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(webView, "RFBridge", Collections.singleton("*"),
                    (view, message, sourceOrigin, isMainFrame, replyProxy) -> {
                        if ("hello".equals(message.getData()) && !frames.contains(replyProxy)) {
                            frames.add(replyProxy);
                        }
                    });
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            WebViewCompat.addDocumentStartJavaScript(webView, playerJs, Collections.singleton("*"));
            startScriptInjected = true;
        }

        webView.setWebViewClient(new Client());
        chromeClient = new ChromeClient();
        webView.setWebChromeClient(chromeClient);

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(HOME_URL);
        }
    }

    private static boolean isAllowed(Uri uri) {
        String host = uri.getHost();
        if (host == null) return false;
        host = host.toLowerCase();
        for (String d : ALLOWED_DOMAINS) {
            if (host.equals(d) || host.endsWith("." + d)) return true;
        }
        return false;
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Iframe-urile (de ex. playerul video) pot fi pe alte domenii; blocam doar pagina principala.
            if (!request.isForMainFrame()) return false;
            Uri uri = request.getUrl();
            String scheme = uri.getScheme();
            if (("http".equals(scheme) || "https".equals(scheme)) && isAllowed(uri)) {
                return false;
            }
            Toast.makeText(MainActivity.this, "Link extern blocat", Toast.LENGTH_SHORT).show();
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            frames.clear();
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (!startScriptInjected) view.evaluateJavascript(playerJs, null);
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) {
                errorView.setVisibility(View.VISIBLE);
            }
        }
    }

    private class ChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progress.setProgress(newProgress);
            progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
            return false; // pop-up blocat
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
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
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
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
        for (JavaScriptReplyProxy p : new ArrayList<>(frames)) {
            try { p.postMessage(msg); } catch (Exception ignored) { }
        }
        // si direct in pagina principala (daca video-ul e acolo)
        webView.evaluateJavascript(
                "(function(){var d=" + seconds + ";document.querySelectorAll('video').forEach(function(v){"
                + "if(!window.RFBridge){v.currentTime=Math.max(0,v.currentTime+d);}});})()", null);
        Toast.makeText(this, (seconds > 0 ? "+" : "") + seconds + "s", Toast.LENGTH_SHORT).show();
    }

    private void nextEpisode() {
        webView.evaluateJavascript("window.__rfNext ? window.__rfNext() : false", result -> {
            if ("true".equals(result)) {
                if (fullscreenView != null) chromeClient.onHideCustomView();
                Toast.makeText(this, "Episodul urm\u0103tor\u2026", Toast.LENGTH_SHORT).show();
            } else {
                // poate butonul e in interiorul playerului (iframe)
                for (JavaScriptReplyProxy p : new ArrayList<>(frames)) {
                    try { p.postMessage("next"); } catch (Exception ignored) { }
                }
                Toast.makeText(this, "Caut episodul urm\u0103tor in player\u2026", Toast.LENGTH_SHORT).show();
            }
        });
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
            if (url == null || url.startsWith("about:")) webView.loadUrl(HOME_URL);
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
        if (fullscreenView != null) {
            chromeClient.onHideCustomView();
        } else if (errorView.getVisibility() == View.VISIBLE && webView.canGoBack()) {
            errorView.setVisibility(View.GONE);
            webView.goBack();
        } else if (webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
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
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
