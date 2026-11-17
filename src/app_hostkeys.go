package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

const (
	hostKeyConfirmTimeout = 60 * time.Second
	hostKeyUpdateTTL      = 10 * time.Minute
)

var (
	errHostKeyRejected = errors.New("host key rejected by user")
	errHostKeyTimeout  = errors.New("host key confirmation timed out")
)

type HostKeyRequest struct {
	RequestID      string `json:"requestId"`
	Hostname       string `json:"hostname"`
	Fingerprint    string `json:"fingerprint"`
	OldFingerprint string `json:"oldFingerprint,omitempty"`
	Kind           string `json:"kind"`
}

type hostKeyUpdate struct {
	hostname string
	key      ssh.PublicKey
	oldKeys  []string
	lines    map[int]struct{}
	at       time.Time
}

func knownHostsPath() string {
	return filepath.Join(dataDir(), "known_hosts")
}

func (m *SessionManager) hostKeyCallback(ctx context.Context) (ssh.HostKeyCallback, error) {
	path := knownHostsPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			return nil, err
		}
	}
	kh, err := knownhosts.New(path)
	if err != nil {
		return nil, err
	}
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		err := kh(hostname, remote, key)
		if err == nil {
			return nil
		}
		var kerr *knownhosts.KeyError
		if !errors.As(err, &kerr) {
			return err
		}
		if len(kerr.Want) == 0 {
			return m.confirmNewHostKey(ctx, path, hostname, key)
		}
		return m.rejectChangedHostKey(hostname, key, kerr.Want)
	}, nil
}

func (m *SessionManager) addHostKeyWaiter() (string, chan bool) {
	requestID := uuid.NewString()
	reply := make(chan bool, 1)
	m.hostKeyMu.Lock()
	if m.hostKeyWait == nil {
		m.hostKeyWait = make(map[string]chan bool)
	}
	m.hostKeyWait[requestID] = reply
	m.hostKeyMu.Unlock()
	return requestID, reply
}

func (m *SessionManager) removeHostKeyWaiter(requestID string) {
	m.hostKeyMu.Lock()
	delete(m.hostKeyWait, requestID)
	m.hostKeyMu.Unlock()
}

func (m *SessionManager) resolveHostKeyDecision(requestID string, trust bool) {
	m.hostKeyMu.Lock()
	reply, ok := m.hostKeyWait[requestID]
	if ok {
		delete(m.hostKeyWait, requestID)
	}
	m.hostKeyMu.Unlock()
	if !ok {
		return
	}
	select {
	case reply <- trust:
	default:
	}
}

func (m *SessionManager) emitHostKeyRequest(req HostKeyRequest) {
	m.emitEvent("session:hostkey", req)
}

