# Chat Aggregator v0.1

Electron-приложение для одновременной работы с ChatGPT, Claude, Gemini и Grok.

## 🚀 Быстрый старт

### Установка

```bash
# 1. Установите Node.js (если ещё не установлен)
# Скачайте с https://nodejs.org/ (версия 18 или выше)

# 2. Установите зависимости
npm install

# 3. Запустите приложение
npm start
```

## 📦 Зависимости

Проект использует только одну зависимость:
- `electron` ^28.0.0

## ✨ Возможности

### Основные
- ✅ Отправка сообщения одновременно во все 4 чата
- ✅ Импорт cookies из браузера (формат Cookie-Editor)
- ✅ Редактируемые URL для каждого AI-сервиса
- ✅ Управление масштабом (zoom) для каждого окна
- ✅ Навигация: назад/вперёд/перезагрузка/стоп
- ✅ Компактный UI с возможностью скрыть контролы
- ✅ Сохранение настроек между сеансами

### Горячие клавиши

- `Enter` - отправить сообщение (без Shift)
- `Shift + Enter` - новая строка в поле ввода
- `Ctrl/Cmd + I` - импорт cookies из файла
- `Ctrl/Cmd + R` - перезагрузить все WebView
- `F12` - открыть DevTools
- `Ctrl/Cmd + Plus` - увеличить масштаб всех окон
- `Ctrl/Cmd + Minus` - уменьшить масштаб всех окон
- `Ctrl/Cmd + 0` - сбросить масштаб всех окон

## 🍪 Как импортировать cookies

### Способ 1: Через расширение Cookie-Editor

1. Установите расширение [Cookie-Editor](https://cookie-editor.com/) для вашего браузера
2. Зайдите на нужный AI-сервис (chatgpt.com, claude.ai, gemini.google.com, x.com)
3. Откройте Cookie-Editor и нажмите "Export" → "JSON"
4. Сохраните файл
5. В Chat Aggregator нажмите "Import 🍪" и выберите файл
6. Все WebView автоматически перезагрузятся

### Способ 2: Через меню (Ctrl+I)

1. Tools → Import Cookies from File...
2. Выберите файл cookies.json
3. WebView перезагрузятся с новыми cookies

## ⚙️ Настройки и персонализация

### Изменение URL

Можете изменить URL любого AI-сервиса:
1. Кликните на адресную строку в заголовке WebView
2. Введите новый URL
3. Нажмите Enter

URL сохраняется автоматически.

### Изменение платформ

Если хотите использовать другие AI-сервисы, отредактируйте:

**renderer.js** - добавьте селекторы для новой платформы:
```javascript
const selectors = {
  newai: {
    textarea: 'textarea[id="input"]',
    button: 'button[type="submit"]'
  }
};
```

**index.html** - добавьте новый WebView:
```html
<webview id="webview-newai" src="https://newai.com" partition="persist:newai"></webview>
```

## 🐛 Известные проблемы

### Gemini
- `gemini.google.com` может зациклиться
- **Решение**: используем `aistudio.google.com/app/prompts/new_chat`

### Cookie импорт
- Google cookies импортируются во все партиции (ChatGPT, Claude, Gemini, Grok)
- Это необходимо для работы Google-авторизации

### Селекторы
- Могут меняться при обновлении AI-сервисов
- Есть fallback-логика, но иногда требуется обновление селекторов в коде

## 📁 Структура проекта

```
chat-aggregator/
├── main.js                    # Главный процесс Electron
├── index.html                 # UI интерфейс
├── renderer.js                # Логика фронтенда
├── preload.js                 # IPC bridge (безопасный мост)
├── cookie-import-simple.js    # Импорт cookies
├── cookie-import.js           # Альтернативный импорт (из браузера напрямую)
└── package.json              # Конфигурация проекта
```

## 🔧 Разработка

### Запуск в режиме разработки

```bash
npm run dev
```

Откроется DevTools для отладки.

### Отладка WebView

1. Откройте DevTools (F12)
2. В консоли выполните:
```javascript
document.getElementById('webview-chatgpt').openDevTools()
```

## 🚀 Сборка для продакшена

Для создания исполняемого файла используйте electron-builder:

```bash
# Установите electron-builder
npm install --save-dev electron-builder

# Добавьте в package.json:
"build": {
  "appId": "com.chataggregator.app",
  "productName": "Chat Aggregator",
  "win": {
    "target": "nsis"
  },
  "mac": {
    "target": "dmg"
  },
  "linux": {
    "target": "AppImage"
  }
}

# Соберите
npm run build
```

## 💡 Советы по использованию

1. **Первый запуск**: импортируйте cookies сразу после установки
2. **Переключение чатов**: используйте чекбоксы чтобы выбрать, куда отправлять
3. **Масштаб**: если текст слишком мелкий, используйте кнопки +/- в каждом окне
4. **Адресная строка**: можно скрыть кнопкой "Address Bar" для экономии места
5. **Контролы**: кнопка "Hide Controls" скрывает верхнюю панель

## 📝 Лицензия

MIT

## 🤝 Вклад

Pull requests приветствуются!

## ⚠️ Дисклеймер

Этот проект создан в образовательных целях. Убедитесь, что использование соответствует Terms of Service каждого AI-сервиса.
