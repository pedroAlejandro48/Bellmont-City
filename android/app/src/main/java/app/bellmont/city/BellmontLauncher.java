package app.bellmont.city;

import android.content.pm.PackageManager;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

/**
 * Opens the game like the standard launcher, but in Chrome when it's installed (whatever the default browser is):
 * Chrome hands the site's notifications to this app, so they show as Bellmont City with the game's icon. Browsers
 * like Brave would show them as their own. Without Chrome, the default browser is used.
 */
public class BellmontLauncher extends LauncherActivity {
    private static final String[] CHROMES = { "com.android.chrome", "com.chrome.beta", "com.chrome.dev" };

    @Override
    protected TwaLauncher createTwaLauncher() {
        for (String pkg : CHROMES) {
            if (enabled(pkg)) return new TwaLauncher(this, pkg);
        }
        return super.createTwaLauncher();
    }

    private boolean enabled(String pkg) {
        try {
            return getPackageManager().getApplicationInfo(pkg, 0).enabled;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }
}
