package app.bellmont.city;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.firebase.messaging.FirebaseMessaging;

/**
 * What the app icon opens. The first time, it asks Android for permission to show notifications (Android 13+);
 * then it gets this phone's notification address (Firebase Cloud Messaging token) and opens the game with it
 * (?fcm=…), so the game can tell the notification server which player this phone belongs to. A tapped
 * notification comes here too, with the page to open ("link").
 */
public class StartActivity extends Activity {
    static final String PREFS = "bellmont";
    private static final String HOST = "https://bellmont-city.web.app";
    private boolean opened = false;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        SharedPreferences prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (Build.VERSION.SDK_INT >= 33 && !prefs.getBoolean("asked", false)
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            prefs.edit().putBoolean("asked", true).apply();
            requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, 1);
        } else {
            getToken();
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        getToken();
    }

    private void getToken() {
        // (Waits at most 4 s for the address; the one saved last time is used meanwhile.)
        new Handler(Looper.getMainLooper()).postDelayed(this::open, 4000);
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString("fcm", task.getResult()).apply();
                }
                open();
            });
        } catch (Exception e) {
            open();
        }
    }

    private void open() {
        if (opened || isFinishing()) return;
        opened = true;
        String link = getIntent().getStringExtra("link");
        if (link == null || !link.startsWith("/")) link = "/";
        Uri.Builder url = Uri.parse(HOST + link).buildUpon().appendQueryParameter("app", "android");
        String token = getSharedPreferences(PREFS, MODE_PRIVATE).getString("fcm", null);
        if (token != null) url.appendQueryParameter("fcm", token);
        Intent game = new Intent(Intent.ACTION_VIEW, url.build(), this, LauncherActivity.class);
        startActivity(game);
        finish();
        overridePendingTransition(0, 0);
    }
}
