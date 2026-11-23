package main

import (
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var (
	errLocked   = errors.New("vault locked")
	errBadPw    = errors.New("wrong password")
	errNotFound = errors.New("not found")
	errInput    = errors.New("invalid input")
	itemTypes   = map[string]bool{"login": true, "bank": true, "card": true, "wifi": true}
)

type Item struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"`
	Name     string          `json:"name"`
	Tags     []string        `json:"tags"`
	Favorite bool            `json:"favorite"`
	Created  int64           `json:"created"`
	Updated  int64           `json:"updated"`
	Sub      string          `json:"sub,omitempty"`
	Data     json.RawMessage `json:"data,omitempty"`
}

type Vault struct {
	mu       sync.RWMutex // guards dek; held (R) for every op that uses it
	db       *sql.DB
	dek      []byte
	smu      sync.Mutex // guards the fields below
	sessions map[string]bool
	last     time.Time
	fails    int
	blocked  time.Time
}

func openVault(path string) (*Vault, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	_ = os.Chmod(filepath.Dir(path), 0o700)
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=secure_delete(ON)&_pragma=foreign_keys(ON)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
  favorite INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, updated INTEGER NOT NULL, data BLOB NOT NULL);`)
	if err != nil {
		return nil, err
	}
	for _, f := range []string{"", "-wal", "-shm"} {
		_ = os.Chmod(path+f, 0o600)
	}
	return &Vault{db: db, sessions: map[string]bool{}, last: time.Now()}, nil
}

func (v *Vault) meta(k string) []byte {
	var b []byte
	_ = v.db.QueryRow(`SELECT v FROM meta WHERE k=?`, k).Scan(&b)
	return b
}

func (v *Vault) setMeta(k string, b []byte) error {
	_, err := v.db.Exec(`INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v`, k, b)
	return err
}

func (v *Vault) Initialized() bool { return v.meta("salt") != nil }

func (v *Vault) Unlocked() bool {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.dek != nil
}

func (v *Vault) Autolock() int {
	n := 900
	if b := v.meta("autolock"); b != nil {
		fmt.Sscanf(string(b), "%d", &n)
	}
	return n
}

func (v *Vault) SetAutolock(n int) error {
	if n != 0 && n != 300 && n != 900 && n != 1800 {
		return errInput
	}
	return v.setMeta("autolock", []byte(fmt.Sprint(n)))
}

func (v *Vault) Setup(pw string) (string, error) {
	if v.Initialized() {
		return "", errors.New("already set up")
	}
	if len(pw) < 8 {
		return "", fmt.Errorf("%w: master password needs 8+ characters", errInput)
	}
	dek, salt := randBytes(32), randBytes(16)
	rec, rk := newRecovery()
	for k, val := range map[string][]byte{
		"salt":     salt,
		"wrap_pw":  seal(deriveKey(pw, salt), dek, aadDEK),
		"wrap_rec": seal(rk, dek, aadDEK),
	} {
		if err := v.setMeta(k, val); err != nil {
			return "", err
		}
	}
	v.mu.Lock()
	v.dek = dek
	v.mu.Unlock()
	return rec, nil
}

// checkPw derives and returns the DEK; rate-limits repeated failures.
func (v *Vault) checkPw(pw string) ([]byte, error) {
	v.smu.Lock()
	if time.Now().Before(v.blocked) {
		v.smu.Unlock()
		return nil, errors.New("too many attempts, wait a bit")
	}
	v.smu.Unlock()
	dek, err := open(deriveKey(pw, v.meta("salt")), v.meta("wrap_pw"), aadDEK)
	v.smu.Lock()
	defer v.smu.Unlock()
	if err != nil {
		if v.fails++; v.fails >= 5 {
			v.blocked, v.fails = time.Now().Add(30*time.Second), 0
		}
		return nil, errBadPw
	}
	v.fails = 0
	return dek, nil
}

func (v *Vault) Unlock(pw string) error {
	if !v.Initialized() {
		return errors.New("not set up")
	}
	dek, err := v.checkPw(pw)
	if err != nil {
		return err
	}
	v.mu.Lock()
	if v.dek != nil {
		zero(v.dek)
	}
	v.dek = dek
	v.mu.Unlock()
	return nil
}

// Verify re-checks the master password (for sensitive actions).
func (v *Vault) Verify(pw string) error {
	dek, err := v.checkPw(pw)
	zero(dek)
	return err
}

func (v *Vault) rewrap(dek []byte, pw string) error {
	if len(pw) < 8 {
		return fmt.Errorf("%w: master password needs 8+ characters", errInput)
	}
	salt := randBytes(16)
	if err := v.setMeta("salt", salt); err != nil {
		return err
	}
	return v.setMeta("wrap_pw", seal(deriveKey(pw, salt), dek, aadDEK))
}

func (v *Vault) ChangePassword(old, pw string) error {
	dek, err := v.checkPw(old)
	if err != nil {
		return err
	}
	defer zero(dek)
	return v.rewrap(dek, pw)
}

func (v *Vault) Recover(rk, pw string) error {
	v.smu.Lock()
	if time.Now().Before(v.blocked) {
		v.smu.Unlock()
		return errors.New("too many attempts, wait a bit")
	}
	v.smu.Unlock()
	dek, err := open(recoveryKey(rk), v.meta("wrap_rec"), aadDEK)
	if err != nil {
		v.smu.Lock()
		if v.fails++; v.fails >= 5 {
			v.blocked, v.fails = time.Now().Add(30*time.Second), 0
		}
		v.smu.Unlock()
		return errors.New("wrong recovery key")
	}
	if err := v.rewrap(dek, pw); err != nil {
		zero(dek)
		return err
	}
	v.mu.Lock()
	if v.dek != nil {
		zero(v.dek)
	}
	v.dek = dek
	v.mu.Unlock()
	return nil
}

func (v *Vault) Lock() {
	v.mu.Lock()
	if v.dek != nil {
		zero(v.dek)
		v.dek = nil
	}
	v.mu.Unlock()
	v.smu.Lock()
	v.sessions = map[string]bool{}
	v.smu.Unlock()
}

func (v *Vault) NewSession() string {
	t := hex.EncodeToString(randBytes(32))
	v.smu.Lock()
	v.sessions[t] = true
	v.last = time.Now()
	v.smu.Unlock()
	return t
}

func (v *Vault) ValidSession(t string, touch bool) bool {
	v.smu.Lock()
	defer v.smu.Unlock()
	if !v.sessions[t] {
		return false
	}
	if touch {
		v.last = time.Now()
	}
	return true
}

func (v *Vault) IdleFor() time.Duration {
	v.smu.Lock()
	defer v.smu.Unlock()
	return time.Since(v.last)
}

// ---- items ----------------------------------------------------------------

func (v *Vault) withKey(f func(key []byte) error) error {
	v.mu.RLock()
	defer v.mu.RUnlock()
	if v.dek == nil {
		return errLocked
	}
	return f(v.dek)
}

var last4 = regexp.MustCompile(`\D`)

func subtitle(t string, d map[string]any) string {
	s := func(k string) string { x, _ := d[k].(string); return x }
	switch t {
	case "login":
		return s("username")
	case "bank":
		return s("bank_name")
	case "card":
		n := last4.ReplaceAllString(s("number"), "")
		if len(n) >= 4 {
			return "•••• " + n[len(n)-4:]
		}
		return s("bank_name")
	case "wifi":
		return s("ssid")
	}
	return ""
}

func cleanItem(it *Item) error {
	it.Name = strings.TrimSpace(it.Name)
	if !itemTypes[it.Type] || it.Name == "" || len(it.Name) > 200 {
		return fmt.Errorf("%w: type/name", errInput)
	}
	var obj map[string]any
	if json.Unmarshal(it.Data, &obj) != nil || len(it.Data) > 256<<10 {
		return fmt.Errorf("%w: data", errInput)
	}
	seen, tags := map[string]bool{}, []string{}
	for _, t := range it.Tags {
		t = strings.TrimSpace(t)
		if k := strings.ToLower(t); t != "" && len(t) <= 40 && !seen[k] && len(tags) < 20 {
			seen[k] = true
			tags = append(tags, t)
		}
	}
	it.Tags = tags
	return nil
}

func scan(r interface{ Scan(...any) error }) (Item, []byte, error) {
	var it Item
	var tags string
	var fav int
	var data []byte
	err := r.Scan(&it.ID, &it.Type, &it.Name, &tags, &fav, &it.Created, &it.Updated, &data)
	it.Favorite = fav == 1
	if json.Unmarshal([]byte(tags), &it.Tags) != nil || it.Tags == nil {
		it.Tags = []string{}
	}
	return it, data, err
}

const cols = `id,type,name,tags,favorite,created,updated,data`

func (v *Vault) List() ([]Item, error) {
	out := []Item{}
	err := v.withKey(func(key []byte) error {
		rows, err := v.db.Query(`SELECT ` + cols + ` FROM items ORDER BY name COLLATE NOCASE`)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			it, ct, err := scan(rows)
			if err != nil {
				return err
			}
			if pt, err := open(key, ct, []byte(it.ID)); err == nil {
				var d map[string]any
				_ = json.Unmarshal(pt, &d)
				it.Sub = subtitle(it.Type, d)
			}
			out = append(out, it)
		}
		return rows.Err()
	})
	return out, err
}

func (v *Vault) Get(id string) (Item, error) {
	var it Item
	err := v.withKey(func(key []byte) error {
		i, ct, err := scan(v.db.QueryRow(`SELECT `+cols+` FROM items WHERE id=?`, id))
		if err != nil {
			return errNotFound
		}
		pt, err := open(key, ct, []byte(id))
		if err != nil {
			return errors.New("decrypt failed")
		}
		i.Data = pt
		it = i
		return nil
	})
	return it, err
}

func (v *Vault) Create(it Item) (Item, error) {
	if err := cleanItem(&it); err != nil {
		return it, err
	}
	if it.ID == "" {
		it.ID = hex.EncodeToString(randBytes(16))
	}
	now := time.Now().Unix()
	if it.Created == 0 {
		it.Created = now
	}
	it.Updated = now
	tags, _ := json.Marshal(it.Tags)
	fav := 0
	if it.Favorite {
		fav = 1
	}
	err := v.withKey(func(key []byte) error {
		_, err := v.db.Exec(`INSERT INTO items(`+cols+`) VALUES(?,?,?,?,?,?,?,?)`,
			it.ID, it.Type, it.Name, string(tags), fav, it.Created, it.Updated, seal(key, it.Data, []byte(it.ID)))
		return err
	})
	return it, err
}

func (v *Vault) Update(id string, it Item) (Item, error) {
	if err := cleanItem(&it); err != nil {
		return it, err
	}
	tags, _ := json.Marshal(it.Tags)
	fav := 0
	if it.Favorite {
		fav = 1
	}
	it.ID, it.Updated = id, time.Now().Unix()
	err := v.withKey(func(key []byte) error {
		r, err := v.db.Exec(`UPDATE items SET type=?,name=?,tags=?,favorite=?,updated=?,data=? WHERE id=?`,
			it.Type, it.Name, string(tags), fav, it.Updated, seal(key, it.Data, []byte(id)), id)
		if err != nil {
			return err
		}
		if n, _ := r.RowsAffected(); n == 0 {
			return errNotFound
		}
		return nil
	})
	return it, err
}

func (v *Vault) SetFavorite(id string, fav bool) error {
	return v.withKey(func([]byte) error {
		n := 0
		if fav {
			n = 1
		}
		r, err := v.db.Exec(`UPDATE items SET favorite=? WHERE id=?`, n, id)
		if err != nil {
			return err
		}
		if c, _ := r.RowsAffected(); c == 0 {
			return errNotFound
		}
		return nil
	})
}

func (v *Vault) Delete(id string) error {
	return v.withKey(func([]byte) error {
		r, err := v.db.Exec(`DELETE FROM items WHERE id=?`, id)
		if err != nil {
			return err
		}
		if c, _ := r.RowsAffected(); c == 0 {
			return errNotFound
		}
		return nil
	})
}

func (v *Vault) Duplicate(id string) (Item, error) {
	it, err := v.Get(id)
	if err != nil {
		return it, err
	}
	it.ID, it.Created, it.Favorite = "", 0, false
	it.Name += " (copy)"
	return v.Create(it)
}

func (v *Vault) All() ([]Item, error) {
	list, err := v.List()
	if err != nil {
		return nil, err
	}
	out := make([]Item, 0, len(list))
	for _, l := range list {
		it, err := v.Get(l.ID)
		if err != nil {
			return nil, err
		}
		it.Sub = ""
		out = append(out, it)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Created < out[j].Created })
	return out, nil
}

func (v *Vault) Backup(dst string) error {
	if _, err := os.Stat(dst); err == nil {
		return fmt.Errorf("%s exists", dst)
	}
	if _, err := v.db.Exec(`VACUUM INTO ?`, dst); err != nil {
		return err
	}
	return os.Chmod(dst, 0o600)
}
