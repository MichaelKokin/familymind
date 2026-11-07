# Зависимости и методические источники

Дата проверки: **6 ноября 2026**. Версии приложения зафиксированы в `package.json` и `package-lock.json`. Изменения зависимостей должны проходить повторную проверку совместимости и тесты.

## ex-USSR Kinship Research

| Поле | Проверенное значение |
|---|---|
| Репозиторий | [DenisSergeevitch/ex-ussr-kinship-research](https://github.com/DenisSergeevitch/ex-ussr-kinship-research) |
| Зафиксированный commit | `84b0eda770b002464e84658a8f63046a4bb94e95` |
| Metadata version | `1.34.0`, прочитана в [SKILL.md этого commit](https://raw.githubusercontent.com/DenisSergeevitch/ex-ussr-kinship-research/84b0eda770b002464e84658a8f63046a4bb94e95/SKILL.md) |
| Лицензия | [MIT, Copyright (c) 2026 Denis Shiryaev](https://raw.githubusercontent.com/DenisSergeevitch/ex-ussr-kinship-research/84b0eda770b002464e84658a8f63046a4bb94e95/LICENSE) |
| Применение в M0 | Методический обзор; runtime-зависимость отсутствует |
| Копирование и исполнение | Код, шаблоны и значимые текстовые фрагменты не копировались; скрипты не запускались |
| Внешние подключения | Не устанавливались; ключи и доступы не предполагались |

Прочитаны [README](https://raw.githubusercontent.com/DenisSergeevitch/ex-ussr-kinship-research/84b0eda770b002464e84658a8f63046a4bb94e95/README.md), metadata и начало SKILL.md, а также разделы [протокола доказательств](https://raw.githubusercontent.com/DenisSergeevitch/ex-ussr-kinship-research/84b0eda770b002464e84658a8f63046a4bb94e95/references/evidence-protocol.md) о происхождении, независимости, статусах и разрешении личности. GitHub HTML-страница не открылась в веб-инструменте; файлы по точному commit успешно прочитаны через официальный raw endpoint. Текущий `main` не использовался вместо фиксированной версии.

Методика сохраняет отдельные идентификаторы одноимённых людей, связывает выводы с конкретными артефактами и не считает зеркала независимыми подтверждениями. Для смешанного документа происхождение сведений оценивают по каждому утверждению. Описанная upstream CSV-модель назначает группу артефакту; поэтому будущему адаптеру понадобится явное сопоставление с нашей моделью EvidenceLink. Это ограничение нельзя скрыть успешным запуском автоматического аудита.

Лицензия методического кода не предоставляет права на архивные изображения или личные сведения. Если в дальнейшем копируется код, шаблон или существенная часть текста, нужно добавить MIT notice рядом с копией, указать путь и изменения. Проверка прав на импортируемые семейные документы выполняется отдельно.

### Дополнение: локальное private-case исследование

После первоначального M0 в `vendor/ex-ussr-kinship-research/` добавлены неизменённые файлы того же commit: `SKILL.md`, `references/evidence-protocol.md`, `references/source-strategy.md`, `scripts/audit_evidence.py`, `scripts/research_common.py`, четыре CSV-шаблона в `assets/` и `LICENSE`. MIT notice сохранён; `PROVENANCE.json` фиксирует SHA-256 и размеры. Локальная сверка **10/10** файлов с manifest прошла. Прежнее описание «код не копировался» относится к первоначальной поставке M0, а не к этому дополнению.

Адаптер реестров имеет тест с запуском vendored-аудитора только на временных синтетических материалах. Это не автономный backend и не проверка исторической истины. Серверный адаптер Codex и границы использования методики описаны в [PRIVATE_CASE.md](PRIVATE_CASE.md); реальный архивный поиск и FamilySearch MCP по-прежнему не подразумеваются.

## Приложение

Версии и лицензии ниже проверены по metadata npm при подготовке установки. Совместимость API сверена с [документацией установки Next.js](https://nextjs.org/docs/app/getting-started/installation) и [React Flow](https://reactflow.dev/learn). Точный состав дерева фиксируется lockfile; таблица перечисляет прямые зависимости, а не все транзитивные пакеты.

| Пакет | Выбранная версия | Лицензия | Назначение |
|---|---|---|---|
| `next` | 16.4.5 | MIT | Локальное web-приложение |
| `react`, `react-dom` | 19.3.1 | MIT | Интерфейс |
| `@xyflow/react` | 12.12.1 | MIT | Canvas, pan/zoom, узлы и связи |
| `zod` | 4.6.7 | MIT | Валидация домена и переноса |
| `idb` | 8.0.4 | ISC | IndexedDB repository |
| `typescript` | 5.9.3 | Apache-2.0 | Проверка типов |
| `vitest` | 4.1.12 | MIT | Unit/integration tests |
| `@playwright/test` | 1.65.0 | Apache-2.0 | Browser smoke tests |
| `eslint` | 9.39.5 | MIT | Lint; совместимость с React lint plugins |
| `eslint-config-next` | 16.4.5 | MIT | Правила Next.js и React |
| `fake-indexeddb` | 6.2.7 | Apache-2.0 | Изолированные тесты браузерного хранилища |
| `@types/node` | 20.19.43 | MIT | Типы Node.js |
| `@types/react`, `@types/react-dom` | 19.3.0 | MIT | Типы React |

После установки версии и поля лицензий этой таблицы дополнительно прочитаны из `node_modules/*/package.json`; это проверка package metadata, а не юридический аудит лицензий всего транзитивного дерева.

ESLint 10 проверялся, но текущие React lint plugins заявляют peer-диапазон ESLint 9. Для совместимого проверенного набора выбран ESLint 9.39.5; ветка помечена deprecated, обновление требует совместимых plugins. Для dev-зависимостей задан override `minimatch@>=7.0.0 <11.0.1` → `11.0.5` (лицензия BlueOak-1.0.0), чтобы устранить найденное npm advisory; установленная версия и поддержка Node.js 20 проверены. Результат итогового audit, lint и тестов фиксируется в статусе реализации.

Vitest 4 выбран с учётом установленного Node.js 20; новая ветка Vitest 5 требует Node.js 22. Проверка совместимости сборкой и тестами отражается в [статусе реализации](IMPLEMENTATION_STATUS.md). Открытая лицензия React Flow core не распространяется автоматически на сторонние Pro-примеры и шаблоны; такие материалы в M0 не используются.
