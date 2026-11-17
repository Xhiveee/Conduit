package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	logFileName = "conduit.log"
	logMaxBytes = 1 << 20
)

var (
	logMu   sync.Mutex
	logFile *os.File
	logPath string
	logSize int64
)

func logDirFor(dir string) string {
	return filepath.Join(dir, "logs")
}

func logPathFor(dir string) string {
	return filepath.Join(logDirFor(dir), logFileName)
}

func initLog(dir string) string {
	path := logPathFor(dir)
	logMu.Lock()
	defer logMu.Unlock()
	if logFile != nil {
		_ = logFile.Close()
	}
	logFile = nil
	logSize = 0
	logPath = path
	if err := os.MkdirAll(logDirFor(dir), 0o755); err != nil {
		return path
	}
	reopenLocked()
	return path
}

func logf(level, format string, args ...any) {
	line := time.Now().UTC().Format(time.RFC3339) + " " + level + " " + fmt.Sprintf(format, args...) + "\n"
	logMu.Lock()
	defer logMu.Unlock()
	if logFile == nil {
		return
	}
	if logSize >= logMaxBytes {
		rotateLocked()
	}
	if logFile == nil {
		return
	}
	n, err := logFile.WriteString(line)
	if err != nil {
		return
	}
	logSize += int64(n)
}

func rotateLocked() {
	_ = logFile.Close()
	logFile = nil
	logSize = 0
	// keep appending to the oversized file when rotation fails instead of dropping logs
	if err := os.Remove(logPath + ".1"); err != nil && !os.IsNotExist(err) {
		reopenLocked()
		return
	}
	if err := os.Rename(logPath, logPath+".1"); err != nil {
		reopenLocked()
		return
	}
	reopenLocked()
}

func reopenLocked() {
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	if info, err := f.Stat(); err == nil {
		logSize = info.Size()
	}
	logFile = f
}

func closeLog() {
	logMu.Lock()
	defer logMu.Unlock()
	if logFile == nil {
		return
	}
	_ = logFile.Close()
	logFile = nil
	logSize = 0
}
