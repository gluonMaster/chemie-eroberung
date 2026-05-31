# Chemie-Eroberung

Локальный каркас тренажера по химии для Klasse 8 Gymnasium Sachsen.

## Запуск

Можно открыть файл напрямую:

```text
chemie-trainer/index.html
```

Или запустить локальный сервер из папки `chemie-trainer`:

```bash
python -m http.server 8000
```

После этого открыть:

```text
http://localhost:8000/
```

## Что уже готово

- Структура приложения без npm, сборки, CDN, `fetch()` и ES modules.
- Подключение скриптов обычными `<script>` в порядке из ТЗ 15.1.
- `window.CHEMIE_DATA` с каноническими полями `meta`, `terms`, `questions`, `readyAnswers`.
- `window.ChemieStorage` с безопасным fallback, если `localStorage` недоступен.
- `window.ChemistryEngine` с валидатором данных, очередью вопросов и базовыми заглушками проверки ответов.
- Адаптированная процедурная гекс-карта из `game`.
- Стартовый экран с настройками `totalHexes`, `playerStartHexes`, `timerEnabled`, `timerMode`, `hardTimerForShortAnswer`.
- Маршруты-заглушки: игра, словарь, готовые ответы, обзор прогресса, `Fehler wiederholen`.

## Что дальше

Следующие промпты должны заполнить банк терминов, вопросы и готовые ответы, а затем подключить полный игровой цикл и рендереры всех типов заданий.
