package main

import (
	"embed"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()
	webviewDir := filepath.Join(dataDir(), "webview")
	os.MkdirAll(webviewDir, 0o755)
	err := wails.Run(&options.App{
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
		println("Error:", err.Error())
	}
}
