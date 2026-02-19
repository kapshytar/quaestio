# Chat Aggregator v0.1 🚀

Electron-приложение для одновременной работы с ChatGPT, Claude, Gemini, Grok и другими AI-сервисами.

## ✨ Основные возможности

- **4-слотовая сетка:** Работайте с четырьмя разными чат-ботами одновременно.
- **Единая отправка:** Отправляйте сообщение во все активные слоты одним нажатием.
- **Функция Merge:** Синтезируйте ответы от разных моделей в один финальный ответ через API (OpenAI, Anthropic, Google и др.).
- **Правая панель управления:** Удобная настройка API и управление слиянием ответов.
- **Импорт сессий:** Быстрый перенос куки из Chrome/Edge для мгновенной авторизации.
- **Кастомизация:** Редактируемые URL и настройки масштаба (zoom) для каждого окна.

## 🚀 Быстрый старт

1. **Установка зависимостей:**
   ```bash
   npm install
   ```
2. **Запуск приложения:**
   ```bash
   npm start
   ```
   (Или используйте `start.bat` в Windows / `start.sh` в macOS/Linux)

3. **Авторизация:**
   - Нажмите "Import 🍪" в верхней панели или используйте `Ctrl+I`.
   - Инструкции по подготовке куки находятся в [docs/COOKIE_IMPORT.md](docs/COOKIE_IMPORT.md).

## 🛠 Документация

Подробные инструкции и технические детали:

### Использование
- [QUICKSTART.md](QUICKSTART.md) — Быстрая настройка и первый запуск.
- [docs/COOKIE_IMPORT.md](docs/COOKIE_IMPORT.md) — Как импортировать сессии из браузера.
- [docs/MANUAL_COOKIE_IMPORT.md](docs/MANUAL_COOKIE_IMPORT.md) — Ручной экспорт куки через расширения.
- [docs/FIXES.md](docs/FIXES.md) — Решение проблем с Gemini и Grok.

### Особенности (Merge Feature)
- [docs/MERGE_FINAL.md](docs/MERGE_FINAL.md) — Обзор функции слияния ответов.
- [docs/RIGHT_SIDE_PANEL.md](docs/RIGHT_SIDE_PANEL.md) — Управление правой панелью и API.
- [docs/MERGE_IMPLEMENTATION.md](docs/MERGE_IMPLEMENTATION.md) — Техническая реализация логики Merge.

### Техническая часть
- [TECHNICAL_DOCS.md](TECHNICAL_DOCS.md) — Архитектура приложения и описание компонентов.
- [PROJECT_STATUS.md](PROJECT_STATUS.md) — Текущее состояние разработки и планы.

## ⌨️ Горячие клавиши

- `Enter` — Отправить во все активные слоты.
- `Shift + Enter` — Новая строка в поле ввода.
- `Ctrl + I` — Импорт cookies.
- `Ctrl + F` — Поиск: по выбранному слоту / по Merge / по всем слотам (если общий фокус).
- `Ctrl + R` — Перезагрузить все окна.
- `F12` — Открыть DevTools.
- `Ctrl + Plus/Minus` — Управление масштабом.
- `Ctrl + 0` — Сбросить масштаб.

## 📁 Структура проекта

- `main.js` — Главный процесс Electron.
- `renderer.js` — Логика фронтенда и отправки сообщений.
- `index.html` — Интерфейс (4 WebView + Merge Panel).
- `merge-api-client.js` — Клиент для работы с API провайдеров (OpenAI, Claude, etc.).
- `side-panel-controls.js` — Логика управления боковой панелью.

---
Лицензия: MIT
