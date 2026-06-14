"use client";
import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import logoPng from "@/app/logo.png";
import meshLogoPng from "@/app/meshlogo.png";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/SidebarContext";
import { getGatewayBaseUrl } from "@/lib/gateway";
import {
  BoxCubeIcon,
  ChevronDownIcon,
  GroupIcon,
  HorizontaLDots,
  PieChartIcon,
  PlugInIcon,
  UserCircleIcon,
} from "../icons/index";

type SubItem = {
  name: string;
  path?: string;
  pro?: boolean;
  new?: boolean;
  children?: SubItem[];
};

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: SubItem[];
  badgeCount?: number;
};

type PluginMeta = {
  name: string;
  enabled: boolean;
};

type AccessCheckResponse = {
  allowed: boolean;
};

function getToken(): string {
  const raw = (window as any).__hubcrmAccessToken;
  if (!raw) return "";
  const token = String(raw).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

function parseJwtPayload(token: string): any {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = payload.length % 4 ? "=".repeat(4 - (payload.length % 4)) : "";
    return JSON.parse(atob(payload + pad));
  } catch {
    return null;
  }
}

function hasAdminAccess(token: string): boolean {
  const payload = parseJwtPayload(token);
  if (!payload) return false;
  const realmRoles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
  if (realmRoles.includes("superadmin") || realmRoles.includes("admin")) return true;
  const resourceAccess = payload?.resource_access || {};
  return Object.values(resourceAccess).some(
    (obj: any) => Array.isArray(obj?.roles) && (obj.roles.includes("superadmin") || obj.roles.includes("admin"))
  );
}

