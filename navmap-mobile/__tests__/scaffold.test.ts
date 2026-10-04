import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

test('bare RN scaffold present: entry, app.json, gradle scripts', () => {
  for (const f of [
    'index.js',
    'app.json',
    'babel.config.js',
    'metro.config.js',
    'android/settings.gradle',
    'android/build.gradle',
    'android/app/build.gradle',
    'android/app/src/main/java/com/navmapprototype/MainApplication.kt',
  ]) {
    expect(existsSync(join(root, f))).toBe(true);
  }
});

test('index.js registers NavMapPrototype; app.json names it', () => {
  const entry = read('index.js');
  expect(entry).toMatch(/registerComponent/);
  expect(entry).toMatch(/app\.json/);
  expect(JSON.parse(read('app.json')).name).toBe('NavMapPrototype');
});

test('android app gradle targets com.navmapprototype with RN-compatible SDKs', () => {
  const app = read('android/app/build.gradle');
  expect(app).toMatch(/applicationId\s+["']com\.navmapprototype["']/);
  expect(app).toMatch(/minSdkVersion\s+24/);
  expect(app).toMatch(/targetSdkVersion\s+3\d/);
  expect(app).toMatch(/com\.facebook\.react/);
});

test('MainApplication wires WifiScanPackage (+ autolinked packages)', () => {
  const kt = read(
    'android/app/src/main/java/com/navmapprototype/MainApplication.kt',
  );
  expect(kt).toMatch(/WifiScanPackage/);
  expect(kt).toMatch(/class MainApplication/);
  expect(kt).toMatch(/ReactApplication/);
});

test('existing Kotlin bridge + manifests untouched in place', () => {
  for (const f of [
    'android/app/src/main/java/com/navmapprototype/WifiScanModule.kt',
    'android/app/src/main/java/com/navmapprototype/AnchorQrModule.kt',
    'android/app/src/main/java/com/navmapprototype/WifiScanPackage.kt',
    'android/app/src/main/java/com/navmapprototype/MainActivity.kt',
    'android/app/src/main/AndroidManifest.xml',
  ]) {
    expect(existsSync(join(root, f))).toBe(true);
  }
  expect(read('android/app/src/main/AndroidManifest.xml')).toMatch(
    /navmap.*anchor/,
  );
});

test('npm run android attempts a real run (not echo)', () => {
  const pkg = JSON.parse(read('package.json'));
  expect(pkg.scripts.android).toMatch(/react-native run-android|gradlew/);
  expect(pkg.scripts.android).not.toMatch(/^\s*echo\b/);
});

test('gradle scripts are brace-balanced (syntax smoke check)', () => {
  for (const f of [
    'android/settings.gradle',
    'android/build.gradle',
    'android/app/build.gradle',
  ]) {
    const s = read(f);
    const opens = (s.match(/{/g) ?? []).length;
    const closes = (s.match(/}/g) ?? []).length;
    expect(`${f}: ${opens} vs ${closes}`).toBe(`${f}: ${opens} vs ${opens}`);
    expect(closes).toBeGreaterThan(0);
  }
});
