package main

import (
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/binary"
	"errors"
	"fmt"
	"hash"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// totp accepts a bare base32 secret or an otpauth:// URI.
func totp(secret string, now time.Time) (code string, remaining int, err error) {
	digits, period, algo := 6, int64(30), sha1.New
	secret = strings.TrimSpace(secret)
	if strings.HasPrefix(strings.ToLower(secret), "otpauth://") {
		u, e := url.Parse(secret)
		if e != nil {
			return "", 0, e
		}
		q := u.Query()
		secret = q.Get("secret")
		if d, e := strconv.Atoi(q.Get("digits")); e == nil && (d == 6 || d == 7 || d == 8) {
			digits = d
		}
		if p, e := strconv.ParseInt(q.Get("period"), 10, 64); e == nil && p > 0 && p <= 300 {
			period = p
		}
		switch strings.ToUpper(q.Get("algorithm")) {
		case "SHA256":
			algo = sha256.New
		case "SHA512":
			algo = sha512.New
		}
	}
	secret = strings.ToUpper(strings.NewReplacer(" ", "", "-", "", "=", "").Replace(secret))
	key, err := b32.DecodeString(secret)
	if err != nil || len(key) == 0 {
		return "", 0, errors.New("invalid 2FA key")
	}
	return hotp(key, now.Unix()/period, digits, algo), int(period - now.Unix()%period), nil
}

func hotp(key []byte, counter int64, digits int, algo func() hash.Hash) string {
	m := hmac.New(algo, key)
	_ = binary.Write(m, binary.BigEndian, counter)
	s := m.Sum(nil)
	o := s[len(s)-1] & 0xf
	v := binary.BigEndian.Uint32(s[o:o+4]) & 0x7fffffff
	mod := uint32(1)
	for i := 0; i < digits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", digits, v%mod)
}
