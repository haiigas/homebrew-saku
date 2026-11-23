package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"errors"
	"strings"

	"golang.org/x/crypto/argon2"
)

var (
	aadDEK    = []byte("saku-dek")
	aadExport = []byte("saku-export")
	b32       = base32.StdEncoding.WithPadding(base32.NoPadding)
)

func randBytes(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}

// ponytail: argon2id params fixed (t=3, 64MiB, p=4); store them in meta to make tunable.
func deriveKey(pw string, salt []byte) []byte {
	return argon2.IDKey([]byte(pw), salt, 3, 64*1024, 4, 32)
}

func seal(key, plain, aad []byte) []byte {
	b, _ := aes.NewCipher(key)
	g, _ := cipher.NewGCM(b)
	n := randBytes(g.NonceSize())
	return g.Seal(n, n, plain, aad)
}

func open(key, ct, aad []byte) ([]byte, error) {
	b, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	g, _ := cipher.NewGCM(b)
	if len(ct) < g.NonceSize() {
		return nil, errors.New("short ciphertext")
	}
	return g.Open(nil, ct[:g.NonceSize()], ct[g.NonceSize():], aad)
}

func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}

// newRecovery returns a human-readable key (160 bits, XXXX-XXXX-...) and its wrapping key.
func newRecovery() (string, []byte) {
	s := b32.EncodeToString(randBytes(20))
	var parts []string
	for i := 0; i < len(s); i += 4 {
		parts = append(parts, s[i:i+4])
	}
	return strings.Join(parts, "-"), recoveryKey(s)
}

// recoveryKey is high-entropy, so a plain hash is enough (no slow KDF needed).
func recoveryKey(rk string) []byte {
	rk = strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(rk))
	h := sha256.Sum256([]byte("saku-recovery:" + rk))
	return h[:]
}
