# 🔧 Фиксы для проблемных сервисов

## Проблема: Gemini и Grok не работают

### Gemini - бесконечная перезагрузка

**Причина:** Google блокирует WebView из-за reCAPTCHA и CSP политики.

**Решение 1: Используй Google AI Studio** (уже исправлено в новой версии)
- URL: https://aistudio.google.com/app/prompts/new_chat
- Это официальный сервис Google для AI, без защиты от ботов

**Решение 2: Логинься через основной браузер**
1. Открой Chrome/Edge
2. Зайди на https://gemini.google.com
3. Залогинься
4. Экспортируй куки (Cookie-Editor)
5. Импортируй в приложение

**Решение 3: Вручную**
1. В приложении кликни правой кнопкой внутри панели Gemini
2. Inspect Element
3. В DevTools открой Console
4. Попробуй залогиниться через UI
5. Если не работает — используй Решение 1

---

### Grok - не логинится

**Причина:** Grok требует авторизацию через X (Twitter), и у тебя либо нет подписки X Premium, либо не залогинен.

**Решение 1: Используй прямой URL** (уже исправлено)
- Новый URL: https://grok.x.com
- Старый: https://x.com/i/grok (может требовать Premium)

**Решение 2: Логинься в X сначала**
1. Смени URL на https://x.com
2. Залогинься в Twitter/X
3. Потом вручную перейди на https://grok.x.com

**Решение 3: Если нет X Premium**
- Grok доступен только для X Premium подписчиков
- Альтернатива: поменяй URL на другой AI:
  ```
  https://perplexity.ai
  https://chat.deepseek.com
  https://copilot.microsoft.com
  ```

---

## Про ошибки в консоли

```
[gemini] failed to load: isTrustedURL false
```
Это Google блокирует WebView. Используй AI Studio (уже исправлено).

```
Unexpected error while loading: GUEST_VIEW_MANAGER_CALL
```
Это Electron пытается загрузить сайт, но сайт блокирует. Используй альтернативные URL.

---

## Что уже исправлено в новой версии

✅ Gemini → AI Studio (без reCAPTCHA)  
✅ Grok → grok.x.com (прямой доступ)  
✅ UserAgent добавлен для обхода некоторых проверок  

---

## Если всё равно не работает

### Вариант 1: Замени на другие AI

Вместо Gemini и Grok используй:

**Вместо Gemini:**
- Perplexity: https://perplexity.ai
- Copilot: https://copilot.microsoft.com

**Вместо Grok:**
- DeepSeek: https://chat.deepseek.com
- Phind: https://phind.com

### Вариант 2: Просто не используй их

Сними галочки с Gemini и Grok в верхней панели. Работай с ChatGPT и Claude — они стабильные.

---

## Итог

Новая версия уже содержит фиксы. Если после обновления всё ещё проблемы — просто поменяй URL на альтернативные AI через адресную строку.
