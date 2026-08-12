# Changelog

All notable changes to this project will be documented in this file.
The format roughly follows Keep a Changelog, and dates are in YYYY-MM-DD.

## [v1.2.0-beta.2] — 2026-08-12

Fixes for the problems beta 1 shipped with, plus the deployment fixes that got the sync server running again, and favourites that finally travel in both directions.

### Added
* Favourites sync both ways with the source sites you hold credentials for. Danbooru, Moebooru and e621 accounts are now read as well as written: a post faved on the site turns up in StreamBooru, a post faved here is sent up to the site, and the whole thing runs shortly after startup or on demand from Settings.
  * No booru records when a favourite was *dropped*, only which posts are currently faved, so each pull keeps a snapshot of what the site reported and dates a disappearance to the window between pulls. A fave made here since the last pull is the newer fact and goes up to the site; an older one loses to the site's removal.
  * The first sync has no snapshot to compare against, so it only ever adds, in both directions. A listing that hits the 2000-per-site cap is never read as a removal either, nor is an empty one from an account that had favourites last time — a changed API or a rejected credential looks exactly like unfaving everything, and the cost of guessing wrong is the whole set.
  * Favourite listings deliberately skip the visibility filtering the feed applies: a post the site has since banned or deleted is still faved, and dropping it from the listing would read as an unfave and delete it locally.

### Fixed
* The Favourites feed rebuilt itself on every sync echo, flashing the grid and dragging the reader back to the top. The server broadcasts our own writes back to us, and both clients announced a change even when the merge settled on the set they already held; a save now announces one only when the stored set actually differs, and a merge no longer re-pushes local-only faves the server has declined to keep.
* Reaching the bottom of Favourites reloaded the list and jumped to the top. Favourites arrive in a single pass, so the view now tells infinite scroll there is no next page.
* Hiding a source could strand the feed on "Loading…" for good: a superseded Popular batch returned without releasing the loading flag, and scrolling, refreshing, and every later fetch are gated on it.
* Thumbnails degraded into "?" placeholders the further you scrolled. Every video preview began downloading as its card was built, and enough of them saturated the connections a browser allows per host, starving the images below. Previews now load only within a screen of the viewport and pause when they leave it.
* Danbooru images failed to load. Seven CDNs were being proxied for hotlink protection they do not enforce; an audit (`scripts/test-hotlink-hosts.js`) trimmed the list to the hosts that actually refuse a foreign Referer, which also cuts proxy traffic.
* Linux builds showed the generic Wayland icon. A compositor resolves a window's icon by matching its app_id to an installed desktop file, and nothing tied the entry to Electron's `streambooru` app_id. The entry now declares `StartupWMClass` and tracks the app_id through `desktopName`, and the build installs the nine icon sizes an icon theme expects instead of a single 1024px file that every panel had to downscale.
* The sync server crash-looped on boot. Bun 1.3 hands an entrypoint's `app` export to `Bun.serve()`, which rejected an Express app for having no fetch handler; the server now boots through `src/serve.js`, which exports nothing, and Nixpacks pins Bun so the runtime cannot change under a deploy that changed no code.
* Server deploys failed with `Module not found "scripts/build-webapp.mjs"` because `.dockerignore` excluded the directory holding the web app build script.
* The Flatpak release job failed on `apt-get` permissions, and its `bwrap` calls needed the unprivileged user namespaces recent Ubuntu confines by default.

### Changed
* Proxied media carries `s-maxage` and `immutable` and no longer varies on `Origin`, so a CDN can hold it at the edge: images load faster and the source sites see fewer requests.
* Request logging reports 4xx and 5xx only, with status and duration, instead of every request — a feed proxies a thumbnail per card, which buried anything useful. Set `LOG_REQUESTS=1` for the lot. The server also answers `/custom_error`, the path Cloudflare fetches for its error pages.

## [v1.2.0-beta.1] — 2026-08-12

### Highlights
* **Favourites survive going offline:** signing back in merges your local faves with the server copy instead of overwriting them, and an unfave on one device no longer comes back from a device that was offline when you made it.
* **Faving reaches the source site:** faving in StreamBooru also faves on Danbooru, Moebooru, and e621 when credentials are configured, and cards show how many StreamBooru users faved a post.
* **Finding things is easier:** tag autocomplete across every enabled source, a grouped artist/copyright/character tag panel in the lightbox, tag chips on cards, and per-site enable/disable for muting a source without deleting its credentials.
* **A settings panel:** dark/light theme, grid density, square-crop or natural-aspect cards, video autoplay, safe-mode blur, and the default filename template.
* **StreamBooru has its own icon,** replacing the stock Capacitor placeholder, and the interface is recoloured to the cyan-and-magenta pair that goes with it.
* **The hosted web app is generated from the desktop source,** so it stops drifting behind the desktop build the way the old hand-maintained copy did.
* **Security:** stored API keys are masked in Manage Sites, Discord OAuth callbacks require a nonce, the image proxy refuses private network targets, and the sync server refuses to boot on a weak `JWT_SECRET` or `ENC_SECRET`.

