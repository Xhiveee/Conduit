package main

import (
	"embed"
	"errors"
	"os"
	"path/filepath"
	"unsafe"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	xwindows "golang.org/x/sys/windows"
)

//go:embed all:web/dist
var assets embed.FS

const swRestore = 9

// version is overridden at build time with -ldflags "-X main.version=v0.1.0".
var version = "dev"

var (
	user32            = xwindows.NewLazySystemDLL("user32.dll")
	procFindWindowW   = user32.NewProc("FindWindowW")
	procIsIconic      = user32.NewProc("IsIconic")
	procShowWindow    = user32.NewProc("ShowWindow")
	procSetForeground = user32.NewProc("SetForegroundWindow")
)

func fatal(err error) {
	text, _ := xwindows.UTF16PtrFromString(err.Error())
	caption, _ := xwindows.UTF16PtrFromString("Conduit")
	xwindows.MessageBox(0, text, caption, xwindows.MB_OK|xwindows.MB_ICONERROR|xwindows.MB_SETFOREGROUND)
	os.Exit(1)
}

func acquireInstance() (xwindows.Handle, bool) {
	name, err := xwindows.UTF16PtrFromString(`Local\Conduit.SingleInstance`)
	if err != nil {
		return 0, true
	}
	h, err := xwindows.CreateMutex(nil, false, name)
	if errors.Is(err, xwindows.ERROR_ALREADY_EXISTS) {
		if h != 0 {
			xwindows.CloseHandle(h)
		}
		return 0, false
	}
	if err != nil {
		return 0, true
	}
	return h, true
}

func focusExistingWindow() {
	name, err := xwindows.UTF16PtrFromString("Conduit")
	if err != nil {
		return
	}
	hwnd, _, _ := procFindWindowW.Call(0, uintptr(unsafe.Pointer(name)))
	if hwnd == 0 {
		return
	}
	if iconic, _, _ := procIsIconic.Call(hwnd); iconic != 0 {
		procShowWindow.Call(hwnd, swRestore)
	}
	procSetForeground.Call(hwnd)
}

func main() {
	instance, first := acquireInstance()
	if !first {
		focusExistingWindow()
		return
	}
	if instance != 0 {
		defer xwindows.CloseHandle(instance)
	}
	webviewDir := filepath.Join(dataDir(), "webview")
	if err := os.MkdirAll(webviewDir, 0o755); err != nil {
		fatal(err)
	}
	store, err := NewStore()
	if err != nil {
		fatal(err)
	}
	chats, err := NewChatStore()
	if err != nil {
		fatal(err)
	}
	app := NewApp(store, chats, version)
	defer closeLog()
	err = wails.Run(&options.App{
		Title:     "Conduit",
		Width:     1360,
		Height:    860,
		MinWidth:  960,
		MinHeight: 600,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
		Windows: &windows.Options{
			WebviewUserDataPath: webviewDir,
		},
	})
	if err != nil {
		fatal(err)
	}
}
