"use client";

import React, { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import Checkbox from "@/components/form/input/Checkbox";
import { getGatewayBaseUrl } from "@/lib/gateway";

type ModuleLink = {
  source_module: string;
  target_module: string;
  enabled: boolean;
};

type FinanceSettingsOut = {
  money_visible_related_modules: string[];
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

export default function FinanceSettingsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [selectedModules, setSelectedModules] = useState<Record<string, boolean>>({});

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [linksResp, settingsResp] = await Promise.all([
          fetch(`${base}/plugins/_links?enabled_only=false`, { cache: "no-store", headers: authHeaders() }),
          fetch(`${base}/finance/finance/settings`, { cache: "no-store", headers: authHeaders() }),
        ]);
        if (!linksResp.ok) throw new Error(`links load failed: ${linksResp.status}`);
        if (!settingsResp.ok) throw new Error(`finance settings load failed: ${settingsResp.status}`);

        const links = (await linksResp.json()) as ModuleLink[];
        const settings = (await settingsResp.json()) as FinanceSettingsOut;

        const linked = Array.from(
          new Set(
            (links || [])
              .filter((x) => x.enabled && (x.source_module === "orders" || x.target_module === "orders"))
              .map((x) =>
                String((x.source_module === "orders" ? x.target_module : x.source_module) || "")
                  .trim()
                  .toLowerCase()
              )
              .filter(Boolean)
          )
        ).sort();
        const modules = ["orders", ...linked.filter((x) => x !== "orders")];

        const selected = new Set((settings.money_visible_related_modules || []).map((x) => String(x || "").toLowerCase()));
        const nextSelected: Record<string, boolean> = {};
        modules.forEach((name) => {
          nextSelected[name] = selected.has(name);
        });

        setAvailableModules(modules);
        setSelectedModules(nextSelected);
      } catch (e: any) {
        setError(e?.message || "failed to load finance settings");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const selected = availableModules.filter((name) => !!selectedModules[name]);
      const resp = await fetch(`${base}/finance/finance/settings`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ money_visible_related_modules: selected }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`finance settings save failed: ${resp.status} ${body}`);
      }
      setOk("Настройки сохранены");
    } catch (e: any) {
      setError(e?.message || "failed to save finance settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageBreadcrumb pageTitle="Настройки · Финансы" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <h3 className="mb-3 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Учет денег: связанные модули</h3>
        <div className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Отметьте модули из связей `orders &lt;-&gt; module` (страница настроек модулей), которые будут учитываться в списке денег.
        </div>
        {error ? <div className="mb-3 text-sm text-red-600">Ошибка: {error}</div> : null}
        {ok ? <div className="mb-3 text-sm text-green-600">{ok}</div> : null}
        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
        ) : !availableModules.length ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">Нет активных связанных модулей для orders.</div>
        ) : (
          <div className="space-y-2">
            {availableModules.map((name) => (
              <div key={name} className="rounded-lg border border-gray-100 px-3 py-3 dark:border-gray-800">
                <Checkbox
                  checked={!!selectedModules[name]}
                  onChange={() => setSelectedModules((prev) => ({ ...prev, [name]: !prev[name] }))}
                  label={name}
                />
              </div>
            ))}
          </div>
        )}
        <div className="mt-4">
          <Button size="sm" disabled={saving || loading} onClick={onSave}>
            Сохранить
          </Button>
        </div>
      </div>
    </div>
  );
}
