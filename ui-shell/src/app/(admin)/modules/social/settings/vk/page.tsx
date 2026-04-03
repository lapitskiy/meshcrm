"use client";

import React, { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { getGatewayBaseUrl } from "@/lib/gateway";

type VkGroupItem = {
  id: number;
  name: string;
  resolved_name?: string;
  group_id: string;
  enabled: boolean;
  is_default: boolean;
};

export default function SocialVkSettingsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [vkSettings, setVkSettings] = useState<{
    id: number;
    name: string;
    group_id: string;
    confirmation_code: string;
    callback_secret: string;
    api_token: string;
    api_version: string;
    longpoll_wait: number;
    enabled: boolean;
  }>({
    id: 0,
    name: "",
    group_id: "",
    confirmation_code: "",
    callback_secret: "",
    api_token: "",
    api_version: "5.199",
    longpoll_wait: 25,
    enabled: false,
  });
  const [groups, setGroups] = useState<VkGroupItem[]>([]);
  const [selectedSettingsId, setSelectedSettingsId] = useState<number>(0);
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [longPollBusy, setLongPollBusy] = useState(false);
  const [longPollStatus, setLongPollStatus] = useState<{ ok: boolean | null; message: string }>({
    ok: null,
    message: "",
  });
  const [longPollSession, setLongPollSession] = useState<{ server: string; key: string; ts: string }>({
    server: "",
    key: "",
    ts: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const getToken = () => (window as any).__hubcrmAccessToken || "";
  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadGroups = async (): Promise<VkGroupItem[]> => {
    const resp = await fetch(`${base}/social/settings/vk/groups`, { cache: "no-store", headers: authHeaders() });
    if (!resp.ok) throw new Error(`vk groups load failed: ${resp.status}`);
    const data = (await resp.json()) as VkGroupItem[];
    const list = Array.isArray(data) ? data : [];
    setGroups(list);
    return list;
  };

  const loadSettings = async (settingsId: number) => {
    const resp = await fetch(`${base}/social/settings/vk?settings_id=${settingsId}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) throw new Error(`vk settings load failed: ${resp.status}`);
    const data = await resp.json();
    setApiBaseUrl(String(data?.api_base_url || ""));
    setVkSettings({
      id: Number(data?.id || settingsId),
      name: String(data?.name || ""),
      group_id: String(data?.group_id || ""),
      confirmation_code: String(data?.confirmation_code || ""),
      callback_secret: String(data?.callback_secret || ""),
      api_token: String(data?.api_token || ""),
      api_version: String(data?.api_version || "5.199"),
      longpoll_wait: Number(data?.longpoll_wait || 25),
      enabled: Boolean(data?.enabled),
    });
    setSelectedSettingsId(Number(data?.id || settingsId));
  };

  const loadAll = async (forcedId?: number) => {
    setLoading(true);
    setError(null);
    try {
      const list = await loadGroups();
      const selected =
        forcedId || selectedSettingsId || list.find((x) => x.is_default)?.id || (list[0] ? Number(list[0].id) : 0);
      if (!selected) throw new Error("vk settings not found");
      await loadSettings(selected);
    } catch (e: any) {
      setError(e?.message || "failed to load vk settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createGroup = async () => {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`${base}/social/settings/vk/groups`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: "VK Group",
          api_base_url: "",
          api_token: "",
          api_version: "5.199",
          longpoll_wait: 25,
          group_id: "",
          confirmation_code: "",
          callback_secret: "",
          enabled: false,
        }),
      });
      if (!resp.ok) throw new Error(`vk group create failed: ${resp.status}`);
      const data = await resp.json();
      setOk("Группа создана");
      await loadAll(Number(data?.id || 0));
    } catch (e: any) {
      setError(e?.message || "failed to create vk group");
    } finally {
      setSaving(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/social/settings/vk?settings_id=${selectedSettingsId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          name: vkSettings.name,
          api_base_url: apiBaseUrl.trim(),
          api_token: vkSettings.api_token,
          api_version: vkSettings.api_version || "5.199",
          longpoll_wait: Math.max(1, Math.min(90, Number(vkSettings.longpoll_wait || 25))),
          group_id: vkSettings.group_id,
          confirmation_code: vkSettings.confirmation_code,
          callback_secret: vkSettings.callback_secret,
          enabled: vkSettings.enabled,
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`vk settings save failed: ${resp.status} ${body}`);
      }
      setOk("Сохранено");
      await loadGroups();
    } catch (e: any) {
      setError(e?.message || "failed to save vk settings");
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/social/settings/vk/groups/${selectedSettingsId}/default`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!resp.ok) throw new Error(`set default failed: ${resp.status}`);
      setOk("Группа установлена как основная");
      await loadGroups();
    } catch (e: any) {
      setError(e?.message || "failed to set default");
    } finally {
      setSaving(false);
    }
  };

  const deleteGroup = async () => {
    if (!selectedSettingsId) return;
    if (!window.confirm("Удалить выбранную VK группу?")) return;
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/social/settings/vk/groups/${selectedSettingsId}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`delete failed: ${resp.status} ${body}`);
      }
      setOk("Группа удалена");
      await loadAll();
    } catch (e: any) {
      setError(e?.message || "failed to delete group");
    } finally {
      setSaving(false);
    }
  };

  const bootstrapLongPoll = async () => {
    setLongPollBusy(true);
    setLongPollStatus({ ok: null, message: "" });
    try {
      const resp = await fetch(`${base}/social/settings/vk/longpoll/bootstrap?settings_id=${selectedSettingsId}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`bootstrap failed: ${resp.status} ${body}`);
      }
      const data = await resp.json();
      setLongPollSession({
        server: String(data?.server || ""),
        key: String(data?.key || ""),
        ts: String(data?.ts || ""),
      });
      setLongPollStatus({ ok: true, message: String(data?.message || "long poll initialized") });
    } catch (e: any) {
      setLongPollStatus({ ok: false, message: e?.message || "bootstrap failed" });
    } finally {
      setLongPollBusy(false);
    }
  };

  const checkLongPoll = async () => {
    setLongPollBusy(true);
    setLongPollStatus({ ok: null, message: "" });
    try {
      const resp = await fetch(`${base}/social/settings/vk/longpoll/check?settings_id=${selectedSettingsId}`, {
        cache: "no-store",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`longpoll check failed: ${resp.status} ${body}`);
      }
      const data = await resp.json();
      setLongPollSession({
        server: String(data?.server || ""),
        key: String(data?.key || ""),
        ts: String(data?.ts || ""),
      });
      setLongPollStatus({
        ok: Boolean(data?.connected),
        message: `${String(data?.message || "")}${Number.isFinite(data?.updates_count) ? `, updates=${data?.updates_count}` : ""}`,
      });
    } catch (e: any) {
      setLongPollStatus({ ok: false, message: e?.message || "longpoll check failed" });
    } finally {
      setLongPollBusy(false);
    }
  };

  const maskKey = (value: string) => (value.length > 10 ? `${value.slice(0, 4)}...${value.slice(-4)}` : value);


  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Соцсети · Вконтакте</h3>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">Укажите настройки Callback API для Вконтакте.</p>
        {error ? <div className="mb-3 text-sm text-red-600">Ошибка: {error}</div> : null}
        {ok ? <div className="mb-3 text-sm text-green-600">{ok}</div> : null}
        <div className="space-y-3">
          <div className="rounded-lg border border-gray-100 px-3 py-3 dark:border-gray-800 space-y-2">
            <div className="text-sm text-gray-700 dark:text-gray-300">VK группы</div>
            <div className="flex gap-2 flex-wrap">
              {groups.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadSettings(item.id)}
                  className={`rounded-md border px-3 py-1 text-sm ${
                    selectedSettingsId === item.id
                      ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                      : "border-gray-200 dark:border-gray-700"
                  }`}
                >
                  {item.resolved_name || item.name || `VK #${item.id}`} {item.is_default ? "· default" : ""}
                </button>
              ))}
              <Button size="sm" disabled={loading || saving} onClick={createGroup}>
                + Группа
              </Button>
            </div>
          </div>
          <div>
            <Label>Название группы</Label>
            <Input
              value={vkSettings.name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVkSettings((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="VK Group 1"
              disabled={loading || saving}
            />
          </div>
          <div className="rounded-lg border border-gray-100 px-3 py-3 dark:border-gray-800">
            <label className="inline-flex items-center gap-2 text-sm text-gray-800 dark:text-white/90">
              <input
                type="checkbox"
                checked={!!vkSettings.enabled}
                onChange={(e) => setVkSettings((prev) => ({ ...prev, enabled: e.target.checked }))}
                disabled={loading || saving}
              />
              <span>Включить Вконтакте</span>
            </label>
          </div>
          <div>
            <Label>Group ID</Label>
            <Input
              value={vkSettings.group_id}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setVkSettings((prev) => ({ ...prev, group_id: e.target.value }))
              }
              placeholder="13277801"
              disabled={loading || saving}
            />
          </div>
          <div>
            <Label>Token сообщества (VK access token)</Label>
            <Input
              value={vkSettings.api_token}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setVkSettings((prev) => ({ ...prev, api_token: e.target.value }))
              }
              placeholder="vk1.a...."
              disabled={loading || saving}
            />
          </div>
          <div>
            <Label>VK API version</Label>
            <Input
              value={vkSettings.api_version}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setVkSettings((prev) => ({ ...prev, api_version: e.target.value }))
              }
              placeholder="5.199"
              disabled={loading || saving}
            />
          </div>
          <div>
            <Label>Long Poll wait (1-90)</Label>
            <Input
              value={String(vkSettings.longpoll_wait)}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setVkSettings((prev) => ({ ...prev, longpoll_wait: Number(e.target.value || 25) }))
              }
              placeholder="25"
              disabled={loading || saving}
            />
          </div>
          <div>
            <Label>Код подтверждения (confirmation)</Label>
            <Input
              value={vkSettings.confirmation_code}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setVkSettings((prev) => ({ ...prev, confirmation_code: e.target.value }))
              }
              placeholder="e6575b4a"
              disabled={loading || saving}
            />
          </div>
          <div>
            <Label>API адрес</Label>
            <Input
              value={apiBaseUrl}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setApiBaseUrl(e.target.value)}
              placeholder="https://api.vk.com/method"
              disabled={loading || saving}
            />
          </div>
          <div className="rounded-lg border border-gray-100 px-3 py-3 dark:border-gray-800">
            <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Bots Long Poll API</div>
            {longPollStatus.ok === null ? (
              <div className="text-sm text-gray-500 dark:text-gray-400">Статус не проверен</div>
            ) : longPollStatus.ok ? (
              <div className="text-sm text-green-600">✓ {longPollStatus.message || "Long Poll OK"}</div>
            ) : (
              <div className="text-sm text-red-600">✕ {longPollStatus.message || "Long Poll error"}</div>
            )}
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              <div>server: {longPollSession.server || "-"}</div>
              <div>key: {longPollSession.key ? maskKey(longPollSession.key) : "-"}</div>
              <div>ts: {longPollSession.ts || "-"}</div>
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" disabled={loading || saving || longPollBusy} onClick={bootstrapLongPoll}>
                Init Long Poll
              </Button>
              <Button size="sm" disabled={loading || saving || longPollBusy} onClick={checkLongPoll}>
                Check Long Poll
              </Button>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={loading || saving} onClick={onSave}>
              Сохранить
            </Button>
            <Button size="sm" disabled={loading || saving} onClick={setDefault}>
              Сделать default
            </Button>
            <Button size="sm" disabled={loading || saving} onClick={deleteGroup}>
              Удалить
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
