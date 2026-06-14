const APP_TITLE_SUFFIX = "Городская мастерская";

const EXACT_ROUTE_TITLES: Record<string, string> = {
  "/": "Главная",
  "/profile": "Профиль",
  "/signin": "Вход",
  "/signup": "Регистрация",
  "/error-404": "Страница не найдена",
  "/modules/orders/create": "Создать заказ",
  "/modules/orders/list": "Список заказов",
  "/modules/orders/prices": "Цены",
  "/modules/orders/report/create": "Создать отчет",
  "/modules/orders/report/list": "Список отчетов",
  "/modules/orders/report/settings": "Отчет / Настройки",
  "/modules/orders/supply/create": "Создать заявку",
  "/modules/orders/supply/list": "Список заявок",
  "/modules/orders/supply/settings": "Снабжение / Настройки",
  "/modules/orders/settings/service-category": "Заказы / Категория услуги",
  "/modules/orders/settings/work-types": "Заказы / Виды работ",
  "/modules/orders/settings/service-object": "Заказы / Объект ремонта",
  "/modules/orders/settings/statuses": "Заказы / Статусы",
  "/modules/finance/money": "Учёт денег заказы",
  "/modules/finance/money-skupka": "Учёт денег скупка",
  "/modules/finance/settings": "Бухгалтерия / Настройки",
  "/modules/contacts/list": "Список контактов",
  "/modules/contacts/settings": "Контакты / Настройки",
  "/modules/skupka/new-deal": "Новая сделка",
  "/modules/skupka/list": "Список выкупов",
  "/modules/skupka/settings/categories": "Скупка / Категории",
  "/modules/skupka/settings/purchase-object": "Скупка / Объект покупки",
  "/modules/skupka/settings/statuses": "Скупка / Статусы",
  "/modules/skupka/settings/device-condition": "Скупка / Состояние устройства",
  "/modules/social/vk": "Вконтакте",
  "/modules/social/settings/vk": "Соцсети / Настройки",
  "/modules/warehouses/list": "Склады",
  "/modules/warehouses/settings": "Склады / Настройки",
  "/modules/staff": "Персонал / КПК",
  "/modules/staff/violations": "Персонал / Нарушения",
  "/modules/staff/settings": "Персонал / Настройки",
  "/modules/staff/settings/kpk": "Персонал / Настройки / КПК",
  "/modules/print/create": "Создать форму",
  "/modules/print/list": "Список форм",
  "/modules/print/settings": "Печать / Общие настройки",
  "/modules/print/settings/categories": "Печать / Категории",
  "/modules/ai-memory/insights": "ИИ / Анализ",
  "/modules/ai-memory/settings": "ИИ / Настройки",
  "/modules/users/add": "Пользователи / Добавить",
  "/modules/users/list": "Пользователи / Список",
  "/modules/settings": "Модули / Настройки",
};

const SEGMENT_TITLES: Record<string, string> = {
  modules: "",
  orders: "Заказы",
  create: "Создать",
  list: "Список",
  prices: "Цены",
  report: "Отчет",
  supply: "Снабжение",
  settings: "Настройки",
  "service-category": "Категория услуги",
  "work-types": "Виды работ",
  "service-object": "Объект ремонта",
  statuses: "Статусы",
  finance: "Бухгалтерия",
  money: "Учёт денег",
  "money-skupka": "Учёт денег скупка",
  contacts: "Контакты",
  skupka: "Скупка",
  "new-deal": "Новая сделка",
  categories: "Категории",
  "purchase-object": "Объект покупки",
  "device-condition": "Состояние устройства",
  social: "Соцсети",
  vk: "Вконтакте",
  warehouses: "Склады",
  staff: "Персонал",
  kpk: "КПК",
  print: "Печать",
  "ai-memory": "ИИ",
  insights: "Анализ",
  users: "Пользователи",
  add: "Добавить",
  profile: "Профиль",
  signin: "Вход",
  signup: "Регистрация",
};

function normalizePathname(pathname: string): string {
  const [rawPath] = pathname.split("?");
  const trimmed = rawPath.replace(/\/+$/, "");
  return trimmed || "/";
}

function prettifySegment(segment: string): string {
  const mapped = SEGMENT_TITLES[segment];
  if (mapped !== undefined) return mapped;
  const normalized = segment.replace(/[-_]+/g, " ").trim();
  if (!normalized) return "";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function getPageTitle(pathname: string): string {
  const normalizedPath = normalizePathname(pathname);
  const exactTitle = EXACT_ROUTE_TITLES[normalizedPath];
  if (exactTitle) return exactTitle;

  const parts = normalizedPath
    .split("/")
    .filter(Boolean)
    .map(prettifySegment)
    .filter(Boolean);

  return parts.length ? parts.join(" / ") : "Главная";
}

export function formatDocumentTitle(title: string): string {
  const cleanTitle = title.trim();
  return cleanTitle ? `${cleanTitle} | ${APP_TITLE_SUFFIX}` : APP_TITLE_SUFFIX;
}

export { APP_TITLE_SUFFIX };
