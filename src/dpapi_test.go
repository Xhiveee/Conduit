//go:build windows

package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestProtectSecretRoundtrip(t *testing.T) {
	secrets := []string{
		"hunter2",
		"p@ss word",
		"ключ-с-юникодом",
		strings.Repeat("x", 1024),
	}
	seen := make(map[string]string, len(secrets))
	for _, plain := range secrets {
		enc, err := protectSecret(plain)
		if err != nil {
			t.Fatalf("protectSecret(%q): %v", plain, err)
		}
		if !strings.HasPrefix(enc, secretPrefix) {
			t.Fatalf("protected value %q missing %q prefix", enc, secretPrefix)
		}
		if strings.Contains(enc, plain) {
			t.Fatalf("protected value %q leaks its plaintext", enc)
		}
		if other, ok := seen[enc]; ok && other != plain {
			t.Fatalf("two plaintexts produced the same ciphertext")
		}
		seen[enc] = plain
		got, err := unprotectSecret(enc)
		if err != nil {
			t.Fatalf("unprotectSecret: %v", err)
		}
		if got != plain {
			t.Fatalf("roundtrip mismatch: got %q want %q", got, plain)
		}
	}
}

func TestProtectSecretEmptyAndLegacy(t *testing.T) {
	if got, err := protectSecret(""); err != nil || got != "" {
		t.Fatalf("protectSecret(\"\") = %q, %v; want empty", got, err)
	}
	if got, err := unprotectSecret(""); err != nil || got != "" {
		t.Fatalf("unprotectSecret(\"\") = %q, %v; want empty", got, err)
	}
	if got, err := unprotectSecret("legacy-plaintext"); err != nil || got != "legacy-plaintext" {
		t.Fatalf("legacy plaintext = %q, %v; want unchanged", got, err)
	}
	enc, err := protectSecret("already")
	if err != nil {
		t.Fatalf("protectSecret: %v", err)
	}
	if again, err := protectSecret(enc); err != nil || again != enc {
		t.Fatalf("protectSecret re-encrypted an already protected value: %q, %v", again, err)
	}
}

func writeLegacyStore(t *testing.T, dir, password, keyPassphrase, apiKey string) {
	t.Helper()
	legacy := map[string]any{
		"hosts": []any{map[string]any{
			"id":            "host-1",
			"name":          "box",
			"address":       "10.0.0.1",
			"port":          22,
			"user":          "root",
			"authMethod":    "password",
			"password":      password,
			"keyPassphrase": keyPassphrase,
		}},
		"settings": map[string]any{
			"themeId": "black",
			"ai": map[string]any{
				"baseUrl":       "https://api.openai.com/v1",
				"apiKey":        apiKey,
				"model":         "gpt-4.1",
				"maxSteps":      30,
				"contextWindow": 128000,
			},
		},
	}
	raw, err := json.MarshalIndent(legacy, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "conduit.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestStoreEncryptsSecretsOnSave(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	writeLegacyStore(t, dir, "host-pw", "key-pass", "sk-legacy")

	s, err := NewStore()
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if warnings := s.Warnings(); len(warnings) != 0 {
		t.Fatalf("unexpected warnings: %v", warnings)
	}
	hosts := s.ListHosts()
	if len(hosts) != 1 {
		t.Fatalf("got %d hosts, want 1", len(hosts))
	}
	if hosts[0].Password != "host-pw" || hosts[0].KeyPassphrase != "key-pass" {
		t.Fatalf("host secrets were not loaded as plaintext: %+v", hosts[0])
	}
	if got := s.GetSettings().AI.APIKey; got != "sk-legacy" {
		t.Fatalf("ai.apiKey = %q, want plaintext %q", got, "sk-legacy")
	}

	host := hosts[0]
	host.Password = "host-pw-2"
	if _, err := s.SaveHost(host); err != nil {
		t.Fatalf("SaveHost: %v", err)
	}
	settings := s.GetSettings()
	settings.AI.APIKey = "sk-rewritten"
	if err := s.SaveSettings(settings); err != nil {
		t.Fatalf("SaveSettings: %v", err)
	}

	path := filepath.Join(dir, "conduit.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, plain := range []string{"host-pw-2", "key-pass", "sk-rewritten", "host-pw", "sk-legacy"} {
		if bytes.Contains(raw, []byte(plain)) {
			t.Fatalf("conduit.json still contains plaintext secret %q", plain)
		}
	}
	if got := strings.Count(string(raw), secretPrefix); got != 3 {
		t.Fatalf("conduit.json has %d protected values, want 3: %s", got, raw)
	}
	for _, key := range []string{`"password"`, `"keyPassphrase"`, `"apiKey"`} {
		if !bytes.Contains(raw, []byte(key)) {
			t.Fatalf("conduit.json lost the %s field", key)
		}
	}

	reloaded, err := NewStore()
	if err != nil {
		t.Fatalf("NewStore after save: %v", err)
	}
	if warnings := reloaded.Warnings(); len(warnings) != 0 {
		t.Fatalf("unexpected warnings after reload: %v", warnings)
	}
	reloadedHosts := reloaded.ListHosts()
	if len(reloadedHosts) != 1 {
		t.Fatalf("got %d hosts after reload, want 1", len(reloadedHosts))
	}
	if reloadedHosts[0].Password != "host-pw-2" || reloadedHosts[0].KeyPassphrase != "key-pass" {
		t.Fatalf("reloaded host secrets = %+v, want decrypted plaintext", reloadedHosts[0])
	}
	if got := reloaded.GetSettings().AI.APIKey; got != "sk-rewritten" {
		t.Fatalf("reloaded ai.apiKey = %q, want %q", got, "sk-rewritten")
	}
}

func TestStoreClearsUndecryptableSecret(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	blob := secretPrefix + base64.StdEncoding.EncodeToString([]byte("not a dpapi blob"))
	writeLegacyStore(t, dir, blob, "", "")

	s, err := NewStore()
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	hosts := s.ListHosts()
	if len(hosts) != 1 {
		t.Fatalf("got %d hosts, want 1", len(hosts))
	}
	if hosts[0].Password != "" {
		t.Fatalf("undecryptable password = %q, want empty", hosts[0].Password)
	}
	if hosts[0].Address != "10.0.0.1" || hosts[0].User != "root" {
		t.Fatalf("host metadata was lost: %+v", hosts[0])
	}
	if len(s.Warnings()) == 0 {
		t.Fatal("expected a warning about the undecryptable secret")
	}

	if err := s.SaveSettings(s.GetSettings()); err != nil {
		t.Fatalf("SaveSettings after failed decryption: %v", err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "conduit.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte(secretPrefix)) {
		t.Fatal("the failing protected blob was written back to conduit.json")
	}
}
