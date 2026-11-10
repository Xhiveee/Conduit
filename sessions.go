package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

const (
	commandOutputMax = 16 * 1024
	sshDialTimeout   = 15 * time.Second
	keepaliveEvery   = 30 * time.Second
	screenReplyWait  = 3 * time.Second
)

type SessionInfo struct {
	ID        string `json:"id"`
	HostID    string `json:"hostId"`
	Title     string `json:"title"`
	Connected bool   `json:"connected"`
	User      string `json:"user"`
	Address   string `json:"address"`
	Color     string `json:"color"`
}

type CommandResult struct {
	Output string `json:"output"`
	Status string `json:"status"`
}

type Session struct {
	info       SessionInfo
	client     *ssh.Client
	sshSession *ssh.Session
	stdin      io.WriteCloser
	mgr        *SessionManager
	mu         sync.Mutex
	subs       map[chan []byte]struct{}
	closed     chan struct{}
	closeOnce  sync.Once
	done       chan struct{}
}

type SessionManager struct {
	store      *Store
	emit       func(name string, args ...interface{})
	mu         sync.Mutex
	byID       map[string]*Session
	screenReqs map[string]chan string
}

func NewSessionManager(store *Store) *SessionManager {
	return &SessionManager{store: store, byID: make(map[string]*Session), screenReqs: make(map[string]chan string)}
}

func (m *SessionManager) emitEvent(name string, args ...interface{}) {
	if m.emit != nil {
		m.emit(name, args...)
	}
}

func (m *SessionManager) get(id string) *Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.byID[id]
}

func (m *SessionManager) ListSessions() []SessionInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SessionInfo, 0, len(m.byID))
	for _, s := range m.byID {
		out = append(out, s.info)
	}
	return out
}

func sessionTitle(h Host) string {
	if h.Name != "" {
		return h.Name
	}
	return h.User + "@" + h.Address
}

func (m *SessionManager) Connect(hostID string, cols, rows int) (string, error) {
	h, ok := m.store.HostByID(hostID)
	if !ok {
		return "", fmt.Errorf("host not found")
	}
	return m.connect(h, cols, rows)
}

func (m *SessionManager) QuickConnect(target, password string, cols, rows int) (string, error) {
	h, err := parseQuickTarget(target)
	if err != nil {
		return "", err
	}
	h.Password = password
	return m.connect(h, cols, rows)
}

func parseQuickTarget(target string) (Host, error) {
	t := strings.TrimSpace(target)
	if t == "" {
		return Host{}, fmt.Errorf("empty target")
	}
	user := ""
	if i := strings.Index(t, "@"); i >= 0 {
		user = t[:i]
		t = t[i+1:]
	}
	if user == "" {
		user = defaultSSHUser()
	}
	host := t
	port := 22
	if i := strings.LastIndex(t, ":"); i >= 0 && !strings.Contains(t[i+1:], "]") {
		if p, err := strconv.Atoi(t[i+1:]); err == nil {
			port = p
			host = t[:i]
		}
	}
	host = strings.Trim(host, "[]")
	if host == "" {
		return Host{}, fmt.Errorf("missing host in %q", target)
	}
	return Host{
		Name:       user + "@" + host,
		Address:    host,
		Port:       port,
		User:       user,
		AuthMethod: "agent",
		Quick:      true,
	}, nil
}

func (m *SessionManager) connect(h Host, cols, rows int) (string, error) {
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 32
	}
	addr := net.JoinHostPort(h.Address, strconv.Itoa(h.Port))
	cfg, cleanup, err := sshConfigFor(h)
	if err != nil {
		return "", err
	}
	defer cleanup()
	cfg.Timeout = sshDialTimeout
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return "", err
	}
	sess, err := client.NewSession()
	if err != nil {
		client.Close()
		return "", err
	}
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		sess.Close()
		client.Close()
		return "", err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return "", err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return "", err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		sess.Close()
		client.Close()
		return "", err
	}
	if err := sess.Shell(); err != nil {
		sess.Close()
		client.Close()
		return "", err
	}
	s := &Session{
		client:     client,
		sshSession: sess,
		stdin:      stdin,
		mgr:        m,
		subs:       make(map[chan []byte]struct{}),
		closed:     make(chan struct{}),
		done:       make(chan struct{}),
	}
	s.info = SessionInfo{
		ID:        uuid.NewString(),
		HostID:    h.ID,
		Title:     sessionTitle(h),
		Connected: true,
		User:      h.User,
		Address:   h.Address,
		Color:     h.Color,
	}
	m.mu.Lock()
	m.byID[s.info.ID] = s
	m.mu.Unlock()
	m.emitEvent("session:opened", s.info)
	go s.pump(stdout)
	go s.pump(stderr)
	go s.wait()
	go s.keepalive()
	return s.info.ID, nil
}

