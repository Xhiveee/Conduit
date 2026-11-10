package main

import (
	"strings"
	"testing"
)

func TestStripANSIBasic(t *testing.T) {
	in := "\x1b[31mred\x1b[0m normal \x1b[1;32mbold\x1b[m"
	got := stripANSI(in)
	if got != "red normal bold" {
		t.Fatalf("got %q", got)
	}
}

func TestStripANSIOSC(t *testing.T) {
	in := "before\x1b]8;;http://x\x07link\x1b]8;;\x07after"
	got := stripANSI(in)
	if got != "beforelinkafter" {
		t.Fatalf("got %q", got)
	}
}

func TestStripANSICRLF(t *testing.T) {
	in := "line1\r\nline2\nline3\rlast"
	got := stripANSI(in)
	if got != "line1\nline2\nline3\rlast" {
		t.Fatalf("got %q", got)
	}
}

func TestStripANSICursorMoves(t *testing.T) {
	in := "\x1b[2K\x1b[1Gprompt$ \x1b[?25l"
	got := stripANSI(in)
	if got != "prompt$ " {
		t.Fatalf("got %q", got)
	}
}

func TestStripANSIBS(t *testing.T) {
	in := "abc\b\bXY"
	got := stripANSI(in)
	if got != "aXY" {
		t.Fatalf("got %q", got)
	}
}

func TestStripANSIBSMultibyte(t *testing.T) {
	in := "héllo\bX"
	got := stripANSI(in)
	if got != "héllX" {
		t.Fatalf("got %q", got)
	}
}

func TestLooksLikePrompt(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"user@host:~$ ", true},
		{"root@host:/#", true},
		{"PS C:\\> ", true},
		{"~/project %", true},
		{"❯ ", true},
		{"some output", false},
		{"$5 total", false},
		{"", false},
		{"cmd output $", true},
	}
	for _, c := range cases {
		if got := looksLikePrompt(c.in); got != c.want {
			t.Errorf("looksLikePrompt(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestParseKeys(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"ls<Enter>", "ls\r"},
		{"<C-c>", "\x03"},
		{"<C-d>", "\x04"},
		{"<Tab>", "\t"},
		{"<Esc>", "\x1b"},
		{"a<Up>b", "a\x1b[Ab"},
		{"<Down><Left><Right>", "\x1b[B\x1b[D\x1b[C"},
		{"<Backspace>", "\x7f"},
		{"<Space>", " "},
		{"y<Enter>", "y\r"},
		{"<C-a><C-z>", "\x01\x1a"},
		{"plain text", "plain text"},
		{"<Unknown>x", "<Unknown>x"},
		{"<C-A>", "\x01"},
	}
	for _, c := range cases {
		if got := parseKeys(c.in); got != c.want {
			t.Errorf("parseKeys(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestTruncateMiddle(t *testing.T) {
	s := strings.Repeat("x", 1000)
	got := truncateMiddle(s, 100)
	if len(got) > 100 {
		t.Fatalf("len %d > 100", len(got))
	}
	if !strings.HasPrefix(got, "xxxx") || !strings.HasSuffix(got, "xxxx") {
		t.Fatalf("bad truncation: %q...%q", got[:20], got[len(got)-20:])
	}
	if got := truncateMiddle("short", 100); got != "short" {
		t.Fatalf("got %q", got)
	}
}
