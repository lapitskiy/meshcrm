"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { getGatewayBaseUrl } from "@/lib/gateway";
import React, { useEffect, useMemo, useState } from "react";

type PluginMeta = {
  name: string;
  enabled: boolean;
  manifest: any;
};

type ModuleLink = {
  source_module: string;
  target_module: string;
  enabled: boolean;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function tryParseJwt(token: string): any | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(payload)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export default function ModulesSettings() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<PluginMeta[]>([]);
  const [links, setLinks] = useState<ModuleLink[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [linksBusy, setLinksBusy] = useState(false);

  const [baseUrl, setBaseUrl] = useState("http://");

  const load = async () => {
    const [metaResp, linksResp] = await Promise.all([
      fetch(`${base}/plugins/_meta?enabled_only=false`, { cache: "no-store" }),
      fetch(`${base}/plugins/_links?enabled_only=false`, { cache: "no-store" }),
    ]);
    if (!metaResp.ok) throw new Error(`plugins meta failed: ${metaResp.status}`);
    if (!linksResp.ok) throw new Error(`plugins links failed: ${linksResp.status}`);
    setItems((await metaResp.json()) as PluginMeta[]);
    setLinks((await linksResp.json()) as ModuleLink[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load modules");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onToggle = async (pluginName: string, enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const token = getToken();
      const resp = await fetch(`${base}/plugins/${encodeURIComponent(pluginName)}/toggle`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ enabled }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`toggle failed: ${resp.status} ${body}`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "toggle failed");
    } finally {
      setBusy(false);
    }
  };

  const onConnect = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = getToken();
      if (!token) throw new Error("нет access_token (нужно войти через Keycloak)");
      const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
      if (!normalizedBaseUrl.startsWith("http://") && !normalizedBaseUrl.startsWith("https://")) {
        throw new Error("api.base_url должен начинаться с http:// или https://");
      }
      const manifestResp = await fetch(`${normalizedBaseUrl}/manifest`, { cache: "no-store" });
      if (!manifestResp.ok) {
        const body = await manifestResp.text().catch(() => "");
        throw new Error(`module manifest fetch failed: ${manifestResp.status} ${body}`);
      }
      const manifest = await manifestResp.json();
      if (!manifest?.name || !manifest?.bounded_context || !manifest?.version) {
        throw new Error("manifest должен содержать name, bounded_context, version");
      }
      manifest.api = { ...(manifest.api || {}), base_url: normalizedBaseUrl };

      const resp = await fetch(`${base}/plugins/${encodeURIComponent(String(manifest.name))}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ enabled: true, manifest }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`register failed: ${resp.status} ${body}`);
      }
      setBaseUrl("http://");
      await load();
    } catch (e: any) {
      setError(e?.message || "connect failed");
    } finally {
      setBusy(false);
    }
  };

  const onSetLink = async (sourceModule: string, targetModule: string, enabled: boolean) => {
    setLinksBusy(true);
    setError(null);
    try {
      const token = getToken();
      const resp = await fetch(
        `${base}/plugins/_links/${encodeURIComponent(sourceModule)}/${encodeURIComponent(targetModule)}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ enabled }),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`set link failed: ${resp.status} ${body}`);
      }
      await load();
    } catch (e: any) {
      setError(e?.message || "failed to set module link");
    } finally {
      setLinksBusy(false);
    }
  };

  const enabledModules = items.filter((m) => m.enabled).map((m) => m.name);
  const linksMap = new Map<string, boolean>();
  links.forEach((l) => {
    linksMap.set(`${l.source_module}::${l.target_module}`, l.enabled);
  });

  return (
    <div>
      <PageBreadcrumb pageTitle="Настройки · Модули" />

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="text-xs text-gray-500 dark:text-gray-400 mb-4">
          Auth:{" "}
          {(() => {
            const t = getToken();
            const p = t ? tryParseJwt(t) : null;
            return t
              ? `token ok, iss=${p?.iss || "?"}, aud=${Array.isArray(p?.aud) ? p.aud.join(",") : p?.aud || "?"}`
              : "no token";
          })()}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          Здесь вы подключаете модуль через его собственный <span className="font-medium">/manifest</span> endpoint.
          Введите <span className="font-medium">api.base_url</span> (например:
          <span className="font-mono"> http://contacts:8000</span>), и registry загрузит manifest из модуля.
        </div>

        {error && <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div>}

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Подключить модуль</h3>
            <div className="space-y-4">
              <div>
                <Label>api.base_url</Label>
                <Input
                  value={baseUrl}
                  onChange={(e: any) => setBaseUrl(e.target.value)}
                  placeholder="http://my-service:8000 (service must expose /manifest)"
                />
              </div>
              <Button size="sm" disabled={busy} onClick={onConnect} className="w-full">
                Подключить из /manifest
              </Button>
            </div>
          </div>

          <div>
            <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Список модулей</h3>
            <div className="max-w-full overflow-x-auto">
              <table className="min-w-full">
                <thead className="border-gray-100 dark:border-gray-800 border-y">
                  <tr>
                    <th className="py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">name</th>
                    <th className="py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      enabled
                    </th>
                    <th className="py-3 text-start text-theme-xs font-medium text-gray-500 dark:text-gray-400">
                      action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {items.map((p) => (
                    <tr key={p.name}>
                      <td className="py-3 text-theme-sm text-gray-800 dark:text-white/90">{p.name}</td>
                      <td className="py-3 text-theme-sm text-gray-500 dark:text-gray-400">
                        {p.enabled ? "true" : "false"}
                      </td>
                      <td className="py-3 text-theme-sm">
                        <button
                          disabled={busy}
                          className="text-brand-600 hover:text-brand-700 dark:text-brand-400"
                          onClick={() => onToggle(p.name, !p.enabled)}
                        >
                          {p.enabled ? "выключить" : "включить"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!items.length && (
                <div className="text-sm text-gray-500 dark:text-gray-400 mt-4">Пока нет модулей.</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8">
          <h3 className="mb-4 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Связанные модули</h3>
          <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Отметьте чекбоксы, чтобы разрешить доступ исходного модуля к данным целевого модуля через API.
          </div>
          {enabledModules.length < 2 ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Нужно минимум 2 включенных модуля для настройки связей.
            </div>
          ) : (
            <div className="space-y-4">
              {enabledModules.map((source) => (
                <div
                  key={source}
                  className="rounded-lg border border-gray-100 dark:border-gray-800 px-4 py-3"
                >
                  <div className="text-sm font-medium text-gray-800 dark:text-white/90 mb-2">{source}</div>
                  <div className="flex flex-wrap gap-4">
                    {enabledModules
                      .filter((target) => target !== source)
                      .map((target) => {
                        const key = `${source}::${target}`;
                        const checked = linksMap.get(key) || false;
                        return (
                          <label key={key} className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={linksBusy}
                              onChange={(e) => void onSetLink(source, target, e.target.checked)}
                            />
                            <span>{target}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