func (s *Session) pump(r io.Reader) {
	buf := make([]byte, 32*1024)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			s.onData(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func (s *Session) onData(p []byte) {
	cp := make([]byte, len(p))
	copy(cp, p)
	s.mgr.emitEvent("session:data", s.info.ID, base64.StdEncoding.EncodeToString(cp))
	s.mu.Lock()
	for ch := range s.subs {
		select {
		case ch <- cp:
		default:
		}
	}
	s.mu.Unlock()
}

func (s *Session) subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 512)
	s.mu.Lock()
	s.subs[ch] = struct{}{}
	s.mu.Unlock()
	return ch, func() {
		s.mu.Lock()
		delete(s.subs, ch)
		s.mu.Unlock()
	}
}

func (s *Session) wait() {
	err := s.sshSession.Wait()
	if err != nil {
		s.finish("connection closed: " + err.Error())
	} else {
		s.finish("session exited")
	}
}

func (s *Session) keepalive() {
	t := time.NewTicker(keepaliveEvery)
	defer t.Stop()
	for {
		select {
		case <-s.closed:
			return
		case <-t.C:
			_, _, err := s.client.SendRequest("keepalive@conduit", true, nil)
			if err != nil {
				return
			}
		}
	}
}

func (s *Session) finish(reason string) {
	s.closeOnce.Do(func() {
		close(s.closed)
		s.mgr.mu.Lock()
		delete(s.mgr.byID, s.info.ID)
		s.mgr.mu.Unlock()
		s.mgr.emitEvent("session:closed", s.info.ID, reason)
		s.client.Close()
		s.sshSession.Close()
		close(s.done)
	})
}

func (s *Session) Write(data string) error {
	_, err := s.stdin.Write([]byte(data))
	return err
}

func (s *Session) Resize(cols, rows int) error {
	if cols <= 0 || rows <= 0 {
		return nil
	}
	return s.sshSession.WindowChange(rows, cols)
}

func (s *Session) Disconnect() {
	s.finish("disconnected by user")
}

func (m *SessionManager) Write(id, data string) error {
	s := m.get(id)
	if s == nil {
		return fmt.Errorf("session not found")
	}
	return s.Write(data)
}

func (m *SessionManager) Resize(id string, cols, rows int) error {
	s := m.get(id)
	if s == nil {
		return fmt.Errorf("session not found")
	}
	return s.Resize(cols, rows)
}

func (m *SessionManager) Disconnect(id string) {
	if s := m.get(id); s != nil {
		s.Disconnect()
	}
}

func knownHostsPath() string {
	return filepath.Join(dataDir(), "known_hosts")
}

func hostKeyCallback() (ssh.HostKeyCallback, error) {
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
		if errors.As(err, &kerr) {
			if len(kerr.Want) == 0 {
				line := knownhosts.Line([]string{hostname}, key)
				f, ferr := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
				if ferr != nil {
					return ferr
				}
				if _, werr := f.WriteString(line + "\n"); werr != nil {
					f.Close()
					return werr
				}
				f.Close()
				return nil
			}
			return fmt.Errorf("host key mismatch for %s", hostname)
		}
		return err
	}, nil
}

func keyboardInteractivePassword(password string) ssh.AuthMethod {
	return ssh.KeyboardInteractive(func(name, instruction string, questions []string, echos []bool) ([]string, error) {
		answers := make([]string, len(questions))
		for i := range answers {
			answers[i] = password
		}
		return answers, nil
	})
}

func sshConfigFor(h Host) (*ssh.ClientConfig, func(), error) {
	hkc, err := hostKeyCallback()
	if err != nil {
		return nil, nil, err
	}
	cfg := &ssh.ClientConfig{
		User:            h.User,
		HostKeyCallback: hkc,
	}
	var cleanups []func()
	cleanup := func() {
		for _, c := range cleanups {
			c()
		}
	}
	var methods []ssh.AuthMethod
	switch h.AuthMethod {
	case "key":
		if h.KeyPath == "" {
			return nil, nil, fmt.Errorf("no key path configured")
		}
		signer, err := parseKeyFile(h.KeyPath, h.KeyPassphrase)
		if err != nil {
			return nil, nil, err
		}
		methods = append(methods, ssh.PublicKeys(signer))
	case "password":
		methods = append(methods,
			ssh.Password(h.Password),
			keyboardInteractivePassword(h.Password),
		)
	}
	if h.AuthMethod == "agent" || h.Quick {
		if signers, closeFn, err := agentSigners(); err == nil && len(signers) > 0 {
			for _, s := range signers {
				methods = append(methods, ssh.PublicKeys(s))
			}
			cleanups = append(cleanups, closeFn)
		}
	}
	if h.Quick {
		for _, keyPath := range defaultKeyPaths() {
			if signer, err := parseKeyFile(keyPath, ""); err == nil {
				methods = append(methods, ssh.PublicKeys(signer))
			}
		}
		if h.Password != "" {
			methods = append(methods,
				ssh.Password(h.Password),
				keyboardInteractivePassword(h.Password),
			)
		}
	}
	cfg.Auth = methods
	return cfg, cleanup, nil
}

