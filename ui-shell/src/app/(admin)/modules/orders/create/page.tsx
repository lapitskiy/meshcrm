"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import { ChevronDownIcon, PlusIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";

type ServiceCategory = {
  id: string;
  name: string;
};

type ServiceCategoryAccessSummary = {
  total_count: number;
  accessible_count: number;
};

type WorkType = {
  id: string;
  name: string;
};

type ServiceObject = {
  id: string;
  name: string;
};

type ModuleLink = {
  source_module: string;
  target_module: string;
  enabled: boolean;
};

type ContactField = {
  key: string;
  label: string;
};

type ContactStepConfig = {
  moduleName: string;
  title: string;
  listEndpoint: string;
  searchEndpoint: string;
  fields: ContactField[];
  pricingByWorkTypes?: boolean;
  warehouseByAccess?: boolean;
};

type ContactRecord = Record<string, any>;

type WarehouseOption = {
  id: string;
  name: string;
};

type WorkTypeRow = {
  key: number;
  selectedId: string;
  query: string;
  label: string;
  options: WorkType[];
  open: boolean;
};

function getToken(): string {
  const raw = (window as any).__hubcrmAccessToken;
  if (!raw) return "";
  const token = String(raw).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

const orderKinds = [
  { id: "onsite", label: "Услуга на месте" },
  { id: "repair", label: "Оставляют в ремонт" },
] as const;

const paidOptions = [
  { id: "yes", label: "Да" },
  { id: "no", label: "Нет" },
] as const;

const defaultContactConfig: ContactStepConfig = {
  moduleName: "",
  title: "",
  listEndpoint: "",
  searchEndpoint: "",
  fields: [],
};

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  let core = digits;
  if (core.startsWith("7")) core = core.slice(1);
  if (core.startsWith("8")) core = core.slice(1);
  core = core.slice(0, 10);
  const p1 = core.slice(0, 3);
  const p2 = core.slice(3, 6);
  const p3 = core.slice(6, 8);
  const p4 = core.slice(8, 10);
  let out = "+7";
  if (p1) out += p1;
  if (p2) out += `-${p2}`;
  if (p3) out += `-${p3}`;
  if (p4) out += `-${p4}`;
  return out;
}

function countPhoneDigits(value: string): number {
  return value.replace(/\D/g, "").length;
}

