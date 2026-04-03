# Как создать новый модуль

## 1. Что считается модулем

В этом проекте модуль — это отдельный bounded context:

- своя папка в корне репозитория;
- свой service в `docker-compose.yml`;
- своя БД Postgres, если модулю нужны данные;
- свой `GET /manifest`;
- свой route через `gateway`;
- своя запись в `plugin-registry`;
- свои страницы и пункт меню в `ui-shell`.

## 2. Минимальная структура

Минимально новый модуль состоит из:

- `<module>/app/main.py`;
- `<module>/app/__init__.py`;
- `<module>/Dockerfile`;
- `<module>/requirements.txt`.

Если модуль сложный, дальше он развивается как остальные сервисы: `domain`, `application`, `interfaces`, `infrastructure`, Alembic и т.д.

## 3. Backend-сервис

В `app/main.py` модуль обычно должен иметь:

- `FastAPI(...)`;
- `GET /health`;
- `GET /manifest`;
- root endpoint `GET /`;
- свои business endpoints;
- `init_db()` и startup-инициализацию, если есть таблицы.

Типовой manifest должен содержать:

- `name`;
- `bounded_context`;
- `version`;
- `events.subscribes`;
- `events.publishes`;
- `ui.menu`;
- `api.base_url`.

Если модуль участвует в других flow, в `ui` можно добавить дополнительные секции, как это уже сделано у `contacts`, `finance`, `warehouses`.

## 4. Docker Compose

В `docker-compose.yml` для нового модуля нужно добавить:

1. контейнер БД `<module>-db`, если нужен отдельный Postgres;
2. контейнер сервиса `<module>`;
3. volume для БД;
4. `healthcheck`;
5. volume c кодом `./<module>/app:/app/app`.

Рекомендуемый паттерн:

- БД: `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`;
- сервис: `DATABASE_URL=postgresql://...`;
- отдельный внешний порт, если сервис нужен для диагностики;
- `depends_on` c `condition: service_healthy`.

## 5. Gateway

Чтобы UI и внешние клиенты ходили в новый модуль через единый вход, нужно:

1. добавить `*_BASE_URL` в service `gateway` внутри `docker-compose.yml`;
2. добавить зависимость `gateway -> <module>`;
3. в `gateway/app/main.py` объявить `MODULE_URL`;
4. добавить новый proxy route вида:

`@app.api_route("/<module>{rest:path}", methods=["GET", "POST", "PATCH", "PUT", "DELETE"])`

Это обязательный шаг. Без него модуль будет жить в Compose, но UI не сможет обращаться к нему через `/api`.

## 6. Plugin Registry

Чтобы модуль считался подключенным, его нужно зарегистрировать в `plugin-registry`.

Есть два рабочих варианта:

1. self-hosted `GET /manifest` + регистрация через API `plugin-registry`;
2. seed-файл в `plugin-registry/manifests/<module>.json`.

Сейчас в проекте используется и файловый seed, и API-модель. Поэтому для нового модуля безопасно делать оба шага:

- модуль отдает свой `GET /manifest`;
- рядом кладется `plugin-registry/manifests/<module>.json`.

Это дает:

- появление модуля в `/plugins/_meta`;
- возможность включать/выключать модуль;
- назначение доступа пользователям по `module_access`;
- участие модуля в межмодульных связях `/plugins/_links`.

## 7. Права

Права здесь двух уровней.

### 7.1. Видимость модуля

За видимость модуля отвечает `plugin-registry`:

- admin и superadmin видят всё;
- обычным пользователям доступ выдается по записи в `module_access`;
- если модуль не назначен пользователю, он не попадет в меню.

### 7.2. Внутренние права модуля

Сам сервис должен отдельно проверять доступ к своим endpoint-ам:

- через `x-user-uuid`;
- через `x-user-roles`;
- без fallback и без доступа "по умолчанию".

Обычно:

- чтение/создание рабочих записей доступно авторизованному пользователю;
- системные настройки доступны только `admin` / `superadmin`.

## 8. UI и меню

Меню не строится автоматически из manifest.  
Его нужно явно добавить в `ui-shell/src/layout/AppSidebar.tsx`.

Для нового модуля требуется:

1. добавить state-флаг `moduleEnabled`;
2. при загрузке `_meta` проверить `item.name === "<module>"`;
3. добавить блок `dynamicItems.push(...)`;
4. создать страницы в `ui-shell/src/app/(admin)/modules/<module>/...`.

Если нужны пункты:

- `Новая сделка`;
- `Список`;
- `Настройки`;

то под них сразу создаются отдельные `page.tsx`.

## 9. Что брать за шаблон

Рекомендуемые шаблоны:

- `orders` — если нужен полноценный модуль с несколькими экранами и manifest в `main.py`;
- `contacts` — если нужен простой CRUD-модуль;
- `finance` — если нужен компактный модуль с отдельным manifest-файлом;
- `warehouses` — если нужен модуль с access-aware логикой.

## 10. Порядок добавления нового модуля

Практический порядок лучше держать таким:

1. создать папку модуля и минимальные backend-файлы;
2. добавить manifest;
3. подключить сервис и БД в `docker-compose.yml`;
4. подключить proxy в `gateway`;
5. зарегистрировать модуль в `plugin-registry`;
6. добавить пункт меню в `AppSidebar.tsx`;
7. создать UI-страницы;
8. перезапустить только затронутые контейнеры;
9. проверить, что модуль появился в `/plugins/_meta` и в меню.

## 11. Что проверить после добавления

Минимальная проверка:

1. `<module>` container в статусе healthy;
2. `gateway` container в статусе healthy;
3. `GET /manifest` отвечает;
4. `GET /plugins/_meta?enabled_only=false` содержит новый модуль;
5. модуль виден в меню у пользователя с нужными правами;
6. settings endpoint действительно закрыт admin-ролью, если это предусмотрено логикой.

## 12. Перезапуск контейнеров

После правок не нужно перестраивать всю систему.  
Обычно достаточно перезапустить только затронутые контейнеры:

- `<module>-db`, если добавлена новая БД;
- `<module>`;
- `plugin-registry`, если добавлен seed manifest;
- `gateway`, если добавлен новый proxy route;
- `ui-shell`, если менялось меню или страницы.

## 13. Короткая памятка

Новый модуль в этом проекте — это не только новая папка сервиса.  
Его нужно провести через всю цепочку:

- service;
- DB;
- gateway;
- plugin-registry;
- access;
- UI menu;
- UI pages.

Если пропустить хотя бы один из этих слоев, модуль будет добавлен не полностью.
