package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// selfSigned returns a persistent self-signed cert covering localhost, every local IP and extra hosts.
// Regenerated when expiring or when a local IP / host is missing from it.
func selfSigned(dir string, hosts []string) (tls.Certificate, error) {
	crt, key := filepath.Join(dir, "tls.pem"), filepath.Join(dir, "tls-key.pem")
	var ips []net.IP
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, a := range addrs {
			if ipn, ok := a.(*net.IPNet); ok {
				ips = append(ips, ipn.IP)
			}
		}
	}
	if c, err := tls.LoadX509KeyPair(crt, key); err == nil && len(c.Certificate) > 0 {
		if x, err := x509.ParseCertificate(c.Certificate[0]); err == nil && time.Until(x.NotAfter) > 30*24*time.Hour {
			ok := true
			for _, ip := range ips {
				if x.VerifyHostname(ip.String()) != nil {
					ok = false
				}
			}
			for _, h := range hosts {
				if x.VerifyHostname(h) != nil {
					ok = false
				}
			}
			if ok {
				return c, nil
			}
		}
	}
	// prefer mkcert (already trusted by the browser if `mkcert -install` was run)
	if mk, err := exec.LookPath("mkcert"); err == nil {
		args := []string{"-cert-file", crt, "-key-file", key, "localhost", "127.0.0.1", "::1"}
		for _, ip := range ips {
			args = append(args, ip.String())
		}
		if exec.Command(mk, append(args, hosts...)...).Run() == nil {
			if c, err := tls.LoadX509KeyPair(crt, key); err == nil {
				_ = os.Chmod(key, 0o600)
				return c, nil
			}
		}
	}
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 100))
	tpl := &x509.Certificate{
		SerialNumber: serial, Subject: pkix.Name{CommonName: "saku"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().AddDate(1, 0, 0),
		KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		DNSNames: append([]string{"localhost"}, hosts...), IPAddresses: ips,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	if err != nil {
		return tls.Certificate{}, err
	}
	kb, _ := x509.MarshalECPrivateKey(priv)
	if err := os.WriteFile(crt, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		return tls.Certificate{}, err
	}
	if err := os.WriteFile(key, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: kb}), 0o600); err != nil {
		return tls.Certificate{}, err
	}
	return tls.LoadX509KeyPair(crt, key)
}
