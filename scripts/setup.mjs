#!/usr/bin/env node
/**
 * DarkBrowser daemon setup
 * Detects system Tor / i2pd / i2prouter; downloads binaries only if nothing is found.
 * Run once with: npm run setup
 */

import { execSync } from 'node:child_process';
import {
  existsSync, mkdirSync, copyFileSync, chmodSync,
  writeFileSync, createWriteStream,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';
import { tmpdir } from 'node:os';

const ROOT   = resolve(fileURLToPath(import.meta.url), '../..');
const HOST   = process.platform;                       // 'linux' | 'win32' | ...
// Target platform: --win32 forces Windows binaries even on a Linux host
// (used to cross-prepare bin/win32 for packaging).
const PLAT   = (process.argv.includes('--win32') || HOST === 'win32') ? 'win32' : 'linux';
const LBIN   = join(ROOT, 'bin', PLAT);
const GEOIP  = join(ROOT, 'bin', 'geoip');
const CFGDIR = join(ROOT, 'bin', 'config');

const crossPlatform = PLAT !== (HOST === 'win32' ? 'win32' : 'linux');
const pname  = name => PLAT === 'win32' ? (name.endsWith('.exe') ? name : `${name}.exe`) : name;
const DEFAULT_TOR_VERSION = '15.0.20';

const g    = s => `\x1b[32m${s}\x1b[0m`;
const y    = s => `\x1b[33m${s}\x1b[0m`;
const b    = s => `\x1b[36m${s}\x1b[0m`;
const r    = s => `\x1b[31m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;
const dim  = s => `\x1b[2m${s}\x1b[0m`;

const ok   = msg => console.log(` ${g('✓')}  ${msg}`);
const info = msg => console.log(` ${b('→')}  ${msg}`);
const warn = msg => console.log(` ${y('!')}  ${msg}`);
const step = msg => console.log(`\n${bold(b(msg))}`);

function mkdirs(...paths) {
  for (const p of paths) mkdirSync(p, { recursive: true });
}

// Test a binary actually runs (not missing shared libs).
// Foreign-platform binaries cannot run on this host, so skip the probe.
function binaryWorks(path) {
  if (crossPlatform) return true;
  try {
    execSync(`"${path}" --version 2>&1`, { stdio: 'pipe', timeout: 3000 });
    return true;
  } catch { return false; }
}

// Search common system paths for a binary (host platform only).
function findSystemBinary(...names) {
  if (crossPlatform) return null;
  const dirs = [
    '/usr/sbin', '/usr/bin', '/usr/local/sbin', '/usr/local/bin',
    '/opt/homebrew/bin', `${process.env.HOME}/.local/bin`,
  ];
  for (const name of names) {
    for (const dir of dirs) {
      const full = join(dir, name);
      if (existsSync(full)) return full;
    }
    try {
      const r = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
      if (r) return r;
    } catch { /* not found */ }
  }
  return null;
}

function fetchJson(url) {
  return new Promise((res, rej) => {
    const follow = (u, depth = 0) => {
      if (depth > 5) return rej(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'DarkBrowser-Setup/1.0' } }, resp => {
        if (resp.statusCode >= 300 && resp.statusCode < 400)
          return follow(resp.headers.location, depth + 1);
        let d = '';
        resp.on('data', c => d += c);
        resp.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } });
      }).on('error', rej);
    };
    follow(url);
  });
}

function download(url, dest) {
  return new Promise((res, rej) => {
    const follow = (u, depth = 0) => {
      if (depth > 10) return rej(new Error('Too many redirects'));
      https.get(u, { headers: { 'User-Agent': 'DarkBrowser-Setup/1.0' } }, resp => {
        if (resp.statusCode >= 300 && resp.statusCode < 400)
          return follow(resp.headers.location, depth + 1);
        if (resp.statusCode !== 200) return rej(new Error(`HTTP ${resp.statusCode}`));
        const total = parseInt(resp.headers['content-length'] || '0');
        let recv = 0;
        const out = createWriteStream(dest);
        resp.on('data', chunk => {
          recv += chunk.length;
          if (total) {
            const pct = Math.floor((recv / total) * 100);
            const bar = '█'.repeat(Math.floor(pct / 4)) + '░'.repeat(25 - Math.floor(pct / 4));
            process.stdout.write(`\r   ${dim('[' + bar + ']')} ${pct}%`);
          }
        });
        resp.pipe(out);
        out.on('finish', () => { process.stdout.write('\r' + ' '.repeat(60) + '\r'); res(); });
        out.on('error', rej);
      }).on('error', rej);
    };
    follow(url);
  });
}

// ── Tor ──────────────────────────────────────────────────────────────────────

async function setupTor() {
  step('Tor');

  const dest = join(LBIN, pname('tor'));
  if (existsSync(dest) && binaryWorks(dest)) {
    ok(`bin/${PLAT}/${pname('tor')} already present and working`);
    ensureGeoip();
    return;
  }

  const sys = findSystemBinary('tor');
  if (sys) {
    info(`Found system Tor at ${sys}`);
    copyFileSync(sys, dest);
    chmodSync(dest, 0o755);
    ok(`Copied to bin/${PLAT}/${pname('tor')}`);
    ensureGeoip();
    return;
  }

  info('Tor not found — downloading Tor Expert Bundle');
  await downloadTorBundle();
}

function ensureGeoip() {
  const dg = join(GEOIP, 'geoip'), dg6 = join(GEOIP, 'geoip6');
  if (existsSync(dg) && existsSync(dg6)) { ok('GeoIP files already present'); return; }
  for (const base of ['/usr/share/tor', '/usr/local/share/tor']) {
    if (existsSync(join(base, 'geoip'))) {
      copyFileSync(join(base, 'geoip'),  dg);
      copyFileSync(join(base, 'geoip6'), dg6);
      ok('GeoIP files copied from system');
      return;
    }
  }
  warn('GeoIP not found — Tor will fetch on first run');
}

async function downloadTorBundle() {
  let version;
  try {
    const v = await fetchJson('https://aus1.torproject.org/torbrowser/update_3/release/RecommendedTBBVersions');
    version = Array.isArray(v) ? v[0] : v;
  } catch { version = DEFAULT_TOR_VERSION; warn(`Could not fetch version, using ${version}`); }

  const torPlat = PLAT === 'win32' ? 'windows-x86_64' : 'linux-x86_64';
  const url = `https://dist.torproject.org/torbrowser/${version}/tor-expert-bundle-${torPlat}-${version}.tar.gz`;
  const tmp = join(tmpdir(), `tor-expert-${torPlat}-${version}.tar.gz`);
  const ext = join(tmpdir(), `tor-expert-${torPlat}-${version}`);

  info(`Downloading Tor Expert Bundle ${version}...`);
  await download(url, tmp);
  ok('Downloaded');
  mkdirSync(ext, { recursive: true });
  execSync(`tar -xzf ${JSON.stringify(tmp)} -C ${JSON.stringify(ext)}`, { stdio: 'pipe' });

  const bin = join(ext, 'tor', pname('tor'));
  if (!existsSync(bin)) throw new Error('tor binary not found in bundle');
  copyFileSync(bin, join(LBIN, pname('tor')));
  chmodSync(join(LBIN, pname('tor')), 0o755);
  ok(`Tor binary installed (bin/${PLAT}/${pname('tor')})`);

  for (const name of ['geoip', 'geoip6']) {
    const src = join(ext, 'data', name);
    if (existsSync(src)) copyFileSync(src, join(GEOIP, name));
  }
  ok('GeoIP files installed from bundle');

  // Check for any pluggable transports bundled with Tor expert bundle
  const ptDirs = [
    join(ext, 'tor', 'pluggable_transports'),
    join(ext, 'data', 'pluggable_transports'),
    join(ext, 'tor'),
  ];
  for (const ptDir of ptDirs) {
    if (!existsSync(ptDir)) continue;
    for (const name of ['lyrebird', 'obfs4proxy', 'snowflake-client', 'webtunnel-client', 'conjure-client']) {
      const src = join(ptDir, pname(name));
      const dest = join(LBIN, pname(name));
      if (existsSync(src) && !existsSync(dest)) {
        copyFileSync(src, dest);
        chmodSync(dest, 0o755);
        ok(`Installed ${name} transport binary from bundle`);
      }
    }
  }
}

// ── Pluggable Transports ──────────────────────────────────────────────────────

function setupPluggableTransports() {
  step('Tor Pluggable Transports (Bridges)');

  const ptNames = ['lyrebird', 'obfs4proxy', 'snowflake-client', 'webtunnel-client', 'conjure-client'];
  let foundAny = false;

  for (const name of ptNames) {
    const dest = join(LBIN, pname(name));
    if (existsSync(dest) && binaryWorks(dest)) {
      ok(`bin/${PLAT}/${pname(name)} already present and working`);
      foundAny = true;
      continue;
    }

    const sys = findSystemBinary(name);
    if (sys) {
      info(`Found system ${name} at ${sys}`);
      copyFileSync(sys, dest);
      chmodSync(dest, 0o755);
      if (binaryWorks(dest)) {
        ok(`Copied to bin/${PLAT}/${pname(name)}`);
        foundAny = true;
      } else {
        warn(`Copied ${name} but it failed to run (missing dependencies)`);
      }
    }
  }

  if (!foundAny && !crossPlatform) {
    ok('Pluggable transport binaries present from Tor bundle');
  } else if (!foundAny) {
    info('No pluggable transport binaries found on system (optional).');
    info('For obfs4 bridge support, install obfs4proxy: sudo apt install obfs4proxy');
  }
}

// ── I2P ──────────────────────────────────────────────────────────────────────

async function setupI2p() {
  step('I2P');

  // Windows: rely on the official win64 zip build of i2pd.
  if (PLAT === 'win32') {
    const dest = join(LBIN, pname('i2pd'));
    if (existsSync(dest)) {
      ok(`bin/win32/${pname('i2pd')} already present`);
      return;
    }
    await downloadI2pdWindows();
    return;
  }

  // Check for already-bundled binary
  for (const name of ['i2pd', 'i2prouter']) {
    const dest = join(LBIN, name);
    if (existsSync(dest) && binaryWorks(dest)) {
      ok(`bin/linux/${name} already present and working`);
      return;
    }
  }

  // Prefer i2pd (C++), fall back to i2prouter (Java I2P)
  const i2pd = findSystemBinary('i2pd');
  if (i2pd) {
    info(`Found i2pd at ${i2pd}`);
    const dest = join(LBIN, 'i2pd');
    copyFileSync(i2pd, dest);
    chmodSync(dest, 0o755);
    if (binaryWorks(dest)) { ok('Copied i2pd to bin/linux/i2pd'); return; }
    warn('Copied i2pd but it failed to run (missing libs) — falling back');
  }

  const i2prouter = findSystemBinary('i2prouter');
  if (i2prouter) {
    info(`Found i2prouter (Java I2P) at ${i2prouter}`);
    // i2prouter is a shell script — copy the whole i2p installation reference
    const dest = join(LBIN, 'i2prouter');
    copyFileSync(i2prouter, dest);
    chmodSync(dest, 0o755);
    ok('Copied i2prouter to bin/linux/i2prouter');
    return;
  }

  info('i2p not found — downloading i2pd from GitHub');
  await downloadI2pd();
}

async function downloadI2pd() {
  const release = await fetchJson('https://api.github.com/repos/PurpleI2P/i2pd/releases/latest');
  const version = release.tag_name;
  info(`Latest i2pd: ${version}`);

  // Try each distro variant until one works
  const variants = ['noble', 'jammy', 'bookworm', 'bullseye', '_amd64'];
  for (const hint of variants) {
    const asset = release.assets.find(a =>
      a.name.includes('amd64') && a.name.endsWith('.deb') && a.name.includes(hint)
    );
    if (!asset) continue;

    const tmp = join(tmpdir(), asset.name);
    const ext = join(tmpdir(), `i2pd-extract-${hint}`);
    info(`Trying ${asset.name}...`);
    await download(asset.browser_download_url, tmp);
    mkdirSync(ext, { recursive: true });

    try {
      execSync(`dpkg-deb --extract ${JSON.stringify(tmp)} ${JSON.stringify(ext)}`, { stdio: 'pipe' });
    } catch {
      execSync(`cd ${JSON.stringify(ext)} && ar x ${JSON.stringify(tmp)}`, { stdio: 'pipe' });
      const dataTar = execSync(`ls ${JSON.stringify(ext)}/data.tar*`, { encoding: 'utf8' }).trim();
      execSync(`tar -xf ${JSON.stringify(dataTar)} -C ${JSON.stringify(ext)}`, { stdio: 'pipe' });
    }

    const bin = join(ext, 'usr', 'bin', 'i2pd');
    if (!existsSync(bin)) continue;

    const dest = join(LBIN, 'i2pd');
    copyFileSync(bin, dest);
    chmodSync(dest, 0o755);

    if (binaryWorks(dest)) {
      ok(`i2pd ${version} (${hint}) installed to bin/linux/i2pd`);
      return;
    }
    warn(`${hint} variant has missing dependencies, trying next...`);
  }

  throw new Error('No compatible i2pd binary found. Install i2pd or i2p manually: sudo apt install i2pd');
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const [cmd, args, shell] of [
    ['unzip', ['-q', '-o', zipPath, '-d', destDir], false],
    ['python3', ['-m', 'zipfile', '-e', zipPath, destDir], false],
    ['powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${zipPath}' '${destDir}'`], true],
  ]) {
    try {
      execSync(`"${cmd}" ${args.map(a => `"${a}"`).join(' ')}`, {
        shell: shell || '/bin/sh',
        stdio: 'pipe',
        timeout: 120000,
      });
      return;
    } catch { /* try next extractor */ }
  }
  throw new Error(`Could not extract ${zipPath} (needs unzip or python3)`);
}

async function downloadI2pdWindows() {
  const release = await fetchJson('https://api.github.com/repos/PurpleI2P/i2pd/releases/latest');
  const version = release.tag_name;
  info(`Latest i2pd: ${version}`);

  const asset = release.assets.find(a =>
    a.name.includes('win64_mingw') && a.name.endsWith('.zip')
  );
  if (!asset) throw new Error('No win64 i2pd asset found in latest release');

  const tmp = join(tmpdir(), asset.name);
  const ext = join(tmpdir(), 'i2pd-extract-win');
  info(`Downloading ${asset.name}...`);
  await download(asset.browser_download_url, tmp);

  extractZip(tmp, ext);
  const bin = join(ext, 'i2pd.exe');
  if (!existsSync(bin)) throw new Error('i2pd.exe not found in archive');

  const dest = join(LBIN, pname('i2pd'));
  copyFileSync(bin, dest);
  chmodSync(dest, 0o755);
  ok(`i2pd ${version} installed to bin/win32/i2pd.exe`);
}

// ── Config files ─────────────────────────────────────────────────────────────

function writeConfigs() {
  step('Config files');

  const torrc = join(CFGDIR, 'torrc');
  if (!existsSync(torrc)) {
    writeFileSync(torrc, [
      '# DarkBrowser — Tor config (paths filled at runtime)',
      'SocksPort 9050',
      'ControlPort 9051',
      'CookieAuthentication 1',
      'DataDirectory {DATA_DIR}',
      'GeoIPFile {GEOIP}',
      'GeoIPv6File {GEOIP6}',
      'Log notice stdout',
      'MaxCircuitDirtiness 600',
    ].join('\n') + '\n');
    ok('Written bin/config/torrc');
  } else {
    ok('bin/config/torrc already exists');
  }

  const i2pdConf = join(CFGDIR, 'i2pd.conf');
  if (!existsSync(i2pdConf)) {
    writeFileSync(i2pdConf, [
      '# DarkBrowser — i2pd config',
      '[httpproxy]',
      'enabled = true',
      'address = 127.0.0.1',
      'port = 4444',
      '',
      '[ntcp2]',
      'enabled = true',
      '',
      '[sam]',
      'enabled = false',
      '',
      '[bobproxy]',
      'enabled = false',
      '',
      '[i2cp]',
      'enabled = false',
      '',
      '[logging]',
      'destination = stdout',
      'level = info',
      '',
      '[upnp]',
      'enabled = false',
      '',
      '[reseed]',
      'verify = true',
    ].join('\n') + '\n');
    ok('Written bin/config/i2pd.conf');
  } else {
    ok('bin/config/i2pd.conf already exists');
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

console.log(bold('\n  ◑  DarkBrowser — Daemon Setup\n'));
mkdirs(LBIN, GEOIP, CFGDIR);

try {
  await setupTor();
  setupPluggableTransports();
  await setupI2p();
  writeConfigs();
  console.log(`\n  ${g(bold('All done!'))}  Run ${b('npm start')} to launch DarkBrowser.\n`);
} catch (e) {
  console.log(` ${r('✗')}  ${e.message}`);
  process.exit(1);
}
