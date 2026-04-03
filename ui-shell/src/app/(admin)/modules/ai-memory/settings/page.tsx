"use client";

import React, { useEffect, useState } from "react";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Switch from "@/components/form/switch/Switch";
import { getGatewayBaseUrl } from "@/lib/gateway";

export default function AiMemorySettingsPage() {
  const [provider, setProvider] = useState("gigachat");
  const [model, setModel] = useState("GigaChat");
  const [baseUrl, setBaseUrl] = useState("https://gigachat.devices.sberbank.ru/api/v1");
  const [oauthUrl, setOauthUrl] = useState("https://ngw.devices.sberbank.ru:9443/api/v2/oauth");
  const [oauthScope, setOauthScope] = useState("GIGACHAT_API_PERS");
  const [basicAuthB64, setBasicAuthB64] = useState("");
  const [tlsInsecure, setTlsInsecure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`${getGatewayBaseUrl()}/ai-memory/settings/gigachat`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        if (!r.ok) return;
        const d = await r.json();
        setProvider(String(d?.provider ?? "gigachat"));
        setModel(String(d?.model ?? "GigaChat"));
        setBaseUrl(String(d?.base_url ?? ""));
        setOauthUrl(String(d?.oauth_url ?? ""));
        setOauthScope(String(d?.oauth_scope ?? ""));
        setBasicAuthB64(String(d?.basic_auth_b64 ?? ""));
        setTlsInsecure(Boolean(d?.tls_insecure));
      } catch {
        // ignore
      }
    })();
  }, []);

  const save = async () => {
    setBusy(true);
    setStatus("Сохраняю...");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/ai-memory/settings/gigachat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          provider,
          model,
          base_url: baseUrl,
          oauth_url: oauthUrl,
          oauth_scope: oauthScope,
          basic_auth_b64: basicAuthB64,
          tls_insecure: tlsInsecure,
        }),
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
      <h1 className="text-2xl font-semibold mb-6">ИИ - Настройки GigaChat</h1>
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6">
          <Switch key={`tls-${tlsInsecure}`} label="TLS insecure (если нужно)" onChange={setTlsInsecure} defaultChecked={tlsInsecure} />
        </div>
        <div className="space-y-4">
          <div><Label>provider</Label><Input value={provider} onChange={(e) => setProvider(e.target.value)} /></div>
          <div><Label>model</Label><Input value={model} onChange={(e) => setModel(e.target.value)} /></div>
          <div><Label>base_url</Label><Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>
          <div><Label>oauth_url</Label><Input value={oauthUrl} onChange={(e) => setOauthUrl(e.target.value)} /></div>
          <div><Label>oauth_scope</Label><Input value={oauthScope} onChange={(e) => setOauthScope(e.target.value)} /></div>
          <div><Label>basic_auth_b64</Label><Input value={basicAuthB64} onChange={(e) => setBasicAuthB64(e.target.value)} /></div>
        </div>
        <div className="flex items-center gap-4 pt-6">
          <button type="button" className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50" disabled={busy} onClick={save}>
            Сохранить
          </button>
          <div className="text-sm text-gray-600">{status}</div>
        </div>
      </div>
    </div>
  );
}
