//go:build windows

package main

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	secretPrefix  = "dpapi:"
	secretEntropy = "conduit"
)

var (
	procCryptProtectData   = windows.NewLazySystemDLL("crypt32.dll").NewProc("CryptProtectData")
	procCryptUnprotectData = windows.NewLazySystemDLL("crypt32.dll").NewProc("CryptUnprotectData")
)

// dataBlob must match the Win32 DATA_BLOB layout passed by pointer to crypt32.
type dataBlob struct {
	cbData uint32
	pbData *byte
}

func newDataBlob(b []byte) dataBlob {
	if len(b) == 0 {
		return dataBlob{}
	}
	return dataBlob{cbData: uint32(len(b)), pbData: &b[0]}
}

func (b dataBlob) bytes() []byte {
	if b.cbData == 0 || b.pbData == nil {
		return nil
	}
	out := make([]byte, b.cbData)
	copy(out, unsafe.Slice(b.pbData, b.cbData))
	return out
}

func (b *dataBlob) free() {
	if b.pbData == nil {
		return
	}
	windows.LocalFree(windows.Handle(unsafe.Pointer(b.pbData)))
	b.pbData = nil
	b.cbData = 0
}

func protectSecret(plain string) (string, error) {
	if plain == "" || isEncryptedSecret(plain) {
		return plain, nil
	}
	blob, err := dpapiProtect([]byte(plain))
	if err != nil {
		return "", err
	}
	return secretPrefix + base64.StdEncoding.EncodeToString(blob), nil
}

func unprotectSecret(stored string) (string, error) {
	if !isEncryptedSecret(stored) {
		return stored, nil
	}
	blob, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, secretPrefix))
	if err != nil {
		return "", fmt.Errorf("decode protected secret: %w", err)
	}
	plain, err := dpapiUnprotect(blob)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

func isEncryptedSecret(s string) bool {
	return strings.HasPrefix(s, secretPrefix)
}

func dpapiProtect(data []byte) ([]byte, error) {
	in := newDataBlob(data)
	entropy := newDataBlob([]byte(secretEntropy))
	var out dataBlob
	r, _, err := procCryptProtectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&entropy)),
		0,
		0,
		uintptr(windows.CRYPTPROTECT_UI_FORBIDDEN),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		if err == nil {
			err = errors.New("unknown failure")
		}
		return nil, fmt.Errorf("CryptProtectData: %w", err)
	}
	defer out.free()
	return out.bytes(), nil
}

func dpapiUnprotect(data []byte) ([]byte, error) {
	in := newDataBlob(data)
	entropy := newDataBlob([]byte(secretEntropy))
	var out dataBlob
	r, _, err := procCryptUnprotectData.Call(
		uintptr(unsafe.Pointer(&in)),
		0,
		uintptr(unsafe.Pointer(&entropy)),
		0,
		0,
		uintptr(windows.CRYPTPROTECT_UI_FORBIDDEN),
		uintptr(unsafe.Pointer(&out)),
	)
	if r == 0 {
		if err == nil {
			err = errors.New("unknown failure")
		}
		return nil, fmt.Errorf("CryptUnprotectData: %w", err)
	}
	defer out.free()
	return out.bytes(), nil
}