> **Self-hosting the sync server?** `ENC_SECRET` must now be set to a real value or the server will not start — see the deployment notes below.

Closes #3, #8, #9, and #23.

### Added
* Tag autocomplete in the search box (desktop and mobile menu), querying all enabled sources per engine (Danbooru, Moebooru, Gelbooru/Rule34, e621, Derpibooru) with keyboard navigation and category colouring.
* Collapsible tag panel in the lightbox grouped by artist/copyright/character/general with click-to-search, plus tag chips on card hover.
* Per-site enable/disable toggle in Manage Sites and a source-chip row above the feed for muting a source without deleting its credentials; the flag syncs across devices via Account Sync (server migration `0006_site_enabled`, with a local fallback against older servers).
* Settings panel: dark/light theme, grid density, square-crop vs natural-aspect card layout, video-thumbnail autoplay, safe-mode blur for non-safe thumbnails, and the default filename template.
* Bulk downloads report live progress with a cancel button on Electron, web, and Android.
* Toast notifications replace every blocking `alert()` dialog.
* First-run, no-results, and empty-favourites states with actionable buttons, plus skeleton cards while feeds load.
* Adapters now surface artist/copyright/character tag categories (Danbooru, e621, Derpibooru), powering the `{artist}` `{copyright}` `{character}` filename tokens and the tag panel.
* Cards show how many StreamBooru users faved each post (public `/api/favourites/counts` endpoint, batch-fetched, with a supporting index in migration `0007_favorites_key_index`).
* Faving a post also favourites it on the source site when API credentials are configured (Danbooru, Moebooru, e621 — including a new e621 favourites endpoint in the adapter), and the lightbox's "Fave on site" button now works for those sites.
* Derpibooru sites accept an optional API key (applies your account's content filters) and Filter ID in Manage Sites; the key is sent with every request.
* Lightbox prefetches neighbouring images, and supports pinch zoom, double-tap zoom, swipe left/right to navigate, and swipe down to close on touch screens.
* Android hardware back button closes the lightbox, menus, and modals before exiting the app.
* The Electron window remembers its size, position, and maximized state.
* `npm run webapp:build` regenerates `server/webapp/` from `renderer/`; CI runs it, and the Nixpacks deploy uses the same script instead of an inline copy command.
* StreamBooru has its own icon at last, replacing the stock Capacitor placeholder that shipped as the Android launcher icon and splash. The mark is four gallery tiles around a play cut-out; vector masters live in `branding/`, and the generated assets cover the desktop build (`build/icon.png`), every Android launcher density including the adaptive foreground and round variants, all eleven splash sizes, and the web favicon.

### Changed
* `server/webapp/` is a generated artifact of `renderer/`; the stale hand-maintained local copy (including the orphaned `bulk-download.js`) is replaced by the build script, which also prunes removed files.
* Popular-feed re-sorts reuse existing cards through keyed DOM reconciliation instead of rebuilding the grid, so images no longer re-decode and playing video thumbnails survive; far-offscreen cards skip rendering work.
* Folder-picker and save dialogs are async so they no longer freeze feed loading, autocomplete, and sync while open; the scroll handler is coalesced to one layout read per frame; the natural-aspect grid batches its layout reads and writes; favourite bulk-sync inserts in one round trip; and web/Android thumbnails on hotlink hosts skip a guaranteed-to-fail direct request.
* Body scrolling locks behind the lightbox, modals, and menu, and infinite scroll pauses while an overlay is open.
* Modals and the lightbox trap focus, restore it on close, and tabs expose `role="tab"`/`aria-selected`.
* Remote site sync no longer clobbers local-only config (settings, filename template), and `/api/sites` now stores and returns each site's enabled state.
* Recoloured the interface to match the new icon: a cyan-and-magenta accent pair replaces the periwinkle blue, applied through theme tokens (`--accent`, `--accent-2`, `--accent-grad`, `--ring`) rather than the hardcoded literals that were scattered through the stylesheet, so the wordmark, active tab, Download All button, and download progress all carry the brand gradient. The light theme uses a deeper teal and magenta to stay legible on white, and the modal surfaces lose their navy tint.
* Dependencies updated to current releases (Electron 43.4, Capacitor CLI 8.5, and server-side Express 4.22, pg 8.23, jsonwebtoken 9.0.3, dotenv 16.6), with `uuid` and `body-parser` pinned through overrides to clear the remaining advisories; `npm audit` and `bun audit` are clean.
* The server's own pages — the landing page, the health page, and the OAuth callback — follow the same palette as the app and carry the icon and favicon, instead of keeping the old periwinkle blue on a navy background.

### Security
* The server refuses to start with a weak or placeholder `JWT_SECRET` (forgeable tokens) unless `ALLOW_INSECURE_JWT_SECRET=1` is set for local development; JWT verification is pinned to HS256.
* **Breaking (deployments):** `ENC_SECRET` is held to the same standard and is now checked at startup instead of on the first credential write, with `ALLOW_INSECURE_ENC_SECRET=1` as the local-dev escape hatch. A deployment running without one, or with the placeholder from `.env.example`, will refuse to boot until it is set.
* Browsers connect to the event stream with a 60-second, stream-only ticket from `POST /api/stream/ticket` instead of putting the 90-day account token in a URL that proxy and CDN logs retain. Tickets are rejected everywhere else in the API, the stream endpoint rejects account tokens presented as tickets, and it now pins HS256 like the rest of the API. Older clients passing `access_token` still work.
* Manage Sites masks API keys and password hashes instead of rendering them as plain text, with a per-field Show/Hide toggle. Non-secret fields (login, user ID, Derpibooru filter ID) are unchanged.
* Postgres TLS verifies the server certificate by default (`PGSSL_REJECT_UNAUTHORIZED`, opt out only for self-signed managed databases).
* The Electron window blocks in-app navigation to remote origins and routes external links to the OS browser, keeping the privileged preload bridge off untrusted pages.
* Discord OAuth callbacks now require a client-generated nonce — on the desktop loopback listener (which also rejects requests carrying an `Origin` header) and the Android `streambooru://` deep link — blocking login-CSRF/token injection.
* The image proxy refuses loopback, private, and link-local targets (SSRF hardening); bulk/single downloads reject `..` path segments; the login route no longer accepts passwords via query string; DB error logs no longer include query parameters.

### Fixed
* Logging back in no longer overwrites favourites saved while offline: sync now merges the server copy with local faves and uploads the local-only ones, on Electron, web, and Android. Live removals from other devices still apply through targeted sync events.
* Unfaving no longer comes back. Merge sync treated every local-only favourite as something to re-upload, so a device that was offline when another one unfaved a post pushed it straight back. Removals are now recorded server-side for 180 days and the newer timestamp wins, so a genuine re-fave still beats an older deletion. The server enforces this on bulk upload rather than trusting clients.
* Favourites synced through the server keep their `artist`, `copyright` and `character` tags and their video fields — the server's post allowlist predated all five and silently dropped them, degrading the grouped tag panel and losing grid autoplay on any favourite that had made a round trip.
* Electron keyed favourites off the raw site URL while the renderer normalized it, so a trailing slash or different host casing in an older config produced two keys for one post. Keys are normalized in one place now, and existing favourites are re-keyed and de-duplicated on load.
* Restored the desktop Gelbooru XML fallback (the adapter was handed a JSON parser instead of a text fetcher), the desktop "Unlink Discord" action, and the correct app version in Settings (all were silently no-ops).
* Linux: Chromium's disk/GPU/code caches and web storage no longer pollute `~/.config/streambooru`. `sessionData` is redirected to `~/.cache` (honouring `XDG_CACHE_HOME`) while durable config stays in `~/.config`, and stale cache directories left by older builds are pruned once on launch.
* The card and lightbox "Save" buttons are now "Fave" (they never wrote files to disk; Download does that), with clearer tooltips.
* Derpibooru's Manage Sites card claimed authentication was optional but offered no way to enter it.
* The "Name format" download options popover is now reachable (right-click or Shift-click Download All) and actually applies and persists the chosen template, including custom formats.
* Keyboard zoom (`+`/`-`) in the lightbox no longer throws a `ReferenceError`.
* Lightbox Prev/Next track the current post by key, so Popular-feed re-sorts can no longer jump navigation to unrelated posts.
* `user_favorited` survives post normalization, restoring the remote-favourite button state in the lightbox.
* Opening Account from the mobile menu no longer opens the modal twice.

### Deployment notes
Only relevant if you run your own sync server. Desktop, Android, and web users need do nothing.

* `ENC_SECRET` must be set to a real value of at least 16 characters — the placeholder from `.env.example` is rejected — or the server exits at startup instead of failing later on the first credential write. `ALLOW_INSECURE_ENC_SECRET=1` bypasses it for local development. Do not change an existing value: site credentials already encrypted with it become unreadable.
* `JWT_SECRET` is held to the same standard. Changing it invalidates every issued token, so everyone is signed out.
* `PGSSL_REJECT_UNAUTHORIZED` now defaults to `true`. Set it to `false` only if your managed Postgres presents a self-signed certificate without a CA bundle.
* Migrations `0006_site_enabled`, `0007_favorites_key_index`, and `0008_favorite_deletions` apply on startup.
* Clients from 1.1.x keep working against this server, and this release's clients keep working against a 1.1.x server — favourite deletion tracking, fave counts, and the stream ticket simply stay dormant until both sides are updated.

## [v1.1.0-beta.2] — never released

Written up under its own heading, but no build was ever tagged or published: the line went
from v1.1.0-beta.1 straight to v1.2.0-beta.1. Everything below first reached users there,
and is kept as its own section because that is how the work was done.

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
