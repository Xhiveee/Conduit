package main

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestClassifyAuthError(t *testing.T) {
	cases := []struct {
		name string
		host Host
		err  error
		want string
	}{
		{"nil error", Host{AuthMethod: "password"}, nil, ""},
		{"passphrase missing", Host{AuthMethod: "key"}, &ssh.PassphraseMissingError{}, "auth_required:passphrase"},
		{"wrapped passphrase missing", Host{AuthMethod: "key"}, fmt.Errorf("outer: %w", &ssh.PassphraseMissingError{}), "auth_required:passphrase"},
		{"password rejected", Host{AuthMethod: "password"}, errors.New("ssh: unable to authenticate, attempted methods [none password], no supported methods remain"), "auth_required:password"},
		{"quick connect rejected", Host{AuthMethod: "agent", Quick: true}, errors.New("ssh: unable to authenticate, attempted methods [none], no supported methods remain"), "auth_required:password"},
		{"agent host rejected", Host{AuthMethod: "agent"}, errors.New("ssh: unable to authenticate, attempted methods [none], no supported methods remain"), "auth_required:password"},
		{"key rejected", Host{AuthMethod: "key"}, errors.New("ssh: unable to authenticate, attempted methods [publickey], no supported methods remain"), ""},
		{"wrong passphrase", Host{AuthMethod: "key"}, errors.New("ssh: incorrect passphrase supplied to decrypt private key"), "auth_required:passphrase"},
		{"key file missing", Host{AuthMethod: "key"}, errors.New("open C:\\nope: no such file or directory"), ""},
		{"network error", Host{AuthMethod: "password"}, errors.New("dial tcp 127.0.0.1:22: connectex: connection refused"), ""},
	}
	for _, tc := range cases {
		if got := classifyAuthError(tc.host, tc.err); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}

func TestAuthErrorKeyRejected(t *testing.T) {
	h := Host{AuthMethod: "key", Name: "prod", KeyPath: `C:\Users\me\.ssh\id_ed25519`}
	err := authError(h, errors.New("ssh: unable to authenticate, attempted methods [publickey], no supported methods remain"))
	if err == nil || !strings.Contains(err.Error(), "server rejected key id_ed25519") {
		t.Fatalf("got %v", err)
	}
}

func TestClassifyCloseError(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"exit missing", &ssh.ExitMissingError{}, "Session ended"},
		{"eof", io.EOF, "Connection lost"},
		{"wrapped eof", fmt.Errorf("wait: %w", io.EOF), "Connection lost"},
		{"reset", errors.New("read tcp: connection reset by peer"), "Connection lost"},
	}
	for _, tc := range cases {
		if got, _ := classifyCloseError(tc.err); got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}

func TestSSHConfigAgentHostWithSecret(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	cfg, cleanup, err := sshConfigFor(Host{AuthMethod: "agent", User: "u", Password: "s3cret"})
	if err != nil {
		t.Fatal(err)
	}
	defer cleanup()
	if len(cfg.Auth) < 2 {
		t.Fatalf("expected agent signers plus password methods, got %d auth methods", len(cfg.Auth))
	}
}
