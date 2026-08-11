# Changelog

All notable changes to this project will be documented in this file.
The format roughly follows Keep a Changelog, and dates are in YYYY-MM-DD.

## [v1.1.0-beta.2] — 2026-08-11

### Highlights
* **e621 video playback:** WebM/MP4 media now streams through a range-aware proxy instead of repeatedly reloading or downloading the entire file before playback.
* **Downloads repaired:** Browser, Android, and Electron downloads now use platform-appropriate streaming paths and report upstream HTTP failures.
* **Forgejo-first releases:** CI, release builds, Android signing, and package publication now run on the Atlas Commons Forgejo infrastructure with GitHub retained as a mirror.

### Added
* Native e621 fetching and normalization in the hosted web and Android client, including optional login/API-key parameters.
* HTTP byte-range forwarding and response-header preservation for `/mediaproxy`.
* Media regression tests covering authenticated e621 requests, video normalization, range headers, MIME types, and attachment filenames.
* Local sync-server integration tests and a packaged Electron startup smoke test in both CI systems.
* Loading, buffering, recovery, download-progress, and error feedback in the media lightbox.
* A media-first gallery redesign with a clearer feed header, live result counts, one-click refresh, compact card actions, keyboard search, and improved responsive/accessibility states.
* Per-site Gelbooru search dialect selection, with automatic Rule34.xxx detection.
* Zoom and pan controls for full-size images in the lightbox.
* Forgejo release builds for Linux, Windows, Android, and Flatpak, plus Forgejo package publication.

### Changed
* Full-size videos no longer force looping, and codec detection is advisory rather than blocking playback.
* Browser downloads use the same-origin media proxy directly; Android downloads stream natively to app-owned external storage without an unnecessary public-storage permission prompt.
* Electron downloads wait for the file stream to finish, reject non-2xx responses, and remove partial files after failures.
* e621/e926 media hosts use the correct referer and a project-identifying user agent.
* Updated the low-risk transitive dependencies from PRs #14, #15, #16, and #21.
* Upgraded Electron 35 to supported Electron 43 and Electron Builder 24 to 26, superseding the already-EOL Electron 39 update proposed by PR #22.
* Upgraded Capacitor 6 to 8 and replaced the legacy community HTTP downloader with the official File Transfer plugin.
* Consolidated desktop networking and hosted/Android booru normalization into shared, independently testable modules.
* Restyled the gallery with flatter surfaces, restrained colour, simpler controls, and less decorative motion.

### Fixed
* Feed cards prefer display-sized sample images over tiny booru thumbnails, keeping previews sharp while retaining lightweight fallbacks.
* **#23:** Video playback no longer calls `load()` again from `loadeddata`/`canplay`, which could leave the player in a reload loop.
* e621 video posts consistently select a video URL instead of falling back to a static sample image.
* Hosted and Android e621 sites no longer fall through to the Danbooru adapter.
* Media proxy responses preserve `206`, `Content-Range`, `Content-Length`, `Content-Type`, validators, and download disposition.
* Hotlink-protected e621/e926 media and grid previews have reliable proxy fallbacks.
* Proxy host checks now reject lookalike domains and revalidate redirects; rate, concurrency, and response-size limits bound proxy resource use.
* Credential-bearing query strings are redacted from request logs, unsafe external-link protocols are rejected, and production refuses the development JWT secret.
* Android trusts system certificate authorities only, disallows cleartext traffic and backups, and targets API 36 with Java 21.
* Global Gelbooru advanced searches translate OR groups from `{ tag_a ~ tag_b }` to Rule34.xxx's `( tag_a ~ tag_b )` syntax, use Rule34's API host, and preserve explicit rating filters.

## [v1.1.0-beta.1] — 2026-05-22

### Highlights
* **Web browser:** StreamBooru now runs in your browser at `/app/` on the sync server, with a landing page at `/`.
* **Web Discord login:** OAuth works in the browser via `/oauth-callback` (no `streambooru://` deep link required).
* **Beta releases:** Tags like `v1.1.0-beta.1` are published as GitHub pre-releases automatically.

