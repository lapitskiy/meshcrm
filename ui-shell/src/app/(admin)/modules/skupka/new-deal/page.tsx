"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { Dropdown } from "@/components/ui/dropdown/Dropdown";
import { DropdownItem } from "@/components/ui/dropdown/DropdownItem";
import { ChevronDownIcon } from "@/icons/index";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

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
  name: string;
};

type DeviceConditionRow = {
  key: number;
  selectedId: string;
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
  const [dealType, setDealType] = useState("");
  const [isDealTypeOpen, setIsDealTypeOpen] = useState(false);
  const [categories, setCategories] = useState<BuybackCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [purchaseObjects, setPurchaseObjects] = useState<PurchaseObject[]>([]);
  const [purchaseObjectId, setPurchaseObjectId] = useState("");
  const [deviceConditionOptions, setDeviceConditionOptions] = useState<DeviceCondition[]>([]);
  const [deviceConditionRows, setDeviceConditionRows] = useState<DeviceConditionRow[]>([{ key: 1, selectedId: "" }]);
  const [nextDeviceConditionKey, setNextDeviceConditionKey] = useState(2);
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
  const selectedDeviceConditionIds = deviceConditionRows
    .map((row) => row.selectedId)
    .filter((id): id is string => !!id);
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

  const loadDeviceConditions = async () => {
    const resp = await fetch(`${base}/skupka/settings/device-conditions`, {
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
    setDeviceConditionOptions([]);
    setDeviceConditionRows([{ key: 1, selectedId: "" }]);
    setNextDeviceConditionKey(2);
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
    setPurchaseObjects([]);
    setDeviceConditionOptions([]);
    setDeviceConditionRows([{ key: 1, selectedId: "" }]);
    setNextDeviceConditionKey(2);
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

  const onSelectPurchaseObject = (value: string) => {
    setPurchaseObjectId(value);
    setDeviceConditionRows([{ key: 1, selectedId: "" }]);
    setNextDeviceConditionKey(2);
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
    void loadDeviceConditions().catch((e: any) => setError(e?.message || "failed to load device conditions"));
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

  const onSelectDeviceCondition = (rowKey: number, conditionId: string) => {
    const alreadySelected = deviceConditionRows.some((row) => row.key !== rowKey && row.selectedId === conditionId);
    if (alreadySelected && conditionId) return;
    setDeviceConditionRows((prev) =>
      prev.map((row) => (row.key === rowKey ? { ...row, selectedId: conditionId } : row))
    );
    resetAfterDeviceConditionsChange();
    setError(null);
  };

  const onAddDeviceConditionRow = () => {
    setDeviceConditionRows((prev) => [...prev, { key: nextDeviceConditionKey, selectedId: "" }]);
    setNextDeviceConditionKey((prev) => prev + 1);
    resetAfterDeviceConditionsChange();
  };

  const onRemoveDeviceConditionRow = (rowKey: number) => {
    setDeviceConditionRows((prev) => {
      const next = prev.filter((row) => row.key !== rowKey);
      return next.length ? next : [{ key: 1, selectedId: "" }];
    });
    resetAfterDeviceConditionsChange();
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
      setDealType("");
      resetAfterDealType();
      setOk(`Сделка создана: ${created.id}`);
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
              <Button size="md" onClick={() => setIsDealTypeOpen((prev) => !prev)} className="dropdown-toggle">
                {dealTypeLabel(dealType) || "Выберите тип сделки"}
                <ChevronDownIcon />
              </Button>
              <Dropdown isOpen={isDealTypeOpen} onClose={() => setIsDealTypeOpen(false)} className="w-56 p-2">
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
                className="h-11 w-full max-w-md rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
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
              <select
                value={purchaseObjectId}
                onChange={(e) => onSelectPurchaseObject(e.target.value)}
                disabled={!purchaseObjects.length}
                className="h-11 w-full max-w-md rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              >
                <option value="">Выберите объект покупки</option>
                {purchaseObjects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {purchaseObjectId ? (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
              <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Состояние устройства</h4>
              <div className="space-y-3">
                {deviceConditionRows.map((row) => {
                  const selectedInOtherRows = new Set(
                    deviceConditionRows.filter((x) => x.key !== row.key && x.selectedId).map((x) => x.selectedId)
                  );
                  return (
                    <div key={row.key} className="flex gap-2 items-center">
                      <select
                        value={row.selectedId}
                        onChange={(e) => onSelectDeviceCondition(row.key, e.target.value)}
                        className="h-11 w-full max-w-md rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                      >
                        <option value="">Выберите состояние</option>
                        {deviceConditionOptions
                          .filter((item) => !selectedInOtherRows.has(item.id) || item.id === row.selectedId)
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name}
                            </option>
                          ))}
                      </select>
                      {deviceConditionRows.length > 1 ? (
                        <button
                          type="button"
                          className="h-11 px-3 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/10"
                          onClick={() => onRemoveDeviceConditionRow(row.key)}
                        >
                          Удалить
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  className="text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400"
                  onClick={onAddDeviceConditionRow}
                >
                  + Добавить ещё состояние
                </button>
              </div>
            </div>
          ) : null}

          {hasSelectedDeviceConditions ? (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
              <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Контакт клиента</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-3">
                <div>
                  <Label>Имя клиента</Label>
                  <Input
                    value={contactName}
                    onChange={(e: any) => {
                      setContactName(e.target.value);
                      setSelectedContactId("");
                      resetAfterContactChange();
                    }}
                    placeholder="Имя клиента"
                  />
                </div>
                <div>
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
                    className="h-11 w-full max-w-md rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="">Выберите способ оплаты</option>
                    {paymentMethodOptions.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-end">
                  <div className="text-sm text-gray-800 dark:text-white/90">
                    Объект покупки: {selectedPurchaseObject?.name || "Объект"}
                  </div>
                  <div>
                    <Label>Сумма</Label>
                    <Input value={amount} onChange={(e: any) => setAmount(e.target.value)} placeholder="0.00" />
                  </div>
                </div>
              </div>
              {!warehouseStepOpen ? (
                <div className="mt-4">
                  <Button size="sm" disabled={!canGoToWarehouse()} onClick={() => void onOpenWarehouse()}>
                    Далее
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {warehouseStepOpen ? (
            <div className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-4">
              <h4 className="mb-3 font-semibold text-gray-800 dark:text-white/90">Склад</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>Склад</Label>
                  <select
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    className="h-11 w-full max-w-md rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                  >
                    <option value="">Выберите склад</option>
                    {warehouses.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Комментарий</Label>
                  <Input value={comment} onChange={(e: any) => setComment(e.target.value)} placeholder="Комментарий по сделке" />
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
