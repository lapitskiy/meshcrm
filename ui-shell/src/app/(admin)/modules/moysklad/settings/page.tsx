"use client";

import Switch from "@/components/form/switch/Switch";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import Select from "@/components/form/Select";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useState } from "react";

type MsOption = { id: string; name: string };

export default function MoySkladSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState("6c9a58b107a034a9cfdfae936d799536a446cdce");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const [contrBusy, setContrBusy] = useState(false);
  const [contrStatus, setContrStatus] = useState("");

  const [orgOptions, setOrgOptions] = useState<MsOption[]>([]);
  const [agentOptions, setAgentOptions] = useState<MsOption[]>([]);
  const [loadError, setLoadError] = useState("");

  const [storageBusy, setStorageBusy] = useState(false);
  const [storageStatus, setStorageStatus] = useState("");
  const [storeOptions, setStoreOptions] = useState<MsOption[]>([]);

  const [statusBusy2, setStatusBusy2] = useState(false);
  const [statusStatus2, setStatusStatus2] = useState("");
  const [statusOptions, setStatusOptions] = useState<MsOption[]>([]);

  const [organizationId, setOrganizationId] = useState("");
  const [ozonId, setOzonId] = useState("");
  const [wbId, setWbId] = useState("");
  const [yandexId, setYandexId] = useState("");

  const [ozonStoreId, setOzonStoreId] = useState("");
  const [wbStoreId, setWbStoreId] = useState("");
  const [yandexStoreId, setYandexStoreId] = useState("");

  const [awaitingId, setAwaitingId] = useState("");
  const [shippedId, setShippedId] = useState("");
  const [completedId, setCompletedId] = useState("");
  const [cancelledId, setCancelledId] = useState("");

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/moysklad/settings`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!r.ok) return;
        const data = await r.json();
        setEnabled(Boolean(data?.enabled));
        setApiKey(String(data?.api_key ?? ""));
      } catch {
        // ignore
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const base = getGatewayBaseUrl();
        const hdrs = { Authorization: `Bearer ${getToken()}` };

        const [orgR, agR, curR, storesR, storesCurR, stR, stCurR] = await Promise.all([
          fetch(`${base}/marketplaces/moysklad/organizations`, { headers: hdrs }),
          fetch(`${base}/marketplaces/moysklad/agents`, { headers: hdrs }),
          fetch(`${base}/marketplaces/moysklad/contragents`, { headers: hdrs }),
          fetch(`${base}/marketplaces/moysklad/storages`, { headers: hdrs }),
          fetch(`${base}/marketplaces/moysklad/storages-settings`, { headers: hdrs }),
          fetch(`${base}/marketplaces/moysklad/statuses`, { headers: hdrs }),
          fetch(`${base}/marketplaces/moysklad/statuses-settings`, { headers: hdrs }),
        ]);

        const errors: string[] = [];
        if (orgR.ok) {
          setOrgOptions((await orgR.json()) as MsOption[]);
        } else {
          const e = await orgR.json().catch(() => null);
          errors.push(`Организации: ${orgR.status} — ${e?.detail || orgR.statusText}`);
        }
        if (agR.ok) {
          setAgentOptions((await agR.json()) as MsOption[]);
        } else {
          const e = await agR.json().catch(() => null);
          errors.push(`Контрагенты: ${agR.status} — ${e?.detail || agR.statusText}`);
        }
        if (curR.ok) {
          const cur = await curR.json();
          setOrganizationId(String(cur?.organization_id ?? ""));
          setOzonId(String(cur?.ozon_id ?? ""));
          setWbId(String(cur?.wb_id ?? ""));
          setYandexId(String(cur?.yandex_id ?? ""));
        }

        if (storesR.ok) {
          setStoreOptions((await storesR.json()) as MsOption[]);
        } else {
          const e = await storesR.json().catch(() => null);
          errors.push(`Склады: ${storesR.status} — ${e?.detail || storesR.statusText}`);
        }

        if (storesCurR.ok) {
          const cur = await storesCurR.json();
          setOzonStoreId(String(cur?.ozon_store_id ?? ""));
          setWbStoreId(String(cur?.wb_store_id ?? ""));
          setYandexStoreId(String(cur?.yandex_store_id ?? ""));
        }

        if (stR.ok) {
          setStatusOptions((await stR.json()) as MsOption[]);
        } else {
          const e = await stR.json().catch(() => null);
          errors.push(`Статусы: ${stR.status} — ${e?.detail || stR.statusText}`);
        }

        if (stCurR.ok) {
          const cur = await stCurR.json();
          setAwaitingId(String(cur?.awaiting_id ?? ""));
          setShippedId(String(cur?.shipped_id ?? ""));
          setCompletedId(String(cur?.completed_id ?? ""));
          setCancelledId(String(cur?.cancelled_id ?? ""));
        }

        if (errors.length) setLoadError(errors.join("\n"));
      } catch (ex: any) {
        setLoadError(`Ошибка сети: ${ex?.message || ex}`);
      }
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    setStatus("Сохраняю...");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/moysklad/settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({ enabled, api_key: apiKey }),
      });
      setStatus(r.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setStatus("Ошибка сети");
    } finally {
      setBusy(false);
    }
  };

  const saveContragents = async () => {
    setContrBusy(true);
    setContrStatus("Сохраняю...");
    try {
      const base = getGatewayBaseUrl();
      const token = getToken();
      const pickName = (opts: MsOption[], id: string) => opts.find((x) => x.id === id)?.name || "";

      const r = await fetch(`${base}/marketplaces/moysklad/contragents`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          organization_id: organizationId,
          organization_name: pickName(orgOptions, organizationId),
          ozon_id: ozonId,
          ozon_name: pickName(agentOptions, ozonId),
          wb_id: wbId,
          wb_name: pickName(agentOptions, wbId),
          yandex_id: yandexId,
          yandex_name: pickName(agentOptions, yandexId),
        }),
      });
      setContrStatus(r.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setContrStatus("Ошибка сети");
    } finally {
      setContrBusy(false);
    }
  };

  const saveStorages = async () => {
    setStorageBusy(true);
    setStorageStatus("Сохраняю...");
    try {
      const base = getGatewayBaseUrl();
      const token = getToken();
      const pickName = (opts: MsOption[], id: string) => opts.find((x) => x.id === id)?.name || "";

      const r = await fetch(`${base}/marketplaces/moysklad/storages-settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ozon_store_id: ozonStoreId,
          ozon_store_name: pickName(storeOptions, ozonStoreId),
          wb_store_id: wbStoreId,
          wb_store_name: pickName(storeOptions, wbStoreId),
          yandex_store_id: yandexStoreId,
          yandex_store_name: pickName(storeOptions, yandexStoreId),
        }),
      });
      setStorageStatus(r.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setStorageStatus("Ошибка сети");
    } finally {
      setStorageBusy(false);
    }
  };

  const saveStatuses = async () => {
    setStatusBusy2(true);
    setStatusStatus2("Сохраняю...");
    try {
      const base = getGatewayBaseUrl();
      const token = getToken();
      const pickName = (opts: MsOption[], id: string) => opts.find((x) => x.id === id)?.name || "";

      const r = await fetch(`${base}/marketplaces/moysklad/statuses-settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          awaiting_id: awaitingId,
          awaiting_name: pickName(statusOptions, awaitingId),
          shipped_id: shippedId,
          shipped_name: pickName(statusOptions, shippedId),
          completed_id: completedId,
          completed_name: pickName(statusOptions, completedId),
          cancelled_id: cancelledId,
          cancelled_name: pickName(statusOptions, cancelledId),
        }),
      });
      setStatusStatus2(r.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setStatusStatus2("Ошибка сети");
    } finally {
      setStatusBusy2(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">МойСклад → Настройки</h1>
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="flex items-center justify-between mb-6">
          <Switch key={`moysklad-${enabled}`} label="Включить" onChange={setEnabled} defaultChecked={enabled} />
        </div>
        <div className="space-y-4">
          <div>
            <Label>Мой склад api</Label>
            <Input value={apiKey} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiKey(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-4 pt-6">
          <button
            type="button"
            className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
            disabled={busy}
            onClick={save}
          >
            Сохранить
          </button>
          <div className="text-sm text-gray-600">{status}</div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <h2 className="text-lg font-semibold mb-4">Контрагенты</h2>
        {loadError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 whitespace-pre-line">
            {loadError}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <Label>Организация</Label>
            <Select
              key={`org-${organizationId}-${orgOptions.length}`}
              options={orgOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите организацию"
              defaultValue={organizationId}
              onChange={setOrganizationId}
            />
          </div>

          <div>
            <Label>Контрагент Ozon</Label>
            <Select
              key={`ozon-${ozonId}-${agentOptions.length}`}
              options={agentOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите контрагента"
              defaultValue={ozonId}
              onChange={setOzonId}
            />
          </div>

          <div>
            <Label>Контрагент WB</Label>
            <Select
              key={`wb-${wbId}-${agentOptions.length}`}
              options={agentOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите контрагента"
              defaultValue={wbId}
              onChange={setWbId}
            />
          </div>

          <div>
            <Label>Контрагент Yandex</Label>
            <Select
              key={`yandex-${yandexId}-${agentOptions.length}`}
              options={agentOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите контрагента"
              defaultValue={yandexId}
              onChange={setYandexId}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-6">
          <button
            type="button"
            className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
            disabled={contrBusy}
            onClick={saveContragents}
          >
            Сохранить
          </button>
          <div className="text-sm text-gray-600">{contrStatus}</div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <h2 className="text-lg font-semibold mb-4">Склады</h2>

        <div className="space-y-4">
          <div>
            <Label>Склад Ozon</Label>
            <Select
              key={`store-ozon-${ozonStoreId}-${storeOptions.length}`}
              options={storeOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите склад"
              defaultValue={ozonStoreId}
              onChange={setOzonStoreId}
            />
          </div>

          <div>
            <Label>Склад WB</Label>
            <Select
              key={`store-wb-${wbStoreId}-${storeOptions.length}`}
              options={storeOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите склад"
              defaultValue={wbStoreId}
              onChange={setWbStoreId}
            />
          </div>

          <div>
            <Label>Склад Yandex</Label>
            <Select
              key={`store-yandex-${yandexStoreId}-${storeOptions.length}`}
              options={storeOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите склад"
              defaultValue={yandexStoreId}
              onChange={setYandexStoreId}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-6">
          <button
            type="button"
            className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
            disabled={storageBusy}
            onClick={saveStorages}
          >
            Сохранить
          </button>
          <div className="text-sm text-gray-600">{storageStatus}</div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <h2 className="text-lg font-semibold mb-4">Статусы</h2>

        <div className="space-y-4">
          <div>
            <Label>Статус "Ожидает отгрузки"</Label>
            <Select
              key={`st-awaiting-${awaitingId}-${statusOptions.length}`}
              options={statusOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите статус"
              defaultValue={awaitingId}
              onChange={setAwaitingId}
            />
          </div>
          <div>
            <Label>Статус "Доставляется"</Label>
            <Select
              key={`st-shipped-${shippedId}-${statusOptions.length}`}
              options={statusOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите статус"
              defaultValue={shippedId}
              onChange={setShippedId}
            />
          </div>
          <div>
            <Label>Статус "Доставлен"</Label>
            <Select
              key={`st-completed-${completedId}-${statusOptions.length}`}
              options={statusOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите статус"
              defaultValue={completedId}
              onChange={setCompletedId}
            />
          </div>
          <div>
            <Label>Статус "Отменен"</Label>
            <Select
              key={`st-cancelled-${cancelledId}-${statusOptions.length}`}
              options={statusOptions.map((x: MsOption) => ({ value: x.id, label: x.name }))}
              placeholder="Выберите статус"
              defaultValue={cancelledId}
              onChange={setCancelledId}
            />
          </div>
        </div>

        <div className="flex items-center gap-4 pt-6">
          <button
            type="button"
            className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
            disabled={statusBusy2}
            onClick={saveStatuses}
          >
            Сохранить
          </button>
          <div className="text-sm text-gray-600">{statusStatus2}</div>
        </div>
      </div>
    </div>
  );
}
