# saku

Local, encrypted password manager with a web UI. No cloud, no account.

## Install

```
brew tap haiigas/homebrew-saku
brew install saku
mkcert -install        # once, for a trusted https://localhost
brew services start saku
```

Open `https://localhost:7878` (or `https://<your-ip>:7878` from another device on your network).
First visit: choose a master password and save the **recovery key** shown once.

## What it stores

| type | fields |
|---|---|
| Login | username, password, 2FA key (live code), websites (many), custom fields (text / password / 2FA), notes |
| Bank account | bank name, full name, account number, shift code, PIN, branch name, contact number, address, notes |
| Payment card | holder, number, expires, CVC, PIN, bank name, bank website, notes |
| Wireless router | SSID, password, IP, admin username, admin password, notes |

Every item has a name and multiple tags. UI has favorites, duplicate, search, tag filters,
password generator, click-to-copy (clipboard cleared after 30s), and auto-lock (5 / 15 / 30 min / never).

## Security

- Master password → Argon2id → key that wraps a random 256-bit data key.
- Item contents encrypted with AES-256-GCM (per-item nonce, item ID bound as AAD).
- Recovery key wraps the same data key; forgetting both = data is unrecoverable.
- Item names and tags are stored **unencrypted** (for fast search). Everything else is encrypted.
- Data key lives in memory only while unlocked; locking wipes it.
- Session cookie is `HttpOnly` + `SameSite=Strict`; Host and Origin are checked; failed logins are rate-limited.
- HTTPS by default (mkcert cert if available, otherwise self-signed).
- Vault: `~/.config/saku/vault.db` (SQLite, mode 0600).

## Usage

```
saku serve [--port 7878] [--bind 0.0.0.0] [--host name]... [--http]
saku backup <file>     copy the encrypted vault
saku doctor            check paths and dependencies
```

```
saku serve --bind 127.0.0.1                     # this machine only
saku serve --http --port 7879 --host saku.dev   # behind rute
rute proxy saku.dev 7879
```

Import: saku export (plain or encrypted), Bitwarden JSON, or CSV. Export is in Settings.

## Develop

```
cd ui && pnpm install && pnpm build   # writes web/dist (committed)
go test ./... && go build
```

## Uninstall

```bash
brew services stop saku
brew uninstall --zap saku
```

## License

MIT
