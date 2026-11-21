package app.bellmont.city;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Shader;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Map;

/**
 * Notifications from the game's server (Firebase Cloud Messaging), shown by the app itself: Bellmont City's name
 * and icon; a big picture only when another player is involved — theirs, round, or their initial in a circle.
 */
public class Messaging extends FirebaseMessagingService {
    private static final String CHANNEL = Chats.CHANNEL;

    @Override
    public void onNewToken(String token) {
        // (Passed to the game the next time it opens.)
        getSharedPreferences(StartActivity.PREFS, MODE_PRIVATE).edit().putString("fcm", token).apply();
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        Map<String, String> d = message.getData();
        String title = d.containsKey("title") ? d.get("title") : "Bellmont City";
        String body = d.containsKey("body") ? d.get("body") : "";
        String tag = d.containsKey("tag") ? d.get("tag") : String.valueOf(System.currentTimeMillis());
        String link = d.containsKey("link") ? d.get("link") : "/";

        Chats.ensureChannel(this);
        // A message that was unsent: out of its notification.
        if ("unsend".equals(d.get("kind"))) { Chats.unsent(this, d.get("friend"), d.get("id")); return; }
        // A friend's chat message: its own notification per friend, with Reply.
        if ("msg".equals(d.get("kind")) && d.get("friend") != null) {
            try {
                org.json.JSONObject info = new org.json.JSONObject();
                for (String k : new String[] { "friend", "id", "name", "title", "reply", "you", "more", "replyLabel", "icon", "who" }) {
                    if (d.get(k) != null) info.put(k, d.get(k));
                }
                Chats.received(this, info, body, picture(d.get("icon"), d.get("who")));
            } catch (Exception ignored) { /* */ }
            return;
        }
        Intent open = new Intent(this, StartActivity.class).putExtra("link", link).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder n = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#FFB547"))
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setGroup(Chats.GROUP)
                .setContentIntent(tap);
        Bitmap pic = picture(d.get("icon"), d.get("who"));
        if (pic != null) n.setLargeIcon(pic);

        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        NotificationManagerCompat.from(this).notify(tag, 1, n.build());
        Chats.summary(this);
    }

    /** The other player's picture cut into a circle, or their initial in a coloured circle; null if no player. */
    static Bitmap picture(String url, String who) {
        final int S = 192;
        Bitmap out = Bitmap.createBitmap(S, S, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(out);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        if (url != null && !url.isEmpty()) {
            try {
                HttpURLConnection con = (HttpURLConnection) new URL(url).openConnection();
                con.setConnectTimeout(5000);
                con.setReadTimeout(5000);
                Bitmap src;
                try (InputStream in = con.getInputStream()) { src = BitmapFactory.decodeStream(in); }
                if (src != null) {
                    float k = Math.max((float) S / src.getWidth(), (float) S / src.getHeight());
                    Matrix m = new Matrix();
                    m.setScale(k, k);
                    m.postTranslate((S - src.getWidth() * k) / 2f, (S - src.getHeight() * k) / 2f);
                    BitmapShader sh = new BitmapShader(src, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP);
                    sh.setLocalMatrix(m);
                    p.setShader(sh);
                    c.drawCircle(S / 2f, S / 2f, S / 2f, p);
                    return out;
                }
            } catch (Exception ignored) { /* (then their initial) */ }
        }
        if (who == null) return null;
        String name = who.isEmpty() ? "?" : who;
        int hue = 0;
        for (int i = 0; i < name.length(); i++) hue += name.charAt(i);
        p.setColor(Color.HSVToColor(new float[] { hue % 360, 0.7f, 0.65f }));
        c.drawCircle(S / 2f, S / 2f, S / 2f, p);
        Paint t = new Paint(Paint.ANTI_ALIAS_FLAG);
        t.setColor(Color.WHITE);
        t.setTextSize(92f);
        t.setFakeBoldText(true);
        t.setTextAlign(Paint.Align.CENTER);
        String letter = name.substring(0, name.offsetByCodePoints(0, 1)).toUpperCase();
        c.drawText(letter, S / 2f, S / 2f - (t.descent() + t.ascent()) / 2f, t);
        return out;
    }
}
