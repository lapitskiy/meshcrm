"use client";

import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type ServiceCategory = {
  id: string;
  name: string;
};

type ServiceObject = {
  id: string;
  service_category_id: string;
  service_category_name: string;
  name: string;
  created_at: string;
};

type RecommendedPriceRow = {
  work_type_id: string;
  work_type_name: string;
  recommended_price: number | null;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
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

function toDraftValue(value: number | null): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export default function OrdersPricesPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [isSuperadmin, setIsSuperadmin] = useState(false);
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [serviceObjects, setServiceObjects] = useState<ServiceObject[]>([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [selectedServiceObjectId, setSelectedServiceObjectId] = useState("");
  const [items, setItems] = useState<RecommendedPriceRow[]>([]);
  const [draftByWorkTypeId, setDraftByWorkTypeId] = useState<Record<string, string>>({});
  const [loadingFilters, setLoadingFilters] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadCategories = async () => {
    const token = getToken();
    const payload = parseJwtPayload(token);
    const roles = Array.isArray(payload?.realm_access?.roles) ? payload.realm_access.roles : [];
    const useAllCategories = roles.includes("superadmin");
    setIsSuperadmin(useAllCategories);
    const resp = await fetch(`${base}/orders/settings/service-categories${useAllCategories ? "" : "/accessible"}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load categories failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as ServiceCategory[];
    setCategories(data);
    setSelectedCategoryId((prev) => (prev && data.some((item) => item.id === prev) ? prev : ""));
  };

  const loadServiceObjects = async (categoryId: string) => {
    if (!categoryId) {
      setServiceObjects([]);
      setSelectedServiceObjectId("");
      return;
    }
    const resp = await fetch(
      `${base}/orders/settings/service-objects?service_category_id=${encodeURIComponent(categoryId)}`,
      {
        cache: "no-store",
        headers: authHeaders(),
      }
    );
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load service objects failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as ServiceObject[];
    setServiceObjects(data);
    setSelectedServiceObjectId((prev) => (prev && data.some((item) => item.id === prev) ? prev : ""));
  };

  const loadPrices = async (categoryId: string, serviceObjectId: string) => {
    if (!categoryId || !serviceObjectId) {
      setItems([]);
      setDraftByWorkTypeId({});
      return;
    }
    const url = new URL(`${base}/orders/settings/recommended-prices`);
    url.searchParams.set("service_category_id", categoryId);
    url.searchParams.set("service_object_id", serviceObjectId);
    const resp = await fetch(url.toString(), {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`load recommended prices failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as RecommendedPriceRow[];
    setItems(data);
    setDraftByWorkTypeId(
      Object.fromEntries(data.map((item) => [item.work_type_id, toDraftValue(item.recommended_price)]))
    );
  };

  useEffect(() => {
    (async () => {
      setLoadingFilters(true);
      setError(null);
      try {
        await loadCategories();
      } catch (e: any) {
        setError(e?.message || "failed to load categories");
      } finally {
        setLoadingFilters(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      setError(null);
      setSuccess(null);
      setItems([]);
      setDraftByWorkTypeId({});
      try {
        await loadServiceObjects(selectedCategoryId);
      } catch (e: any) {
        setError(e?.message || "failed to load service objects");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId]);

  useEffect(() => {
    (async () => {
      setLoadingItems(true);
      setError(null);
      setSuccess(null);
      try {
        await loadPrices(selectedCategoryId, selectedServiceObjectId);
      } catch (e: any) {
        setError(e?.message || "failed to load recommended prices");
      } finally {
        setLoadingItems(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategoryId, selectedServiceObjectId]);

  const onDraftChange = (workTypeId: string, value: string) => {
    setDraftByWorkTypeId((prev) => ({ ...prev, [workTypeId]: value }));
  };

  const onSave = async () => {
    if (!selectedCategoryId || !selectedServiceObjectId) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payloadItems = items.map((item) => {
        const raw = String(draftByWorkTypeId[item.work_type_id] || "").trim();
        if (!raw) {
          return { work_type_id: item.work_type_id, recommended_price: null };
        }
        const normalized = raw.replace(",", ".");
        const parsed = Number(normalized);
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error(`Некорректная цена для "${item.work_type_name}"`);
        }
        return { work_type_id: item.work_type_id, recommended_price: parsed };
      });
      const resp = await fetch(`${base}/orders/settings/recommended-prices`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          service_category_id: selectedCategoryId,
          service_object_id: selectedServiceObjectId,
          items: payloadItems,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`save failed: ${resp.status} ${body}`);
      }
      const data = (await resp.json()) as RecommendedPriceRow[];
      setItems(data);
      setDraftByWorkTypeId(
        Object.fromEntries(data.map((item) => [item.work_type_id, toDraftValue(item.recommended_price)]))
      );
      setSuccess("Цены сохранены.");
    } catch (e: any) {
      setError(e?.message || "failed to save recommended prices");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Фильтр цен</h3>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <Label>Категория</Label>
            <select
              className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              disabled={loadingFilters || !categories.length}
            >
              <option value="">Выберите категорию</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>Объект ремонта</Label>
            <select
              className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
              value={selectedServiceObjectId}
              onChange={(e) => setSelectedServiceObjectId(e.target.value)}
              disabled={!selectedCategoryId || !serviceObjects.length}
            >
              <option value="">Выберите объект ремонта</option>
              {serviceObjects.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {!isSuperadmin && !categories.length ? (
          <div className="mt-3 text-sm text-red-600">
            Нет доступа ни к одной из категорий услуг, обратитесь к администратору.
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">Рекомендованные цены</h3>
            <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Пустое поле означает, что рекомендованная цена не задана.
            </div>
          </div>
          <Button size="sm" disabled={saving || loadingItems || !selectedCategoryId || !selectedServiceObjectId} onClick={onSave}>
            {saving ? "Сохраняю..." : "Сохранить"}
          </Button>
        </div>

        {error && <div className="mb-4 text-sm text-red-600">Ошибка: {error}</div>}
        {success && <div className="mb-4 text-sm text-green-600">{success}</div>}

        {!selectedCategoryId ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Сначала выберите категорию.</div>
        ) : !selectedServiceObjectId ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Теперь выберите объект ремонта.</div>
        ) : loadingItems ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Загружаю список видов ремонта...</div>
        ) : !items.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Для выбранной категории пока нет видов работ.</div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div
                key={item.work_type_id}
                className="grid grid-cols-1 items-end gap-3 rounded-lg border border-gray-100 px-4 py-3 dark:border-gray-800 md:grid-cols-[minmax(0,1fr)_220px]"
              >
                <div>
                  <div className="text-sm font-medium text-gray-800 dark:text-white/90">{item.work_type_name}</div>
                </div>
                <div>
                  <Label>Рекомендованная цена</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={draftByWorkTypeId[item.work_type_id] || ""}
                    onChange={(e: any) => onDraftChange(item.work_type_id, e.target.value)}
                    placeholder="Не задана"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
