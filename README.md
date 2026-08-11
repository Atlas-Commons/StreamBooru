# 🌊 StreamBooru

[![CI](https://github.com/Atlas-Commons/StreamBooru/actions/workflows/ci.yml/badge.svg)](https://github.com/Atlas-Commons/StreamBooru/actions/workflows/ci.yml)

Contributions welcome — see [CONTRIBUTING.md](.github/CONTRIBUTING.md). PRs require DCO sign-off (`git commit -s`).

Welcome to StreamBooru! Your slick, fast desktop gateway to the vast world of booru image boards. Dive into content from multiple sites all in one place.

StreamBooru elegantly merges posts from various engines like Danbooru, Gelbooru, Moebooru (Yande.re/Konachan), e621/e926, and Derpibooru. Enjoy seamless browsing, cross-site searching, a handy lightbox viewer, bulk downloading, and your own local favorites collection.

**New in v1.0.0:** Keep your favorites and site settings synced across devices with optional **Account Sync**! Log in with a local account or Discord.


> [!NOTE]
> **Enjoying StreamBooru?**
>
> This is an open-source project maintained in spare time. If you find it useful and want to support its development, consider buying the developer a coffee!
>
> [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/amateurgod)

## ✨ Key Features

* **Multi-Engine Support:**
    * Danbooru (including Safebooru variant)
    * Moebooru family (Yande.re, Konachan .com/.net, Hypnohub, TBIB)
    * Gelbooru family (gelbooru.com, Safebooru.org, Rule34.xxx, Realbooru, Xbooru)
    * e621 / e926
    * Derpibooru
* **Unified Views:**
    * **New:** See the latest posts from all sites, smartly merged.
    * **Popular:** Discover trending content based on a global popularity model.
    * **Search:** Enter tags and get results interleaved from your chosen sites.
    * **Favorites:** Your personal collection, always accessible, now with optional cloud sync!
* **Account Sync (Optional):**
    * Create a local account or log in with Discord via our secure server.
    * Sync your favorite posts and site configurations across multiple StreamBooru installations.
* **Bulk Downloading:**
    * "Download All" button grabs everything currently loaded in your active view.
    * Right-click (or Shift/Alt-click) "Download All" for powerful naming options.
    * Downloads go to a single folder, with optional subfolders per site.
* **Custom Filenames:**
    * Choose from presets like `site-id` or create your own using tokens:
        * Basic: `{site}`, `{id}`, `{score}`, `{rating}`, `{width}x{height}`, etc.
        * Date: `{created_yyyy}-{created_mm}-{created_dd}`
        * Tags: `{artist}`, `{copyright}`, `{character}` (best effort)
* **Smooth Viewing:**
    * Click any image to open the lightbox viewer.
    * Navigate with ←/→ keys, Esc to close.
    * Quick actions: View Post page, Open Media directly, Download, Favorite.
* **Site Management:**
    * Easily add/edit sites with presets for popular ones.
    * Configure ratings (Safe, Questionable, Explicit, Any) and default tags per site.
    * Add authentication details (API keys, logins) for enhanced access.
    * Test connectivity, auth status, and rate limits.
* **Smart Image Loading:** Automatically handles common CDN protections (Referer headers).

---


## 🚀 Get Started: Installation

Choose the easiest method for your system:

>[!WARNING] Use Official Releases, Not the `main` Branch
>
>The `main` branch is for active development and is not guaranteed to be stable. It often contains untested updates.
>
>For a stable, tested version, please download from the Releases page (which uses version tags).
>

### 1) One-Liner Install (Linux)

This command downloads the latest release and installs the best package for your Linux distribution (Deb → Flatpak → tar.gz), adding a launcher and the `streambooru` command.

```bash
curl -fsSL https://raw.githubusercontent.com/Atlas-Commons/StreamBooru/HEAD/scripts/install.sh | bash
```

*(See the script or full docs for options like installing specific versions or forks.)*

### 2) Debian / Ubuntu (.deb)

1.  Download the `.deb` file from the [Releases page](https://github.com/Atlas-Commons/StreamBooru/releases).
2.  Install it:

    ```bash
    sudo apt install ./StreamBooru-*.deb
    ```

### 3) Windows (.exe)

1.  Download the `StreamBooru-Setup-<version>.exe` from the [Releases page](https://github.com/Atlas-Commons/StreamBooru/releases).
2.  Run the installer (it's a simple One-Click setup).
3.  Launch StreamBooru from your Start Menu.

### 4) Flatpak (.flatpak)

First time using Flatpak on Debian/Ubuntu? Set it up:
```bash
sudo apt install flatpak
sudo flatpak remote-add --if-not-exists flathub https://flathub.org/repo/flathub.flatpakrepo
```

Then, install the downloaded `.flatpak` bundle:
```bash
flatpak install --user ./StreamBooru.flatpak
flatpak run io.streambooru.StreamBooru
```

### 5) Arch Linux (AUR)

Use your favorite AUR helper (like `yay`):
```bash
yay -S streambooru-bin
```

Or, build manually:
```bash
git clone https://aur.archlinux.org/streambooru-bin.git
cd streambooru-bin
makepkg -si
```

### 6) Generic Linux (tar.gz)

1.  Download `StreamBooru-*-linux-x64.tar.gz` from the [Releases page](https://github.com/Atlas-Commons/StreamBooru/releases).
2.  Extract and run:
    ```bash
    tar xf StreamBooru-*-linux-x64.tar.gz
    cd StreamBooru-*-linux-x64
    ./streambooru
    ```
    *(Wayland users might need `./streambooru --ozone-platform-hint=x11` if issues occur.)*

---

## 💻 How to Use StreamBooru

1.  **Add Your Sites:** Click "Manage Sites". Use presets or add sites manually. Set preferred ratings/tags and enter credentials if needed:
    * **Danbooru:** Login + API Key (Find it in your Profile → API).
    * **Yande.re/Konachan:** Login + Password Hash (Check your account page).
    * **gelbooru.com:** User ID + API Key often required for API access. (Safebooru.org usually works without auth).
    * **e621/e926:** Auth is optional for basic browsing.
2.  **Browse:**
    * **New / Popular Tabs:** See merged feeds from your enabled sites.
    * **Search Tab:** Enter space-separated tags (like `1girl blue_hair`), hit Search.
    * **Favorites Tab:** View your locally saved (and potentially synced) posts. The search box here filters your favorites.
3.  **Download:**
    * **Single:** Use the "Download" button on any image card or in the lightbox.
    * **Bulk:** Click "Download All" to save everything currently visible. Right-click or Shift/Alt-click it for filename options.
4.  **View:** Click any image thumbnail to open the lightbox for a larger view and navigation (←/→ keys, Esc to close).

---

## 📝 Notes & Troubleshooting

* **Engine Specifics:**
    * *Danbooru:* Video previews are small static images (site limitation). The "Test" button shows API status, auth, and rate limits.
    * *Gelbooru:* `gelbooru.com` usually needs `user_id` + `api_key`. Clones like `safebooru.org` often work without auth. If JSON fails, it tries XML.
    * *Derpibooru:* Defaults to searching `score.gte:0` if the tag box is empty.
    * *e621/e926:* Browsing works without login. App doesn't use account-specific features like remote favorites for these sites yet.
* **Troubleshooting Tips:**
    * *Blurry Danbooru Thumbs:* Fixed! Cards now use larger previews (`sample_url`). Videos still use small previews.
    * *Gelbooru "No results" or 401:* Add `user_id` and `api_key` in Manage Sites for gelbooru.com, or try `safebooru.org`.
    * *Search only shows some sites:* Search uses each site's own engine. Gelbooru advanced syntax is translated for Rule34.xxx automatically; custom Gelbooru forks can select their syntax in Manage Sites. If plain tags yield nothing on Moebooru/Gelbooru, the app retries with a compatible sorting tag.
    * *`rating:safe` in tags:* Use the Rating dropdown in Manage Sites instead; the tag input ignores `rating:` tokens.

---

## 🛠️ Build From Source

Need Node.js 20+ and npm.

```bash
# Install dependencies
npm ci
# Run in development mode
npm run start
# Build packages (.deb, .tar.gz, .exe)
npx electron-builder --linux deb tar.gz
npx electron-builder --win nsis
```

---

## 🗑️ Uninstall

* **Debian/Ubuntu:** `sudo apt remove streambooru`
* **Flatpak:** `flatpak uninstall io.streambooru.StreamBooru`
* **Generic/Manual Linux:** Run the `uninstall.sh` script from the repository/source, or manually remove `/opt/streambooru`, `/usr/local/bin/streambooru`, and `/usr/share/applications/streambooru.desktop`.

---

## 📜 License

This project is licensed under the GPLv3. See the [LICENSE](LICENSE) file for details.