### Added
* **Landing page** at `/` on the sync server with links to the web app, downloads, and health check.
* **Web app** at `/app/` — full StreamBooru UI served from the sync server (renderer copied at build time).
* **Web OAuth callback** at `/oauth-callback` for browser Discord login and account linking.
* **`POST /auth/discord/unlink`** endpoint to remove Discord from a linked account.
* **Tab cache TTLs** — New (2 min), Popular (30 s), Search (3 min) with manual refresh by re-clicking the active tab.
* **Server Coolify/Nixpacks** deployment with Bun runtime and automatic DB migrations on start.
* **Release notes builder** — releases combine `CHANGELOG.md` sections with GitHub-generated commit/PR notes.

### Changed
* **Sync server** migrated to Bun; native `fetch` replaces `node-fetch`; `start:prod` runs migrations then starts.
* **Profile tags (web/Android)** — site tags and rating from Manage Sites are now merged into search/popular queries (matching desktop adapters).
* **Discord login** — logging in with Discord after linking no longer overwrites your local username when a password is set.
* **Release workflow** — pre-release tags publish to `streambooru-bin-beta` on AUR; stable tags publish to `streambooru-bin`; Flatpak build uses electron-builder; release body built from changelog + auto notes.

### Fixed
* **Local login after Discord link** — username/password login works again after linking Discord to a local account.
* **Tab cache stale results** — cached feeds expire and can be refreshed manually instead of blocking new posts indefinitely.
* **Flatpak CI** — rebuilt around `electron-builder --linux flatpak` with the Electron base app.

### Notes
* Web app URL (when deployed): `https://streambooru.ecchibooru.uk/app/`
* Discord OAuth redirect (unchanged): `{BASE_URL}/auth/discord/callback`
* If your username was already overwritten before this fix, restore it in the database or unlink/re-link Discord after upgrading the server.

## [v1.0.2] — 2025-10-25

### Added
* **Caching** Added caching to results pages to speed up loads when changing between tabs
* **Pre-Connects** Added preconnects so the apps can start connecting and pulling posts before the UI has loaded
* **Concurrent Pulls** added concurrent pulls from sites to increase load speed

### Changed
* **How Posts are loaded** previously the new and popular tab would wait for all configured sites to respond, organise the posts, then display them, this caused rather slow loading at start, now they display posts as soon as they are loaded and add new ones to the end, this may however mean popular is not always in a descending order between sites and sites wont be round-robin anymore and post may appear slightly grouped by sites due to some sites responding faster than others, the same has been done for the new tab. 

### Fixed
* **Login** Login in with local account and then linking discord would overwrite local account details in db with discord making it impposible to login with local again, this has now been fixed to add discord details rather than replace and added an unlink discord button
* **Sync issues** fixed some *rather persistent* issues where SSE wouldnt always trigger a refresh and site settings like api keys and login details wouldnt sync, also fixed some cross platform sync issues which caused issues when syncing between desktop and mobile or vice versa


## [v1.0.0] — 2025-10-25

### Highlights
* **Account Sync:** Introducing optional server-side account synchronization for favorites and site configurations across devices.
* **Multiple Login Options:** Support for creating local accounts or logging in via Discord.
* **Improved Mobile UI:** Enhanced mobile experience with a dedicated menu for navigation and actions.

### Added
* **Server Backend:** Added a Node.js backend (`server/`) for handling user accounts, authentication (local & Discord OAuth), and data synchronization (favorites, sites).
* **Account Management:** New "Account" section in the UI (`renderer/js/account.js`) to manage server settings, login, registration, and logout.
* **Cross-Device Sync:**
    * Favorites are now synced with the server when logged in.
    * Site configurations (including credentials) are synced.
    * Real-time updates via Server-Sent Events (SSE) for changes pushed from other devices.
* **Mobile Menu:** Implemented a hamburger menu (`renderer/js/mobile-menu.js`, `renderer/mobile.css`) for better usability on smaller screens or mobile platforms (like the Android build).
* **Database Migrations:** SQL migration scripts added for setting up user, favorites, and sites tables (`server/src/migrations/`).
* **Encryption:** User credentials stored in the database are encrypted (`server/src/crypto.js`).

