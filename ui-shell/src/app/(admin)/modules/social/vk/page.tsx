"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";

type VkConversation = {
  peer_id: string;
  last_message_text: string;
  last_from_id: string;
  last_from_name: string;
  last_message_ts: number;
  messages_count: number;
  needs_reply?: boolean;
};

type VkGroupItem = {
  id: number;
  name: string;
  resolved_name?: string;
  group_id: string;
  enabled: boolean;
  is_default: boolean;
};

type VkMessage = {
  event_type: string;
  event_id: string;
  text: string;
  from_id: string;
  sender_name: string;
  is_outgoing: boolean;
  peer_id: string;
  created_at: number;
  attachments: { type: string; title: string; url: string }[];
};

export default function SocialVkMessagesPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [groups, setGroups] = useState<VkGroupItem[]>([]);
  const [selectedSettingsId, setSelectedSettingsId] = useState<number>(0);
  const [conversations, setConversations] = useState<VkConversation[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>("");
  const [messages, setMessages] = useState<VkMessage[]>([]);
  const [offset, setOffset] = useState(0);
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [dismissingPeerId, setDismissingPeerId] = useState<string>("");
  const [previewImage, setPreviewImage] = useState<{ url: string; title: string } | null>(null);
  const groupsRef = useRef<VkGroupItem[]>([]);
  const selectedSettingsIdRef = useRef(0);
  const selectedPeerIdRef = useRef("");

  const authHeaders = () => {
    const token = (window as any).__hubcrmAccessToken || "";
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadGroups = async (): Promise<VkGroupItem[]> => {
    const resp = await fetch(`${base}/social/settings/vk/groups`, { cache: "no-store", headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`vk groups load failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as VkGroupItem[];
    const list = Array.isArray(data) ? data : [];
    setGroups(list);
    groupsRef.current = list;
    return list;
  };

  const pullLongPoll = async (settingsId: number) => {
    const resp = await fetch(`${base}/social/settings/vk/longpoll/messages?limit=1&settings_id=${settingsId}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`longpoll pull failed: ${resp.status} ${body}`);
    }
    const data = await resp.json();
    if (!data?.connected) {
      throw new Error(String(data?.message || "Long Poll not connected"));
    }
    setStatus(`Long Poll OK, updates=${Number(data?.updates_count || 0)}`);
  };

  const loadConversations = async (settingsId: number) => {
    const resp = await fetch(`${base}/social/vk/conversations?limit=100&settings_id=${settingsId}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`conversations load failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as VkConversation[];
    setConversations(data || []);
    if (!selectedPeerIdRef.current && (data || []).length) {
      setSelectedPeerId(String(data[0].peer_id));
    }
  };

  const loadThread = async (peerId: string, settingsId: number, nextOffset = 0, append = false) => {
    if (!peerId) {
      setMessages([]);
      setOffset(0);
      return;
    }
    setThreadLoading(true);
    try {
      const resp = await fetch(
        `${base}/social/vk/conversations/${encodeURIComponent(peerId)}/messages?limit=50&offset=${nextOffset}&settings_id=${settingsId}`,
        {
          cache: "no-store",
          headers: authHeaders(),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`thread load failed: ${resp.status} ${body}`);
      }
      const rows = (await resp.json()) as VkMessage[];
      const ordered = (rows || []).slice().reverse();
      setMessages((prev) => (append ? [...ordered, ...prev] : ordered));
      setOffset(nextOffset + (rows || []).length);
    } finally {
      setThreadLoading(false);
    }
  };

  const refreshAll = async (forcedSettingsId?: number) => {
    setRefreshing(true);
    setError(null);
    try {
      const list = groupsRef.current.length ? groupsRef.current : await loadGroups();
      const settingsId =
        forcedSettingsId ||
        selectedSettingsIdRef.current ||
        list.find((x) => x.is_default)?.id ||
        (list[0] ? Number(list[0].id) : 0);
      if (!settingsId) {
        setConversations([]);
        setMessages([]);
        setSelectedPeerId("");
        setStatus("Нет VK групп");
        return;
      }
      if (!selectedSettingsIdRef.current) setSelectedSettingsId(settingsId);
      await pullLongPoll(settingsId);
      await loadConversations(settingsId);
      if (selectedPeerIdRef.current) {
        await loadThread(selectedPeerIdRef.current, settingsId, 0, false);
      }
    } catch (e: any) {
      setError(e?.message || "failed to load messages");
    } finally {
      setRefreshing(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  useEffect(() => {
    selectedSettingsIdRef.current = selectedSettingsId;
  }, [selectedSettingsId]);

  useEffect(() => {
    selectedPeerIdRef.current = selectedPeerId;
  }, [selectedPeerId]);

  useEffect(() => {
    if (!previewImage) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewImage]);

  useEffect(() => {
    void refreshAll();
    const timer = window.setInterval(() => {
      void refreshAll();
    }, 15000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedPeerId) return;
    setReplyText("");
    if (!selectedSettingsId) return;
    void loadThread(selectedPeerId, selectedSettingsId, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPeerId, selectedSettingsId]);

  const sendReply = async () => {
    if (!selectedPeerId) return;
    const text = replyText.trim();
    if (!text) return;
    setSending(true);
    setError(null);
    try {
      const resp = await fetch(
        `${base}/social/vk/conversations/${encodeURIComponent(selectedPeerId)}/reply?settings_id=${selectedSettingsId}`,
        {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ text }),
      }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`send failed: ${resp.status} ${body}`);
      }
      setReplyText("");
      await loadThread(selectedPeerId, selectedSettingsId, 0, false);
      await loadConversations(selectedSettingsId);
      setStatus("Сообщение отправлено");
    } catch (e: any) {
      setError(e?.message || "failed to send reply");
    } finally {
      setSending(false);
    }
  };

  const onSelectGroup = async (settingsId: number) => {
    setSelectedSettingsId(settingsId);
    setSelectedPeerId("");
    setMessages([]);
    setOffset(0);
    await refreshAll(settingsId);
  };

  const dismissReplyNeed = async (peerId: string) => {
    if (!selectedSettingsId) return;
    setDismissingPeerId(peerId);
    setError(null);
    try {
      const resp = await fetch(
        `${base}/social/vk/conversations/${encodeURIComponent(peerId)}/dismiss-reply?settings_id=${selectedSettingsId}`,
        {
          method: "POST",
          headers: authHeaders(),
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`dismiss reply failed: ${resp.status} ${body}`);
      }
      await loadConversations(selectedSettingsId);
    } catch (e: any) {
      setError(e?.message || "failed to dismiss reply marker");
    } finally {
      setDismissingPeerId("");
    }
  };

  const selectedGroup = groups.find((x) => x.id === selectedSettingsId);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800 text-theme-xl dark:text-white/90">Вконтакте · Сообщения группы</h3>
          <Button size="sm" disabled={refreshing} onClick={() => void refreshAll()}>
            {refreshing ? "Обновляю..." : "Обновить"}
          </Button>
        </div>
        <div className="mb-3 rounded-lg border border-gray-100 dark:border-gray-800 p-3">
          <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Группа VK</div>
          <div className="flex gap-2 flex-wrap">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => void onSelectGroup(g.id)}
                className={`rounded-md border px-3 py-1 text-sm ${
                  selectedSettingsId === g.id
                    ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                {g.resolved_name || g.name || `VK #${g.id}`} {g.is_default ? "· default" : ""}
              </button>
            ))}
          </div>
          {selectedGroup ? (
            <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
              group_id: {selectedGroup.group_id || "-"} · {selectedGroup.enabled ? "enabled" : "disabled"}
            </div>
          ) : null}
        </div>
        {error ? <div className="mb-3 text-sm text-red-600">Ошибка: {error}</div> : null}
        {status ? <div className="mb-3 text-sm text-gray-600 dark:text-gray-300">{status}</div> : null}

        {loading ? <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка...</div> : null}
        {!loading ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="lg:col-span-1 rounded-lg border border-gray-100 dark:border-gray-800 p-3 max-h-[70vh] overflow-y-auto">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Диалоги</div>
              {!conversations.length ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Пока нет сообщений.</div>
              ) : (
                <div className="space-y-2">
                  {conversations.map((conv) => (
                    <div
                      key={conv.peer_id}
                      onClick={() => setSelectedPeerId(conv.peer_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedPeerId(conv.peer_id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      className={`w-full cursor-pointer text-left rounded-lg border px-3 py-2 ${
                        selectedPeerId === conv.peer_id
                          ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10"
                          : "border-gray-100 dark:border-gray-800"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm text-gray-800 dark:text-white/90">peer {conv.peer_id}</div>
                        {conv.needs_reply ? (
                          <div className="flex items-center gap-1">
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                              Ждет ответа
                            </span>
                            <button
                              type="button"
                              className="rounded-full border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500 hover:text-red-600 dark:border-gray-700 dark:text-gray-400"
                              disabled={dismissingPeerId === conv.peer_id}
                              onClick={(e) => {
                                e.stopPropagation();
                                void dismissReplyNeed(conv.peer_id);
                              }}
                              title="Ответ не нужен"
                            >
                              {dismissingPeerId === conv.peer_id ? "..." : "×"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                        {conv.last_message_text || "[без текста]"}
                      </div>
                      <div className="text-[11px] text-gray-400 mt-1">
                        {conv.last_from_name || conv.last_from_id || "-"} · сообщений: {conv.messages_count}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="lg:col-span-2 rounded-lg border border-gray-100 dark:border-gray-800 p-3 max-h-[70vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Переписка {selectedPeerId ? `(peer ${selectedPeerId})` : ""}
                </div>
                <Button
                  size="sm"
                  disabled={!selectedPeerId || threadLoading || sending}
                  onClick={() => void loadThread(selectedPeerId, selectedSettingsId, offset, true)}
                >
                  Загрузить еще
                </Button>
              </div>
              {!selectedPeerId ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Выберите диалог слева.</div>
              ) : threadLoading && !messages.length ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">Загрузка переписки...</div>
              ) : !messages.length ? (
                <div className="text-sm text-gray-500 dark:text-gray-400">В этом диалоге пока нет сохраненных сообщений.</div>
              ) : (
                <div className="space-y-2">
                  {messages.map((item) => (
                    <div key={item.event_id} className={`flex ${item.is_outgoing ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[85%] rounded-lg border px-3 py-3 ${
                          item.is_outgoing
                            ? "border-brand-300 bg-brand-50 dark:bg-brand-500/20 dark:border-brand-400"
                            : "border-gray-100 dark:border-gray-800"
                        }`}
                      >
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {item.sender_name || item.from_id || "-"} · {item.created_at || 0}
                        </div>
                        <div className="text-sm text-gray-800 dark:text-white/90 mt-1 whitespace-pre-wrap">
                          {item.text || "[без текста]"}
                        </div>
                        {item.attachments?.length ? (
                          <div className="mt-2 space-y-1">
                            {item.attachments.map((att, idx) => (
                              <div key={`${item.event_id}-att-${idx}`} className="text-xs">
                                {att.type === "photo" && att.url ? (
                                  <button
                                    type="button"
                                    className="inline-block"
                                    onClick={() => setPreviewImage({ url: att.url, title: att.title || "Фото" })}
                                  >
                                    <img
                                      src={att.url}
                                      alt={att.title || "Фото"}
                                      className="rounded-lg border border-gray-200 dark:border-gray-700 object-cover cursor-zoom-in"
                                      style={{ width: 300, height: 300, maxWidth: "100%", maxHeight: "100%" }}
                                      loading="lazy"
                                    />
                                  </button>
                                ) : att.url ? (
                                  <a
                                    href={att.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-brand-600 hover:text-brand-700 dark:text-brand-400"
                                  >
                                    {att.title || att.type}
                                  </a>
                                ) : (
                                  <span className="text-gray-500 dark:text-gray-400">{att.title || att.type}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {selectedPeerId ? (
                <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <div className="text-sm text-gray-700 dark:text-gray-300 mb-2">Ответить</div>
                  <textarea
                    className="w-full rounded-lg border border-gray-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-gray-700"
                    rows={4}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Введите ответ..."
                    disabled={sending}
                  />
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" disabled={sending || !replyText.trim()} onClick={sendReply}>
                      {sending ? "Отправляю..." : "Отправить"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      {previewImage ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={() => setPreviewImage(null)}
          role="presentation"
        >
          <button
            type="button"
            onClick={() => setPreviewImage(null)}
            className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1 text-2xl leading-none text-white hover:bg-white/20"
            aria-label="Закрыть"
          >
            x
          </button>
          <img
            src={previewImage.url}
            alt={previewImage.title}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
