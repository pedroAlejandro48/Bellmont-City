package app.bellmont.city;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;
import androidx.core.app.RemoteInput;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** An answer typed into a message notification: sent to the friend through the game's server, then shown under it. */
public class ReplyReceiver extends BroadcastReceiver {
    private static final String SERVER = "https://bellmont-push.bellmont-city.workers.dev/reply";

    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle in = RemoteInput.getResultsFromIntent(intent);
        String friend = intent.getStringExtra("friend");
        CharSequence typed = in == null ? null : in.getCharSequence(Chats.KEY_REPLY);
        if (friend == null || typed == null || typed.toString().trim().isEmpty()) {
            if (friend != null) Chats.failed(context, friend);
            return;
        }
        final String text = typed.toString();
        final Context app = context.getApplicationContext();
        final PendingResult done = goAsync();
        new Thread(() -> {
            boolean ok = false;
            try {
                HttpURLConnection con = (HttpURLConnection) new URL(SERVER).openConnection();
                con.setRequestMethod("POST");
                con.setConnectTimeout(10000);
                con.setReadTimeout(10000);
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                byte[] body = new JSONObject().put("token", Chats.token(app, friend)).put("text", text).toString().getBytes(StandardCharsets.UTF_8);
                try (OutputStream out = con.getOutputStream()) { out.write(body); }
                ok = con.getResponseCode() == 200;
                con.disconnect();
            } catch (Exception ignored) { /* (shown as not sent) */ }
            if (ok) Chats.replied(app, friend, text); else Chats.failed(app, friend);
            done.finish();
        }).start();
    }
}