func defaultKeyPaths() []string {
	dir := sshDir()
	if dir == "" {
		return nil
	}
	var out []string
	for _, name := range []string{"id_ed25519", "id_rsa", "id_ecdsa"} {
		p := filepath.Join(dir, name)
		if _, err := os.Stat(p); err == nil {
			out = append(out, p)
		}
	}
	return out
}

func (m *SessionManager) runInSession(ctx context.Context, id, command string, timeoutSec int) (CommandResult, error) {
	s := m.get(id)
	if s == nil {
		return CommandResult{}, fmt.Errorf("session not found")
	}
	if timeoutSec <= 0 {
		timeoutSec = 60
	}
	if timeoutSec > 600 {
		timeoutSec = 600
	}
	ch, unsub := s.subscribe()
	defer unsub()
	m.emitEvent("session:agent", id, true)
	defer m.emitEvent("session:agent", id, false)
	if _, err := s.stdin.Write([]byte(command + "\r")); err != nil {
		return CommandResult{}, err
	}
	var buf bytes.Buffer
	buf.Grow(64 * 1024)
	start := time.Now()
	lastActivity := start
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case chunk := <-ch:
			buf.Write(chunk)
			lastActivity = time.Now()
		case <-ticker.C:
			now := time.Now()
			idle := now.Sub(lastActivity)
			text := stripANSI(buf.String())
			if idle >= 800*time.Millisecond {
				if looksLikePrompt(lastNonEmptyLine(text)) {
					return CommandResult{Output: cleanCommandOutput(text, command), Status: "done"}, nil
				}
				if idle >= 8*time.Second {
					return CommandResult{Output: cleanCommandOutput(text, command), Status: "waiting_for_input_or_still_running"}, nil
				}
			}
			if now.Sub(start) >= time.Duration(timeoutSec)*time.Second {
				return CommandResult{Output: cleanCommandOutput(text, command), Status: "timeout"}, nil
			}
		case <-s.closed:
			text := stripANSI(buf.String())
			return CommandResult{Output: cleanCommandOutput(text, command), Status: "session_closed"}, nil
		case <-ctx.Done():
			return CommandResult{}, ctx.Err()
		}
	}
}

func lastNonEmptyLine(s string) string {
	lines := strings.Split(s, "\n")
	for i := len(lines) - 1; i >= 0; i-- {
		if strings.TrimSpace(lines[i]) != "" {
			return lines[i]
		}
	}
	return ""
}

func cleanCommandOutput(text, command string) string {
	if command != "" {
		lines := strings.SplitAfter(text, "\n")
		for i, l := range lines {
			if strings.Contains(l, command) {
				lines = append(lines[:i], lines[i+1:]...)
				break
			}
		}
		text = strings.Join(lines, "")
	}
	return truncateMiddle(strings.TrimRight(text, "\n"), commandOutputMax)
}

func (m *SessionManager) readScreen(ctx context.Context, id string, lines int) (string, error) {
	s := m.get(id)
	if s == nil {
		return "", fmt.Errorf("session not found")
	}
	if lines <= 0 {
		lines = 60
	}
	requestID := uuid.NewString()
	ch := make(chan string, 1)
	m.mu.Lock()
	m.screenReqs[requestID] = ch
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.screenReqs, requestID)
		m.mu.Unlock()
	}()
	m.emitEvent("screen:request", requestID, id, lines)
	select {
	case text := <-ch:
		return text, nil
	case <-time.After(screenReplyWait):
		return "", fmt.Errorf("terminal view not available")
	case <-s.closed:
		return "", fmt.Errorf("session closed")
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

func (m *SessionManager) screenReply(requestID, text string) {
	m.mu.Lock()
	ch, ok := m.screenReqs[requestID]
	if ok {
		delete(m.screenReqs, requestID)
	}
	m.mu.Unlock()
	if ok {
		ch <- text
	}
}

func (m *SessionManager) sendKeys(id, keys string) error {
	s := m.get(id)
	if s == nil {
		return fmt.Errorf("session not found")
	}
	_, err := s.stdin.Write([]byte(parseKeys(keys)))
	return err
}
