# DarkBrowser

DarkBrowser is a Linux desktop browser built with Electron. It can route its browsing session through a local Tor SOCKS proxy, a local I2P HTTP proxy, or a direct connection.

> **Privacy notice:** This is an experimental browser, not a hardened replacement for Tor Browser. Electron/browser fingerprinting, browser features, and the sites you visit can still expose information. Use Tor Browser for sensitive or high-risk browsing.

## Features

- Tabbed browsing with back, forward, reload, and address/search navigation
- Tor routing through `127.0.0.1:9050`
- I2P routing through `127.0.0.1:4444`
- Direct (“CLEAR”) network mode
- Automatic recognition of `.onion` and `.i2p` addresses, with a suggestion to use the matching network
- Local Tor and I2P daemon management, including status indicators and restart controls

## Requirements

- Linux on x86_64/amd64
- Node.js 18 or newer (Node 22 is known to work)
- npm
- For automatic daemon setup: `tar`, plus either `dpkg-deb` or `ar`

The setup script first looks for installed `tor`, `i2pd`, or `i2prouter` binaries. When they are not available, it downloads compatible Linux binaries. Internet access is therefore needed if the bundled binaries are missing or unusable.

## Download a release

Prebuilt Linux packages are published on the [GitHub Releases page](https://github.com/Palmtree890/DarkBrowser/releases).

- **AppImage:** download the `.AppImage` file, make it executable, then run it:

  ```bash
  chmod +x DarkBrowser-*.AppImage
  ./DarkBrowser-*.AppImage
  ```

- **Debian/Ubuntu:** download the `.deb` file and install it with:

  ```bash
  sudo apt install ./darkbrowser_*.deb
  ```

- **Fedora, RHEL, and similar distributions:** download the `.rpm` file and install it with:

  ```bash
  sudo dnf install ./darkbrowser-*.rpm
  ```

## Compile from source

From the project directory:

```bash
npm ci
npm run setup
npm start
```

`npm run setup` prepares the local daemon binaries and configuration under `bin/`. It may copy binaries from your system or download them. After setup completes, `npm start` launches the app.

If you prefer to manage the daemons yourself, start Tor on port `9050` and I2P/i2pd’s HTTP proxy on port `4444` before launching the app. DarkBrowser detects those local services and uses them instead of starting its own process.

## Using the browser

DarkBrowser starts with **Tor** selected. Wait until the Tor indicator shows it is ready before opening `.onion` sites.

- Select **TOR** to route browser traffic through the local Tor SOCKS proxy.
- Select **I2P** to use the local I2P HTTP proxy and browse `.i2p` destinations.
- Select **CLEAR** for a normal, direct connection—this does not provide Tor or I2P privacy.
- Enter a URL in the address bar. Plain search terms are searched with DuckDuckGo; ordinary domains default to HTTPS.
- A `.onion` or `.i2p` address prompts the browser to suggest the appropriate network if another one is selected.
- Right-click the Tor or I2P network button to restart its managed daemon.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the exact dependency versions in `package-lock.json`. |
| `npm run setup` | Locate or download Tor/I2P binaries and ensure configuration files exist. |
| `npm start` | Run DarkBrowser in development. |
| `npm run build` | Create AppImage, Debian (`.deb`), and RPM packages. |
| `npm run build:appimage` | Create only an AppImage package. |
| `npm run build:deb` | Create only a Debian package. |
| `npm run build:rpm` | Create only an RPM package. |

## Build Linux packages

After completing the source setup, build all distributable formats with:

```bash
npm run build
```

The generated `.AppImage`, `.deb`, and `.rpm` files are written to `dist/`. To create one format only, use `npm run build:appimage`, `npm run build:deb`, or `npm run build:rpm`.

The package build keeps `bin/` outside Electron's application archive so the bundled Tor and I2P executables can run in the installed app. Build on Linux x86_64 for Linux x86_64 packages.

## Troubleshooting

### Tor or I2P says “Missing”

Run `npm run setup` again. Alternatively, install `tor`, `i2pd`, or Java I2P with your Linux distribution and restart the app. The app searches common system binary locations and `PATH`.

### A network stays on “Starting”

Check whether another local service already uses the expected port:

```bash
ss -ltn | rg ':(9050|4444)'
```

Tor uses port `9050`; I2P uses port `4444`. A first Tor or I2P bootstrap can take a few minutes depending on network conditions. The network buttons can restart daemons managed by DarkBrowser.

### I2P setup cannot find a compatible binary

Install `i2pd` using your distribution’s package manager, then rerun `npm run setup`. The automatic fallback downloads Debian packages and may not suit every distribution or library version.

## Project layout

```text
main.js            Electron main process, tabs, proxying, and daemon lifecycle
preload.js         Restricted renderer-to-main IPC bridge
src/               Browser UI, splash screen, styles, and image assets
scripts/setup.mjs  Tor and I2P detection/download setup
bin/               Runtime binaries, GeoIP data, and daemon configuration
```

## Data and networking

The app creates Tor and I2P runtime data in Electron’s per-user application-data directory. Its browser session uses a dedicated Electron partition, but this project does not claim full anonymity or anti-fingerprinting protections. Do not use **CLEAR** mode when you intend to avoid a direct network connection.

## License

MIT, as declared in `package.json`.

## Author

Palmtree890. Package metadata, including the author, homepage, and Linux maintainer, is defined in `package.json`.