const othersItems: NavItem[] = [];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  const [openSubItemChildren, setOpenSubItemChildren] = useState<Record<string, boolean>>({});
  const [enabledModuleOrder, setEnabledModuleOrder] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [socialNeedsReplyCount, setSocialNeedsReplyCount] = useState(0);

  const navItems = React.useMemo<NavItem[]>(() => {
    const dynamicItems: NavItem[] = [];
    const knownModuleItems: Record<string, NavItem> = {
      orders: {
        name: "Заказы",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Создать заказ", path: "/modules/orders/create" },
          { name: "Список заказов", path: "/modules/orders/list" },
          { name: "Цены", path: "/modules/orders/prices" },
          {
            name: "Отчет",
            children: [
              { name: "Создать отчет", path: "/modules/orders/report/create" },
              { name: "Список отчетов", path: "/modules/orders/report/list" },
              { name: "Настройки", path: "/modules/orders/report/settings" },
            ],
          },
          {
            name: "Снабжение",
            children: [
              { name: "Создать заявку", path: "/modules/orders/supply/create" },
              { name: "Список заявок", path: "/modules/orders/supply/list" },
              { name: "Настройки", path: "/modules/orders/supply/settings" },
            ],
          },
          {
            name: "Настройки",
            children: [
              { name: "Категория услуги", path: "/modules/orders/settings/service-category" },
              { name: "Виды работ", path: "/modules/orders/settings/work-types" },
              { name: "Объект ремонта/услуги", path: "/modules/orders/settings/service-object" },
              { name: "Статусы", path: "/modules/orders/settings/statuses" },
            ],
          },
        ],
      },
      finance: {
        name: "Бухглатерия",
        icon: <PieChartIcon />,
        subItems: [
          { name: "Учёт денег заказы", path: "/modules/finance/money" },
          { name: "Учёт денег скупка", path: "/modules/finance/money-skupka" },
          { name: "Настройки", path: "/modules/finance/settings" },
        ],
      },
      contacts: {
        name: "Контакты",
        icon: <UserCircleIcon />,
        subItems: [
          { name: "Список контактов", path: "/modules/contacts/list" },
          { name: "Настройки", path: "/modules/contacts/settings" },
        ],
      },
      skupka: {
        name: "Скупка",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Новая сделка", path: "/modules/skupka/new-deal" },
          { name: "Список выкупов", path: "/modules/skupka/list" },
          {
            name: "Настройки",
            children: [
              { name: "Категории", path: "/modules/skupka/settings/categories" },
              { name: "Объект покупки", path: "/modules/skupka/settings/purchase-object" },
              { name: "Статусы", path: "/modules/skupka/settings/statuses" },
              { name: "Состояние устройства", path: "/modules/skupka/settings/device-condition" },
            ],
          },
        ],
      },
      social: {
        name: "Соцсети",
        icon: <BoxCubeIcon />,
        badgeCount: socialNeedsReplyCount,
        subItems: [
          { name: "Вконтакте", path: "/modules/social/vk" },
          { name: "Настройки", path: "/modules/social/settings/vk" },
        ],
      },
      warehouses: {
        name: "Склады/Точки",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Склады", path: "/modules/warehouses/list" },
          { name: "Настройки", path: "/modules/warehouses/settings" },
        ],
      },
      staff: {
        name: "Персонал",
        icon: <GroupIcon />,
        subItems: [
          { name: "Посещаемость", path: "/modules/staff/attendance" },
          { name: "Графики смен", path: "/modules/staff/schedules" },
          { name: "Аналитика", path: "/modules/staff/analytics" },
          { name: "КПК", path: "/modules/staff" },
          { name: "Нарушения", path: "/modules/staff/violations" },
          {
            name: "Уведомления",
            children: [
              { name: "Создать уведомление", path: "/modules/staff/notifications/create" },
              { name: "Список уведомлений", path: "/modules/staff/notifications/list" },
            ],
          },
          {
            name: "Настройки",
            children: [
              { name: "Общие", path: "/modules/staff/settings" },
              { name: "КПК", path: "/modules/staff/settings/kpk" },
            ],
          },
        ],
      },
      communications: {
        name: "Новости",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Лента", path: "/modules/communications/news" },
          { name: "Чат", path: "/modules/communications/news#chat" },
        ],
      },
      documents: {
        name: "Печать",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Создать форму", path: "/modules/print/create" },
          { name: "Список форм", path: "/modules/print/list" },
          {
            name: "Настройки",
            children: [
              { name: "Общие", path: "/modules/print/settings" },
              { name: "Категории", path: "/modules/print/settings/categories" },
            ],
          },
        ],
      },
      "ai-memory": {
        name: "ИИ",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Анализ", path: "/modules/ai-memory/insights" },
          { name: "Настройки", path: "/modules/ai-memory/settings" },
        ],
      },
    };
    for (const moduleName of enabledModuleOrder) {
      const nav = knownModuleItems[moduleName];
      if (nav) dynamicItems.push(nav);
    }

    if (canManageUsers) {
      dynamicItems.push({
        name: "Пользователи",
        icon: <GroupIcon />,
        subItems: [
          { name: "Добавить", path: "/modules/users/add" },
          { name: "Список", path: "/modules/users/list" },
        ],
      });
    }

    if (isAdmin) {
      dynamicItems.push({
        name: "Модули",
        icon: <PlugInIcon />,
        subItems: [{ name: "Настройки", path: "/modules/settings" }],
      });
    }

    return dynamicItems;
  }, [enabledModuleOrder, isAdmin, canManageUsers, socialNeedsReplyCount]);

  useEffect(() => {
    let alive = true;

    const loadEnabledModules = async () => {
      try {
        const base = getGatewayBaseUrl();
        const token = getToken();
        setIsAdmin(hasAdminAccess(token));
        const headers = token ? { authorization: `Bearer ${token}` } : {};

        const [metaResp, socialSummaryResp, usersManageResp] = await Promise.all([
          fetch(`${base}/plugins/_meta?enabled_only=true`, { cache: "no-store", headers }).catch((e) => {
            console.error("meta fail", e);
            return null;
          }),
          token
            ? fetch(`${base}/social/vk/inbox-summary`, { cache: "no-store", headers }).catch((e) => null)
            : Promise.resolve(null),
          token
            ? fetch(`${base}/plugins/access/check/users.manage`, { cache: "no-store", headers }).catch((e) => null)
            : Promise.resolve(null),
        ]);

        if (!alive) return;

        if (metaResp && metaResp.ok) {
          const data = (await metaResp.json()) as PluginMeta[];
          if (!alive) return;
          const nextEnabledModuleOrder = (data || []).filter((item) => item.enabled).map((item) => item.name);
          setEnabledModuleOrder(nextEnabledModuleOrder);

          if (socialSummaryResp && socialSummaryResp.ok && nextEnabledModuleOrder.includes("social")) {
            const socialSummary = await socialSummaryResp.json();
            if (alive) {
              setSocialNeedsReplyCount(Number(socialSummary?.needs_reply_count || 0));
            }
          } else {
            setSocialNeedsReplyCount(0);
          }
        }

        if (usersManageResp && usersManageResp.ok) {
          const respData = (await usersManageResp.json()) as AccessCheckResponse;
          if (alive) {
            setCanManageUsers(respData.allowed ?? false);
          }
        } else if (usersManageResp && !usersManageResp.ok) {
          setCanManageUsers(false);
        }

      } catch (err) {
        console.error("loadEnabledModules error:", err);
      }
    };

    void loadEnabledModules();
    const timer = window.setInterval(() => {
      void loadEnabledModules();
    }, 15000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  const renderMenuItems = (
    navItems: NavItem[],
    menuType: "main" | "others"
  ) => (
    <ul className="flex flex-col gap-2">
      {navItems.map((nav, index) => (
        <li key={nav.name}>
          {nav.subItems ? (
            <button
              onClick={() => handleSubmenuToggle(index, menuType)}
              className={`menu-item group  ${
                openSubmenu?.type === menuType && openSubmenu?.index === index
                  ? "menu-item-active"
                  : "menu-item-inactive"
              } cursor-pointer ${
                !isExpanded && !isHovered
                  ? "lg:justify-center"
                  : "lg:justify-start"
              }`}
            >
              <span
                className={` ${
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? "menu-item-icon-active"
                    : "menu-item-icon-inactive"
                } ${nav.badgeCount ? "relative" : ""}`}
              >
                {nav.icon}
                {nav.badgeCount ? (
                  <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-white bg-red-500 dark:border-gray-900" />
                ) : null}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <>
                  <span className={`menu-item-text`}>{nav.name}</span>
                  {nav.badgeCount ? (
                    <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                      {nav.badgeCount > 99 ? "99+" : nav.badgeCount}
                    </span>
                  ) : null}
                </>
              )}
              {(isExpanded || isHovered || isMobileOpen) && (
                <ChevronDownIcon
                  className={`ml-auto w-5 h-5 transition-transform duration-200  ${
                    openSubmenu?.type === menuType &&
                    openSubmenu?.index === index
                      ? "rotate-180 text-brand-500"
                      : ""
                  }`}
                />
              )}
            </button>
          ) : (
            nav.path && (
              <Link
                href={nav.path}
                onClick={(event) => handleMenuLinkClick(event, nav.path)}
                className={`menu-item group ${
                  isActive(nav.path) ? "menu-item-active" : "menu-item-inactive"
                }`}
              >
                <span
                  className={`${
                    isActive(nav.path)
                      ? "menu-item-icon-active"
                      : "menu-item-icon-inactive"
                  }`}
                >
                  {nav.icon}
                </span>
                {(isExpanded || isHovered || isMobileOpen) && (
                  <span className={`menu-item-text`}>{nav.name}</span>
                )}
              </Link>
            )
          )}
          {nav.subItems && (isExpanded || isHovered || isMobileOpen) && (
            <div
              ref={(el) => {
                subMenuRefs.current[`${menuType}-${index}`] = el;
              }}
              className="overflow-hidden transition-all duration-300"
              style={{
                height:
                  openSubmenu?.type === menuType && openSubmenu?.index === index
                    ? `${subMenuHeight[`${menuType}-${index}`]}px`
                    : "0px",
              }}
            >
              <ul
                ref={(el) => {
                  subMenuContentRefs.current[`${menuType}-${index}`] = el;
                }}
                className="mt-2 space-y-1 ml-9"
              >
                {nav.subItems.map((subItem) => (
                  <li key={subItem.name}>
                    {subItem.path ? (
                      <Link
                        href={subItem.path}
                        onClick={(event) => handleMenuLinkClick(event, subItem.path)}
                        className={`menu-dropdown-item ${
                          isActive(subItem.path)
                            ? "menu-dropdown-item-selected"
                            : "menu-dropdown-item-inactive"
                        }`}
                      >
                        {subItem.name}
                        <span className="flex items-center gap-1 ml-auto">
                          {subItem.new && (
                            <span
                              className={`ml-auto ${
                                isActive(subItem.path)
                                  ? "menu-dropdown-badge-active"
                                  : "menu-dropdown-badge-inactive"
                              } menu-dropdown-badge `}
                            >
                              new
                            </span>
                          )}
                          {subItem.pro && (
                            <span
                              className={`ml-auto ${
                                isActive(subItem.path)
                                  ? "menu-dropdown-badge-active"
                                  : "menu-dropdown-badge-inactive"
                              } menu-dropdown-badge `}
                            >
                              pro
                            </span>
                          )}
                        </span>
                      </Link>
                    ) : (
                      subItem.children?.length ? (
                        (() => {
                          const k = `${menuType}-${index}-${subItem.name}`;
                          const isChildGroupOpen = openSubItemChildren[k] ?? true;
                          return (
                            <button
                              type="button"
                              onClick={() => {
                                setOpenSubItemChildren((prev) => ({
                                  ...prev,
                                  [k]: !isChildGroupOpen,
                                }));
                              }}
                              className={`menu-dropdown-item w-full flex items-center ${
                                isChildGroupOpen
                                  ? "menu-dropdown-item-active"
                                  : "menu-dropdown-item-inactive"
                              }`}
                            >
                              {subItem.name}
                              <ChevronDownIcon
                                className={`ml-auto w-4 h-4 transition-transform duration-200 ${
                                  isChildGroupOpen
                                    ? "rotate-180 text-brand-500"
                                    : ""
                                }`}
                              />
                            </button>
                          );
                        })()
                      ) : (
                        <div className="menu-dropdown-item menu-dropdown-item-inactive cursor-default">
                          {subItem.name}
                        </div>
                      )
                    )}
                    {subItem.children?.length ? (
                      (openSubItemChildren[`${menuType}-${index}-${subItem.name}`] ?? true) ? (
                        <ul className="mt-1 space-y-1 ml-4">
                          {subItem.children.map((child) => (
                            <li key={child.name}>
                              {child.path ? (
                                <Link
                                  href={child.path}
                                  onClick={(event) => handleMenuLinkClick(event, child.path!)}
                                  className={`menu-dropdown-item ${
                                    isActive(child.path)
                                      ? "menu-dropdown-item-selected"
                                      : "menu-dropdown-item-inactive"
                                  }`}
                                >
                                  {child.name}
                                </Link>
                              ) : child.children?.length ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const childKey = `${menuType}-${index}-${subItem.name}-${child.name}`;
                                      setOpenSubItemChildren((prev) => ({
                                        ...prev,
                                        [childKey]: !(prev[childKey] ?? true),
                                      }));
                                    }}
                                    className={`menu-dropdown-item w-full flex items-center ${
                                      (openSubItemChildren[`${menuType}-${index}-${subItem.name}-${child.name}`] ?? true)
                                        ? "menu-dropdown-item-active"
                                        : "menu-dropdown-item-inactive"
                                    }`}
                                  >
                                    {child.name}
                                    <ChevronDownIcon
                                      className={`ml-auto w-4 h-4 transition-transform duration-200 ${
                                        (openSubItemChildren[`${menuType}-${index}-${subItem.name}-${child.name}`] ?? true)
                                          ? "rotate-180 text-brand-500"
                                          : ""
                                      }`}
                                    />
                                  </button>
                                  {(openSubItemChildren[`${menuType}-${index}-${subItem.name}-${child.name}`] ?? true) ? (
                                    <ul className="mt-1 space-y-1 ml-4">
                                      {child.children.map((grandChild) => (
                                        <li key={grandChild.name}>
                                          {grandChild.path ? (
                                            <Link
                                              href={grandChild.path}
                                              onClick={(event) => handleMenuLinkClick(event, grandChild.path!)}
                                              className={`menu-dropdown-item ${
                                                isActive(grandChild.path)
                                                  ? "menu-dropdown-item-selected"
                                                  : "menu-dropdown-item-inactive"
                                              }`}
                                            >
                                              {grandChild.name}
                                            </Link>
                                          ) : (
                                            <div className="menu-dropdown-item menu-dropdown-item-inactive cursor-default">
                                              {grandChild.name}
                                            </div>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </>
                              ) : (
                                <div className="menu-dropdown-item menu-dropdown-item-inactive cursor-default">
                                  {child.name}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : null
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </li>
      ))}
    </ul>
  );

  const [openSubmenu, setOpenSubmenu] = useState<{
    type: "main" | "others";
    index: number;
  } | null>(null);
  const [subMenuHeight, setSubMenuHeight] = useState<Record<string, number>>(
    {}
  );
  const subMenuRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const subMenuContentRefs = useRef<Record<string, HTMLUListElement | null>>({});
  const prevPathnameRef = useRef(pathname);

  // const isActive = (path: string) => path === pathname;
   const isActive = useCallback((path: string) => path === pathname, [pathname]);
  const handleMenuLinkClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>, path: string) => {
      if (!isActive(path)) return;
      event.preventDefault();
      window.location.reload();
    },
    [isActive]
  );

  useEffect(() => {
    // Check if the current path matches any submenu item
    let submenuMatched = false;
    ["main", "others"].forEach((menuType) => {
      const items = menuType === "main" ? navItems : othersItems;
      items.forEach((nav, index) => {
        if (nav.subItems) {
          nav.subItems.forEach((subItem) => {
            const hit =
              (subItem.path && isActive(subItem.path)) ||
              subItem.children?.some((c) => isActive(c.path));
            if (hit) {
              setOpenSubmenu({
                type: menuType as "main" | "others",
                index,
              });
              if (subItem.children?.some((c) => isActive(c.path))) {
                const k = `${menuType}-${index}-${subItem.name}`;
                setOpenSubItemChildren((prev) => ({ ...prev, [k]: true }));
              }
              submenuMatched = true;
            }
          });
        }
      });
    });

    // Keep manually opened menus during sidebar polling; only auto-close on real route change.
    if (!submenuMatched && prevPathnameRef.current !== pathname) {
      setOpenSubmenu(null);
    }
    prevPathnameRef.current = pathname;
  }, [pathname, isActive, navItems]);

  useEffect(() => {
    // Set the height of the submenu items when the submenu is opened
    if (openSubmenu !== null) {
      const key = `${openSubmenu.type}-${openSubmenu.index}`;
      if (subMenuContentRefs.current[key]) {
        setSubMenuHeight((prevHeights) => ({
          ...prevHeights,
          [key]: subMenuContentRefs.current[key]?.scrollHeight || 0,
        }));
      }
    }
  }, [openSubmenu, openSubItemChildren]);

  const handleSubmenuToggle = (index: number, menuType: "main" | "others") => {
    setOpenSubmenu((prevOpenSubmenu) => {
      if (
        prevOpenSubmenu &&
        prevOpenSubmenu.type === menuType &&
        prevOpenSubmenu.index === index
      ) {
        return null;
      }
      return { type: menuType, index };
    });
  };

  return (
    <aside
      className={`fixed top-16 bottom-0 flex shrink-0 flex-col lg:sticky lg:top-0 lg:bottom-auto lg:h-screen px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
        ${
          isExpanded || isMobileOpen
            ? "w-[290px]"
            : isHovered
            ? "w-[290px]"
            : "w-[90px]"
        }
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full"}
        lg:translate-x-0`}
      onMouseEnter={() => !isExpanded && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className={`shrink-0 py-6 flex  ${
          !isExpanded && !isHovered ? "lg:justify-center" : "justify-start"
        }`}
      >
        <Link href="/">
          {isExpanded || isHovered || isMobileOpen ? (
            <>
              <Image
                className="dark:hidden"
                src={logoPng}
                alt="Logo"
                width={150}
                height={40}
              />
              <Image
                className="hidden dark:block"
                src={logoPng}
                alt="Logo"
                width={150}
                height={40}
              />
            </>
          ) : (
            <Image
              src="/images/logo/logo-icon.svg"
              alt="Logo"
              width={32}
              height={32}
            />
          )}
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-4">
          <div className="flex flex-col gap-3">
            <div>
              <h2
                className={`mb-2 text-xs uppercase flex leading-[20px] text-gray-400 ${
                  !isExpanded && !isHovered
                    ? "lg:justify-center"
                    : "justify-start"
                }`}
              >
                {isExpanded || isHovered || isMobileOpen ? null : (
                  <HorizontaLDots />
                )}
              </h2>
              {renderMenuItems(navItems, "main")}
            </div>

            <div className="">
              {othersItems.length ? (
                <>
                  <h2
                    className={`mb-2 text-xs uppercase flex leading-[20px] text-gray-400 ${
                      !isExpanded && !isHovered
                        ? "lg:justify-center"
                        : "justify-start"
                    }`}
                  >
                    {isExpanded || isHovered || isMobileOpen ? (
                      "Others"
                    ) : (
                      <HorizontaLDots />
                    )}
                  </h2>
                  {renderMenuItems(othersItems, "others")}
                </>
              ) : null}
            </div>
          </div>
        </nav>
      </div>
      <div
        className={`mt-auto shrink-0 pt-3 pb-4 ${
          isExpanded || isHovered || isMobileOpen ? "flex justify-center" : "hidden lg:flex lg:justify-center"
        }`}
      >
        <Image src={meshLogoPng} alt="Mesh logo" width={144} height={34} className="h-auto w-auto max-w-[144px]" />
      </div>
    </aside>
  );
};

export default AppSidebar;
