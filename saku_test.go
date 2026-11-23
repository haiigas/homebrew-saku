package main

import (
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestTOTP(t *testing.T) {
	// RFC 6238 vector, SHA1, secret "12345678901234567890", T=59 -> 94287082 (8 digits)
	c, _, err := totp("otpauth://totp/x?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8", time.Unix(59, 0))
	if err != nil || c != "94287082" {
		t.Fatalf("got %q %v", c, err)
	}
}

func TestVault(t *testing.T) {
	v, err := openVault(filepath.Join(t.TempDir(), "v.db"))
	if err != nil {
		t.Fatal(err)
	}
	rec, err := v.Setup("hunter2hunter2")
	if err != nil {
		t.Fatal(err)
	}
	it, err := v.Create(Item{Type: "login", Name: "gh", Tags: []string{"dev", "DEV"}, Data: json.RawMessage(`{"username":"me","password":"s3cret"}`)})
	if err != nil || len(it.Tags) != 1 {
		t.Fatal(err, it.Tags)
	}
	// ciphertext at rest must not contain the secret
	var raw []byte
	_ = v.db.QueryRow(`SELECT data FROM items WHERE id=?`, it.ID).Scan(&raw)
	if string(raw) == "" || contains(raw, "s3cret") {
		t.Fatal("plaintext leaked")
	}
	v.Lock()
	if _, err := v.List(); err != errLocked {
		t.Fatal("expected locked", err)
	}
	if err := v.Unlock("wrongwrong"); err != errBadPw {
		t.Fatal(err)
	}
	if err := v.Unlock("hunter2hunter2"); err != nil {
		t.Fatal(err)
	}
	g, _ := v.Get(it.ID)
	if !contains(g.Data, "s3cret") {
		t.Fatal("roundtrip failed")
	}
	// recovery resets password
	v.Lock()
	if err := v.Recover(rec, "newpassword1"); err != nil {
		t.Fatal(err)
	}
	v.Lock()
	if err := v.Unlock("newpassword1"); err != nil {
		t.Fatal(err)
	}
	// duplicate + export/import
	d, err := v.Duplicate(it.ID)
	if err != nil || d.Name != "gh (copy)" {
		t.Fatal(err, d.Name)
	}
	all, _ := v.All()
	for _, pass := range []string{"", "exportpass1"} {
		b, err := exportItems(all, pass)
		if err != nil {
			t.Fatal(err)
		}
		got, _, err := parseImport(b, pass)
		if err != nil || len(got) != 2 {
			t.Fatal(pass, err, len(got))
		}
	}
	if _, _, err := parseImport(mustExport(t, all), "bad-pass-1"); err == nil {
		t.Fatal("wrong passphrase accepted")
	}
	// csv + bitwarden
	if got, _, err := parseImport([]byte("name,login_uri,login_username,login_password\nx,https://a.b,u,p\n"), ""); err != nil || len(got) != 1 {
		t.Fatal(err)
	}
	bw := `{"encrypted":false,"folders":[{"id":"f","name":"Work"}],"items":[{"type":1,"name":"a","folderId":"f","login":{"username":"u","password":"p","uris":[{"uri":"https://x"}]}},{"type":2,"name":"note"}]}`
	if got, sk, err := parseImport([]byte(bw), ""); err != nil || len(got) != 1 || sk != 1 || got[0].Tags[0] != "Work" {
		t.Fatal(err, got, sk)
	}
}

func mustExport(t *testing.T, it []Item) []byte {
	b, err := exportItems(it, "exportpass1")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func contains(b []byte, s string) bool { return len(b) > 0 && indexOf(string(b), s) >= 0 }
func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}

func TestHostMatch(t *testing.T) {
	for _, c := range []struct {
		saved, host string
		want        bool
	}{
		{"https://github.com/login", "github.com", true},
		{"github.com", "gist.github.com", true},
		{"https://gist.github.com", "github.com", false},
		{"https://evilgithub.com", "github.com", false},
		{"https://github.com.evil.io", "github.com", false},
	} {
		if hostMatch(c.saved, c.host) != c.want {
			t.Errorf("hostMatch(%q,%q) != %v", c.saved, c.host, c.want)
		}
	}
}
