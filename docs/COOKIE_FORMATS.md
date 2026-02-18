# Примеры формата кукис

## Для Claude (у тебя уже есть) ✅
```json
[
    {
        "domain": ".claude.ai",
        "name": "sessionKey",
        "value": "sk-ant-sid02-...",
        ...
    }
]
```

## Для ChatGPT
Экспортируй с https://chat.openai.com

Нужные куки:
- `__Secure-next-auth.session-token` (главная!)
- `__cf_bm`
- другие куки с domain `.openai.com`

## Для Gemini
Экспортируй с https://gemini.google.com

Нужные куки:
- `__Secure-1PSID` (главная!)
- `SIDCC`
- другие куки с domain `.google.com`

## Для Grok (X/Twitter)
⚠️ ВАЖНО: Экспортируй с https://x.com (не grok.com!)

Нужные куки:
- `auth_token` (главная!)
- `ct0`
- `kdt`
- другие куки с domain `.x.com` или `.twitter.com`

---

## Как объединить все куки в один файл

Создай `all-cookies.json`:

```json
[
    ...куки из claude_cookie.json...,
    ...куки из chatgpt_cookie.json...,
    ...куки из gemini_cookie.json...,
    ...куки из x_cookie.json...
]
```

Просто открой все файлы, скопируй их содержимое (без внешних `[` и `]`), вставь в один массив через запятую.
