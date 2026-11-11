package main

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/google/uuid"
)

type Host struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Group         string `json:"group"`
	Address       string `json:"address"`
	Port          int    `json:"port"`
	User          string `json:"user"`
	AuthMethod    string `json:"authMethod"`
	KeyPath       string `json:"keyPath"`
	KeyPassphrase string `json:"keyPassphrase"`
	Password      string `json:"password"`
	Color         string `json:"color"`
	Notes         string `json:"notes"`
	Quick         bool   `json:"-"`
}

type Theme struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Builtin  bool              `json:"builtin"`
	UI       map[string]string `json:"ui"`
	Terminal map[string]string `json:"terminal"`
}

type AISettings struct {
	BaseURL         string `json:"baseUrl"`
	APIKey          string `json:"apiKey"`
	Model           string `json:"model"`
	ApproveCommands bool   `json:"approveCommands"`
	MaxSteps        int    `json:"maxSteps"`
	Instructions    string `json:"instructions"`
}

type Settings struct {
	ThemeID         string     `json:"themeId"`
	CustomThemes    []Theme    `json:"customThemes"`
	FontFamily      string     `json:"fontFamily"`
	FontSize        int        `json:"fontSize"`
	LineHeight      float64    `json:"lineHeight"`
	CursorStyle     string     `json:"cursorStyle"`
	CursorBlink     bool       `json:"cursorBlink"`
	Scrollback      int        `json:"scrollback"`
	CopyOnSelect    bool       `json:"copyOnSelect"`
	RightClickPaste bool       `json:"rightClickPaste"`
	UIScale         float64    `json:"uiScale"`
	SidebarWidth    int        `json:"sidebarWidth"`
	AgentWidth      int        `json:"agentWidth"`
	SidebarVisible  bool       `json:"sidebarVisible"`
	AgentVisible    bool       `json:"agentVisible"`
	AgentSide       string     `json:"agentSide"`
	CustomCSS       string     `json:"customCss"`
	AI              AISettings `json:"ai"`
}

type storeData struct {
	Hosts    []Host   `json:"hosts"`
	Settings Settings `json:"settings"`
}

type Store struct {
	mu   sync.Mutex
	path string
	data storeData
}

func dataDir() string {
	if dir := os.Getenv("CONDUIT_DATA_DIR"); dir != "" {
		return dir
	}
	exe, err := os.Executable()
	if err != nil {
		return "data"
	}
	return filepath.Join(filepath.Dir(exe), "data")
}

const legacyFontFamily = "Cascadia Mono, Consolas, monospace"

func defaultSettings() Settings {
	return Settings{
		ThemeID:        "black",
		FontFamily:     legacyFontFamily,
		FontSize:       14,
		LineHeight:     1.2,
		CursorStyle:    "bar",
		Scrollback:     10000,
		UIScale:        1,
		SidebarWidth:   260,
		AgentWidth:     400,
		SidebarVisible: true,
		AgentVisible:   true,
		AgentSide:      "right",
		AI: AISettings{
			BaseURL:         "https://api.openai.com/v1",
			APIKey:          "",
			Model:           "gpt-4.1",
			ApproveCommands: true,
			MaxSteps:        30,
		},
	}
}

