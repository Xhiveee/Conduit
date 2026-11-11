package main

import (
	"embed"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
	xwindows "golang.org/x/sys/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func fatal(err error) {
	text, _ := xwindows.UTF16PtrFromString(err.Error())
	caption, _ := xwindows.UTF16PtrFromString("Conduit")
	xwindows.MessageBox(0, text, caption, xwindows.MB_OK|xwindows.MB_ICONERROR|xwindows.MB_SETFOREGROUND)
	os.Exit(1)
}

func main() {
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
	app := NewApp(store, chats)
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
