package main

import (
	"embed"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

//go:embed all:web/dist
var webFS embed.FS

const cookieName = "saku_session"

// extOrigin is the browser extension in ./extension (ID is fixed by "key" in its manifest).
const extOrigin = "chrome-extension://npfiijknlecpfdggffkejocdebbodipl"

// hostOf: hostname of a saved URL or bare domain ("" if unusable).
func hostOf(saved string) string {
	saved = strings.TrimSpace(saved)
	if !strings.Contains(saved, "://") {
		saved = "https://" + saved
	}
	u, err := url.Parse(saved)
	if err != nil {
		return ""
	}
	return strings.ToLower(u.Hostname())
}

// hostMatch: saved URL (or bare domain) covers host, including subdomains.
func hostMatch(saved, host string) bool {
	h := hostOf(saved)
	return h != "" && (h == host || strings.HasSuffix(host, "."+h))
}

type Server struct {
	v     *Vault
	hosts map[string]bool
	tls   bool
	icons bool // fetch site favicons (config: favicons = false to disable)
}

func (s *Server) hostOK(h string) bool {
	if hh, _, err := net.SplitHostPort(h); err == nil {
		h = hh
	}
	h = strings.ToLower(strings.Trim(h, "[]"))
	return h == "localhost" || strings.HasSuffix(h, ".localhost") || net.ParseIP(h) != nil || s.hosts[h]
}

func (s *Server) handler() http.Handler {
	mux := http.NewServeMux()
	api := func(pattern string, auth bool, f func(w http.ResponseWriter, r *http.Request)) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if auth {
				tok := token(r)
				// totp polling and status must not keep the vault awake
				touch := r.URL.Path != "/api/totp"
				if tok == "" || !s.v.Unlocked() || !s.v.ValidSession(tok, touch) {
					fail(w, 401, "locked")
					return
				}
			}
			f(w, r)
		})
	}

	mux.HandleFunc("GET /api/status", func(w http.ResponseWriter, r *http.Request) {
		ok := false
		if t := token(r); t != "" {
			ok = s.v.Unlocked() && s.v.ValidSession(t, false)
		}
		reply(w, map[string]any{"initialized": s.v.Initialized(), "unlocked": ok, "autolock": s.v.Autolock()})
	})
	mux.HandleFunc("POST /api/setup", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Password string }
		if !body(w, r, &in, 1<<16) {
			return
		}
		rec, err := s.v.Setup(in.Password)
		if err != nil {
			failErr(w, err)
			return
		}
		s.login(w, r)
		reply(w, map[string]any{"recovery": rec})
	})
	mux.HandleFunc("POST /api/unlock", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Password string }
		if !body(w, r, &in, 1<<16) {
			return
		}
		if err := s.v.Unlock(in.Password); err != nil {
			failErr(w, err)
			return
		}
		s.login(w, r)
		reply(w, map[string]any{})
	})
	mux.HandleFunc("POST /api/recover", func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Recovery, Password string }
		if !body(w, r, &in, 1<<16) {
			return
		}
		if err := s.v.Recover(in.Recovery, in.Password); err != nil {
			failErr(w, err)
			return
		}
		s.login(w, r)
		reply(w, map[string]any{})
	})
	mux.HandleFunc("POST /api/signout", func(w http.ResponseWriter, r *http.Request) {
		s.v.EndSession(token(r))
		http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", MaxAge: -1})
		reply(w, map[string]any{})
	})
	api("POST /api/lock", false, func(w http.ResponseWriter, r *http.Request) {
		s.v.Lock()
		http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", MaxAge: -1})
		reply(w, map[string]any{})
	})

	api("GET /api/items", true, func(w http.ResponseWriter, r *http.Request) {
		items, err := s.v.List()
		if !s.icons {
			for i := range items {
				items[i].Site = ""
			}
		}
		respond(w, items, err)
	})
	api("GET /api/icon", true, func(w http.ResponseWriter, r *http.Request) {
		b, t, ok := favicon(r.URL.Query().Get("host"))
		if !s.icons || !ok {
			w.Header().Set("Cache-Control", "private, max-age=3600")
			fail(w, 404, "no icon")
			return
		}
		w.Header().Set("Content-Type", t)
		w.Header().Set("Cache-Control", "private, max-age=86400")
		w.Header().Set("Content-Security-Policy", "sandbox")
		_, _ = w.Write(b)
	})
	api("POST /api/items", true, func(w http.ResponseWriter, r *http.Request) {
		var it Item
		if !body(w, r, &it, 1<<20) {
			return
		}
		it.ID, it.Created = "", 0
		out, err := s.v.Create(it)
		respond(w, out, err)
	})
	api("GET /api/items/{id}", true, func(w http.ResponseWriter, r *http.Request) {
		it, err := s.v.Get(r.PathValue("id"))
		if !s.icons {
			it.Site = ""
		}
		respond(w, it, err)
	})
	api("PUT /api/items/{id}", true, func(w http.ResponseWriter, r *http.Request) {
		var it Item
		if !body(w, r, &it, 1<<20) {
			return
		}
		out, err := s.v.Update(r.PathValue("id"), it)
		respond(w, out, err)
	})
	api("DELETE /api/items/{id}", true, func(w http.ResponseWriter, r *http.Request) {
		respond(w, map[string]any{}, s.v.Delete(r.PathValue("id")))
	})
	api("POST /api/items/{id}/duplicate", true, func(w http.ResponseWriter, r *http.Request) {
		it, err := s.v.Duplicate(r.PathValue("id"))
		it.Data = nil
		respond(w, it, err)
	})
	api("POST /api/items/{id}/favorite", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Favorite bool }
		if !body(w, r, &in, 1<<10) {
			return
		}
		respond(w, map[string]any{}, s.v.SetFavorite(r.PathValue("id"), in.Favorite))
	})
	api("POST /api/totp", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Secret string }
		if !body(w, r, &in, 1<<12) {
			return
		}
		code, rem, err := totp(in.Secret, time.Now())
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		reply(w, map[string]any{"code": code, "remaining": rem})
	})

	// match: logins for a host (?host=) or by name/username (?q=); slim rows for the extension.
	api("GET /api/match", true, func(w http.ResponseWriter, r *http.Request) {
		host := strings.ToLower(r.URL.Query().Get("host"))
		q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
		all, err := s.v.All()
		if err != nil {
			failErr(w, err)
			return
		}
		type row struct {
			ID   string `json:"id"`
			Name string `json:"name"`
			Sub  string `json:"sub"`
			Totp bool   `json:"totp"`
		}
		out := []row{}
		for _, it := range all {
			var d struct {
				Urls     []string
				Username string
				Totp     string
			}
			if it.Type != "login" || json.Unmarshal(it.Data, &d) != nil {
				continue
			}
			ok := false
			if q != "" {
				ok = strings.Contains(strings.ToLower(it.Name), q) || strings.Contains(strings.ToLower(d.Username), q)
			} else {
				for _, u := range d.Urls {
					if host != "" && hostMatch(u, host) {
						ok = true
						break
					}
				}
			}
			if ok {
				out = append(out, row{it.ID, it.Name, d.Username, d.Totp != ""})
			}
		}
		reply(w, out)
	})
	api("GET /api/tags", true, func(w http.ResponseWriter, r *http.Request) { reply(w, s.v.TagColors()) })
	api("POST /api/tags", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Old, Name, Color string }
		if !body(w, r, &in, 1<<10) {
			return
		}
		respond(w, map[string]any{}, s.v.UpdateTag(in.Old, in.Name, in.Color))
	})
	api("POST /api/ping", true, func(w http.ResponseWriter, r *http.Request) { reply(w, map[string]any{}) })
	api("POST /api/autolock", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Seconds int }
		if !body(w, r, &in, 1<<10) {
			return
		}
		respond(w, map[string]any{}, s.v.SetAutolock(in.Seconds))
	})
	api("POST /api/password", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Old, New string }
		if !body(w, r, &in, 1<<16) {
			return
		}
		respond(w, map[string]any{}, s.v.ChangePassword(in.Old, in.New))
	})
	api("POST /api/export", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Password, Passphrase string }
		if !body(w, r, &in, 1<<16) {
			return
		}
		if err := s.v.Verify(in.Password); err != nil {
			failErr(w, err)
			return
		}
		items, err := s.v.All()
		if err != nil {
			failErr(w, err)
			return
		}
		out, err := exportItems(items, in.Passphrase)
		if err != nil {
			failErr(w, err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", `attachment; filename="saku-export.json"`)
		_, _ = w.Write(out)
	})
	api("POST /api/import", true, func(w http.ResponseWriter, r *http.Request) {
		var in struct{ Data, Passphrase string }
		if !body(w, r, &in, 32<<20) {
			return
		}
		items, skipped, err := parseImport([]byte(in.Data), in.Passphrase)
		if err != nil {
			fail(w, 400, err.Error())
			return
		}
		n := 0
		for _, it := range items {
			it.ID = ""
			if _, err := s.v.Create(it); err == nil {
				n++
			} else {
				skipped++
			}
		}
		reply(w, map[string]any{"imported": n, "skipped": skipped})
	})
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { fail(w, 404, "not found") })

	dist, _ := fs.Sub(webFS, "web/dist")
	files := http.FileServer(http.FS(dist))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if p := strings.TrimPrefix(r.URL.Path, "/"); p != "" {
			if f, err := dist.Open(p); err == nil {
				f.Close()
			} else {
				r.URL.Path = "/"
			}
		}
		files.ServeHTTP(w, r)
	})

	return s.guard(mux)
}

