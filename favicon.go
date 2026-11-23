package main

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

var (
	cgnat     = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}
	hostRe    = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$`)
	linkRe    = regexp.MustCompile(`(?is)<link\b[^>]*>`)
	relIconRe = regexp.MustCompile(`(?is)\brel\s*=\s*["']?[^"'>]*\bicon\b`)
	hrefRe    = regexp.MustCompile(`(?is)\bhref\s*=\s*["']([^"']+)["']`)
)

// publicOnly refuses to connect to loopback, LAN, link-local or CGNAT addresses (SSRF guard).
// It runs on the resolved IP, so DNS rebinding and redirects cannot get around it.
func publicOnly(_, address string, _ syscall.RawConn) error {
	h, _, _ := net.SplitHostPort(address)
	ip := net.ParseIP(h)
	if ip == nil || !ip.IsGlobalUnicast() || ip.IsPrivate() || cgnat.Contains(ip) {
		return errors.New("address not allowed")
	}
	return nil
}

var iconClient = &http.Client{
	Timeout:   5 * time.Second,
	Transport: &http.Transport{DialContext: (&net.Dialer{Timeout: 3 * time.Second, Control: publicOnly}).DialContext},
	CheckRedirect: func(_ *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		return nil
	},
}

type iconEntry struct {
	data []byte
	ctyp string
	at   time.Time
}

var (
	iconMu    sync.Mutex
	iconCache = map[string]iconEntry{}
)

func fetchBody(u string, max int64) ([]byte, error) {
	req, _ := http.NewRequest("GET", u, nil)
	req.Header.Set("User-Agent", "saku-favicon")
	res, err := iconClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return nil, errors.New("status")
	}
	b, err := io.ReadAll(io.LimitReader(res.Body, max+1))
	if err != nil || int64(len(b)) > max {
		return nil, errors.New("too large")
	}
	return b, nil
}

// rasterOnly: sniffed type must be a bitmap image. SVG is refused (it can carry script).
func rasterOnly(b []byte) (string, bool) {
	t := http.DetectContentType(b)
	return t, strings.HasPrefix(t, "image/") && !strings.Contains(t, "svg")
}

func findIcon(host string) ([]byte, string, bool) {
	base := "https://" + host + "/"
	cands := []string{base + "favicon.ico"}
	try := func() ([]byte, string, bool) {
		for _, c := range cands {
			if b, err := fetchBody(c, 64<<10); err == nil {
				if t, ok := rasterOnly(b); ok {
					return b, t, true
				}
			}
		}
		return nil, "", false
	}
	if b, t, ok := try(); ok {
		return b, t, true
	}
	// no /favicon.ico: look for <link rel="icon"> on the home page
	cands = nil
	if page, err := fetchBody(base, 128<<10); err == nil {
		bu, _ := url.Parse(base)
		for _, l := range linkRe.FindAllString(string(page), 30) {
			if m := hrefRe.FindStringSubmatch(l); m != nil && relIconRe.MatchString(l) {
				if u, err := bu.Parse(strings.TrimSpace(m[1])); err == nil && u.Scheme == "https" {
					cands = append(cands, u.String())
				}
			}
		}
	}
	return try()
}

// favicon returns a cached icon for host (found or not, so dead sites are not hammered).
func favicon(host string) ([]byte, string, bool) {
	host = strings.ToLower(host)
	if len(host) > 253 || !hostRe.MatchString(host) {
		return nil, "", false
	}
	iconMu.Lock()
	e, hit := iconCache[host]
	iconMu.Unlock()
	if hit {
		ttl := time.Hour
		if e.data != nil {
			ttl = 7 * 24 * time.Hour
		}
		if time.Since(e.at) < ttl {
			return e.data, e.ctyp, e.data != nil
		}
	}
	b, t, ok := findIcon(host)
	if !ok {
		b, t = nil, ""
	}
	iconMu.Lock()
	if len(iconCache) > 500 {
		iconCache = map[string]iconEntry{}
	}
	iconCache[host] = iconEntry{b, t, time.Now()}
	iconMu.Unlock()
	return b, t, ok
}
