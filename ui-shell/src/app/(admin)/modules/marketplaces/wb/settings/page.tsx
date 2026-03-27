"use client";

import Switch from "@/components/form/switch/Switch";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useState } from "react";

export default function WbSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState(
    "eyJhbGciOiJFUzI1NiIsImtpZCI6IjIwMjUwOTA0djEiLCJ0eXAiOiJKV1QifQ.eyJhY2MiOjMsImVudCI6MSwiZXhwIjoxNzgzMzY0NTc0LCJmb3IiOiJzZWxmIiwiaWQiOiIwMTliOGNmNy00ODJkLTc1ZWEtYjUyNi1iYWJlNzE1MjllNjQiLCJpaWQiOjI2NDg1NDI0LCJvaWQiOjE0MTAwOTMsInMiOjgxNTM0LCJzaWQiOiI2M2E1OGJiYi0yMDYxLTQ3NzgtOTExNC04NmQ4ZDVhOTIzOWEiLCJ0IjpmYWxzZSwidWlkIjoyNjQ4NTQyNH0.v_Ih5_XyHaRGJ_44sl4Uo9wgwizihX6YG3frOB5ODrWOiafsqPLeIlibg9vLTUkYYJ83VjyLJnhJGNO6HtXy_Q"
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/settings`, {
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

  const save = async () => {
    setBusy(true);
    setStatus("Сохраняю...");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/settings`, {
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

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-6">Маркетплейсы → WB → Настройки</h1>
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="flex items-center justify-between mb-6">
          <Switch key={`wb-${enabled}`} label="Включить" onChange={setEnabled} defaultChecked={enabled} />
        </div>
        <div className="space-y-4">
          <div>
            <Label>Wildberries api</Label>
            <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
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
    </div>
  );
}
