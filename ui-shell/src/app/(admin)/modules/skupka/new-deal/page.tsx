"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import { ChevronDownIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";

type BuybackCategory = {
  id: string;
  name: string;
};

type PurchaseObject = {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
};

type Contact = {
  id: string;
  name: string;
  phone: string;
};

type Warehouse = {
  id: string;
  name: string;
};

type DeviceCondition = {
  id: string;
  category_id: string;
  name: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

const dealTypeOptions = [
  { id: "parts", label: "На запчасти" },
  { id: "resale", label: "На перепродажу" },
] as const;

const paymentMethodOptions = [
  { id: "cashbox", label: "Из кассы" },
  { id: "online_transfer", label: "Онлайн перевод" },
] as const;

function dealTypeLabel(value: string): string {
  return dealTypeOptions.find((item) => item.id === value)?.label || value;
}

function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  let core = digits;
  if (core.startsWith("7") || core.startsWith("8")) core = core.slice(1);
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

export default function SkupkaNewDealPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const router = useRouter();
  const purchaseObjectBoxRef = useRef<HTMLDivElement | null>(null);
  const [dealType, setDealType] = useState("");
  const [isDealTypeOpen, setIsDealTypeOpen] = useState(false);
  const [categories, setCategories] = useState<BuybackCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [purchaseObjects, setPurchaseObjects] = useState<PurchaseObject[]>([]);
  const [purchaseObjectId, setPurchaseObjectId] = useState("");
  const [purchaseObjectQuery, setPurchaseObjectQuery] = useState("");
  const [purchaseObjectOptionsOpen, setPurchaseObjectOptionsOpen] = useState(false);
  const [deviceConditionOptions, setDeviceConditionOptions] = useState<DeviceCondition[]>([]);
  const [selectedDeviceConditionIds, setSelectedDeviceConditionIds] = useState<string[]>([]);
  const [contactName, setContactName] = useState("");
  const [clientPhone, setClientPhone] = useState("+7");
  const [contactHasNoPhone, setContactHasNoPhone] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");
  const [contactMatches, setContactMatches] = useState<Contact[]>([]);
  const [contactsSearchBusy, setContactsSearchBusy] = useState(false);
  const [financeStepOpen, setFinanceStepOpen] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amount, setAmount] = useState("");
  const [warehouseStepOpen, setWarehouseStepOpen] = useState(false);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const selectedPurchaseObject = purchaseObjects.find((item) => item.id === purchaseObjectId);
  const visiblePurchaseObjects = purchaseObjects.filter((item) =>
    item.name.toLowerCase().includes(purchaseObjectQuery.trim().toLowerCase())
  );
  const hasSelectedDeviceConditions = selectedDeviceConditionIds.length > 0;

  const loadCategories = async () => {
    const resp = await fetch(`${base}/skupka/settings/categories`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load categories failed: ${resp.status} ${body}`);
    }
    setCategories((await resp.json()) as BuybackCategory[]);
  };

  const loadPurchaseObjects = async (nextCategoryId: string) => {
    const resp = await fetch(
      `${base}/skupka/settings/purchase-objects?category_id=${encodeURIComponent(nextCategoryId)}`,
      {
        cache: "no-store",
        headers: authHeaders(),
      }
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load purchase objects failed: ${resp.status} ${body}`);
    }
    setPurchaseObjects((await resp.json()) as PurchaseObject[]);
  };

  const loadWarehouses = async () => {
    const resp = await fetch(`${base}/warehouses/warehouses/accessible`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load warehouses failed: ${resp.status} ${body}`);
    }
    setWarehouses((await resp.json()) as Warehouse[]);
  };

  const loadDeviceConditions = async (nextCategoryId: string) => {
    const qs = nextCategoryId ? `?category_id=${encodeURIComponent(nextCategoryId)}` : "";
    const resp = await fetch(`${base}/skupka/settings/device-conditions${qs}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load device conditions failed: ${resp.status} ${body}`);
    }
    setDeviceConditionOptions((await resp.json()) as DeviceCondition[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await loadCategories();
      } catch (e: any) {
        setError(e?.message || "failed to load data");
      }
    })();
  }, [base]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (purchaseObjectBoxRef.current && !purchaseObjectBoxRef.current.contains(event.target as Node)) {
        setPurchaseObjectOptionsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!purchaseObjectId) {
      setContactMatches([]);
      setContactsSearchBusy(false);
      return;
    }
    if (contactHasNoPhone) {
      setContactMatches([]);
      setContactsSearchBusy(false);
      return;
    }
    if (countPhoneDigits(clientPhone) < 4) {
      setContactMatches([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setContactsSearchBusy(true);
      setError(null);
      try {
        const resp = await fetch(
          `${base}/contacts/contacts/search?phone=${encodeURIComponent(clientPhone)}&limit=20`,
          {
            cache: "no-store",
            headers: authHeaders(),
          }
        );
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`contacts search failed: ${resp.status} ${body}`);
        }
        setContactMatches((await resp.json()) as Contact[]);
      } catch (e: any) {
        setError(e?.message || "failed to search contacts");
        setContactMatches([]);
      } finally {
        setContactsSearchBusy(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [purchaseObjectId, clientPhone, contactHasNoPhone, base]);

  const resetAfterDealType = () => {
    setCategoryId("");
    setPurchaseObjects([]);
    setPurchaseObjectId("");
    setPurchaseObjectQuery("");
    setPurchaseObjectOptionsOpen(false);
    setDeviceConditionOptions([]);
    setSelectedDeviceConditionIds([]);
    setContactName("");
    setClientPhone("+7");
    setContactHasNoPhone(false);
    setSelectedContactId("");
    setContactMatches([]);
    setFinanceStepOpen(false);
    setPaymentMethod("");
    setAmount("");
    setWarehouseStepOpen(false);
    setWarehouses([]);
    setWarehouseId("");
    setComment("");
  };

  const onSelectDealType = (value: string) => {
    setDealType(value);
    setIsDealTypeOpen(false);
    resetAfterDealType();
  };

  const onSelectCategory = async (value: string) => {
    setCategoryId(value);
    setPurchaseObjectId("");
    setPurchaseObjectQuery("");
    setPurchaseObjectOptionsOpen(false);
    setPurchaseObjects([]);
    setDeviceConditionOptions([]);
    setSelectedDeviceConditionIds([]);
    setContactName("");
    setClientPhone("+7");
    setContactHasNoPhone(false);
    setSelectedContactId("");
    setContactMatches([]);
    setFinanceStepOpen(false);
    setPaymentMethod("");
    setAmount("");
    setWarehouseStepOpen(false);
    setWarehouses([]);
    setWarehouseId("");
    setComment("");
    if (!value) return;
    setError(null);
    try {
      await loadPurchaseObjects(value);
    } catch (e: any) {
      setError(e?.message || "failed to load purchase objects");
    }
  };

  const onSelectPurchaseObject = (item: PurchaseObject | null) => {
    const value = item?.id || "";
    setPurchaseObjectId(value);
    setPurchaseObjectQuery(item?.name || "");
    setPurchaseObjectOptionsOpen(false);
    setSelectedDeviceConditionIds([]);
    setContactHasNoPhone(false);
    setSelectedContactId("");
    setContactMatches([]);
    setFinanceStepOpen(false);
    setPaymentMethod("");
    setAmount("");
    setWarehouseStepOpen(false);
    setWarehouses([]);
    setWarehouseId("");
    if (!value) {
      setDeviceConditionOptions([]);
      return;
    }
    setError(null);
    void loadDeviceConditions(categoryId).catch((e: any) => setError(e?.message || "failed to load device conditions"));
  };

  const resetAfterContactChange = () => {
    setFinanceStepOpen(false);
    setPaymentMethod("");
    setAmount("");
    setWarehouseStepOpen(false);
    setWarehouses([]);
    setWarehouseId("");
    setComment("");
  };

  const resetAfterDeviceConditionsChange = () => {
    setContactName("");
    setClientPhone("+7");
    setContactHasNoPhone(false);
    setSelectedContactId("");
    setContactMatches([]);
    resetAfterContactChange();
  };

  const onToggleDeviceCondition = (conditionId: string) => {
    setSelectedDeviceConditionIds((prev) => {
      const next = prev.includes(conditionId) ? prev.filter((id) => id !== conditionId) : [...prev, conditionId];
      return next;
    });
    resetAfterDeviceConditionsChange();
    setError(null);
  };

  const onPickContact = (contact: Contact) => {
    setSelectedContactId(contact.id);
    setContactName(contact.name);
    setClientPhone(contact.phone);
    resetAfterContactChange();
    setError(null);
    setFinanceStepOpen(true);
  };

  const canGoToFinance = () =>
    !!purchaseObjectId &&
    hasSelectedDeviceConditions &&
    (contactHasNoPhone || (!!contactName.trim() && countPhoneDigits(clientPhone) >= 11));

  const canGoToWarehouse = () => {
    const amountNum = Number(String(amount).replace(",", "."));
    return !!paymentMethod && Number.isFinite(amountNum) && amountNum >= 0;
  };

  const onOpenWarehouse = async () => {
    if (!canGoToWarehouse()) return;
    setWarehouseStepOpen(true);
    setError(null);
    try {
      await loadWarehouses();
    } catch (e: any) {
      setError(e?.message || "failed to load warehouses");
    }
  };

  const resolveContactId = async (): Promise<string> => {
    if (contactHasNoPhone) return "";
    if (selectedContactId) return selectedContactId;
    const name = contactName.trim();
    const phone = clientPhone.trim();
    const createResp = await fetch(`${base}/contacts/contacts`, {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders() },
      body: JSON.stringify({ name, phone }),
    });
    if (createResp.ok) {
      const created = (await createResp.json()) as { id: string };
      return String(created.id || "");
    }
    const body = await createResp.text().catch(() => "");
    const isDuplicatePhone =
      createResp.status === 400 &&
      (body.includes("uq_contacts_phone") || body.toLowerCase().includes("duplicate key value"));
    if (!isDuplicatePhone) {
      throw new Error(`contacts create failed: ${createResp.status} ${body}`);
    }
    const searchResp = await fetch(
      `${base}/contacts/contacts/search?phone=${encodeURIComponent(phone)}&limit=20`,
      { cache: "no-store", headers: authHeaders() }
    );
    if (!searchResp.ok) {
      const searchBody = await searchResp.text().catch(() => "");
      throw new Error(`contacts search after duplicate failed: ${searchResp.status} ${searchBody}`);
    }
    const existingList = (await searchResp.json()) as Contact[];
    const exact = existingList.find((item) => phoneDigits(item.phone) === phoneDigits(phone));
    const first = exact || existingList[0];
    if (!first?.id) {
      throw new Error("contacts duplicate detected, but existing contact not found");
    }
    return first.id;
  };

  const onCreate = async () => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      if (!dealType) throw new Error("Тип сделки обязателен");
      if (!categoryId) throw new Error("Категория обязательна");
      if (!purchaseObjectId) throw new Error("Объект покупки обязателен");
      if (!hasSelectedDeviceConditions) throw new Error("Выберите хотя бы одно состояние устройства");
      if (!canGoToFinance()) throw new Error("Заполните контакт клиента");
      if (!canGoToWarehouse()) throw new Error("Заполните шаг Бухгалтерия");
      if (!warehouseId) throw new Error("Выберите склад");
      const amountNum = Number(String(amount).replace(",", "."));
      const effectiveClientName = contactName.trim() || (contactHasNoPhone ? "Клиент без номера" : "");
      const contactId = await resolveContactId();
      const dealResp = await fetch(`${base}/skupka/deals`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          deal_type: dealType,
          category_id: categoryId,
          purchase_object_id: purchaseObjectId,
          device_condition_ids: selectedDeviceConditionIds,
          title: selectedPurchaseObject?.name || "Сделка скупки",
          client_name: effectiveClientName,
          client_phone: contactHasNoPhone ? "" : clientPhone.trim(),
          offered_amount: amountNum,
          comment: comment.trim(),
          contact_uuid: contactId,
          warehouse_id: warehouseId,
        }),
      });
      if (!dealResp.ok) {
        const body = await dealResp.text().catch(() => "");
        throw new Error(`create deal failed: ${dealResp.status} ${body}`);
      }
      const created = (await dealResp.json()) as { id: string };
      const financeResp = await fetch(`${base}/finance/finance/buyback-lines`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          deal_uuid: created.id,
          amount: amountNum,
          currency: "RUB",
          payment_method: paymentMethod,
        }),
      });
      if (!financeResp.ok) {
        const body = await financeResp.text().catch(() => "");
        throw new Error(`finance save failed: ${financeResp.status} ${body}`);
      }
      router.push(`/modules/skupka/list?open_deal_id=${encodeURIComponent(created.id)}`);
      return;
    } catch (e: any) {
      setError(e?.message || "failed to create deal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Новая сделка</h3>
        <div className="space-y-5">
          <div>
            <Label>Тип сделки</Label>
            <div className="relative inline-block">
              <Button
                size="md"
                onClick={() => setIsDealTypeOpen((prev) => !prev)}
                className="dropdown-toggle w-[250px] justify-between"
              >
                {dealTypeLabel(dealType) || "Выберите тип сделки"}
                <ChevronDownIcon />
              </Button>
              <Dropdown
                isOpen={isDealTypeOpen}
                onClose={() => setIsDealTypeOpen(false)}
                className="left-0 right-auto w-[250px] p-2"
              >
                {dealTypeOptions.map((item) => (
                  <DropdownItem
                    key={item.id}
                    onClick={() => onSelectDealType(item.id)}
                    onItemClick={() => setIsDealTypeOpen(false)}
                    className="flex w-full rounded-lg text-left font-normal text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-300"
                  >
                    {item.label}
                  </DropdownItem>
                ))}
              </Dropdown>
            </div>
          </div>

          {dealType ? (
            <div>
              <Label>Категория скупки</Label>
              <select
                value={categoryId}
                onChange={(e) => void onSelectCategory(e.target.value)}
                disabled={!categories.length}
                className="h-11 w-[250px] max-w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">Выберите категорию</option>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {categoryId ? (
            <div>
              <div className="mb-2 flex items-center gap-2">
                <Label>Объект покупки</Label>
                <button
                  type="button"
                  title="Добавить объект покупки"
                  onClick={() => window.open("/modules/skupka/settings/purchase-object", "_blank", "noopener,noreferrer")}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-sm font-semibold text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10"
                >
                  +
                </button>
              </div>
              <div className="relative w-[250px] max-w-full" ref={purchaseObjectBoxRef}>
                <input
                  value={purchaseObjectQuery}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setPurchaseObjectQuery(nextValue);
                    setPurchaseObjectOptionsOpen(true);
                    if (purchaseObjectId && selectedPurchaseObject?.name !== nextValue) {
                      onSelectPurchaseObject(null);
                      setPurchaseObjectQuery(nextValue);
                      setPurchaseObjectOptionsOpen(true);
                    }
                  }}
                  onFocus={() => setPurchaseObjectOptionsOpen(true)}
                  disabled={!purchaseObjects.length}
                  placeholder="Введите объект покупки для поиска"
                  className="h-11 w-[250px] max-w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
                />
                {purchaseObjectOptionsOpen && (
                  <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-theme-lg dark:border-gray-800 dark:bg-gray-900 max-h-56 overflow-auto">
                    {!visiblePurchaseObjects.length ? (
                      <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">Ничего не найдено</div>
                    ) : (
                      visiblePurchaseObjects.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => onSelectPurchaseObject(item)}
                          className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/10"
                        >
                          {item.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {purchaseObjectId ? (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
              <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Состояние устройства</h4>
              {!deviceConditionOptions.length ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Для выбранной категории состояния не созданы.</div>
              ) : (
                <ul className="inline-flex flex-wrap overflow-hidden rounded-lg border border-gray-300 text-sm font-medium text-gray-800 dark:border-gray-700 dark:text-white/90">
                  {deviceConditionOptions.map((item, index) => (
                    <li
                      key={item.id}
                      className={`w-[250px] ${index > 0 ? "border-l border-gray-300 dark:border-gray-700" : ""}`}
                    >
                      <label
                        htmlFor={`device-condition-${item.id}`}
                        className={`flex min-h-11 cursor-pointer items-center px-3 py-3 ${
                          selectedDeviceConditionIds.includes(item.id) ? "bg-brand-50 dark:bg-brand-500/10" : ""
                        }`}
                      >
                        <input
                          id={`device-condition-${item.id}`}
                          type="checkbox"
                          value={item.id}
                          checked={selectedDeviceConditionIds.includes(item.id)}
                          onChange={() => onToggleDeviceCondition(item.id)}
                          className="h-4 w-4 rounded border border-gray-300 focus:ring-2 focus:ring-brand-300 dark:border-gray-700 dark:bg-gray-900"
                        />
                        <span className="ml-2 break-words">{item.name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {hasSelectedDeviceConditions ? (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
              <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Контакт клиента</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                <div className="w-[250px] max-w-full">
                  <Label>Имя клиента</Label>
                  <Input
                    value={contactName}
                    onChange={(e: any) => {
                      setContactName(e.target.value);
                      setSelectedContactId("");
                      resetAfterContactChange();
                    }}
                    placeholder="Имя клиента"
                    className="w-[250px]"
                  />
                </div>
                <div className="w-[250px] max-w-full">
                  <Label>Телефон</Label>
                  <Input
                    value={clientPhone}
                    disabled={contactHasNoPhone}
                    onChange={(e: any) => {
                      setClientPhone(formatPhone(e.target.value));
                      setSelectedContactId("");
                      resetAfterContactChange();
                    }}
                    placeholder="+7xxx-xxx-xx-xx"
                    className="w-[250px]"
                  />
                  <label className="mt-2 flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <input
                      type="checkbox"
                      checked={contactHasNoPhone}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setContactHasNoPhone(next);
                        resetAfterContactChange();
                        setSelectedContactId("");
                        if (next) {
                          setContactMatches([]);
                          setClientPhone("+7");
                          setError(null);
                          setFinanceStepOpen(true);
                        }
                      }}
                    />
                    У клиента нет номера
                  </label>
                </div>
              </div>
              {contactsSearchBusy ? (
                <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">Ищем контакт по номеру...</div>
              ) : null}
              {contactHasNoPhone ? (
                <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">
                  Поиск по телефону отключен, заполните имя вручную.
                </div>
              ) : null}
              {!contactHasNoPhone && contactMatches.length ? (
                <ul className="space-y-2">
                  {contactMatches.map((contact) => (
                    <li
                      key={contact.id}
                      className={`rounded-lg border px-3 py-2 cursor-pointer ${
                        selectedContactId === contact.id
                          ? "border-brand-500 bg-brand-50/50 dark:bg-brand-500/10"
                          : "border-gray-100 dark:border-gray-800"
                      }`}
                      onClick={() => onPickContact(contact)}
                    >
                      <div className="text-sm text-gray-800 dark:text-white/90">{contact.name}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">{contact.phone}</div>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!financeStepOpen ? (
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      const contactIsEmpty = !contactName.trim() && countPhoneDigits(clientPhone) <= 1;
                      if (contactIsEmpty) {
                        setContactHasNoPhone(true);
                        setSelectedContactId("");
                        setContactMatches([]);
                        setClientPhone("+7");
                        setError(null);
                        setFinanceStepOpen(true);
                        return;
                      }
                      if (!canGoToFinance()) {
                        setError(contactHasNoPhone ? "Заполните имя клиента" : "Заполните имя и телефон клиента");
                        return;
                      }
                      setError(null);
                      setFinanceStepOpen(true);
                    }}
                  >
                    Далее
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {financeStepOpen ? (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
              <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Бухгалтерия</h4>
              <div className="space-y-4">
                <div>
                  <Label>Способ оплаты</Label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    className="h-11 w-[250px] max-w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="">Выберите способ оплаты</option>
                    {paymentMethodOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-3">
                  <div className="w-[250px] text-sm text-gray-800 dark:text-white/90">
                    Объект покупки: {selectedPurchaseObject?.name || "Объект"}
                  </div>
                  <div className="w-[250px] max-w-full">
                    <Label>Сумма</Label>
                    <Input
                      value={amount}
                      onChange={(e: any) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-[250px]"
                    />
                  </div>
                </div>
              </div>
              {!warehouseStepOpen && canGoToWarehouse() ? (
                <div className="mt-4">
                  <Button size="sm" onClick={() => void onOpenWarehouse()}>
                    Далее
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {warehouseStepOpen ? (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
              <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Склад</h4>
              <div className="space-y-4">
                <div className="w-[250px] max-w-full">
                  <Label>Склад</Label>
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="h-11 w-[250px] max-w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="">Выберите склад</option>
                    {warehouses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-[500px] max-w-full">
                  <Label>Комментарий</Label>
                  <Input
                    value={comment}
                    onChange={(e: any) => setComment(e.target.value)}
                    placeholder="Комментарий по сделке"
                    className="w-[500px]"
                  />
                </div>
              </div>
              {!warehouses.length ? (
                <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">Нет доступных складов для текущего пользователя.</div>
              ) : null}
              <div className="mt-4">
                <Button size="sm" disabled={busy || !warehouseId} onClick={onCreate}>
                  Создать
                </Button>
              </div>
            </div>
          ) : null}
        </div>
        {error ? <div className="mt-4 text-sm text-red-600">Ошибка: {error}</div> : null}
        {ok ? <div className="mt-4 text-sm text-green-600">{ok}</div> : null}
      </div>

    </div>
  );
}
