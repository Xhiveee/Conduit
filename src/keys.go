package main
import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/Microsoft/go-winio"
	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"
)

type KeyInfo struct {
	Path        string `json:"path"`
	Type        string `json:"type"`
	Fingerprint string `json:"fingerprint"`
	Comment     string `json:"comment"`
	Encrypted   bool   `json:"encrypted"`
	Source      string `json:"source"`
}

func sshDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".ssh")
}

func fingerprintOf(key ssh.PublicKey) string {
	sum := sha256.Sum256(key.Marshal())
	return "SHA256:" + base64.StdEncoding.EncodeToString(sum[:])
}

func parsePubFile(path string) (ssh.PublicKey, string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	key, comment, _, _, err := ssh.ParseAuthorizedKey(raw)
	if err != nil {
		return nil, "", err
	}
	return key, strings.TrimSpace(comment), nil
}

func keyInfoFromSigner(path string, signer ssh.Signer) KeyInfo {
	ki := KeyInfo{Path: path, Type: signer.PublicKey().Type(), Fingerprint: fingerprintOf(signer.PublicKey()), Source: "file"}
	if key, comment, err := parsePubFile(path + ".pub"); err == nil {
		ki.Fingerprint = fingerprintOf(key)
		ki.Comment = comment
	}
	return ki
}

func ListKeys() ([]KeyInfo, error) {
	out := make([]KeyInfo, 0)
	dir := sshDir()
	if dir != "" {
		entries, err := os.ReadDir(dir)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() {
					continue
				}
				name := e.Name()
				lower := strings.ToLower(name)
				if strings.HasSuffix(lower, ".pub") || strings.HasPrefix(lower, "known_hosts") ||
					lower == "config" || lower == "authorized_keys" || lower == "known_hosts2" {
					continue
				}
				ki, ok := inspectKeyFile(filepath.Join(dir, name))
				if ok {
					out = append(out, ki)
				}
			}
		}
	}
	if agentKeys, err := listAgentKeys(); err == nil {
		out = append(out, agentKeys...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func inspectKeyFile(path string) (KeyInfo, bool) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return KeyInfo{}, false
	}
	key, err := ssh.ParseRawPrivateKey(raw)
	if err == nil {
		if signer, serr := ssh.NewSignerFromKey(key); serr == nil {
			return keyInfoFromSigner(path, signer), true
		}
		return KeyInfo{}, false
	}
	var pmErr *ssh.PassphraseMissingError
	if errors.As(err, &pmErr) {
		ki := KeyInfo{Path: path, Encrypted: true, Source: "file"}
		pubPath := path + ".pub"
		if pubKey, comment, perr := parsePubFile(pubPath); perr == nil {
			ki.Type = pubKey.Type()
			ki.Fingerprint = fingerprintOf(pubKey)
			ki.Comment = comment
		}
		return ki, true
	}
	return KeyInfo{}, false
}

func agentConn() (net.Conn, error) {
	return winio.DialPipe(`\\.\pipe\openssh-ssh-agent`, nil)
}

func listAgentKeys() ([]KeyInfo, error) {
	client, conn, err := agentClient()
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	keys, err := client.List()
	if err != nil {
		return nil, err
	}
	var out []KeyInfo
	for _, k := range keys {
		ki := KeyInfo{Path: "ssh-agent", Type: k.Format, Comment: k.Comment, Source: "agent"}
		if pubKey, err := ssh.ParsePublicKey(k.Blob); err == nil {
			ki.Fingerprint = fingerprintOf(pubKey)
			ki.Type = pubKey.Type()
		}
		out = append(out, ki)
	}
	return out, nil
}

func agentClient() (agent.ExtendedAgent, net.Conn, error) {
	conn, err := agentConn()
	if err != nil {
		return nil, nil, err
	}
	return agent.NewClient(conn), conn, nil
}

func agentSigners() ([]ssh.Signer, func(), error) {
	client, conn, err := agentClient()
	if err != nil {
		return nil, nil, err
	}
	signers, err := client.Signers()
	if err != nil {
		conn.Close()
		return nil, nil, err
	}
	return signers, func() { conn.Close() }, nil
}

func parseKeyFile(path, passphrase string) (ssh.Signer, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	key, err := ssh.ParseRawPrivateKey(raw)
	if err != nil {
		var pmErr *ssh.PassphraseMissingError
		if errors.As(err, &pmErr) {
			if passphrase == "" {
				return nil, pmErr
			}
			key, err = ssh.ParseRawPrivateKeyWithPassphrase(raw, []byte(passphrase))
		}
		if err != nil {
			return nil, err
		}
	}
	return ssh.NewSignerFromKey(key)
}
