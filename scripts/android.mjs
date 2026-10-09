// Opens the app on the Android emulator: boots the AVD if needed, forwards the
// app port into the emulator and opens it in Chrome. Run `npm start` (or `npm run dev`) first.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const sdk = process.env.ANDROID_HOME || join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const exe = process.platform === 'win32' ? '.exe' : '';
const adb = join(sdk, 'platform-tools', `adb${exe}`);
const emulator = join(sdk, 'emulator', `emulator${exe}`);
const avd = process.env.AVD || 'MorningBox_Pixel7';
const port = process.argv[2] || '8787';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const run = (...args) => { try { return execFileSync(adb, args, { encoding: 'utf8' }).trim(); } catch { return ''; } };

if (!existsSync(adb) || !existsSync(emulator)) {
  console.error(`Android SDK not found in ${sdk}. Install Android Studio or set ANDROID_HOME.`);
  process.exit(1);
}
try { await fetch(`http://localhost:${port}`); } catch {
  console.error(`Nothing is running on http://localhost:${port}. Start the app first: npm start (or npm run dev, then: npm run android 5173)`);
  process.exit(1);
}

run('start-server');
if (!/\bdevice$/m.test(run('devices'))) {
  console.log(`Starting emulator ${avd}…`);
  spawn(emulator, ['-avd', avd, '-no-snapshot-save'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  run('wait-for-device');
}
process.stdout.write('Waiting for Android to boot');
while (run('shell', 'getprop', 'sys.boot_completed') !== '1') { process.stdout.write('.'); await sleep(2000); }
console.log(' ready');

run('reverse', `tcp:${port}`, `tcp:${port}`);
// Chrome can take a few seconds to become launchable after boot.
for (let i = 0; i < 15 && /Error/.test(run('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `http://localhost:${port}`, 'com.android.chrome')); i++) await sleep(2000);
console.log(`Opened http://localhost:${port} in Chrome on the emulator.`);
