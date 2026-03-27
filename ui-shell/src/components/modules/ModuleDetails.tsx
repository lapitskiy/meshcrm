"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useState } from "react";

type Props = {
  name: string;
};

export default function ModuleDetails({ name }: Props) {
  const [data, setData] = useState<any | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const base = getGatewayBaseUrl();
        const resp = await fetch(`${base}/plugins/${encodeURIComponent(name)}`, { cache: "no-store" });
        if (!resp.ok) throw new Error(`plugin not found: ${resp.status}`);
        setData(await resp.json());
      } catch (e: any) {
        setError(e?.message || "failed to load module");
      }
    })();
  }, [name]);

  return (
    <div>
      <PageBreadcrumb pageTitle={`Модуль · ${name}`} />

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        {error ? (
          <div className="text-sm text-red-600">Ошибка: {error}</div>
        ) : (
          <>
            <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
              API: <span className="font-mono">{data?.api?.base_url || "—"}</span>
            </div>
            <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
{JSON.stringify(data, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