func (m *SessionManager) confirmNewHostKey(ctx context.Context, path, hostname string, key ssh.PublicKey) error {
	if m.emit == nil {
		return errors.New("host key confirmation is unavailable")
	}
	requestID, reply := m.addHostKeyWaiter()
	defer m.removeHostKeyWaiter(requestID)
	m.emitHostKeyRequest(HostKeyRequest{
		RequestID:   requestID,
		Hostname:    hostname,
		Fingerprint: ssh.FingerprintSHA256(key),
		Kind:        "new",
	})
	timer := time.NewTimer(hostKeyConfirmTimeout)
	defer timer.Stop()
	select {
	case trust := <-reply:
		if !trust {
			return errHostKeyRejected
		}
		return m.appendKnownHostLine(path, hostname, key)
	case <-timer.C:
		return errHostKeyTimeout
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (m *SessionManager) rejectChangedHostKey(hostname string, key ssh.PublicKey, want []knownhosts.KnownKey) error {
	oldFingerprints := make([]string, 0, len(want))
	oldKeys := make([]string, 0, len(want))
	lines := make(map[int]struct{}, len(want))
	seen := make(map[string]struct{}, len(want))
	for _, known := range want {
		if known.Line > 0 {
			lines[known.Line-1] = struct{}{}
		}
		oldKeys = append(oldKeys, serializedKey(known.Key))
		fp := ssh.FingerprintSHA256(known.Key)
		if _, dup := seen[fp]; dup {
			continue
		}
		seen[fp] = struct{}{}
		oldFingerprints = append(oldFingerprints, fp)
	}
	requestID := m.rememberHostKeyUpdate(&hostKeyUpdate{
		hostname: hostname,
		key:      key,
		oldKeys:  oldKeys,
		lines:    lines,
		at:       time.Now(),
	})
	presented := ssh.FingerprintSHA256(key)
	m.emitHostKeyRequest(HostKeyRequest{
		RequestID:      requestID,
		Hostname:       hostname,
		Fingerprint:    presented,
		OldFingerprint: strings.Join(oldFingerprints, ", "),
		Kind:           "changed",
	})
	return fmt.Errorf("host key mismatch for %s: known %s, presented %s; confirm the update to reconnect",
		hostname, strings.Join(oldFingerprints, ", "), presented)
}

func (m *SessionManager) rememberHostKeyUpdate(update *hostKeyUpdate) string {
	requestID := uuid.NewString()
	cutoff := time.Now().Add(-hostKeyUpdateTTL)
	m.hostKeyMu.Lock()
	if m.hostKeyUpdates == nil {
		m.hostKeyUpdates = make(map[string]*hostKeyUpdate)
	}
	for id, stale := range m.hostKeyUpdates {
		if stale.at.Before(cutoff) {
			delete(m.hostKeyUpdates, id)
		}
	}
	m.hostKeyUpdates[requestID] = update
	m.hostKeyMu.Unlock()
	return requestID
}

func (m *SessionManager) takeHostKeyUpdate(requestID string) (*hostKeyUpdate, bool) {
	m.hostKeyMu.Lock()
	defer m.hostKeyMu.Unlock()
	update, ok := m.hostKeyUpdates[requestID]
	if ok {
		delete(m.hostKeyUpdates, requestID)
	}
	return update, ok
}

func (m *SessionManager) applyHostKeyUpdate(requestID string) error {
	update, ok := m.takeHostKeyUpdate(requestID)
	if !ok {
		return errors.New("host key update request expired")
	}
	path := knownHostsPath()
	m.knownHostsMu.Lock()
	defer m.knownHostsMu.Unlock()
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	line := knownhosts.Line([]string{update.hostname}, update.key)
	return writeKnownHosts(path, rewriteKnownHosts(data, update.hostname, update.lines, update.oldKeys, line))
}

func (m *SessionManager) appendKnownHostLine(path, hostname string, key ssh.PublicKey) error {
	line := knownhosts.Line([]string{hostname}, key)
	m.knownHostsMu.Lock()
	defer m.knownHostsMu.Unlock()
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if len(data) > 0 && data[len(data)-1] != '\n' {
		data = append(data, '\n')
	}
	data = append(data, line+"\n"...)
	return writeKnownHosts(path, data)
}

func writeKnownHosts(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func serializedKey(key ssh.PublicKey) string {
	return strings.TrimSpace(string(ssh.MarshalAuthorizedKey(key)))
}

func rewriteKnownHosts(data []byte, hostname string, conflictLines map[int]struct{}, conflictKeys []string, newLine string) []byte {
	normalized := knownhosts.Normalize(hostname)
	lines := strings.Split(strings.ReplaceAll(string(data), "\r\n", "\n"), "\n")
	kept := make([]string, 0, len(lines)+1)
	for i, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			kept = append(kept, line)
			continue
		}
		if _, conflicting := conflictLines[i]; conflicting && containsAnyKey(line, conflictKeys) {
			continue
		}
		rewritten, matched := stripKnownHostEntry(line, normalized)
		if matched && strings.TrimSpace(rewritten) == "" {
			continue
		}
		kept = append(kept, rewritten)
	}
	kept = append(kept, newLine)
	return []byte(strings.Join(kept, "\n") + "\n")
}

func stripKnownHostEntry(line, normalizedHost string) (string, bool) {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return line, false
	}
	hostIdx := 0
	if strings.HasPrefix(fields[0], "@") {
		if len(fields) < 3 {
			return line, false
		}
		hostIdx = 1
	}
	hosts := strings.Split(fields[hostIdx], ",")
	kept := make([]string, 0, len(hosts))
	for _, host := range hosts {
		if !strings.EqualFold(knownhosts.Normalize(host), normalizedHost) {
			kept = append(kept, host)
		}
	}
	if len(kept) == len(hosts) {
		return line, false
	}
	if len(kept) == 0 {
		return "", true
	}
	fields[hostIdx] = strings.Join(kept, ",")
	return strings.Join(fields, " "), true
}

func containsAnyKey(line string, keys []string) bool {
	for _, key := range keys {
		if key != "" && strings.Contains(line, key) {
			return true
		}
	}
	return false
}

func (a *App) SessionHostKeyDecision(requestID string, trust bool) {
	if a.sessions == nil {
		return
	}
	a.sessions.resolveHostKeyDecision(requestID, trust)
}

func (a *App) SessionHostKeyUpdate(requestID string) error {
	if a.sessions == nil {
		return errors.New("host key update unavailable")
	}
	return a.sessions.applyHostKeyUpdate(requestID)
}
