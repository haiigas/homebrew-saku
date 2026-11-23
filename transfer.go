package main

import (
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type bundle struct {
	App   string `json:"app"`
	Enc   int    `json:"enc,omitempty"`
	Salt  string `json:"salt,omitempty"`
	Data  string `json:"data,omitempty"`
	Items []Item `json:"items,omitempty"`
}

func exportItems(items []Item, pass string) ([]byte, error) {
	if pass == "" {
		return json.MarshalIndent(bundle{App: "saku", Items: items}, "", "  ")
	}
	if len(pass) < 8 {
		return nil, fmt.Errorf("%w: export passphrase needs 8+ characters", errInput)
	}
	plain, _ := json.Marshal(items)
	salt := randBytes(16)
	e := base64.StdEncoding
	return json.Marshal(bundle{App: "saku", Enc: 1, Salt: e.EncodeToString(salt),
		Data: e.EncodeToString(seal(deriveKey(pass, salt), plain, aadExport))})
}

// parseImport auto-detects saku (plain/encrypted), Bitwarden JSON, or CSV.
func parseImport(raw []byte, pass string) ([]Item, int, error) {
	s := strings.TrimSpace(string(raw))
	if strings.HasPrefix(s, "{") {
		var probe struct{ App string }
		if json.Unmarshal(raw, &probe) != nil {
			return nil, 0, errors.New("unreadable JSON")
		}
		if probe.App == "saku" {
			var b bundle
			if json.Unmarshal(raw, &b) != nil {
				return nil, 0, errors.New("corrupt export")
			}
			if b.Enc == 0 {
				return b.Items, 0, nil
			}
			salt, e1 := base64.StdEncoding.DecodeString(b.Salt)
			ct, e2 := base64.StdEncoding.DecodeString(b.Data)
			if e1 != nil || e2 != nil {
				return nil, 0, errors.New("corrupt export")
			}
			pt, err := open(deriveKey(pass, salt), ct, aadExport)
			if err != nil {
				return nil, 0, errors.New("wrong passphrase or corrupt export")
			}
			var items []Item
			return items, 0, json.Unmarshal(pt, &items)
		}
		var bw struct {
			Encrypted bool                        `json:"encrypted"`
			Folders   []struct{ ID, Name string } `json:"folders"`
			Items     []bwItem                    `json:"items"`
		}
		if json.Unmarshal(raw, &bw) != nil || bw.Encrypted || bw.Items == nil {
			return nil, 0, errors.New("unknown or encrypted JSON format")
		}
		folders := map[string]string{}
		for _, f := range bw.Folders {
			folders[f.ID] = f.Name
		}
		return fromBitwarden(bw.Items, folders)
	}
	return fromCSV(s)
}

type bwItem struct {
	Type     int    `json:"type"`
	Name     string `json:"name"`
	Notes    string `json:"notes"`
	Favorite bool   `json:"favorite"`
	Folder   string `json:"folderId"`
	Login    *struct {
		Username string `json:"username"`
		Password string `json:"password"`
		TOTP     string `json:"totp"`
		URIs     []struct {
			URI string `json:"uri"`
		} `json:"uris"`
	} `json:"login"`
	Card *struct {
		Holder string `json:"cardholderName"`
		Number string `json:"number"`
		Month  string `json:"expMonth"`
		Year   string `json:"expYear"`
		Code   string `json:"code"`
	} `json:"card"`
	Fields []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
		Type  int    `json:"type"`
	} `json:"fields"`
}

func mk(t, name string, fav bool, tags []string, d map[string]any) Item {
	raw, _ := json.Marshal(d)
	return Item{Type: t, Name: name, Favorite: fav, Tags: tags, Data: raw}
}

func fromBitwarden(in []bwItem, folders map[string]string) ([]Item, int, error) {
	var out []Item
	skipped := 0
	for _, b := range in {
		var tags []string
		if f := folders[b.Folder]; f != "" {
			tags = []string{f}
		}
		switch {
		case b.Type == 1 && b.Login != nil:
			urls := []string{}
			for _, u := range b.Login.URIs {
				urls = append(urls, u.URI)
			}
			fields := []map[string]string{}
			for _, f := range b.Fields {
				t := "text"
				if f.Type == 1 {
					t = "password"
				}
				fields = append(fields, map[string]string{"label": f.Name, "type": t, "value": f.Value})
			}
			out = append(out, mk("login", b.Name, b.Favorite, tags, map[string]any{
				"username": b.Login.Username, "password": b.Login.Password, "totp": b.Login.TOTP,
				"urls": urls, "fields": fields, "notes": b.Notes}))
		case b.Type == 3 && b.Card != nil:
			exp := strings.Trim(b.Card.Month+"/"+b.Card.Year, "/")
			out = append(out, mk("card", b.Name, b.Favorite, tags, map[string]any{
				"holder": b.Card.Holder, "number": b.Card.Number, "expires": exp, "cvc": b.Card.Code, "notes": b.Notes}))
		default:
			skipped++
		}
	}
	return out, skipped, nil
}

func fromCSV(s string) ([]Item, int, error) {
	r := csv.NewReader(strings.NewReader(strings.TrimPrefix(s, "\ufeff")))
	r.FieldsPerRecord = -1
	r.LazyQuotes = true
	rows, err := r.ReadAll()
	if err != nil || len(rows) < 2 {
		return nil, 0, errors.New("unreadable CSV")
	}
	idx := map[string]int{}
	for i, h := range rows[0] {
		idx[strings.ToLower(strings.TrimSpace(h))] = i
	}
	pick := func(row []string, names ...string) string {
		for _, n := range names {
			if i, ok := idx[n]; ok && i < len(row) {
				return strings.TrimSpace(row[i])
			}
		}
		return ""
	}
	var out []Item
	skipped := 0
	for _, row := range rows[1:] {
		name := pick(row, "name", "title")
		if name == "" {
			if name = pick(row, "login_uri", "url", "website", "uri"); name == "" {
				skipped++
				continue
			}
		}
		urls := []string{}
		if u := pick(row, "login_uri", "url", "website", "uri"); u != "" {
			urls = append(urls, u)
		}
		var tags []string
		if t := pick(row, "folder", "tags", "grouping"); t != "" {
			tags = []string{t}
		}
		out = append(out, mk("login", name, pick(row, "favorite") == "1", tags, map[string]any{
			"username": pick(row, "login_username", "username", "user"),
			"password": pick(row, "login_password", "password"),
			"totp":     pick(row, "login_totp", "totp", "otp", "otpauth"),
			"urls":     urls, "fields": []any{}, "notes": pick(row, "notes", "note")}))
	}
	return out, skipped, nil
}
