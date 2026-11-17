package main

import (
	"strings"
	"testing"
)

func TestStripANSI(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{name: "plain text", in: "hello", want: "hello"},
		{name: "empty", in: "", want: ""},
		{name: "sgr colours", in: "\x1b[31mred\x1b[0m", want: "red"},
		{name: "sgr bold and reset", in: "\x1b[1;32mok\x1b[0m done", want: "ok done"},
		{name: "cursor hide", in: "\x1b[?25l", want: ""},
		{name: "cursor move and erase", in: "\x1b[2K\x1b[1;1Hx", want: "x"},
		{name: "osc with bel", in: "\x1b]0;Conduit\x07ok", want: "ok"},
		{name: "osc with st", in: "\x1b]2;title\x1b\\ok", want: "ok"},
		{name: "dcs sequence", in: "\x1bP1;2;3\x1b\\payload", want: "payload"},
		{name: "charset selection", in: "\x1b(Bhi", want: "hi"},
		{name: "single esc sequence", in: "\x1bMtext", want: "text"},
		{name: "crlf collapses to lf", in: "a\r\nb", want: "a\nb"},
		{name: "lone cr is kept", in: "a\rb", want: "a\rb"},
		{name: "backspace erases byte", in: "abc\b", want: "ab"},
		{name: "backspace erases multibyte rune", in: "aб\b", want: "a"},
		{name: "backspace on empty output", in: "\babc", want: "abc"},
		{name: "key tokens are not stripped", in: "<enter>", want: "<enter>"},
		{name: "coloured prompt", in: "\x1b[1;32muser@host\x1b[0m:~$ ", want: "user@host:~$ "},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := stripANSI(tc.in); got != tc.want {
				t.Fatalf("stripANSI(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestLooksLikePrompt(t *testing.T) {
	cases := []struct {
		name string
		line string
		want bool
	}{
		{name: "bash dollar", line: "user@host:~$ ", want: true},
		{name: "root hash", line: "root@server:/var/www# ", want: true},
		{name: "windows cmd", line: "C:\\Users\\me> ", want: true},
		{name: "percent", line: "100% ", want: true},
		{name: "chevron", line: "❯ ", want: true},
		{name: "sigil only", line: "$", want: true},
		{name: "trailing spaces after hash", line: "#   ", want: true},
		{name: "empty line", line: "", want: false},
		{name: "no sigil", line: "user@host:~ ", want: false},
		{name: "sigil in the middle", line: "50% done", want: false},
		{name: "ordinary output", line: "total 42", want: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := looksLikePrompt(tc.line); got != tc.want {
				t.Fatalf("looksLikePrompt(%q) = %v, want %v", tc.line, got, tc.want)
			}
		})
	}
}

func TestParseKeys(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{name: "empty", in: "", want: ""},
		{name: "enter", in: "<enter>", want: "\r"},
		{name: "return alias", in: "<Return>", want: "\r"},
		{name: "tab", in: "<tab>", want: "\t"},
		{name: "esc", in: "<Esc>", want: "\x1b"},
		{name: "escape alias", in: "<escape>", want: "\x1b"},
		{name: "up", in: "<up>", want: "\x1b[A"},
		{name: "down uppercase", in: "<Down>", want: "\x1b[B"},
		{name: "left", in: "<left>", want: "\x1b[D"},
		{name: "right", in: "<right>", want: "\x1b[C"},
		{name: "backspace", in: "<backspace>", want: "\x7f"},
		{name: "space", in: "<space>", want: " "},
		{name: "delete", in: "<delete>", want: "\x1b[3~"},
		{name: "del alias", in: "<del>", want: "\x1b[3~"},
		{name: "home", in: "<home>", want: "\x1b[H"},
		{name: "end", in: "<end>", want: "\x1b[F"},
		{name: "page up", in: "<pageup>", want: "\x1b[5~"},
		{name: "page down", in: "<PageDown>", want: "\x1b[6~"},
		{name: "ctrl a", in: "<C-a>", want: "\x01"},
		{name: "ctrl c", in: "<Ctrl-C>", want: "\x03"},
		{name: "ctrl z", in: "<c-z>", want: "\x1a"},
		{name: "token between text", in: "a<enter>b", want: "a\rb"},
		{name: "two tokens", in: "<enter><enter>", want: "\r\r"},
		{name: "cyrillic around token", in: "привет <enter>", want: "привет \r"},
		{name: "unknown name passes through", in: "<unknown>", want: "<unknown>"},
		{name: "empty token passes through", in: "<>", want: "<>"},
		{name: "bare letter passes through", in: "<c>", want: "<c>"},
		{name: "two opening brackets", in: "<<", want: "<<"},
		{name: "multi letter ctrl passes through", in: "<ctrl-ab>", want: "<ctrl-ab>"},
		{name: "ctrl token between text", in: "x<C-a>y", want: "x\x01y"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := parseKeys(tc.in); got != tc.want {
				t.Fatalf("parseKeys(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestNamedKey(t *testing.T) {
	cases := []struct {
		name   string
		key    string
		want   string
		wantOK bool
	}{
		{name: "enter", key: "enter", want: "\r", wantOK: true},
		{name: "return", key: "return", want: "\r", wantOK: true},
		{name: "uppercase enter", key: "ENTER", want: "\r", wantOK: true},
		{name: "tab", key: "tab", want: "\t", wantOK: true},
		{name: "esc", key: "esc", want: "\x1b", wantOK: true},
		{name: "escape", key: "escape", want: "\x1b", wantOK: true},
		{name: "up", key: "up", want: "\x1b[A", wantOK: true},
		{name: "down", key: "down", want: "\x1b[B", wantOK: true},
		{name: "right", key: "right", want: "\x1b[C", wantOK: true},
		{name: "left", key: "left", want: "\x1b[D", wantOK: true},
		{name: "backspace", key: "backspace", want: "\x7f", wantOK: true},
		{name: "space", key: "space", want: " ", wantOK: true},
		{name: "delete", key: "delete", want: "\x1b[3~", wantOK: true},
		{name: "del", key: "del", want: "\x1b[3~", wantOK: true},
		{name: "home", key: "home", want: "\x1b[H", wantOK: true},
		{name: "end", key: "end", want: "\x1b[F", wantOK: true},
		{name: "pageup", key: "pageup", want: "\x1b[5~", wantOK: true},
		{name: "pagedown", key: "pagedown", want: "\x1b[6~", wantOK: true},
		{name: "unknown function key", key: "f1", want: "", wantOK: false},
		{name: "empty", key: "", want: "", wantOK: false},
		{name: "ctrl prefix is not a named key", key: "ctrl", want: "", wantOK: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := namedKey(tc.key)
			if got != tc.want || ok != tc.wantOK {
				t.Fatalf("namedKey(%q) = (%q, %v), want (%q, %v)", tc.key, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestCtrlKey(t *testing.T) {
	cases := []struct {
		name   string
		key    string
		want   string
		wantOK bool
	}{
		{name: "c-a", key: "c-a", want: "\x01", wantOK: true},
		{name: "ctrl-a", key: "ctrl-a", want: "\x01", wantOK: true},
		{name: "uppercase ctrl-a", key: "CTRL-A", want: "\x01", wantOK: true},
		{name: "c-z", key: "c-z", want: "\x1a", wantOK: true},
		{name: "c-at sign", key: "c-@", want: "\x00", wantOK: true},
		{name: "c-opening bracket", key: "c-[", want: "\x1b", wantOK: true},
		{name: "c-closing bracket", key: "c-]", want: "\x1d", wantOK: true},
		{name: "c-caret", key: "c-^", want: "\x1e", wantOK: true},
		{name: "c-underscore", key: "c-_", want: "\x1f", wantOK: true},
		{name: "digit is not a control char", key: "c-1", want: "", wantOK: false},
		{name: "two letters", key: "c-ab", want: "", wantOK: false},
		{name: "empty letter", key: "c-", want: "", wantOK: false},
		{name: "wrong prefix", key: "x-a", want: "", wantOK: false},
		{name: "no separator", key: "ctrl", want: "", wantOK: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := ctrlKey(tc.key)
			if got != tc.want || ok != tc.wantOK {
				t.Fatalf("ctrlKey(%q) = (%q, %v), want (%q, %v)", tc.key, got, ok, tc.want, tc.wantOK)
			}
		})
	}
}

func TestTruncateMiddle(t *testing.T) {
	const marker = "\n... [truncated] ...\n"
	cases := []struct {
		name string
		in   string
		max  int
		want string
	}{
		{name: "zero max returns input", in: "abcdef", max: 0, want: "abcdef"},
		{name: "negative max returns input", in: "abcdef", max: -3, want: "abcdef"},
		{name: "shorter than max", in: "abc", max: 10, want: "abc"},
		{name: "exactly max", in: "abc", max: 3, want: "abc"},
		{name: "below marker threshold keeps head", in: strings.Repeat("z", 25), max: 23, want: strings.Repeat("z", 23)},
		{name: "marker in the middle", in: strings.Repeat("x", 100), max: 30, want: "xxxx" + marker + "xxxxx"},
		{name: "shortest marked cut", in: strings.Repeat("y", 25), max: 24, want: "y" + marker + "yy"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := truncateMiddle(tc.in, tc.max)
			if got != tc.want {
				t.Fatalf("truncateMiddle(len=%d, max=%d) = %q (len %d), want %q (len %d)",
					len(tc.in), tc.max, got, len(got), tc.want, len(tc.want))
			}
		})
	}
}
