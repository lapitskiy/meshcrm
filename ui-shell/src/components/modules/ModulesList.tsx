"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useState } from "react";

type PluginMeta = {
  name: string;
  enabled: boolean;
  manifest: any;
};

export default function ModulesList() {
  const [items, setItems] = useState<PluginMeta[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const base = getGatewayBaseUrl();
        const resp = await fetch(`${base}/plugins/_meta?enabled_only=false`, {
          method: "GET",
          cache: "no-store",
        });
        if (!resp.ok) throw new Error(`plugins meta failed: ${resp.status}`);
        const data = (await resp.json()) as PluginMeta[];
        setItems(data);
      } catch (e: any) {
        setError(e?.message || "failed to load modules");
      }
    })();
  }, []);

  return (
    <div>
      <PageBreadcrumb pageTitle="Модули" />

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        {error ? (
          <div className="text-sm text-red-600">Ошибка: {error}</div>
        ) : (
          <div className="max-w-full overflow-x-auto">
            <table className="min-w-full">
              <thead className="border-gray-100 dark:border-gray-800 border-y">
                <tr>
                  <th className="py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                    Модуль
                  </th>
                  <th className="py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                    Статус
                  </th>
                  <th className="py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                    API base_url
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {items.map((p) => (
                  <tr key={p.name}>
                    <td className="py-3 text-theme-sm text-gray-800 dark:text-white/90">
                      {p.name}
                    </td>
                    <td className="py-3 text-theme-sm text-gray-500 dark:text-gray-400">
                      {p.enabled ? "включён" : "выключен"}
                    </td>
                    <td className="py-3 text-theme-sm text-gray-500 dark:text-gray-400">
                      {p.manifest?.api?.base_url || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {!items.length && (
              <div className="text-sm text-gray-500 dark:text-gray-400 mt-4">
                Пока нет модулей.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

