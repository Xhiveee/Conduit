# Сторонние компоненты

Conduit распространяется под лицензией MIT (см. [LICENSE](LICENSE)). В сборку `Conduit.exe`
входит код сторонних библиотек под лицензиями, перечисленными ниже. Актуальные версии Go-зависимостей
— в `src/go.mod` и `src/go.sum`, интерфейса — в `src/web/package.json` и `src/web/package-lock.json`.

## Go-зависимости (встраиваются в exe)

| Компонент | Версия | Лицензия | Ссылка |
| --- | --- | --- | --- |
| Wails v2 | v2.17.1 | MIT | https://github.com/wailsapp/wails |
| golang.org/x/crypto | v0.58.0 | BSD-3-Clause | https://pkg.go.dev/golang.org/x/crypto |
| golang.org/x/sys | v0.49.0 | BSD-3-Clause | https://pkg.go.dev/golang.org/x/sys |
| github.com/google/uuid | v1.6.0 | BSD-3-Clause | https://github.com/google/uuid |
| github.com/Microsoft/go-winio | v0.6.2 | MIT | https://github.com/microsoft/go-winio |

Остальные Go-модули в `src/go.mod` помечены как `// indirect`: они приходят транзитивно с Wails и
распространяются под MIT/BSD-лицензиями. Полный список для аудита — `cd src && go list -m all`.

## Зависимости интерфейса (встраиваются в exe)

| Компонент | Версия | Лицензия | Ссылка |
| --- | --- | --- | --- |
| @xterm/xterm | 6.0.0 | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-fit | 0.11.0 | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-search | 0.16.0 | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-unicode11 | 0.9.0 | MIT | https://github.com/xtermjs/xterm.js |
| @xterm/addon-web-links | 0.12.0 | MIT | https://github.com/xtermjs/xterm.js |
| lucide | 1.66.0 | ISC | https://github.com/lucide-icons/lucide |
| markdown-it | 14.1.0 | MIT | https://github.com/markdown-it/markdown-it |
| highlight.js | 11.11.1 | BSD-3-Clause | https://github.com/highlightjs/highlight.js |
| @fontsource/jetbrains-mono | 5.3.0 | OFL-1.1 (шрифт), MIT (пакет) | https://github.com/fontsource/fontsource |

Шрифт JetBrains Mono распространяется по SIL Open Font License 1.1; текст лицензии —
https://openfontlicense.org/open-font-license-official-text/. Пакет `@fontsource/jetbrains-mono`
собирает и подключает файлы шрифта и распространяется по MIT.

## Инструменты сборки (в exe не попадают)

| Компонент | Версия | Лицензия | Ссылка |
| --- | --- | --- | --- |
| Vite | 7.3.8 | MIT | https://github.com/vitejs/vite |
| TypeScript | 5.9.3 | Apache-2.0 | https://github.com/microsoft/TypeScript |
| @types/markdown-it | 14.1.2 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |

## Среда выполнения

Conduit использует Microsoft Edge WebView2 Runtime через Wails. WebView2 — компонент Microsoft,
отдельно от Conduit не распространяется и не входит в поставку; на Windows 11 он установлен по
умолчанию, на Windows 10 его нужно поставить вручную.
