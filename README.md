# saku

Local, encrypted password manager. A web UI and a Chrome extension. No cloud, no account.
Your vault is one file on your machine.

## Install

```
brew tap haiigas/homebrew-saku
brew install saku
mkcert -install        # once, for a trusted https://localhost
brew services start saku
```

Open `https://localhost:7878` (or `https://<your-ip>:7878` from another device on your network).
First visit: choose a master password and save the **recovery key**. It is shown once.

Run in the foreground instead of as a service: `saku serve`.

## What it stores

| type | fields |
|---|---|
| Login | username, password, 2FA key (live code), websites (many), custom fields (text / password / 2FA), notes |
| Bank account | bank name, full name, account number, shift / SWIFT code, PIN, branch name, contact number, address, notes |
| Payment card | holder, number, expires, CVC, PIN, bank name, bank website, notes |
| Wireless router | SSID, password, IP, admin username, admin password, notes |

Every item has a name and any number of tags.

## Web UI

- Favorites, duplicate, search, filter by type or tag.
- Tags can be renamed and given a color (hover a tag in the sidebar, then the `⋮` menu). Renaming to an existing tag merges them.
- Site favicons for items with a website. The local server fetches them, not a third party. It refuses private and LAN addresses. Turn off with `favicons = false` in the config.
- Password generator (also next to the password fields of logins and routers).
- Click to copy. The clipboard is cleared after 30 seconds.
- Auto-lock after 5 / 15 / 30 minutes, or never.
- Import: saku export (plain or encrypted), Bitwarden JSON, CSV. Export is in Settings.

## Chrome extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. **Load unpacked** and pick `$(brew --prefix)/share/saku/extension` (or `extension/` in this repo).
   In the file picker, press Cmd+Shift+G to type the path.
3. Click the icon, allow access to your server, and unlock. The default server is `https://localhost:7878`. Use the same address you open in the browser.

The popup has four tabs: **Favorites**, **All items**, **Generator**, **Settings**.

- Search, plus a category filter and a tag filter.
- `+` adds an item. Pick a type and fill in the same fields as the web UI.
- Hover a login: **Open & Fill** opens its first website and fills the form. The `⋮` menu copies the username, password or TOTP code.
- Settings: auto-lock, auto-fill (off by default; fills when exactly one login matches the page), change server, lock, sign out.
  **Lock** locks the whole vault. **Sign out** only ends this extension's session.

Nothing is filled unless you click, except with the auto-fill setting.
The session token lives in `storage.session` and is dropped when the browser closes.
Chrome rejects self-signed certificates for extensions, so run `mkcert -install` once.

## Security

- Master password → Argon2id → key that wraps a random 256-bit data key.
- Item contents are encrypted with AES-256-GCM (per-item nonce, item ID bound as AAD).
- The recovery key wraps the same data key. Forget both and the data is unrecoverable.
- Item names, tags and tag colors are stored **unencrypted** (for fast search). Everything else is encrypted.
- The data key lives in memory only while unlocked. Locking wipes it.
- Session cookie is `HttpOnly` + `SameSite=Strict`. Host and Origin are checked, and failed unlocks are rate-limited.
- Only the saku extension (fixed ID) is allowed as a cross-origin caller, using a bearer token.
- HTTPS by default (mkcert certificate if available, otherwise self-signed).
- Vault: `~/.config/saku/vault.db` (SQLite, mode 0600).

## Usage

```
saku serve [--port 7878] [--bind 0.0.0.0] [--host name]... [--http]
saku backup <file>     copy the encrypted vault
saku doctor            check paths and dependencies
saku --version
```

```
saku serve --bind 127.0.0.1        # this machine only
```

### Config file

`~/.config/saku/config` (flags override it):

```
port = 7878
bind = 0.0.0.0
http = false          # plain HTTP, for localhost or behind a TLS proxy
host = a.dev, b.dev   # extra allowed host names
favicons = true       # set false to stop fetching site icons
```

### Behind rute (permanent)

```
# ~/.config/saku/config
port = 7879
bind = 127.0.0.1
http = true
host = saku.example.dev
```

```
brew services restart saku
rute proxy saku.example.dev 7879
```

## Develop

```
cd ui && pnpm install && pnpm build   # writes web/dist (committed)
go test ./... && go build
```

The extension in `extension/` is plain JavaScript with no build step.

## Uninstall

```
brew services stop saku
brew uninstall --zap saku        # also removes ~/.config/saku (your vault)
```

## License

MIT
