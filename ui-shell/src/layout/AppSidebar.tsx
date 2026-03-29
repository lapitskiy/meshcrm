"use client";
import React, { useEffect, useRef, useState,useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import logoPng from "@/app/logo.png";
import { usePathname } from "next/navigation";
import { useSidebar } from "../context/SidebarContext";
import { getGatewayBaseUrl } from "@/lib/gateway";
import {
  BoxCubeIcon,
  ChevronDownIcon,
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
  children?: { name: string; path: string; pro?: boolean; new?: boolean }[];
};

type NavItem = {
  name: string;
  icon: React.ReactNode;
  path?: string;
  subItems?: SubItem[];
};

type PluginMeta = {
  name: string;
  enabled: boolean;
};

const staticNavItems: NavItem[] = [
  {
    name: "Модули",
    icon: <PlugInIcon />,
    subItems: [{ name: "Настройки", path: "/modules/settings" }],
  },
  {
    name: "Маркетплейсы",
    icon: <BoxCubeIcon />,
    subItems: [
      {
        name: "Настройки",
        children: [{ name: "Общие", path: "/modules/marketplaces/settings/common" }],
      },
      {
        name: "Ozon",
        children: [
          { name: "Настройки", path: "/modules/marketplaces/ozon/settings" },
          { name: "Финансы", path: "/modules/marketplaces/ozon/finances" },
          { name: "Акции", path: "/modules/marketplaces/ozon/promotions" },
        ],
      },
      {
        name: "WB",
        children: [{ name: "Настройки", path: "/modules/marketplaces/wb/settings" }],
      },
      {
        name: "Yandex",
        children: [{ name: "Настройки", path: "/modules/marketplaces/yandex/settings" }],
      },
    ],
  },
  {
    name: "МойСклад",
    icon: <BoxCubeIcon />,
    subItems: [{ name: "Настройки", path: "/modules/moysklad/settings" }],
  },
];

const othersItems: NavItem[] = [];

const AppSidebar: React.FC = () => {
  const { isExpanded, isMobileOpen, isHovered, setIsHovered } = useSidebar();
  const pathname = usePathname();
  const [openSubItemChildren, setOpenSubItemChildren] = useState<Record<string, boolean>>({});
  const [ordersEnabled, setOrdersEnabled] = useState(false);
  const [contactsEnabled, setContactsEnabled] = useState(false);
  const [financeEnabled, setFinanceEnabled] = useState(false);
  const [warehousesEnabled, setWarehousesEnabled] = useState(false);

  const navItems = React.useMemo<NavItem[]>(() => {
    const dynamicItems: NavItem[] = [];

    if (ordersEnabled) {
      dynamicItems.push({
        name: "Заказы",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Создать заказ", path: "/modules/orders/create" },
          { name: "Список заказов", path: "/modules/orders/list" },
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
      });
    }

    if (financeEnabled) {
      dynamicItems.push({
        name: "Бухглатерия",
        icon: <PieChartIcon />,
        subItems: [
          { name: "Учёт денег", path: "/modules/finance/money" },
          { name: "Настройки", path: "/modules/finance/settings" },
        ],
      });
    }

    if (contactsEnabled) {
      dynamicItems.push({
        name: "Контакты",
        icon: <UserCircleIcon />,
        subItems: [
          { name: "Список контактов", path: "/modules/contacts/list" },
          { name: "Настройки", path: "/modules/contacts/settings" },
        ],
      });
    }

    if (warehousesEnabled) {
      dynamicItems.push({
        name: "Склады/Точки",
        icon: <BoxCubeIcon />,
        subItems: [
          { name: "Склады", path: "/modules/warehouses/list" },
          { name: "Настройки", path: "/modules/warehouses/settings" },
        ],
      });
    }

    dynamicItems.push({
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
    });

    return [...dynamicItems, ...staticNavItems];
  }, [ordersEnabled, contactsEnabled, financeEnabled, warehousesEnabled]);

  useEffect(() => {
    let alive = true;

    const loadEnabledModules = async () => {
      try {
        const base = getGatewayBaseUrl();
        const resp = await fetch(`${base}/plugins/_meta?enabled_only=true`, { cache: "no-store" });
        if (!resp.ok) {
          throw new Error(`plugins meta failed: ${resp.status}`);
        }
        const data = (await resp.json()) as PluginMeta[];
        if (!alive) return;
        setOrdersEnabled(data.some((item) => item.name === "orders" && item.enabled));
        setContactsEnabled(data.some((item) => item.name === "contacts" && item.enabled));
        setFinanceEnabled(data.some((item) => item.name === "finance" && item.enabled));
        setWarehousesEnabled(data.some((item) => item.name === "warehouses" && item.enabled));
      } catch {
        if (alive) {
          setOrdersEnabled(false);
          setContactsEnabled(false);
          setFinanceEnabled(false);
          setWarehousesEnabled(false);
        }
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
    <ul className="flex flex-col gap-4">
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
                }`}
              >
                {nav.icon}
              </span>
              {(isExpanded || isHovered || isMobileOpen) && (
                <span className={`menu-item-text`}>{nav.name}</span>
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
                        className={`menu-dropdown-item ${
                          isActive(subItem.path)
                            ? "menu-dropdown-item-active"
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
                        <button
                          type="button"
                          onClick={() => {
                            const k = `${menuType}-${index}-${subItem.name}`;
                            setOpenSubItemChildren((prev) => ({
                              ...prev,
                              [k]: !(prev[k] ?? true),
                            }));
                          }}
                          className="menu-dropdown-item menu-dropdown-item-inactive w-full flex items-center"
                        >
                          {subItem.name}
                          <ChevronDownIcon
                            className={`ml-auto w-4 h-4 transition-transform duration-200 ${
                              openSubItemChildren[`${menuType}-${index}-${subItem.name}`] ?? true
                                ? "rotate-180 text-brand-500"
                                : ""
                            }`}
                          />
                        </button>
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
                              <Link
                                href={child.path}
                                className={`menu-dropdown-item ${
                                  isActive(child.path)
                                    ? "menu-dropdown-item-active"
                                    : "menu-dropdown-item-inactive"
                                }`}
                              >
                                {child.name}
                              </Link>
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

  // const isActive = (path: string) => path === pathname;
   const isActive = useCallback((path: string) => path === pathname, [pathname]);

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

    // If no submenu item matches, close the open submenu
    if (!submenuMatched) {
      setOpenSubmenu(null);
    }
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
      className={`fixed mt-16 flex flex-col lg:mt-0 top-0 px-5 left-0 bg-white dark:bg-gray-900 dark:border-gray-800 text-gray-900 h-screen transition-all duration-300 ease-in-out z-50 border-r border-gray-200 
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
        className={`py-8 flex  ${
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
      <div className="flex flex-col overflow-y-auto duration-300 ease-linear no-scrollbar">
        <nav className="mb-6">
          <div className="flex flex-col gap-4">
            <div>
              <h2
                className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
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
                    className={`mb-4 text-xs uppercase flex leading-[20px] text-gray-400 ${
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
    </aside>
  );
};

export default AppSidebar;
