package app.bellmont.city;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.service.notification.StatusBarNotification;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.RemoteInput;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Chat messages from friends, one notification per friend: "Message from <name>", their message(s) and your answers
 * ("You replied: …"), the latest two only (a third pushes the oldest out). Expanded, up to 6 lines, then "… more".
 * A Reply button opens a text box with a send (paper plane) button; the answer is sent by ReplyReceiver and shows
 * under their message. An unsent message disappears from it. Notifications of different friends (and other kinds) stack in one expandable group.
 */
final class Chats {
    static final String CHANNEL = "bellmont";
    static final String GROUP = "bellmont";
    static final String KEY_REPLY = "reply_text";
    private static final String PREFS = "bellmont-chats";
    private static final int KEEP = 2, LINES = 6, LINE_CHARS = 40;

    private Chats() {}

    static void ensureChannel(Context c) {
        NotificationManager nm = c.getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Bellmont City", NotificationManager.IMPORTANCE_HIGH));
        }
    }

    static boolean allowed(Context c) {
        return Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private static boolean showing(Context c, String tag) {
        if (Build.VERSION.SDK_INT < 23) return true;
        try {
            for (StatusBarNotification n : c.getSystemService(NotificationManager.class).getActiveNotifications()) {
                if (tag.equals(n.getTag())) return true;
            }
        } catch (Exception ignored) { /* (then: not showing) */ }
        return false;
    }

    private static SharedPreferences prefs(Context c) { return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE); }

    /** A message arrived from a friend (data from the game's server). */
    static void received(Context c, JSONObject info, String text, Bitmap pic) {
        String friend = info.optString("friend");
        String tag = "msg-" + friend;
        JSONArray lines = history(c, friend);
        // (A friend's notification that was opened or swiped away starts over.)
        if (!showing(c, tag)) lines = new JSONArray();
        lines = add(lines, false, text, info.optString("id"));
        save(c, friend, info, lines);
        show(c, friend, pic, false, null);
    }

    /** This player answered from the notification: their answer is added under the friend's message. */
    static void replied(Context c, String friend, String text, String id) {
        save(c, friend, null, add(history(c, friend), true, text, id));
        show(c, friend, null, true, null);
    }

    /** A message was unsent: it leaves the notification as if it had never been there (the box goes if empty). */
    static void unsent(Context c, String friend, String id) {
        if (id == null || id.isEmpty()) return;
        JSONArray lines = history(c, friend), kept = new JSONArray();
        boolean found = false;
        for (int i = 0; i < lines.length(); i++) {
            JSONObject l = lines.optJSONObject(i);
            if (l != null && id.equals(l.optString("id"))) found = true; else if (l != null) kept.put(l);
        }
        if (!found) return;
        save(c, friend, null, kept);
        if (!showing(c, "msg-" + friend)) return;
        if (kept.length() == 0) NotificationManagerCompat.from(c).cancel("msg-" + friend, 1);
        else show(c, friend, null, true, null);
    }

    /** An answer that could not be sent: the notification comes back (so the spinner stops) saying so. */
    static void failed(Context c, String friend) { show(c, friend, null, true, "Not sent"); }

    static String token(Context c, String friend) {
        try { return new JSONObject(prefs(c).getString("info-" + friend, "{}")).optString("reply", ""); } catch (Exception e) { return ""; }
    }

    private static JSONArray history(Context c, String friend) {
        try { return new JSONArray(prefs(c).getString("lines-" + friend, "[]")); } catch (Exception e) { return new JSONArray(); }
    }

    private static JSONArray add(JSONArray lines, boolean mine, String text, String id) {
        JSONArray out = new JSONArray();
        try {
            lines.put(new JSONObject().put("me", mine).put("text", text).put("id", id == null ? "" : id));
            for (int i = Math.max(0, lines.length() - KEEP); i < lines.length(); i++) out.put(lines.get(i));
        } catch (Exception ignored) { /* */ }
        return out;
    }

    private static void save(Context c, String friend, JSONObject info, JSONArray lines) {
        SharedPreferences.Editor e = prefs(c).edit().putString("lines-" + friend, lines.toString());
        if (info != null) e.putString("info-" + friend, info.toString());
        e.apply();
    }

    /** The text shown, cut to about 6 lines with "… more" when it doesn't fit. */
    static String fit(String text, String more) {
        StringBuilder out = new StringBuilder();
        int used = 0;
        String[] paras = text.split("\n", -1);
        for (int p = 0; p < paras.length; p++) {
            String para = paras[p];
            int need = Math.max(1, (para.length() + LINE_CHARS - 1) / LINE_CHARS);
            if (used + need > LINES) {
                int room = (LINES - used) * LINE_CHARS - (more.length() + 5);
                if (room > 0) out.append(para, 0, Math.min(para.length(), room));
                return out.toString().replaceAll("\\s+$", "") + "… " + more;
            }
            out.append(para);
            if (p < paras.length - 1) out.append('\n');
            used += need;
        }
        return out.toString();
    }

    private static void show(Context c, String friend, Bitmap pic, boolean quiet, String note) {
        if (!allowed(c)) return;
        ensureChannel(c);
        JSONObject info;
        try { info = new JSONObject(prefs(c).getString("info-" + friend, "{}")); } catch (Exception e) { info = new JSONObject(); }
        String you = info.optString("you", "You replied:"), more = info.optString("more", "more");
        JSONArray lines = history(c, friend);
        StringBuilder all = new StringBuilder();
        String last = "";
        for (int i = 0; i < lines.length(); i++) {
            JSONObject l = lines.optJSONObject(i);
            if (l == null) continue;
            String t = l.optBoolean("me") ? you + " " + l.optString("text") : l.optString("text");
            if (all.length() > 0) all.append("\n");
            all.append(t);
            last = t;
        }
        String tag = "msg-" + friend;
        Intent open = new Intent(c, StartActivity.class).putExtra("link", "/?chat=" + friend).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(c, tag.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent answer = new Intent(c, ReplyReceiver.class).putExtra("friend", friend).setPackage(c.getPackageName());
        int mutable = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
        PendingIntent send = PendingIntent.getBroadcast(c, tag.hashCode(), answer, PendingIntent.FLAG_UPDATE_CURRENT | mutable);
        String label = info.optString("replyLabel", "Reply");
        RemoteInput box = new RemoteInput.Builder(KEY_REPLY).setLabel(label).build();
        NotificationCompat.Action reply = new NotificationCompat.Action.Builder(R.drawable.ic_send, label, send)
                .addRemoteInput(box).setAllowGeneratedReplies(false).setShowsUserInterface(false)
                .setSemanticAction(NotificationCompat.Action.SEMANTIC_ACTION_REPLY).build();

        NotificationCompat.Builder n = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#FFB547"))
                .setContentTitle(info.optString("title", "Bellmont City"))
                .setContentText(last)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(fit(all.toString(), more)))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setGroup(GROUP)
                .setAutoCancel(true)
                .setOnlyAlertOnce(quiet)
                .setContentIntent(tap)
                .addAction(reply);
        if (quiet) n.setSilent(true);
        if (note != null) n.setSubText(note);
        if (pic == null) pic = Messaging.picture(info.optString("icon", ""), info.optString("who", ""));
        if (pic != null) n.setLargeIcon(pic);
        NotificationManagerCompat.from(c).notify(tag, 1, n.build());
        summary(c);
    }

    /** The group's summary: lets several notifications stack into one that expands to show them all. */
    static void summary(Context c) {
        if (!allowed(c)) return;
        Notification s = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(Color.parseColor("#FFB547"))
                .setContentTitle("Bellmont City")
                .setGroup(GROUP)
                .setGroupSummary(true)
                .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_CHILDREN)
                .setAutoCancel(true)
                .build();
        NotificationManagerCompat.from(c).notify("summary", 0, s);
    }
}
