// Builds the Morning Box Android app with Capacitor.
//
//   npm run apk                                                 # debug APK for the emulator (local server)
//   MB_APP_URL=https://app.example.com npm run apk              # debug APK against a deployed server
//   MB_APP_URL=https://app.example.com npm run apk:release      # signed release APK + AAB for Google Play
//
// Release builds need HTTPS and the signing variables MB_KEYSTORE, MB_KEYSTORE_PASSWORD,
// MB_KEY_ALIAS, MB_KEY_PASSWORD (see scripts/android-native.mjs). Web debugging is off in release.
//
// The native app is a shell around the same web app the server serves, so sessions
// (httpOnly cookie), the API and every screen behave exactly as on the web.
// Requires the Android SDK (ANDROID_HOME or ~/Library/Android/sdk) and JDK 21 (JAVA_HOME).
import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const release = process.argv.includes('--release');
const url = process.env.MB_APP_URL || 'http://10.0.2.2:8787';
const cleartext = url.startsWith('http://');
/* MB_ALLOW_CLEARTEXT_RELEASE=1 is for internal QA against a local server only — never for Play. */
if (release && cleartext && process.env.MB_ALLOW_CLEARTEXT_RELEASE !== '1') { console.error('[apk] A release build needs an https:// MB_APP_URL.'); process.exit(1); }
if (release && !['MB_KEYSTORE', 'MB_KEYSTORE_PASSWORD', 'MB_KEY_ALIAS', 'MB_KEY_PASSWORD'].every(k => process.env[k])) {
  console.error('[apk] A release build needs MB_KEYSTORE, MB_KEYSTORE_PASSWORD, MB_KEY_ALIAS and MB_KEY_PASSWORD.'); process.exit(1);
}
const sdk = process.env.ANDROID_HOME || (process.platform === 'win32' ? join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : join(homedir(), 'Library', 'Android', 'sdk'));
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });

const config = {
  appId: 'ae.morningbox.app',
  appName: 'Morning Box',
  webDir: 'dist',
  backgroundColor: '#FBF7EF',
  /* Card payments (Stripe Checkout) open inside the app and come back to it. */
  server: { url, cleartext, androidScheme: 'https', errorPath: 'offline.html', allowNavigation: ['checkout.stripe.com', '*.stripe.com'] },
  android: { webContentsDebuggingEnabled: !release, allowMixedContent: false },
  plugins: { SystemBars: { insetsHandling: 'css', style: 'LIGHT' } }
};
writeFileSync('capacitor.config.json', JSON.stringify(config, null, 2) + '\n');
console.log(`[apk] app URL: ${url}${cleartext ? ' (cleartext — development only)' : ''}`);

run('npx vite build');
/* Shown instead of a blank screen when the server can't be reached. */
const logo = `data:image/png;base64,${readFileSync(join('public', 'icons', 'morning-box-192.png')).toString('base64')}`;
writeFileSync(join('dist', 'offline.html'), readFileSync(join('scripts', 'offline.html'), 'utf8')
  .replace('__MB_APP_URL__', url).replace('icons/morning-box-192.png', logo));
if (!existsSync('android')) {
  run('npx cap add android');
}
run('node scripts/android-native.mjs');
/* The smaller Gradle "bin" distribution is enough to build. */
const wrapper = join('android', 'gradle', 'wrapper', 'gradle-wrapper.properties');
writeFileSync(wrapper, readFileSync(wrapper, 'utf8').replace(/-all\.zip/, '-bin.zip'));
run('npx cap sync android');
writeFileSync(join('android', 'local.properties'), `sdk.dir=${sdk.replace(/\\/g, '/')}\n`);
const gradlew = process.platform === 'win32' ? '.\\gradlew.bat' : './gradlew';
mkdirSync('apk', { recursive: true });
if (release) {
  run(`${gradlew} assembleRelease bundleRelease --console=plain`, { cwd: 'android' });
  const outs = [
    [join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk'), join('apk', 'morning-box-release.apk')],
    [join('android', 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab'), join('apk', 'morning-box-release.aab')]
  ];
  for (const [from, to] of outs) { rmSync(to, { force: true }); copyFileSync(from, to); console.log(`[apk] built ${to}`); }
} else {
  run(`${gradlew} assembleDebug --console=plain`, { cwd: 'android' });
  const out = join('apk', 'morning-box-debug.apk');
  rmSync(out, { force: true });
  copyFileSync(join('android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), out);
  console.log(`[apk] built ${out}`);
}
