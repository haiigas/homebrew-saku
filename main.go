package main

import (
	"crypto/tls"
	"flag"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const version = "0.1.1"

func home() string {
	if h := os.Getenv("SAKU_HOME"); h != "" {
		return h
	}
	if x := os.Getenv("XDG_CONFIG_HOME"); x != "" {
		return filepath.Join(x, "saku")
	}
	h, _ := os.UserHomeDir()
	return filepath.Join(h, ".config", "saku")
}

func die(f string, a ...any) {
	fmt.Fprintf(os.Stderr, "saku: "+f+"\n", a...)
	os.Exit(1)
}

const usage = `saku ` + version + ` — local encrypted password manager

usage:
  saku serve [--port 7878] [--bind 0.0.0.0] [--host name]... [--http]
                       start the web UI (HTTPS by default)
  config: ~/.config/saku/config  (port, bind, http, host = a.dev, b.dev; favicons = false; flags win)
  saku backup <file>   copy the (still encrypted) vault to <file>
  saku doctor          check paths and dependencies
  saku -h | --help
  saku --version

examples:
  saku serve                                  # https://localhost:7878 and https://<lan-ip>:7878
  saku serve --bind 127.0.0.1                 # this machine only
  saku serve --http --port 7879 --host saku.dev   # behind rute: rute proxy saku.dev 7879
  brew services start saku                    # run in background
`

type multi []string

func (m *multi) String() string     { return strings.Join(*m, ",") }
func (m *multi) Set(s string) error { *m = append(*m, strings.ToLower(s)); return nil }

func main() {
	if len(os.Args) < 2 {
		fmt.Print(usage)
		os.Exit(1)
	}
	switch os.Args[1] {
	case "-h", "--help", "help":
		fmt.Print(usage)
	case "--version", "version":
		fmt.Println("saku " + version)
	case "serve":
		serve(os.Args[2:])
	case "backup":
		if len(os.Args) != 3 {
			die("usage: saku backup <file>")
		}
		v, err := openVault(filepath.Join(home(), "vault.db"))
		if err != nil {
			die("%v", err)
		}
		if err := v.Backup(os.Args[2]); err != nil {
			die("%v", err)
		}
		fmt.Println("saku: backup written to", os.Args[2], "(encrypted; needs your master password or recovery key)")
	case "doctor":
		doctor()
	default:
		fmt.Fprint(os.Stderr, usage)
		os.Exit(1)
	}
}

// readConfig parses "key = value" lines; flags override it.
func readConfig(path string) map[string]string {
	m := map[string]string{}
	b, err := os.ReadFile(path)
	if err != nil {
		return m
	}
	for _, l := range strings.Split(string(b), "\n") {
		if k, v, ok := strings.Cut(l, "="); ok && !strings.HasPrefix(strings.TrimSpace(l), "#") {
			m[strings.ToLower(strings.TrimSpace(k))] = strings.TrimSpace(v)
		}
	}
	return m
}

func serve(args []string) {
	cfg := readConfig(filepath.Join(home(), "config"))
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	dport := 7878
	fmt.Sscan(cfg["port"], &dport)
	dbind := "0.0.0.0"
	if cfg["bind"] != "" {
		dbind = cfg["bind"]
	}
	port := fs.Int("port", dport, "port")
	bind := fs.String("bind", dbind, "bind address")
	plain := fs.Bool("http", cfg["http"] == "true", "plain HTTP (use only on localhost or behind a TLS proxy)")
	var hosts multi
	for _, h := range strings.Split(cfg["host"], ",") {
		if h = strings.TrimSpace(h); h != "" {
			hosts = append(hosts, strings.ToLower(h))
		}
	}
	fs.Var(&hosts, "host", "extra allowed hostname (repeatable)")
	_ = fs.Parse(args)

	dir := home()
	v, err := openVault(filepath.Join(dir, "vault.db"))
	if err != nil {
		die("%v", err)
	}
	s := &Server{v: v, hosts: map[string]bool{}, tls: !*plain, icons: cfg["favicons"] != "false"}
	for _, h := range hosts {
		s.hosts[h] = true
	}
	go func() {
		for range time.Tick(10 * time.Second) {
			if n := v.Autolock(); n > 0 && v.Unlocked() && v.IdleFor() > time.Duration(n)*time.Second {
				v.Lock()
			}
		}
	}()

	addr := net.JoinHostPort(*bind, fmt.Sprint(*port))
	srv := &http.Server{Addr: addr, Handler: s.handler(), ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout: 60 * time.Second, IdleTimeout: 120 * time.Second}
	scheme := "http"
	if s.tls {
		cert, err := selfSigned(dir, hosts)
		if err != nil {
			die("tls: %v", err)
		}
		srv.TLSConfig = &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
		scheme = "https"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		die("%v", err)
	}
	fmt.Printf("saku %s: %s://localhost:%d\n", version, scheme, *port)
	if *bind == "0.0.0.0" || *bind == "::" {
		if addrs, err := net.InterfaceAddrs(); err == nil {
			for _, a := range addrs {
				if ipn, ok := a.(*net.IPNet); ok && ipn.IP.To4() != nil && !ipn.IP.IsLoopback() {
					fmt.Printf("           %s://%s:%d\n", scheme, ipn.IP, *port)
				}
			}
		}
	}
	if s.tls {
		err = srv.ServeTLS(ln, "", "")
	} else {
		err = srv.Serve(ln)
	}
	die("%v", err)
}

func doctor() {
	ok := func(b bool) string {
		if b {
			return "ok"
		}
		return "missing"
	}
	dir := home()
	_, e := os.Stat(filepath.Join(dir, "vault.db"))
	_, mk := exec.LookPath("mkcert")
	_, rt := exec.LookPath("rute")
	fmt.Printf("data dir   %s\nvault      %s\nmkcert     %s (trusted HTTPS cert; else self-signed)\nrute       %s (optional, saku.dev style domains)\n",
		dir, ok(e == nil), ok(mk == nil), ok(rt == nil))
}
