# Как участвовать в Conduit

Спасибо за интерес к проекту. Conduit — портативный SSH-клиент для Windows со встроенным
ИИ-агентом. Ниже — как собрать проект, прогнать проверки и прислать изменения.

## Требования

- Go 1.26+;
- Node.js 24+ и npm;
- Wails CLI v2.17.1;
- Windows 10/11 с WebView2 Runtime (нужен для запуска и для `wails dev`).

Wails CLI ставится из модуля проекта:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1
```

Каталог `$(go env GOPATH)/bin` должен быть в `PATH`. В этом репозитории локальная копия CLI может
лежать в `.tools/bin/wails.exe` (каталог не коммитится).

## Разработка

Зависимости интерфейса:

```sh
cd src/web
npm ci
```

Режим с hot-reload:

```pwsh
$env:CONDUIT_DATA_DIR = "$PWD\.clean\devdata"
cd src
wails dev
```

`CONDUIT_DATA_DIR` для dev-режима и тестов обязателен: без него приложение пишет данные в
`data/` рядом с exe. Используйте каталог внутри `.clean/` — он в `.gitignore` и не попадёт в
коммит.

## Сборка

```sh
cd src
wails build -o Conduit.exe
```

Готовый файл — `src/build/bin/Conduit.exe`. Фронтенд собирается автоматически (Vite) и
встраивается в exe через `go:embed`. Никогда не запускайте `wails build -clean`: он удаляет
`src/build/bin/data` вместе с рабочими хостами, настройками и ключами.

## Проверки

Бэкенд:

```sh
cd src
go vet ./...
go test ./...
gofmt -l .   # вывод должен быть пустым
```

Интерфейс:

```sh
cd src/web
npm run build   # tsc + vite build
```

Те же шаги выполняет CI (`.github/workflows/ci.yml`) на `windows-latest`; pull request должен быть
зелёным.

## Соглашения

- Комментарии — только однострочные WHY для неочевидных мест. Код должен читаться сам.
- Никакого отладочного вывода: `fmt.Println`, `console.log` и подобное в PR не попадают.
- Каждая строка интерфейса существует на двух языках, EN и RU. Переводы лежат в словарях
  `src/web/src/i18n/`; строка только на одном языке — ошибка.
- Go-код форматируется `gofmt`; TypeScript — по стилю соседних файлов (4 пробела, одинарные кавычки).
- Сообщения коммитов — [Conventional Commits](https://www.conventionalcommits.org/ru/v1.0.0/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), тема на английском в повелительном
  наклонении.
- Изменения, заметные пользователю, попадают в `CHANGELOG.md`.

## Что не коммитить

`data/`, `src/build/bin/`, `src/web/dist/`, `node_modules/`, `.clean/`, `.tools/`, `.env`, логи и
локальные настройки IDE. Пароли, приватные ключи и API-ключи в репозиторий не попадают никогда.

## Pull request

- [ ] `go vet ./...` и `go test ./...` проходят.
- [ ] `gofmt -l .` не выдаёт файлов.
- [ ] `npm run build` в `src/web` проходит.
- [ ] Изменение проверено вручную в `wails dev` с данными в `CONDUIT_DATA_DIR`.
- [ ] Новые строки интерфейса переведены на EN и RU.
- [ ] В диффе нет `data/`, артефактов сборки, секретов и отладочного вывода.
- [ ] `CHANGELOG.md` обновлён, если изменение видно пользователю.
- [ ] CI зелёный.

## Вопросы и баги

Ошибки и предложения — через GitHub Issues. Об уязвимостях сообщайте только приватно, по правилам
из [SECURITY.md](SECURITY.md).
