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

---

### Grok - не логинится

**Причина:** Grok требует авторизацию через X (Twitter).

**Решение 1: Используй прямой URL** (уже исправлено)
- Новый URL: https://grok.x.com
- Старый: https://x.com/i/grok (может требовать Premium)

**Решение 2: Логинься в X сначала**
1. Смени URL на https://x.com
2. Залогинься в Twitter/X
3. Потом вручную перейди на https://grok.x.com

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

## Итог

Новая версия уже содержит фиксы. Если после обновления всё ещё проблемы — просто поменяй URL на альтернативные AI через адресную строку.
