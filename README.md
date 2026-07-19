# Habr Article Downloader

Chrome-расширение (Manifest V3), которое сохраняет публикации [Habr](https://habr.com) в **Markdown** с YAML frontmatter.

Поддерживаются статьи, посты и новости. Скачивание — с кнопки на сайте, пакетом по списку ссылок или автоматически по расписанию с фильтрами.

## Возможности

| Режим | Описание |
|-------|----------|
| **Кнопка `.md` на Habr** | В шапке статьи или на карточке в ленте |
| **Пакет** | Список URL или файл `.txt`, фоновое скачивание |
| **Слежение** | Периодическая проверка лент/хабов, только новые публикации |
| **Фильтры** | Тип, рейтинг, сложность, хабы и теги (include/exclude) |
| **Контекстное меню** | «Скачать Habr → Markdown» на странице и ссылке |

Дополнительно: Turndown/GFM, шаблон имени файла, экспорт/импорт настроек, тихие загрузки без диалога «Сохранить как».

## Установка

1. Клонируйте репозиторий или скачайте ZIP.
2. Откройте `chrome://extensions/`.
3. Включите **Режим разработчика**.
4. **Загрузить распакованное расширение** → папка [`extension/`](extension/).
5. После обновления кода нажмите **Обновить** на карточке расширения.

## Куда сохраняются файлы

Chrome пишет только в **папку загрузок браузера**. В настройках расширения укажите относительный путь, например `downloads` или `habr_articles/downloads`.

Чтобы `.md` попадали в нужный каталог на диске:

1. Chrome → **Настройки → Загрузки → Расположение**
2. Укажите нужную папку (например, `E:\archive\habr`)
3. В расширении оставьте подпапку `downloads`

## Использование

### Скачать одну статью

На странице публикации или в ленте нажмите **`.md`** (правый верхний угол блока). Кнопка покажет статус: «Скачиваю…», «Сохранено: …», «Уже скачано».

### Пакет

Вкладка **Пакет** в popup: вставьте ссылки (по одной на строку) или загрузите `.txt`.

### Слежение

1. Вкладка **Слежение** → включите переключатель.
2. Укажите источники (по одному на строку), например `https://habr.com/ru/feed/`.
3. Настройте фильтры и лимиты (по умолчанию щадящие: до 8 HTTP-запросов за цикл).
4. **Сохранить** → при необходимости **Проверить сейчас**.

Для «Моей ленты» нужна авторизация на habr.com в этом браузере.

## Формат `.md`

```yaml
---
url: "https://habr.com/ru/articles/123456/"
article_id: 123456
publication_type: articles
title: "Заголовок"
author: username
published: "2026-07-03T14:40:31.000Z"
complexity: Средний
reading_time: 15 мин
hubs:
  - "Компьютерное железо"
tags:
  - python
rating: 42
word_count: 1234
---
```

Тело статьи — Markdown (Turndown + правила для формул, iframe, spoiler, figure).

## Структура проекта

```
extension/
├── manifest.json          # MV3
├── background.js          # service worker, alarms, сообщения
├── content.js             # кнопки .md на habr.com
├── popup.html / popup.js  # интерфейс
├── parser.js              # HTML → metadata + Markdown
├── markdown.js            # Turndown + правила Habr
├── filters.js             # фильтры слежения/пакета
├── habr-core.js           # fetch, batch, watch, storage
├── styles/                # popup.css, content.css
├── icons/                 # иконки расширения
├── lib/                   # turndown, gfm, dom-shim (для worker)
└── utils/                 # fetch-retry, rss, journal, filename
```

### Поток скачивания

1. **Content script** или **popup** отправляет `DOWNLOAD_URL` / запускает batch.
2. **Service worker** (`background.js`) загружает HTML через `habr-core.js`.
3. **parser.js** + **markdown.js** (Turndown) строят Markdown.
4. Файл сохраняется через `chrome.downloads` как data URL (без Blob URL в worker).

### Service worker и DOM

В MV3 у service worker нет `DOMParser`. Для парсинга HTML в фоне подключён [`lib/dom-shim.js`](extension/lib/dom-shim.js) (linkedom, уже собран в репозитории).

## Ограничения

- Только `https://habr.com/*`
- Пути `/articles/`, `/news/`, `/post/` (в т.ч. `/companies/.../articles/`)
- Комментарии в `.md` — только если они есть в отданном HTML (часто подгружаются отдельно)
- Частые запросы могут временно ограничиваться Habr — увеличьте паузу в настройках
- Расширение **не** пишет в произвольные каталоги вне папки загрузок Chrome

## Разработка

После изменения файлов в `extension/` обновите расширение на `chrome://extensions/`.

Основные модули не требуют сборки. `lib/dom-shim.js` уже включён в репозиторий; пересборка нужна только при смене polyfill (linkedom).

## Лицензия

[MIT](LICENSE)

## Сторонние компоненты

- [Turndown](https://github.com/mixmark-io/turndown) — HTML → Markdown
- [turndown-plugin-gfm](https://github.com/domchristie/turndown-plugin-gfm) — таблицы, strikethrough
- [linkedom](https://github.com/WebReflection/linkedom) — DOM в service worker (в составе `dom-shim.js`)