function phoneDigits(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

export default function OrdersCreatePage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const router = useRouter();
  const workTypesBlockRef = useRef<HTMLDivElement | null>(null);
  const serviceObjectBoxRef = useRef<HTMLDivElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [orderKind, setOrderKind] = useState<string>("");

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoryAccessSummary, setCategoryAccessSummary] = useState<ServiceCategoryAccessSummary>({
    total_count: 0,
    accessible_count: 0,
  });
  const [serviceObjects, setServiceObjects] = useState<ServiceObject[]>([]);

  const [categoryId, setCategoryId] = useState("");
  const [workTypeRows, setWorkTypeRows] = useState<WorkTypeRow[]>([
    { key: 1, selectedId: "", query: "", label: "", options: [], open: false },
  ]);
  const [nextWorkTypeKey, setNextWorkTypeKey] = useState(2);
  const [serviceObjectId, setServiceObjectId] = useState("");
  const [serviceObjectQuery, setServiceObjectQuery] = useState("");
  const [serviceObjectLabel, setServiceObjectLabel] = useState("");
  const [serviceObjectOptionsOpen, setServiceObjectOptionsOpen] = useState(false);
  const [serialModel, setSerialModel] = useState("");
  const [contactsStepOpen, setContactsStepOpen] = useState(false);
  const [contactsBusy, setContactsBusy] = useState(false);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [contactConfig, setContactConfig] = useState<ContactStepConfig>(defaultContactConfig);
  const [relatedModuleConfigs, setRelatedModuleConfigs] = useState<ContactStepConfig[]>([]);
  const [relatedModuleIndex, setRelatedModuleIndex] = useState(0);
  const [moduleFieldValues, setModuleFieldValues] = useState<Record<string, Record<string, string>>>({});
  const [contactHasNoPhone, setContactHasNoPhone] = useState(false);
  const [contactsSearchBusy, setContactsSearchBusy] = useState(false);
  const [warehouseOptions, setWarehouseOptions] = useState<WarehouseOption[]>([]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  function toggleDropdown() {
    setIsOpen((prev) => !prev);
  }

  function closeDropdown() {
    setIsOpen(false);
  }

  const authHeaders = async () => {
    let token = getToken();
    if (!token) {
      try {
        const kc = await getKeycloak();
        try {
          await kc.updateToken(30);
        } catch {
          // If refresh fails, we'll still try with the current token value.
        }
        token = kc.token || "";
        if (token) {
          (window as any).__hubcrmAccessToken = token;
        }
      } catch {
        // Keep empty token; API will return 401 and show a clear error.
      }
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadCategories = async () => {
    const headers = await authHeaders();
    const [categoriesResp, summaryResp] = await Promise.all([
      fetch(`${base}/orders/settings/service-categories/accessible`, {
        cache: "no-store",
        headers,
      }),
      fetch(`${base}/orders/settings/service-categories/accessible-summary`, {
        cache: "no-store",
        headers,
      }),
    ]);
    if (!categoriesResp.ok) {
      const body = await categoriesResp.text().catch(() => "");
      throw new Error(`load categories failed: ${categoriesResp.status} ${body}`);
    }
    if (!summaryResp.ok) {
      const body = await summaryResp.text().catch(() => "");
      throw new Error(`load categories summary failed: ${summaryResp.status} ${body}`);
    }
    setCategories((await categoriesResp.json()) as ServiceCategory[]);
    setCategoryAccessSummary((await summaryResp.json()) as ServiceCategoryAccessSummary);
  };

  const fetchWorkTypeOptions = async (selectedCategoryId: string, q: string): Promise<WorkType[]> => {
    const resp = await fetch(
      `${base}/orders/settings/work-types?service_category_id=${encodeURIComponent(
        selectedCategoryId
      )}&q=${encodeURIComponent(q)}&limit=50`,
      {
        cache: "no-store",
        headers: await authHeaders(),
      }
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load work types failed: ${resp.status} ${body}`);
    }
    return (await resp.json()) as WorkType[];
  };

  const loadServiceObjects = async (selectedCategoryId: string, q: string) => {
    const resp = await fetch(
      `${base}/orders/settings/service-objects?service_category_id=${encodeURIComponent(
        selectedCategoryId
      )}&q=${encodeURIComponent(q)}&limit=50`,
      {
        cache: "no-store",
        headers: await authHeaders(),
      }
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load service objects failed: ${resp.status} ${body}`);
    }
    setServiceObjects((await resp.json()) as ServiceObject[]);
  };

  const resetWorkTypeRows = () => {
    setWorkTypeRows([{ key: 1, selectedId: "", query: "", label: "", options: [], open: false }]);
    setNextWorkTypeKey(2);
  };

  const closeAllWorkTypeDropdowns = () => {
    setWorkTypeRows((prev) => prev.map((row) => ({ ...row, open: false })));
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (workTypesBlockRef.current && !workTypesBlockRef.current.contains(event.target as Node)) {
        closeAllWorkTypeDropdowns();
      }
      if (serviceObjectBoxRef.current && !serviceObjectBoxRef.current.contains(event.target as Node)) {
        setServiceObjectOptionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadCategories();
      } catch (e: any) {
        setError(e?.message || "failed to load categories");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!orderKind) return;
    if (categoryId) return;
    if (categories.length === 1) {
      onSelectCategory(categories[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderKind, categories, categoryId]);

  const onSelectOrderKind = (kindId: string) => {
    setOrderKind(kindId);
    setCategoryId("");
    resetWorkTypeRows();
    setServiceObjectId("");
    setServiceObjectQuery("");
    setServiceObjectLabel("");
    setServiceObjectOptionsOpen(false);
    setSerialModel("");
    setServiceObjects([]);
    setContactsStepOpen(false);
    setContacts([]);
    setSelectedContactId("");
    setContactConfig(defaultContactConfig);
    setRelatedModuleConfigs([]);
    setRelatedModuleIndex(0);
    setModuleFieldValues({});
    setContactHasNoPhone(false);
    closeDropdown();
  };

  const onSelectCategory = (nextCategoryId: string) => {
    setCategoryId(nextCategoryId);
    resetWorkTypeRows();
    setServiceObjectId("");
    setServiceObjectQuery("");
    setServiceObjectLabel("");
    setServiceObjectOptionsOpen(false);
    setSerialModel("");
    setServiceObjects([]);
    setContactsStepOpen(false);
    setContacts([]);
    setSelectedContactId("");
    setContactConfig(defaultContactConfig);
    setRelatedModuleConfigs([]);
    setRelatedModuleIndex(0);
    setModuleFieldValues({});
    setContactHasNoPhone(false);
    setError(null);
  };

  const hasNoCategoryAccess = orderKind && categories.length === 0 && categoryAccessSummary.total_count > 0;

  const onSelectWorkType = (rowKey: number, item: WorkType) => {
    const alreadySelected = workTypeRows.some((r) => r.key !== rowKey && r.selectedId === item.id);
    if (alreadySelected) return;
    setWorkTypeRows((prev) =>
      prev.map((row) =>
        row.key === rowKey
          ? { ...row, selectedId: item.id, query: item.name, label: item.name, open: false }
          : row
      )
    );
    setError(null);
  };

  const onChangeWorkTypeQuery = async (rowKey: number, value: string) => {
    setWorkTypeRows((prev) =>
      prev.map((row) =>
        row.key === rowKey ? { ...row, query: value, selectedId: "", label: "", open: false } : row
      )
    );
    if (!categoryId) return;
    setError(null);
    try {
      const options = await fetchWorkTypeOptions(categoryId, value);
      setWorkTypeRows((prev) =>
        prev.map((row) => (row.key === rowKey ? { ...row, options, open: true } : row))
      );
    } catch (e: any) {
      setError(e?.message || "failed to load work types");
    }
  };

  const onFocusWorkTypeInput = async (rowKey: number) => {
    if (!categoryId) return;
    const row = workTypeRows.find((x) => x.key === rowKey);
    const q = row?.query || "";
    setError(null);
    try {
      const options = await fetchWorkTypeOptions(categoryId, q);
      setWorkTypeRows((prev) =>
        prev.map((item) => ({
          ...item,
          options: item.key === rowKey ? options : item.options,
          open: item.key === rowKey,
        }))
      );
    } catch (e: any) {
      setError(e?.message || "failed to load work types");
    }
  };

  const onAddWorkTypeRow = () => {
    setWorkTypeRows((prev) => [
      ...prev,
      { key: nextWorkTypeKey, selectedId: "", query: "", label: "", options: [], open: false },
    ]);
    setNextWorkTypeKey((prev) => prev + 1);
  };

  const onRemoveWorkTypeRow = (rowKey: number) => {
    setWorkTypeRows((prev) => {
      const next = prev.filter((row) => row.key !== rowKey);
      if (!next.length) {
        return [{ key: 1, selectedId: "", query: "", label: "", options: [], open: false }];
      }
      return next;
    });
  };

  const onClearWorkTypeRow = (rowKey: number) => {
    const targetRow = workTypeRows.find((row) => row.key === rowKey);
    if (!targetRow) return;
    if (!targetRow.query && workTypeRows.length > 1) {
      onRemoveWorkTypeRow(rowKey);
      setContactsStepOpen(false);
      setContacts([]);
      setSelectedContactId("");
      setContactConfig(defaultContactConfig);
      setRelatedModuleConfigs([]);
      setRelatedModuleIndex(0);
      setModuleFieldValues({});
      setContactHasNoPhone(false);
      setWarehouseOptions([]);
      setError(null);
      return;
    }
    setWorkTypeRows((prev) =>
      prev.map((row) =>
        row.key === rowKey ? { ...row, selectedId: "", query: "", label: "", options: [], open: false } : row
      )
    );
    setContactsStepOpen(false);
    setContacts([]);
    setSelectedContactId("");
    setContactConfig(defaultContactConfig);
    setRelatedModuleConfigs([]);
    setRelatedModuleIndex(0);
    setModuleFieldValues({});
    setContactHasNoPhone(false);
    setWarehouseOptions([]);
    setError(null);
  };

  const onSelectServiceObject = (item: ServiceObject) => {
    setServiceObjectId(item.id);
    setServiceObjectQuery(item.name);
    setServiceObjectLabel(item.name);
    setServiceObjectOptionsOpen(false);
  };

  const onClearServiceObject = () => {
    setServiceObjectId("");
    setServiceObjectQuery("");
    setServiceObjectLabel("");
    setServiceObjectOptionsOpen(false);
    setServiceObjects([]);
    resetWorkTypeRows();
    setContactsStepOpen(false);
    setContacts([]);
    setSelectedContactId("");
    setContactConfig(defaultContactConfig);
    setRelatedModuleConfigs([]);
    setRelatedModuleIndex(0);
    setModuleFieldValues({});
    setContactHasNoPhone(false);
    setWarehouseOptions([]);
    setError(null);
  };

  const onChangeServiceObjectQuery = async (value: string) => {
    setServiceObjectQuery(value);
    setServiceObjectId("");
    setServiceObjectLabel("");
    if (!categoryId) return;
    setError(null);
    try {
      await loadServiceObjects(categoryId, value);
      setServiceObjectOptionsOpen(true);
    } catch (e: any) {
      setError(e?.message || "failed to load service objects");
    }
  };

  const selectedWorkTypeLabels = workTypeRows.filter((row) => row.selectedId).map((row) => row.label);
  const selectedWorkTypes = workTypeRows
    .filter((row) => row.selectedId)
    .map((row) => ({ id: row.selectedId, label: row.label }));
  const hasSelectedWorkTypes = selectedWorkTypeLabels.length > 0;
  const currentModuleValues = moduleFieldValues[contactConfig.moduleName] || {};
  const currentPhoneValue = currentModuleValues.phone || "+7";
  const isPricingByWorkTypesReady = (values: Record<string, any>) => {
    if (!values.is_paid) return false;
    return selectedWorkTypes.some((wt) => String(values[`amount:${wt.id}`] || "").trim().length > 0);
  };
  const canGoNextRelatedModule =
    !contactConfig.pricingByWorkTypes || isPricingByWorkTypesReady(currentModuleValues);

  const onNextToContacts = async () => {
    if (!hasSelectedWorkTypes) return;
    setContactsBusy(true);
    setError(null);
    try {
      const linksResp = await fetch(`${base}/plugins/_links?enabled_only=true`, {
        cache: "no-store",
        headers: await authHeaders(),
      });
      if (!linksResp.ok) {
        const body = await linksResp.text().catch(() => "");
        throw new Error(`links load failed: ${linksResp.status} ${body}`);
      }

      const linksData = (await linksResp.json()) as ModuleLink[];
      const linkedTargets = linksData
        .filter((l) => l.source_module === "orders" && l.enabled && !!l.target_module)
        .map((l) => l.target_module);

      if (!linkedTargets.length) {
        throw new Error("Нет активных связей вида orders -> <module>. Включите связи в Настройки модулей.");
      }

      const resolvedConfigs: ContactStepConfig[] = [];
      for (const moduleName of linkedTargets) {
        const moduleResp = await fetch(`${base}/plugins/${encodeURIComponent(moduleName)}`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!moduleResp.ok) continue;

        const manifest = await moduleResp.json();
        const cfg = manifest?.ui?.order_create;
        const listEndpoint =
          typeof cfg?.list_endpoint === "string" && cfg.list_endpoint.startsWith("/") ? cfg.list_endpoint : "";
        const searchEndpointRaw =
          typeof cfg?.search_endpoint === "string" && cfg.search_endpoint.startsWith("/")
            ? cfg.search_endpoint
            : "";
        const searchEndpoint = searchEndpointRaw || (listEndpoint ? `${listEndpoint}/search` : "");
        const fields = Array.isArray(cfg?.display_fields)
          ? cfg.display_fields
              .filter((x: any) => typeof x?.key === "string" && typeof x?.label === "string")
              .map((x: any) => ({ key: x.key, label: x.label }))
          : [];
        const pricingByWorkTypes = cfg?.pricing_by_work_types === true;
        const warehouseByAccess = cfg?.warehouse_by_access === true;
        if (!pricingByWorkTypes && !warehouseByAccess && !fields.length) {
          continue;
        }
        if (warehouseByAccess && !listEndpoint) {
          continue;
        }
        resolvedConfigs.push({
          moduleName,
          title: typeof cfg?.title === "string" && cfg.title.trim() ? cfg.title : moduleName,
          listEndpoint,
          searchEndpoint,
          fields,
          pricingByWorkTypes,
          warehouseByAccess,
        });
      }

      if (!resolvedConfigs.length) {
        throw new Error(
          "У подключенных модулей нет валидного manifest.ui.order_create"
        );
      }

      const initialValues: Record<string, Record<string, string>> = {};
      for (const cfg of resolvedConfigs) {
        initialValues[cfg.moduleName] = {};
        if (cfg.pricingByWorkTypes) {
          initialValues[cfg.moduleName]["is_paid"] = "";
          for (const wt of selectedWorkTypes) {
            initialValues[cfg.moduleName][`amount:${wt.id}`] = "";
          }
        } else if (cfg.warehouseByAccess) {
          initialValues[cfg.moduleName]["warehouse_id"] = "";
        } else {
          for (const f of cfg.fields) {
            initialValues[cfg.moduleName][f.key] = f.key === "phone" ? "+7" : "";
          }
        }
      }

      setRelatedModuleConfigs(resolvedConfigs);
      setRelatedModuleIndex(0);
      setContactConfig(resolvedConfigs[0]);
      setModuleFieldValues(initialValues);
      setContacts([]);
      setSelectedContactId("");
      setContactHasNoPhone(false);
      setWarehouseOptions([]);
      setContactsStepOpen(true);
    } catch (e: any) {
      setError(e?.message || "failed to open contacts step");
      setContactsStepOpen(false);
    } finally {
      setContactsBusy(false);
    }
  };

  const onChangeModuleField = (fieldKey: string, value: string) => {
    const moduleName = contactConfig.moduleName;
    if (!moduleName) return;
    setModuleFieldValues((prev) => ({
      ...prev,
      [moduleName]: {
        ...(prev[moduleName] || {}),
        [fieldKey]: value,
      },
    }));
    if (fieldKey === "phone" || fieldKey === "name") {
      setSelectedContactId("");
    }
  };

  const onNextRelatedModule = () => {
    if (relatedModuleIndex >= relatedModuleConfigs.length - 1) return;
    if (!canGoNextRelatedModule) return;
    const nextIndex = relatedModuleIndex + 1;
    const nextConfig = relatedModuleConfigs[nextIndex];
    setRelatedModuleIndex(nextIndex);
    setContactConfig(nextConfig);
    setContacts([]);
    setSelectedContactId("");
    setContactHasNoPhone(false);
    setWarehouseOptions([]);
  };

  const canCreateOrder = () => {
    if (!orderKind || !categoryId || !serviceObjectId || !hasSelectedWorkTypes) return false;
    if (!contactsStepOpen) return false;
    if (hasNextRelatedModule) return false;
    for (const cfg of relatedModuleConfigs) {
      const values = moduleFieldValues[cfg.moduleName] || {};
      if (cfg.pricingByWorkTypes) {
        if (!isPricingByWorkTypesReady(values)) return false;
      }
      if (cfg.warehouseByAccess && !values.warehouse_id) return false;
    }
    return true;
  };

  const onCreateOrder = async () => {
    if (!canCreateOrder()) return;
    setCreateBusy(true);
    setCreateSuccess(null);
    setError(null);
    try {
      let contactUuid = "";
      const contactsCfg = relatedModuleConfigs.find((cfg) => cfg.moduleName === "contacts");
      if (contactsCfg) {
        const contactValues = moduleFieldValues[contactsCfg.moduleName] || {};
        if (selectedContactId) {
          contactUuid = selectedContactId;
        } else {
          const name = String(contactValues.name || "").trim();
          const phone = String(contactValues.phone || "").trim();
          if (name && phone && phone !== "+7" && contactsCfg.listEndpoint) {
            const createContactResp = await fetch(`${base}${contactsCfg.listEndpoint}`, {
              method: "POST",
              headers: { "content-type": "application/json", ...(await authHeaders()) },
              body: JSON.stringify({ name, phone }),
            });
            if (!createContactResp.ok) {
              const body = await createContactResp.text().catch(() => "");
              const isDuplicatePhone =
                createContactResp.status === 400 &&
                (body.includes("uq_contacts_phone") || body.toLowerCase().includes("duplicate key value"));
              if (isDuplicatePhone) {
                const fallbackSearchEndpoint = contactsCfg.searchEndpoint || `${contactsCfg.listEndpoint}/search`;
                const searchResp = await fetch(
                  `${base}${fallbackSearchEndpoint}?phone=${encodeURIComponent(phone)}&limit=20`,
                  { cache: "no-store", headers: await authHeaders() },
                );
                if (!searchResp.ok) {
                  const searchBody = await searchResp.text().catch(() => "");
                  throw new Error(`contacts search after duplicate failed: ${searchResp.status} ${searchBody}`);
                }
                const existingList = (await searchResp.json()) as ContactRecord[];
                const targetDigits = phoneDigits(phone);
                const exact = existingList.find((c) => phoneDigits(String(c.phone || "")) === targetDigits);
                const first = existingList[0];
                const pickedId = String((exact || first || {}).id || "");
                if (!pickedId) {
                  throw new Error("contacts create duplicate detected, but existing contact not found");
                }
                contactUuid = pickedId;
              } else {
                throw new Error(`contacts create failed: ${createContactResp.status} ${body}`);
              }
            } else {
              const createdContact = (await createContactResp.json()) as { id: string };
              contactUuid = String(createdContact.id || "");
            }
          }
        }
      }

      const warehouseCfg = relatedModuleConfigs.find((cfg) => cfg.warehouseByAccess);
      const warehouseId = warehouseCfg ? moduleFieldValues[warehouseCfg.moduleName]?.warehouse_id || "" : "";

      const orderPayload = {
        order_kind: orderKind,
        service_category_id: categoryId || null,
        service_object_id: serviceObjectId || null,
        serial_model: serialModel || "",
        work_type_ids: selectedWorkTypes.map((x) => x.id),
        warehouse_id: warehouseId || null,
        contact_uuid: contactUuid || null,
        related_modules: moduleFieldValues,
      };

      const createOrderResp = await fetch(`${base}/orders/orders`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeaders()) },
        body: JSON.stringify(orderPayload),
      });
      if (!createOrderResp.ok) {
        const body = await createOrderResp.text().catch(() => "");
        throw new Error(`order create failed: ${createOrderResp.status} ${body}`);
      }
      const createdOrder = (await createOrderResp.json()) as { id: string };
      const orderUuid = String(createdOrder.id || "");
      if (!orderUuid) {
        throw new Error("order create failed: missing order uuid");
      }

      const financeCfg = relatedModuleConfigs.find((cfg) => cfg.pricingByWorkTypes);
      if (financeCfg) {
        const financeValues = moduleFieldValues[financeCfg.moduleName] || {};
        const isPaid = financeValues.is_paid === "yes";
        if (financeValues.is_paid === "yes" || financeValues.is_paid === "no") {
          for (const wt of selectedWorkTypes) {
            const amountRaw = String(financeValues[`amount:${wt.id}`] || "").replace(",", ".").trim();
            if (!amountRaw) continue;
            const amountNum = Number(amountRaw);
            if (!Number.isFinite(amountNum)) {
              throw new Error(`finance amount invalid for work type: ${wt.label}`);
            }
            const financeResp = await fetch(`${base}/finance/finance/order-lines`, {
              method: "PUT",
              headers: { "content-type": "application/json", ...(await authHeaders()) },
              body: JSON.stringify({
                order_uuid: orderUuid,
                work_type_uuid: wt.id,
                amount: amountNum,
                payment_method: null,
                is_paid: isPaid,
              }),
            });
            if (!financeResp.ok) {
              const body = await financeResp.text().catch(() => "");
              throw new Error(`finance save failed: ${financeResp.status} ${body}`);
            }
          }
        }
      }

      router.push(`/modules/orders/list?open_order_id=${encodeURIComponent(orderUuid)}`);
      return;
    } catch (e: any) {
      setError(e?.message || "failed to create order");
    } finally {
      setCreateBusy(false);
    }
  };

  useEffect(() => {
    if (!contactsStepOpen) return;
    if (contactConfig.warehouseByAccess) {
      setContacts([]);
      setContactsSearchBusy(false);
      return;
    }
    const hasPhoneField = !contactConfig.pricingByWorkTypes && contactConfig.fields.some((f) => f.key === "phone");
    if (!hasPhoneField || !contactConfig.searchEndpoint) {
      setContacts([]);
      setContactsSearchBusy(false);
      return;
    }
    if (contactHasNoPhone) {
      setContacts([]);
      setContactsSearchBusy(false);
      return;
    }
    const digitsCount = countPhoneDigits(currentPhoneValue);
    if (digitsCount < 4) {
      setContacts([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setContactsSearchBusy(true);
      setError(null);
      try {
        const resp = await fetch(
          `${base}${contactConfig.searchEndpoint}?phone=${encodeURIComponent(currentPhoneValue)}&limit=20`,
          {
            cache: "no-store",
            headers: await authHeaders(),
          }
        );
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`contacts search failed: ${resp.status} ${body}`);
        }
        setContacts((await resp.json()) as ContactRecord[]);
      } catch (e: any) {
        setError(e?.message || "failed to search contacts");
        setContacts([]);
      } finally {
        setContactsSearchBusy(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactsStepOpen, currentPhoneValue, contactConfig.searchEndpoint, contactConfig.fields, contactHasNoPhone, base]);

  useEffect(() => {
    if (!contactsStepOpen) return;
    if (!contactConfig.warehouseByAccess) return;
    if (!contactConfig.listEndpoint) {
      setError("Для шага Склады не задан list_endpoint в manifest");
      setWarehouseOptions([]);
      return;
    }
    (async () => {
      setError(null);
      try {
        const resp = await fetch(`${base}${contactConfig.listEndpoint}`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`warehouses load failed: ${resp.status} ${body}`);
        }
        setWarehouseOptions((await resp.json()) as WarehouseOption[]);
      } catch (e: any) {
        setError(e?.message || "failed to load warehouses");
        setWarehouseOptions([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactsStepOpen, contactConfig.moduleName, contactConfig.warehouseByAccess, contactConfig.listEndpoint, base]);

  useEffect(() => {
    if (!contactConfig.warehouseByAccess) return;
    const currentWarehouseId = currentModuleValues["warehouse_id"] || "";
    if (!currentWarehouseId) return;
    const exists = warehouseOptions.some((w) => w.id === currentWarehouseId);
    if (!exists) {
      onChangeModuleField("warehouse_id", "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouseOptions, contactConfig.moduleName, contactConfig.warehouseByAccess]);

  useEffect(() => {
    if (!contactsStepOpen) return;
    if (!contactConfig.warehouseByAccess) return;
    const currentWarehouseId = currentModuleValues["warehouse_id"] || "";
    if (currentWarehouseId) return;
    if (warehouseOptions.length === 1) {
      onChangeModuleField("warehouse_id", warehouseOptions[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactsStepOpen, warehouseOptions, contactConfig.moduleName, contactConfig.warehouseByAccess]);

  const onPickContact = (contact: ContactRecord) => {
    setSelectedContactId(String(contact.id));
    const moduleName = contactConfig.moduleName;
    if (!moduleName) return;
    setModuleFieldValues((prev) => {
      const nextModuleValues = { ...(prev[moduleName] || {}) };
      for (const f of contactConfig.fields) {
        const raw = contact?.[f.key];
        nextModuleValues[f.key] = typeof raw === "string" ? raw : String(raw ?? "");
      }
      return { ...prev, [moduleName]: nextModuleValues };
    });
  };

  const currentHasPhoneField = !contactConfig.pricingByWorkTypes && contactConfig.fields.some((f) => f.key === "phone");
  const hasNextRelatedModule = relatedModuleIndex < relatedModuleConfigs.length - 1;
  const relatedModulesSummary = relatedModuleConfigs
    .map((cfg) => {
      const values = moduleFieldValues[cfg.moduleName] || {};
      const filled = cfg.pricingByWorkTypes
        ? [
            `Оплачен заказ: ${paidOptions.find((p) => p.id === values.is_paid)?.label || "-"}`,
            ...selectedWorkTypes.map((wt) => `${wt.label}: ${String(values[`amount:${wt.id}`] || "-")}`),
          ].join(", ")
        : cfg.warehouseByAccess
        ? `Склад: ${
            warehouseOptions.find((w) => w.id === values["warehouse_id"])?.name ||
            values["warehouse_id"] ||
            "-"
          }`
        : cfg.fields.map((f) => `${f.label}: ${String(values[f.key] || "-")}`).join(", ");
      return `${cfg.title || cfg.moduleName} (${filled})`;
    })
    .join(" | ");

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Создание заказа</h3>

        <div className="space-y-5">
          <div>
            <Label>Тип заказа</Label>
            <div className="relative inline-block">
              <Button size="md" onClick={toggleDropdown} className="dropdown-toggle w-[250px] justify-between">
                {orderKinds.find((x) => x.id === orderKind)?.label || "Выберите тип"}
                <ChevronDownIcon />
              </Button>
              <Dropdown isOpen={isOpen} onClose={closeDropdown} className="left-0 right-auto w-[250px] p-2">
                {orderKinds.map((kind) => (
                  <DropdownItem
                    key={kind.id}
                    onClick={() => onSelectOrderKind(kind.id)}
                    onItemClick={closeDropdown}
                    className="flex w-full rounded-lg text-left font-normal text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
                  >
                    {kind.label}
                  </DropdownItem>
                ))}
              </Dropdown>
            </div>
          </div>

          {orderKind && (
            <div>
              <Label>Категория услуг</Label>
              <select
                value={categoryId}
                onChange={(e) => void onSelectCategory(e.target.value)}
                disabled={categories.length === 0}
                className="h-11 w-[250px] max-w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">Выберите категорию</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              {hasNoCategoryAccess ? (
                <div className="mt-2 text-sm text-red-600">
                  Нет доступа ни к одной из категорий услуг, обратитесь к администратору.
                </div>
              ) : null}
            </div>
          )}

          {categoryId && (
            <div>
              <div className="space-y-4">
                <div>
                  <Label>Объект ремонта услуги</Label>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="relative w-[250px] max-w-full" ref={serviceObjectBoxRef}>
                    <input
                      value={serviceObjectQuery}
                      onChange={(e) => void onChangeServiceObjectQuery(e.target.value)}
                      onFocus={async () => {
                        if (!categoryId) return;
                        setError(null);
                        try {
                          await loadServiceObjects(categoryId, serviceObjectQuery);
                          setServiceObjectOptionsOpen(true);
                        } catch (e: any) {
                          setError(e?.message || "failed to load service objects");
                        }
                      }}
                      placeholder="Введите объект ремонта для поиска"
                      className="h-11 w-[250px] max-w-full rounded-lg border border-gray-300 px-4 pr-10 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                    />
                    {serviceObjectQuery ? (
                      <button
                        type="button"
                        onClick={onClearServiceObject}
                        className="absolute right-3 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-200"
                        aria-label="Очистить объект ремонта"
                        title="Очистить"
                      >
                        <span className="text-base leading-none">&times;</span>
                      </button>
                    ) : null}
                    {serviceObjectOptionsOpen && (
                      <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 max-h-56 overflow-auto">
                        {!serviceObjects.length ? (
                          <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Ничего не найдено</div>
                        ) : (
                          serviceObjects.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => onSelectServiceObject(item)}
                              className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                            >
                              {item.name}
                            </button>
                          ))
                        )}
                      </div>
                    )}
                    </div>
                    <a
                      href="/modules/orders/settings/service-object"
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10"
                      title="Добавить объект ремонта"
                      aria-label="Добавить объект ремонта"
                    >
                      <PlusIcon className="h-4 w-4" />
                    </a>
                  </div>
                </div>
                <div className="w-[250px] max-w-full">
                  <Label>Серийный/Модель:</Label>
                  <Input
                    name="order-serial-model"
                    value={serialModel}
                    onChange={(e: any) => setSerialModel(e.target.value)}
                    placeholder="Например: iPhone 12, SN123456789"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="w-[250px]"
                  />
                </div>
              </div>
            </div>
          )}

          {categoryId && serviceObjectId && (
            <div>
              <Label>Вид работы</Label>
              <div ref={workTypesBlockRef} className="space-y-3">
                {workTypeRows.map((row, index) => {
                  const selectedIdsExceptCurrent = new Set(
                    workTypeRows.filter((x) => x.key !== row.key && x.selectedId).map((x) => x.selectedId)
                  );
                  const visibleOptions = row.options.filter((item) => !selectedIdsExceptCurrent.has(item.id));
                  return (
                    <div key={row.key} className="relative">
                      <div className="mt-1 flex items-center gap-2">
                        <div className="relative w-[250px] max-w-full">
                          <input
                            value={row.query}
                            onChange={(e) => void onChangeWorkTypeQuery(row.key, e.target.value)}
                            onFocus={() => void onFocusWorkTypeInput(row.key)}
                            placeholder={`Введите вид работы${index ? ` #${index + 1}` : ""}`}
                            className="h-11 w-[250px] max-w-full rounded-lg border border-gray-300 px-4 pr-10 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                          />
                          {(row.query || workTypeRows.length > 1) ? (
                            <button
                              type="button"
                              onClick={() => onClearWorkTypeRow(row.key)}
                              className="absolute right-3 top-1/2 z-10 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-white/10 dark:hover:text-gray-200"
                              aria-label="Очистить вид работы"
                              title="Очистить"
                            >
                              <span className="text-base leading-none">&times;</span>
                            </button>
                          ) : null}
                        </div>
                        <a
                          href="/modules/orders/settings/work-types"
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10"
                          title="Добавить вид работы"
                          aria-label="Добавить вид работы"
                        >
                          <PlusIcon className="h-4 w-4" />
                        </a>
                        {workTypeRows.length > 1 && (
                          <Button size="sm" variant="outline" onClick={() => onRemoveWorkTypeRow(row.key)}>
                            -
                          </Button>
                        )}
                      </div>
                      {row.open && (
                        <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 max-h-56 overflow-auto">
                          {!visibleOptions.length ? (
                            <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Ничего не найдено</div>
                          ) : (
                            visibleOptions.map((item) => (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => onSelectWorkType(row.key, item)}
                                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                              >
                                {item.name}
                              </button>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div>
                  <Button size="sm" variant="outline" onClick={onAddWorkTypeRow}>
                    + Добавить еще вид работы
                  </Button>
                </div>
              </div>
            </div>
          )}

          {hasSelectedWorkTypes && !contactsStepOpen && (
            <div>
              <Button size="sm" disabled={contactsBusy} onClick={onNextToContacts}>
                Далее
              </Button>
            </div>
          )}

          {contactsStepOpen && (
            <div className="space-y-3">
              {relatedModuleConfigs.slice(0, relatedModuleIndex).map((cfg) => {
                const values = moduleFieldValues[cfg.moduleName] || {};
                return (
                  <div key={cfg.moduleName} className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
                    <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">{cfg.title}</h4>
                    {cfg.pricingByWorkTypes ? (
                      <div className="space-y-2">
                        <div className="text-sm">
                          <span className="text-gray-500 dark:text-gray-400">Оплачен заказ: </span>
                          <span className="text-gray-800 dark:text-white/90">
                            {paidOptions.find((p) => p.id === values.is_paid)?.label || "-"}
                          </span>
                        </div>
                        {selectedWorkTypes.map((wt) => (
                          <div key={wt.id} className="text-sm">
                            <span className="text-gray-500 dark:text-gray-400">{wt.label}: </span>
                            <span className="text-gray-800 dark:text-white/90">
                              {String(values[`amount:${wt.id}`] || "-")}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : cfg.warehouseByAccess ? (
                      <div className="text-sm">
                        <span className="text-gray-500 dark:text-gray-400">Склад: </span>
                        <span className="text-gray-800 dark:text-white/90">
                          {warehouseOptions.find((w) => w.id === values["warehouse_id"])?.name ||
                            values["warehouse_id"] ||
                            "-"}
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {cfg.fields.map((f) => (
                          <div key={f.key} className="text-sm">
                            <span className="text-gray-500 dark:text-gray-400">{f.label}: </span>
                            <span className="text-gray-800 dark:text-white/90">{String(values[f.key] || "-")}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
                <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">{contactConfig.title}</h4>
                {contactConfig.pricingByWorkTypes ? (
                  <div className="space-y-3 mb-3">
                    <div>
                      <Label>Оплачен заказ</Label>
                      <ul className="mt-2 inline-flex overflow-hidden rounded-lg border border-gray-300 text-sm font-medium text-gray-800 dark:border-gray-700 dark:text-white/90">
                        {paidOptions.map((opt, index) => (
                          <li
                            key={opt.id}
                            className={`w-[125px] ${index > 0 ? "border-l border-gray-300 dark:border-gray-700" : ""}`}
                          >
                            <label
                              htmlFor={`finance-is-paid-${contactConfig.moduleName}-${opt.id}`}
                              className={`flex cursor-pointer items-center px-3 py-3 ${
                                currentModuleValues.is_paid === opt.id ? "bg-brand-50 dark:bg-brand-500/10" : ""
                              }`}
                            >
                              <input
                                id={`finance-is-paid-${contactConfig.moduleName}-${opt.id}`}
                                type="radio"
                                name={`finance-is-paid-${contactConfig.moduleName}`}
                                value={opt.id}
                                checked={currentModuleValues.is_paid === opt.id}
                                onChange={(e) => onChangeModuleField("is_paid", e.target.value)}
                                className="h-4 w-4 border border-gray-300 text-brand-500 focus:ring-2 focus:ring-brand-300 dark:border-gray-700 dark:bg-gray-900"
                              />
                              <span className="ml-2 select-none">{opt.label}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {!!currentModuleValues.is_paid && (
                      <div className="space-y-3">
                        {selectedWorkTypes.map((wt) => (
                          <div key={wt.id} className="flex items-center gap-3">
                            <div className="w-[250px] text-sm text-gray-800 dark:text-white/90">{wt.label}</div>
                            <Input
                              value={currentModuleValues[`amount:${wt.id}`] || ""}
                              onChange={(e: any) => onChangeModuleField(`amount:${wt.id}`, e.target.value)}
                              placeholder="Сумма"
                              className="w-[250px]"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    {!currentModuleValues.is_paid ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        Сначала выберите, оплачен заказ или нет.
                      </div>
                    ) : null}
                  </div>
                ) : contactConfig.warehouseByAccess ? (
                  <div className="space-y-3 mb-3">
                    <div>
                      <Label>Склад</Label>
                      <ul className="mt-2 inline-flex flex-wrap overflow-hidden rounded-lg border border-gray-300 text-sm font-medium text-gray-800 dark:border-gray-700 dark:text-white/90">
                        {warehouseOptions.map((w, index) => (
                          <li
                            key={w.id}
                            className={`w-[250px] ${index > 0 ? "border-l border-gray-300 dark:border-gray-700" : ""}`}
                          >
                            <label
                              htmlFor={`warehouse-${contactConfig.moduleName}-${w.id}`}
                              className={`flex min-h-11 cursor-pointer items-center px-3 py-3 ${
                                currentModuleValues.warehouse_id === w.id ? "bg-brand-50 dark:bg-brand-500/10" : ""
                              }`}
                            >
                              <input
                                id={`warehouse-${contactConfig.moduleName}-${w.id}`}
                                type="radio"
                                name={`warehouse-${contactConfig.moduleName}`}
                                value={w.id}
                                checked={currentModuleValues.warehouse_id === w.id}
                                onChange={(e) => onChangeModuleField("warehouse_id", e.target.value)}
                                className="h-4 w-4 border border-gray-300 text-brand-500 focus:ring-2 focus:ring-brand-300 dark:border-gray-700 dark:bg-gray-900"
                              />
                              <span className="ml-2 break-words">{w.name}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {!warehouseOptions.length ? (
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        Нет доступных складов для текущего логина.
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                    {contactConfig.fields.map((field) => {
                      const isPhone = field.key === "phone";
                      const value = currentModuleValues[field.key] || (isPhone ? "+7" : "");
                      return (
                        <div key={field.key} className="w-[250px] max-w-full">
                          <Label>{field.label}</Label>
                          <Input
                            name={isPhone ? `order-contact-p-${contactConfig.moduleName}` : `order-contact-f-${field.key}`}
                            value={value}
                            disabled={isPhone && contactHasNoPhone}
                            onChange={(e: any) => {
                              const nextValue = isPhone ? formatPhone(e.target.value) : e.target.value;
                              onChangeModuleField(field.key, nextValue);
                            }}
                            placeholder={isPhone ? "+7xxx-xxx-xx-xx" : `Введите ${field.label.toLowerCase()}`}
                            autoComplete={isPhone ? "new-password" : "off"}
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            inputMode={isPhone ? "numeric" : "text"}
                            className="w-[250px]"
                          />
                          {isPhone && (
                            <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                              <input
                                type="checkbox"
                                checked={contactHasNoPhone}
                                onChange={(e) => {
                                  const next = e.target.checked;
                                  setContactHasNoPhone(next);
                                  if (next) {
                                    setContacts([]);
                                    setSelectedContactId("");
                                    onChangeModuleField("phone", "+7");
                                  }
                                }}
                              />
                              У клиента нет номера
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {contactsSearchBusy && currentHasPhoneField && !contactHasNoPhone && !contactConfig.warehouseByAccess && (
                  <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                    Ищем запись в модуле {contactConfig.moduleName}...
                  </div>
                )}

                {contactConfig.warehouseByAccess ? null : currentHasPhoneField && contactHasNoPhone ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Поиск по телефону отключен, заполните имя вручную.
                  </div>
                ) : currentHasPhoneField && !contacts.length ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Совпадений по номеру не найдено.</div>
                ) : currentHasPhoneField ? (
                  <ul className="space-y-2">
                    {contacts.map((contact) => (
                      <li
                        key={String(contact.id)}
                        className={`rounded-lg border px-3 py-2 cursor-pointer ${
                          selectedContactId === String(contact.id)
                            ? "border-brand-500 bg-brand-50/50 dark:bg-brand-500/10"
                            : "border-gray-100 dark:border-gray-800"
                        }`}
                        onClick={() => onPickContact(contact)}
                      >
                        {contactConfig.fields.map((f) => (
                          <div key={f.key} className="text-sm">
                            <span className="text-gray-500 dark:text-gray-400">{f.label}: </span>
                            <span className="text-gray-800 dark:text-white/90">{String(contact?.[f.key] ?? "-")}</span>
                          </div>
                        ))}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    Поля заполняются вручную по manifest модуля.
                  </div>
                )}

                {hasNextRelatedModule && canGoNextRelatedModule && (
                  <div className="mt-4">
                    <Button size="sm" onClick={onNextRelatedModule}>
                      Далее
                    </Button>
                  </div>
                )}
                {!hasNextRelatedModule && (
                  <div className="mt-4">
                    <Button size="sm" disabled={createBusy || !canCreateOrder()} onClick={onCreateOrder}>
                      Создать
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <div className="text-sm text-red-600">Ошибка: {error}</div>}
          {createSuccess && <div className="text-sm text-green-600">{createSuccess}</div>}
        </div>
      </div>
    </div>
  );
}
