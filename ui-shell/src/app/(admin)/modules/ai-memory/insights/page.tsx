"use client";

import React, { useState } from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

export default function AiMemoryInsightsPage() {
  const [monthsAgo, setMonthsAgo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  const run = async () => {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const r = await fetch(
        `${getGatewayBaseUrl()}/ai-memory/insights/ozon-finances?months_ago=${encodeURIComponent(String(monthsAgo))}`,
        { method: "POST", headers: { Authorization: `Bearer ${getToken()}` } }
      );
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        return;
      }
      setResult(String(j?.result ?? ""));
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-4">ИИ - Анализ Ozon финансов</h1>
      <div className="flex items-center gap-3 mb-4">
        <button type="button" className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50" disabled={busy} onClick={run}>
          {busy ? "Анализирую..." : "Запустить анализ"}
        </button>
        <select
          className="h-11 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          value={monthsAgo}
          onChange={(e) => setMonthsAgo(Number(e.target.value))}
          disabled={busy}
        >
          {Array.from({ length: 12 }).map((_, i) => {
            const v = i + 1;
            return <option key={v} value={v}>{v === 1 ? "Прошлый месяц" : `${v} месяца назад`}</option>;
          })}
        </select>
      </div>
      {error ? <div className="mb-4 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div> : null}
      {result ? <pre className="whitespace-pre-wrap rounded-xl border border-gray-200 p-4 text-sm dark:border-gray-800">{result}</pre> : null}
    </div>
  );
}
