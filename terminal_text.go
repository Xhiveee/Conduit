package main

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	oscRe      = regexp.MustCompile("\x1b\\][^\x07\x1b]*(?:\x07|\x1b\\\\)")
	dcsRe      = regexp.MustCompile("\x1bP[^\x1b]*(?:\x07|\x1b\\\\)")
	csiRe      = regexp.MustCompile("\x1b\\[[0-9;?]*[ -/]*[@-~]")
	charsetRe  = regexp.MustCompile("\x1b[()][0-9A-Za-z]")
	escSeqRe   = regexp.MustCompile("\x1b[@-~]")
	promptRe   = regexp.MustCompile(`[$#%>❯]\s*$`)
	keyTokenRe = regexp.MustCompile(`^<([A-Za-z0-9_+-]+)>`)
)

func stripANSI(s string) string {
	s = oscRe.ReplaceAllString(s, "")
	s = dcsRe.ReplaceAllString(s, "")
	s = csiRe.ReplaceAllString(s, "")
	s = charsetRe.ReplaceAllString(s, "")
	s = escSeqRe.ReplaceAllString(s, "")
	out := make([]byte, 0, len(s))
	for i := 0; i < len(s); {
		c := s[i]
		switch {
		case c == '\r':
			if i+1 < len(s) && s[i+1] == '\n' {
				i++
				continue
			}
			out = append(out, c)
			i++
		case c == '\b':
			if len(out) > 0 {
				_, size := utf8.DecodeLastRune(out)
				out = out[:len(out)-size]
			}
			i++
		default:
			_, size := utf8.DecodeRuneInString(s[i:])
			out = append(out, s[i:i+size]...)
			i += size
		}
	}
	return string(out)
}

func looksLikePrompt(lastLine string) bool {
	return promptRe.MatchString(lastLine)
}

func parseKeys(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for len(s) > 0 {
		if s[0] == '<' {
			if m := keyTokenRe.FindStringSubmatch(s); m != nil {
				if seq, ok := namedKey(m[1]); ok {
					b.WriteString(seq)
					s = s[len(m[0]):]
					continue
				}
				if seq, ok := ctrlKey(m[1]); ok {
					b.WriteString(seq)
					s = s[len(m[0]):]
					continue
				}
			}
		}
		_, size := utf8.DecodeRuneInString(s)
		b.WriteString(s[:size])
		s = s[size:]
	}
	return b.String()
}

func namedKey(name string) (string, bool) {
	switch strings.ToLower(name) {
	case "enter", "return":
		return "\r", true
	case "tab":
		return "\t", true
	case "esc", "escape":
		return "\x1b", true
	case "up":
		return "\x1b[A", true
	case "down":
		return "\x1b[B", true
	case "right":
		return "\x1b[C", true
	case "left":
		return "\x1b[D", true
	case "backspace":
		return "\x7f", true
	case "space":
		return " ", true
	case "delete", "del":
		return "\x1b[3~", true
	case "home":
		return "\x1b[H", true
	case "end":
		return "\x1b[F", true
	case "pageup":
		return "\x1b[5~", true
	case "pagedown":
		return "\x1b[6~", true
	}
	return "", false
}

func ctrlKey(name string) (string, bool) {
	lower := strings.ToLower(name)
	sep := strings.Index(lower, "-")
	if sep < 0 {
		return "", false
	}
	prefix, rest := lower[:sep], lower[sep+1:]
	if prefix != "c" && prefix != "ctrl" {
		return "", false
	}
	if len(rest) != 1 {
		return "", false
	}
	c := rest[0]
	if c >= 'a' && c <= 'z' {
		return string(c - 'a' + 1), true
	}
	if c >= '@' && c <= '_' {
		return string(c & 0x1f), true
	}
	return "", false
}

func truncateMiddle(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	if max < 24 {
		return s[:max]
	}
	marker := "\n... [truncated] ...\n"
	keep := max - len(marker)
	half := keep / 2
	return s[:half] + marker + s[len(s)-(keep-half):]
}