// guard: host allowlist (DNS rebinding), same-origin check (CSRF), security headers.
func (s *Server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.hostOK(r.Host) {
			http.Error(w, "host not allowed (use `saku serve --host <name>`)", 403)
			return
		}
		if o := r.Header.Get("Origin"); o != "" {
			if u, err := url.Parse(o); o != extOrigin && (err != nil || !strings.EqualFold(u.Host, r.Host)) {
				http.Error(w, "cross-origin request blocked", 403)
				return
			}
		}
		h := w.Header()
		h.Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'")
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		if strings.HasPrefix(r.URL.Path, "/api/") {
			h.Set("Cache-Control", "no-store")
		}
		if s.tls {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	t := s.v.NewSession()
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: t, Path: "/",
		HttpOnly: true, SameSite: http.SameSiteStrictMode, Secure: s.tls})
	if r.Header.Get("Origin") == extOrigin {
		w.Header().Set("X-Saku-Token", t) // extension keeps it in memory, no cookie jar
	}
}

// token: session cookie (web UI) or Bearer (extension). Bearer is not ambient, so no CSRF risk.
func token(r *http.Request) string {
	if a, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		return a
	}
	if c, err := r.Cookie(cookieName); err == nil {
		return c.Value
	}
	return ""
}

func reply(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func fail(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func failErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errNotFound):
		fail(w, 404, err.Error())
	case errors.Is(err, errInput):
		fail(w, 400, err.Error())
	case errors.Is(err, errBadPw):
		fail(w, 401, err.Error())
	case errors.Is(err, errLocked):
		fail(w, 401, "locked")
	default:
		fail(w, 400, err.Error())
	}
}

func respond(w http.ResponseWriter, v any, err error) {
	if err != nil {
		failErr(w, err)
		return
	}
	reply(w, v)
}

func body(w http.ResponseWriter, r *http.Request, v any, max int64) bool {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, max))
	if err != nil || json.Unmarshal(b, v) != nil {
		fail(w, 400, "bad request")
		return false
	}
	return true
}