func NewStore() (*Store, error) {
	dir := dataDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{path: filepath.Join(dir, "conduit.json")}
	if err := s.load(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		s.data = storeData{Settings: defaultSettings()}
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(raw, &s.data); err != nil {
		return fmt.Errorf("conduit.json is corrupted: %w", err)
	}
	var top struct {
		Settings json.RawMessage `json:"settings"`
	}
	_ = json.Unmarshal(raw, &top)
	var smap map[string]interface{}
	if len(top.Settings) > 0 {
		_ = json.Unmarshal(top.Settings, &smap)
	}
	s.data.Settings = mergeSettings(defaultSettings(), s.data.Settings, smap)
	return nil
}

func mergeSettings(def, cur Settings, m map[string]interface{}) Settings {
	has := func(k string) bool { _, ok := m[k]; return ok }
	ai, _ := m["ai"].(map[string]interface{})
	hasAI := func(k string) bool { _, ok := ai[k]; return ok }
	out := cur
	if !has("themeId") || out.ThemeID == "" {
		out.ThemeID = def.ThemeID
	}
	if !has("fontFamily") || out.FontFamily == "" || out.FontFamily == legacyFontFamily {
		out.FontFamily = def.FontFamily
	}
	if !has("fontSize") || out.FontSize == 0 {
		out.FontSize = def.FontSize
	}
	if !has("lineHeight") || out.LineHeight == 0 {
		out.LineHeight = def.LineHeight
	}
	if !has("cursorStyle") || out.CursorStyle == "" {
		out.CursorStyle = def.CursorStyle
	}
	if !has("cursorBlink") {
		out.CursorBlink = def.CursorBlink
	}
	if !has("scrollback") || out.Scrollback == 0 {
		out.Scrollback = def.Scrollback
	}
	if !has("copyOnSelect") {
		out.CopyOnSelect = def.CopyOnSelect
	}
	if !has("rightClickPaste") {
		out.RightClickPaste = def.RightClickPaste
	}
	if !has("uiScale") || out.UIScale == 0 {
		out.UIScale = def.UIScale
	}
	if !has("sidebarWidth") || out.SidebarWidth == 0 {
		out.SidebarWidth = def.SidebarWidth
	}
	if !has("agentWidth") || out.AgentWidth == 0 {
		out.AgentWidth = def.AgentWidth
	}
	if !has("sidebarVisible") {
		out.SidebarVisible = def.SidebarVisible
	}
	if !has("agentVisible") {
		out.AgentVisible = def.AgentVisible
	}
	if !has("agentSide") || out.AgentSide == "" {
		out.AgentSide = def.AgentSide
	}
	if !has("customCss") {
		out.CustomCSS = def.CustomCSS
	}
	a := out.AI
	if !hasAI("baseUrl") || a.BaseURL == "" {
		a.BaseURL = def.AI.BaseURL
	}
	if !hasAI("apiKey") {
		a.APIKey = def.AI.APIKey
	}
	if !hasAI("model") || a.Model == "" {
		a.Model = def.AI.Model
	}
	if !hasAI("approveCommands") {
		a.ApproveCommands = def.AI.ApproveCommands
	}
	if !hasAI("maxSteps") || a.MaxSteps == 0 {
		a.MaxSteps = def.AI.MaxSteps
	}
	if !hasAI("instructions") {
		a.Instructions = def.AI.Instructions
	}
	out.AI = a
	return out
}

func (s *Store) save() error {
	raw, err := json.MarshalIndent(s.data, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func (s *Store) ListHosts() []Host {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]Host, len(s.data.Hosts))
	copy(out, s.data.Hosts)
	return out
}

func (s *Store) SaveHost(h Host) (Host, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if h.ID == "" {
		h.ID = uuid.NewString()
	}
	for i := range s.data.Hosts {
		if s.data.Hosts[i].ID == h.ID {
			s.data.Hosts[i] = h
			return h, s.save()
		}
	}
	s.data.Hosts = append(s.data.Hosts, h)
	return h, s.save()
}

func (s *Store) DeleteHost(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.data.Hosts {
		if s.data.Hosts[i].ID == id {
			s.data.Hosts = append(s.data.Hosts[:i], s.data.Hosts[i+1:]...)
			return s.save()
		}
	}
	return nil
}

func (s *Store) HostByID(id string) (Host, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, h := range s.data.Hosts {
		if h.ID == id {
			return h, true
		}
	}
	return Host{}, false
}

func (s *Store) GetSettings() Settings {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.data.Settings
}

func (s *Store) SaveSettings(st Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data.Settings = st
	return s.save()
}

func (s *Store) ImportSSHConfig(r io.Reader, homeDir string) ([]Host, error) {
	parsed := parseSSHConfig(r, homeDir)
	s.mu.Lock()
	defer s.mu.Unlock()
	var added []Host
	for _, h := range parsed {
		dup := false
		for _, e := range s.data.Hosts {
			if e.Address == h.Address && e.Port == h.Port && e.User == h.User {
				dup = true
				break
			}
		}
		if dup {
			continue
		}
		h.ID = uuid.NewString()
		s.data.Hosts = append(s.data.Hosts, h)
		added = append(added, h)
	}
	if len(added) > 0 {
		if err := s.save(); err != nil {
			return nil, err
		}
	}
	return added, nil
}

func parseSSHConfig(r io.Reader, homeDir string) []Host {
	var hosts []Host
	var cur *Host
	inSkip := false
	flush := func() {
		if cur != nil && !inSkip && cur.Address != "" {
			hosts = append(hosts, *cur)
		}
		cur = nil
		inSkip = false
	}
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if idx := strings.Index(line, "#"); idx >= 0 {
			line = strings.TrimSpace(line[:idx])
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.ToLower(fields[0])
		value := strings.Trim(strings.TrimSpace(line[len(fields[0]):]), `"`)
		if key == "host" {
			flush()
			wild := false
			for _, p := range fields[1:] {
				if strings.ContainsAny(p, "*?") {
					wild = true
				}
			}
			if wild {
				inSkip = true
				continue
			}
			cur = &Host{
				Name:       fields[1],
				Address:    fields[1],
				Port:       22,
				AuthMethod: "agent",
				User:       defaultSSHUser(),
			}
			continue
		}
		if key == "match" {
			flush()
			inSkip = true
			continue
		}
		if cur == nil || inSkip {
			continue
		}
		switch key {
		case "hostname":
			cur.Address = value
		case "user":
			cur.User = value
		case "port":
			if p, err := strconv.Atoi(value); err == nil {
				cur.Port = p
			}
		case "identityfile":
			cur.KeyPath = expandHomePath(value, homeDir)
			cur.AuthMethod = "key"
		}
	}
	flush()
	return hosts
}

func expandHomePath(p, homeDir string) string {
	if p == "~" {
		return homeDir
	}
	if strings.HasPrefix(p, "~/") || strings.HasPrefix(p, `~\`) {
		return filepath.Join(homeDir, p[2:])
	}
	return p
}

func defaultSSHUser() string {
	if u := os.Getenv("USERNAME"); u != "" {
		return u
	}
	if u := os.Getenv("USER"); u != "" {
		return u
	}
	return "root"
}

func sshConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".ssh", "config")
}