### Changed
* **Preload Script (`electron/preload.js`):** Extended `window.api` to include functions for account management and synchronization.
* **Renderer (`renderer/renderer.js`, `renderer/index.html`):** Integrated account button and sync logic. Site Manager now saves/loads site configurations via sync API when logged in.
* **GitHub Actions:** Updated `release.yml`, `android.yml`, and `publish-aur.yml` workflows.

### Fixed
* Minor adjustments and fixes related to integrating the account system.

[v1.0.0]: [https://github.com/Atlas-Commons/StreamBooru/releases/tag/v1.0.0](https://github.com/Atlas-Commons/StreamBooru/releases/tag/v1.0.0)

## [v0.4.0] — 2025-10-18

### Highlights
- First Android APK available (signed Release AAB and APK; Debug APK also provided).
- Mobile UI with a touch‑friendly hamburger menu.
- Per‑site rating honored from the Site Manager dropdown.

### Added
- Android app (Capacitor):
  - Native HTTP path (CapacitorHttp) to bypass CORS for API calls and image proxying.
  - proxyImage: converts hotlink‑protected media to data URLs on‑device.
  - Local favorites storage on Android (no account required).
- Rating handling (Android/Web adapter):
  - Uses each site’s rating selection from the Site Manager (safe/questionable/explicit/any) unless the search already contains a `rating:` token.
  - Safety net: when the adapter injects a rating, results are also filtered client‑side to that rating.
- Mobile menu:
  - Consolidated actions: Browse (New/Popular/Search/Favorites), Search box, Manage Sites, and Download actions.
  - Larger touch targets, visual polish (icons, blur/glass), and proper focus/escape behavior.

### Build/CI
- Android CI workflow:
  - Always uploads a Debug APK artifact.
  - When signing secrets are present (PKCS#12 keystore), also builds and uploads signed Release AAB and APK.
- Release workflow:
  - Can collect Android artifacts and attach them to GitHub Releases alongside desktop builds.

### Known limitations (Android)
- Bulk “Download All” is not supported (single‑item downloads only).
- “Favorite on site” (remote/booru‑side) is not available in the Android build.
- Some sites may still rate‑limit or use anti‑bot protections; the native HTTP path helps with CORS but can’t bypass site‑level restrictions.

[v0.4.0]: [https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.4.0](https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.4.0)


## [v0.3.1] — 2025-10-18

### Added
- Download options popover
  - Shift-click, Alt-click, or right-click “Download All” to open options.
  - Filename templates with presets and “Custom…” entry; selection is used by both single “Download” and “Download All”.
  - “Shift for options” tooltip shown below the button for visibility.

### Changed
- Naming templates
  - Tokens supported: `{site} {site_type} {id} {score} {favorites} {rating} {width} {height} {index} {ext} {original_name} {created} {created_yyyy} {created_mm} {created_dd} {created_hhmm} {artist} {copyright} {character}`.
- Card thumbnails
  - Prefer `sample_url` (then `file_url`, then `preview_url`) and add a simple `srcset` to keep Danbooru previews sharp.

### Fixed
- Favorites (local)
  - “♥ Save” button works again even if the preload method is missing: renderer includes a safe localStorage fallback.
  - Preload bridge restored back‑compat names (`toggleLocalFavorite`, `getLocalFavoriteKeys`, etc.).
- Popular view sorting
  - Corrected popularity computation (typo fix `st.scoresP95` → `st.scoreP95` and added guards), restoring true global popularity sorting.
- Manage Sites – Test row
  - Restored full test flow (API probe, Auth check with info, Danbooru rate‑limit) and brought back “Open Account Page” and “API Help” buttons.
  - Fixed info text rendering (no more “[object Object]”) and polished badges.
- Release workflow
  - Release notes are reliably extracted from CHANGELOG and passed via `body_path`; removed unsupported `allow_updates` input. Falls back to auto‑notes when no section matches.

[v0.3.1]: [https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.3.1](https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.3.1)

## [v0.3.0] — 2025-10-18

### Added
- New engines
  - e621/e926: adapter with proper tag mapping, “New” (order:id_desc + before-id pagination) and “Popular” (order:score).
  - Derpibooru: adapter using `/api/v1/json/search/images` with sort by created_at (New) and score (Popular).
- Manage Sites presets
  - e621 (R18) and e926 (SFW).
  - Derpibooru.
  - Quick-picks for other common Booru clones that already work via existing adapters:
    - Gelbooru family (Rule34/rule34.xxx, Realbooru, Xbooru) via Gelbooru adapter.
    - Hypnohub and TBIB via Moebooru adapter.
- Defaults
  - Fresh installs now include optional examples for e621 and Derpibooru (browsing works without auth).
- Download All
  - New “Download All” button in the top bar (next to “Manage Sites”) to bulk‑download everything currently loaded in the active view: New, Popular, Search, or Local Favorites.
  - Single folder chooser (once), optional per‑site subfolders, concurrency‑limited downloads, and correct Referer headers for supported CDNs.
  - New IPC: `download:bulk` (renderer → main); preload exposes `api.downloadBulk(items, options)`.

### Changed
- Site Manager
  - Engine list expanded to include e621 and Derpibooru; helper links (Account/API Help) added for those engines.
  - Rating/tag hints normalized across engines (rating tokens mapped to the correct flavor per site).
- Hotlink headers
  - Automatic Referer injection extended to cover common image CDNs: `static1.e621.net`, `static1.e926.net`, `derpicdn.net`, alongside existing Danbooru/Moebooru hosts.
- UI
  - Top bar updated to include the “Download All” action next to “Manage Sites.”

### Fixed
- Gelbooru family
  - 401 “No results” on gelbooru.com: adapter now supports API credentials (`user_id` + `api_key`) and will add them to requests when present.
  - JSON blocked/empty responses now fall back to XML automatically (requires credentials on gelbooru.com; clones like Safebooru usually work without auth).
- Derpibooru
  - Empty results when query was blank: adapter now defaults to `q=score.gte:0`.
  - Optional `filter_id` support (via site credentials) to avoid local default filters hiding results.
- Release workflow (GitHub Actions)
  - Release notes now pull the correct section from CHANGELOG.md and use it as the GitHub Release body.
  - Robust heading matcher: supports “## vX.Y.Z”, “## X.Y.Z”, “## [vX.Y.Z] — YYYY‑MM‑DD”, etc., with a fallback to auto-generated notes if no section is found.

### Removed
- Zerochan integration
  - Adapter, presets, and special‑case request handling removed due to persistent anti‑bot/503 gating.

### Notes
- e621/e926
  - Browsing is unauthenticated by default; account features (favorites, etc.) are not implemented in this release.
  - Image requests include a reasonable UA and Referer where applicable to maximize compatibility with their static hosts.
- Derpibooru
  - Browsing is unauthenticated by default; favorites are not implemented in this release.
- Bulk download
  - Uses concurrency (default 3) to avoid rate‑limiting and disk thrash; customize via `downloadBulk(items, { concurrency, subfolderBySite })`.

### Known Issues (unchanged)
- Lightbox video playback may not work on some Linux builds lacking proprietary codecs (H.264/AAC). Use “Open Media” or replace Electron’s `libffmpeg.so` with the distro’s `chromium-codecs-ffmpeg-extra` variant.
- Danbooru video thumbnails may look softer (site only serves small static previews for videos).

[v0.3.0]: [https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.3.0](https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.3.0)

## [v0.2.1] — 2025-10-18

### Highlights
- Reliable searches and infinite scroll with a clear “End of results” message.
- “New” tab now fairly interleaves results from all sites (round‑robin) and appends new items without jumping your view.
- “Popular” remains globally sorted, with scroll-position preservation when a re‑order is required.
- Danbooru: filter takedowns and gold‑only/restricted posts (when not viewable with your account).
- Video groundwork in the lightbox (CSP and sizing); proxy fallback for media that requires headers.
- Remote “Favorite” (site API) button appears when credentials are configured.

### Added
- Lightbox video handling
  - Render videos as a video element with controls, muted autoplay, loop, and playsInline.
  - Fallback: if the CDN blocks direct loads, try an in‑app proxy that preserves Referer.
  - If the environment can’t decode the video (e.g., missing H.264/AAC), a tip suggests using “Open Media.”
- Content-Security-Policy
  - index.html now allows media (`media-src`) so videos can load in the app.
- Remote “Favorite” via site APIs
  - When a site in Manage Sites has valid credentials, cards and lightbox show a “♥ Favorite” button:
    - Danbooru: login + API key
    - Moebooru: login + password_hash
  - Uses the site’s favorite endpoints to add/remove favorites; initial state uses site flags when available (e.g., Danbooru’s `is_favorited`).

### Changed
- Thumbnails in the grid (cards)
  - Prefer `sample_url` (or full `file_url`) for images so Danbooru thumbs are sharp.
  - For video posts, fall back to preview (Danbooru only provides a small static preview for videos).
- New tab behavior
  - Switch to a true round‑robin interleave across all configured sites, append‑only per fetch.
  - Newer items discovered later won’t jump to the top (prevents viewport shifts).
- Popular tab behavior
  - Still globally sorted by popularity/recency. If new items strictly belong at the end, we append; otherwise we re‑render while preserving scroll to avoid “teleporting.”
- Search tab behavior
  - Continues using round‑robin interleaving across sites (fair mixing of results).
- Card actions layout
  - Actions row now uses a two‑column grid so 3–4 buttons (Open Post, Open Media, Favorite, Save) fit without clipping on narrow cards.

### Fixed
- New search at end‑of‑pagination yielded no images
  - Implemented robust fetch coordination with a generation token and a queued‑fetch flag; drops stale responses after resets.
- Endless “Loading…” when results are exhausted
  - Added `noMoreResults` guard; displays “End of results” and stops auto‑fetching when a batch adds zero new posts.
- Scroll jumps when loading a new batch
  - Append‑only rendering when possible; when a global sort is needed, re‑render while preserving scroll from the nearest visible anchor.
- Remote favorite POST errors
  - Removed manual `Content-Length` in POST form requests; let Chromium set it to avoid `net::ERR_INVALID_ARGUMENT`.
- Danbooru: hide posts that shouldn’t be shown
  - Filter out takedowns (`is_banned`, `is_deleted`).
  - Filter out gold‑only or otherwise restricted posts for non‑gold accounts (no `file_url` and no `large_file_url` and no `media_asset.variants` with `sample` or `original`). If you log in with a gold account, these posts will appear as media URLs become available.

### Known Issues
- Lightbox video playback on some Linux builds
  - Electron builds often lack proprietary codecs (H.264/AAC), so many MP4s show 0:00 and won’t play. Workarounds:
    - Replace Electron’s `libffmpeg.so` with your distro’s “chromium‑codecs‑ffmpeg‑extra” (or equivalent with proprietary codecs).
    - Use “Open Media” to view in your default browser.
  - WebM typically works. The lightbox shows a small tip when codecs are unsupported.
- Softer thumbnails for video posts
  - Danbooru only provides small static previews for videos; grid thumbs for video entries may look blurry. Image posts remain sharp via `sample_url`.
- Remote favorites
  - Favorite button only appears when credentials are present for a site. We show an alert on auth or rate‑limit errors; state is not auto‑refreshed from the server after out‑of‑band changes.
- End‑of‑results detection is conservative
  - We mark end‑of‑results when a fetch adds zero new items across all sites. Some sites might still return data in later attempts.
- Intentional behavior: “New” does not reorder
  - Newer posts fetched later are appended at the end by design so your current view doesn’t shift. Use “Popular” if you want a globally resorted feed.

### Developer Notes
- State coordination
  - Added `fetchGen` to drop stale responses across resets, `pendingFetch` to queue a fetch while one is in flight, and `noMoreResults` to halt further loads at the end.
  - New tab keeps a `feedSeen` set and a rolling `rrCursor` for fair round‑robin across sites per fetch.
  - Search tab keeps `searchBuckets` and `searchSeen` to fairly interleave de‑duplicated results.
- Network
  - Image/media requests continue to set site‑specific Referer headers; proxy endpoint returns data URLs for render safety when direct loads fail.
- UI
  - Popular re‑sort path preserves scroll via nearest visible anchor element; append‑only path avoids any scroll changes.

[v0.2.1]: [https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.2.1](https://github.com/Atlas-Commons/StreamBooru/releases/tag/v0.2.1)
