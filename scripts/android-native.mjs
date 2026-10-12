// Applies Morning Box branding to the generated Android project (safe to re-run):
// launcher icon from the approved PWA icon, Warm Ivory splash and window
// background, and dark status/navigation bar icons on the ivory screens.
// Icon resizing uses macOS `sips`; on other systems the Capacitor default icons stay.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RES = join('android', 'app', 'src', 'main', 'res');
const ICON = join('public', 'icons', 'morning-box-512.png');
const IVORY = '#FBF7EF';
const ESPRESSO = '#3B2D22';
if (!existsSync(RES)) { console.error('[native] android/ not found — run `npx cap add android` first'); process.exit(1); }

/* Launcher icons: legacy (48dp) and adaptive foreground (108dp) per density. */
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
if (process.platform === 'darwin') {
  for (const [d, k] of Object.entries(DENSITIES)) {
    const dir = join(RES, `mipmap-${d}`);
    const resize = (size, out) => execFileSync('sips', ['-z', String(size), String(size), ICON, '--out', join(dir, out)], { stdio: 'ignore' });
    resize(Math.round(48 * k), 'ic_launcher.png');
    resize(Math.round(48 * k), 'ic_launcher_round.png');
    resize(Math.round(108 * k), 'ic_launcher_foreground.png');
  }
}
writeFileSync(join(RES, 'values', 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${IVORY}</color>\n</resources>\n`);

/* Splash: plain Warm Ivory with the app icon (Android 12+ splash API, and older devices). */
for (const dir of readdirSync(RES).filter(d => d.startsWith('drawable'))) {
  for (const f of ['splash.png', 'splash.xml']) rmSync(join(RES, dir, f), { force: true });
}
writeFileSync(join(RES, 'drawable', 'splash.xml'), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/mbIvory" />
    <item android:width="160dp" android:height="160dp" android:gravity="center" android:drawable="@mipmap/ic_launcher_foreground" />
</layer-list>
`);
writeFileSync(join(RES, 'values', 'colors.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="colorPrimary">${IVORY}</color>
    <color name="colorPrimaryDark">${IVORY}</color>
    <color name="colorAccent">#D99A12</color>
    <color name="mbIvory">${IVORY}</color>
    <color name="mbEspresso">${ESPRESSO}</color>
</resources>
`);
writeFileSync(join(RES, 'values', 'styles.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <!-- Light app: ivory window, dark status and navigation bar icons. -->
    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.Light.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
        <item name="android:windowBackground">@color/mbIvory</item>
        <item name="android:statusBarColor">@color/mbIvory</item>
        <item name="android:navigationBarColor">@color/mbIvory</item>
        <item name="android:windowLightStatusBar">true</item>
        <item name="android:windowLightNavigationBar">true</item>
    </style>

    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash</item>
        <item name="windowSplashScreenBackground">@color/mbIvory</item>
        <item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
    </style>
</resources>
`);

/* The keyboard resizes the app instead of covering the focused field. */
const manifest = join('android', 'app', 'src', 'main', 'AndroidManifest.xml');
let m = readFileSync(manifest, 'utf8');
if (!m.includes('windowSoftInputMode')) {
  m = m.replace('android:name=".MainActivity"', 'android:name=".MainActivity"\n            android:windowSoftInputMode="adjustResize"');
  writeFileSync(manifest, m);
}
/* Keep customers signed in: write WebView cookies to disk whenever the app goes
   to the background (Android otherwise saves them only every ~30 s, so closing the
   app soon after signing in would sign the customer out). */
const javaDir = join('android', 'app', 'src', 'main', 'java', 'ae', 'morningbox', 'app');
writeFileSync(join(javaDir, 'MainActivity.java'), `package ae.morningbox.app;

import android.webkit.CookieManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
    }
}
`);
/* Release signing and versioning, read from the environment so no key or password
   is ever stored in the project:
     MB_KEYSTORE, MB_KEYSTORE_PASSWORD, MB_KEY_ALIAS, MB_KEY_PASSWORD
     MB_VERSION_CODE (whole number, +1 for every Play upload), MB_VERSION_NAME (e.g. 1.0.0) */
const gradleFile = join('android', 'app', 'build.gradle');
let g = readFileSync(gradleFile, 'utf8');
if (!g.includes('MB_KEYSTORE')) {
  g = g.replace('versionCode 1', "versionCode((System.getenv('MB_VERSION_CODE') ?: '1') as int)")
    .replace('versionName "1.0"', "versionName(System.getenv('MB_VERSION_NAME') ?: '1.0.0')")
    .replace('    buildTypes {', `    signingConfigs {
        release {
            if (System.getenv('MB_KEYSTORE')) {
                storeFile file(System.getenv('MB_KEYSTORE'))
                storePassword System.getenv('MB_KEYSTORE_PASSWORD')
                keyAlias System.getenv('MB_KEY_ALIAS')
                keyPassword System.getenv('MB_KEY_PASSWORD')
            }
        }
    }
    buildTypes {`)
    .replace(`        release {
            minifyEnabled false`, `        release {
            if (System.getenv('MB_KEYSTORE')) signingConfig signingConfigs.release
            minifyEnabled false`);
  writeFileSync(gradleFile, g);
}
console.log('[native] Morning Box icon, splash, system bar colours, cookie persistence and release signing applied');
