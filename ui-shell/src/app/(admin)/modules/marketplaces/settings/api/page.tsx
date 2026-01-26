"use client";

import React, { useEffect, useState } from "react";

type ApiSettings = {
  moy_sklad_api: string;
  yandex_market_api: string;
  wildberries_api: string;
  ozon_client_id: string;
  ozon_api: string;
};

const DEFAULTS: ApiSettings = {
  moy_sklad_api: "",
  yandex_market_api: "",
  wildberries_api: "",
  ozon_client_id: "",
  ozon_api: "",
};

function getToken(): string {
  return ((window as any).__hubcrmAccessToken as string) || "";
}

function getGatewayBase(): string {
  const envBase = process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (envBase) return envBase;
  return `${window.location.protocol}//${window.location.hostname}:8080`;
}

export default function MarketplaceApiSettingsPage() {
  const [form, setForm] = useState<ApiSettings>(DEFAULTS);
  const [status, setStatus] = useState<string>("");
  const [base, setBase] = useState<string>("");

  useEffect(() => {
    (async () => {
      try {
        const b = getGatewayBase();
        setBase(b);
        const r = await fetch(`${b}/marketplaces/api-settings`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!r.ok) return;
        const data = (await r.json()) as Partial<ApiSettings>;
        setForm({ ...DEFAULTS, ...data });
      } catch {
        // ignore
      }
    })();
  }, []);

  const set = (k: keyof ApiSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((p) => ({ ...p, [k]: e.target.value }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("Сохраняю...");
    try {
      const b = base || getGatewayBase();
      if (!base) setBase(b);
      const r = await fetch(`${b}/marketplaces/api-settings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(form),
      });
      setStatus(r.ok ? "Сохранено" : "Ошибка сохранения");
    } catch {
      setStatus("Ошибка сети");
    }
  };

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-6">Маркетплейсы → Настройки → API</h1>
      <form onSubmit={save} className="space-y-4">
        <div>
          <label className="block text-sm mb-1">Мой склад api</label>
          <input className="w-full border rounded px-3 py-2" value={form.moy_sklad_api} onChange={set("moy_sklad_api")} />
        </div>
        <div>
          <label className="block text-sm mb-1">Yandex market api</label>
          <input className="w-full border rounded px-3 py-2" value={form.yandex_market_api} onChange={set("yandex_market_api")} />
        </div>
        <div>
          <label className="block text-sm mb-1">Wildberries api</label>
          <input className="w-full border rounded px-3 py-2" value={form.wildberries_api} onChange={set("wildberries_api")} />
        </div>
        <div>
          <label className="block text-sm mb-1">Ozon client id</label>
          <input className="w-full border rounded px-3 py-2" value={form.ozon_client_id} onChange={set("ozon_client_id")} />
        </div>
        <div>
          <label className="block text-sm mb-1">Ozon api</label>
          <input className="w-full border rounded px-3 py-2" value={form.ozon_api} onChange={set("ozon_api")} />
        </div>
        <div className="flex items-center gap-4 pt-2">
          <button type="submit" className="px-4 py-2 rounded bg-brand-500 text-white">
            Сохранить
          </button>
          <div className="text-sm text-gray-600">{status}</div>
        </div>
      </form>
    </div>
  );
}

