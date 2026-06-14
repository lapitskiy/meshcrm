"use client";

import React, { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";

type NewsType = "news" | "warning" | "rule";

type NewsPost = {
  id: string;
  type: NewsType;
  title: string;
  body: string;
  rule_reference: string;
  created_by: string;
  published_at?: string | null;
};

type ChatMessage = {
  id: number;
  body: string;
  created_by: string;
  created_at: string;
};

const typeLabels: Record<NewsType, string> = {
  news: "Новость",
  warning: "Предупреждение",
  rule: "Внутреннее правило",
};

export default function CommunicationsNewsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [posts, setPosts] = useState<NewsPost[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [ruleReference, setRuleReference] = useState("");
  const [type, setType] = useState<NewsType>("news");
  const [messageBody, setMessageBody] = useState("");

  const authHeaders = () => {
    const token = (window as any).__hubcrmAccessToken || "";
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadData = async () => {
    setError("");
    try {
      const [newsResp, chatResp] = await Promise.all([
        fetch(`${base}/communications/news`, { cache: "no-store", headers: authHeaders() }),
        fetch(`${base}/communications/chat/messages`, { cache: "no-store", headers: authHeaders() }),
      ]);
      if (!newsResp.ok) throw new Error(`news load failed: ${newsResp.status}`);
      if (!chatResp.ok) throw new Error(`chat load failed: ${chatResp.status}`);
      setPosts((await newsResp.json()) || []);
      setMessages((await chatResp.json()) || []);
    } catch (e: any) {
      setError(e?.message || "Не удалось загрузить новости");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createPost = async () => {
    setSaving(true);
    setError("");
    try {
      const resp = await fetch(`${base}/communications/news`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ type, title, body, rule_reference: ruleReference, is_published: true }),
      });
      if (!resp.ok) throw new Error(`news create failed: ${resp.status}`);
      setTitle("");
      setBody("");
      setRuleReference("");
      setType("news");
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Не удалось создать новость");
    } finally {
      setSaving(false);
    }
  };

  const sendMessage = async () => {
    const text = messageBody.trim();
    if (!text) return;
    setError("");
    try {
      const resp = await fetch(`${base}/communications/chat/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ body: text }),
      });
      if (!resp.ok) throw new Error(`message send failed: ${resp.status}`);
      setMessageBody("");
      await loadData();
    } catch (e: any) {
      setError(e?.message || "Не удалось отправить сообщение");
    }
  };

  return (
    <div>
      <PageBreadcrumb pageTitle="Новости" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="mb-5">
            <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Новости и предупреждения</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Общая лента для новостей, предупреждений и ссылок на КПК/внутренние правила.</p>
          </div>

          {error ? <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

          <div className="mb-6 grid gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
            <div className="grid gap-3 md:grid-cols-[160px_1fr]">
              <select className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" value={type} onChange={(e) => setType(e.target.value as NewsType)}>
                <option value="news">Новость</option>
                <option value="warning">Предупреждение</option>
                <option value="rule">Внутреннее правило</option>
              </select>
              <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" placeholder="Заголовок" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <textarea className="min-h-28 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" placeholder="Текст новости или предупреждения" value={body} onChange={(e) => setBody(e.target.value)} />
            <input className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" placeholder="Ссылка на КПК / внутреннее правило" value={ruleReference} onChange={(e) => setRuleReference(e.target.value)} />
            <div>
              <Button size="sm" onClick={createPost} disabled={saving || !title.trim() || !body.trim()}>
                Опубликовать
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            {loading ? <div className="text-sm text-gray-500">Загрузка...</div> : null}
            {!loading && posts.length === 0 ? <div className="text-sm text-gray-500">Новостей пока нет.</div> : null}
            {posts.map((post) => (
              <article key={post.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-600">{typeLabels[post.type]}</span>
                  {post.rule_reference ? <span className="text-xs text-gray-500">{post.rule_reference}</span> : null}
                </div>
                <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">{post.title}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm text-gray-600 dark:text-gray-300">{post.body}</p>
              </article>
            ))}
          </div>
        </div>

        <aside id="chat" className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Общий чат</h2>
          <div className="mt-4 h-[520px] space-y-3 overflow-y-auto rounded-xl border border-gray-200 p-3 dark:border-gray-800">
            {messages.length === 0 ? <div className="text-sm text-gray-500">Сообщений пока нет.</div> : null}
            {messages.map((message) => (
              <div key={message.id} className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/[0.05]">
                <div className="mb-1 text-xs text-gray-400">{message.created_by}</div>
                <div className="whitespace-pre-wrap text-gray-700 dark:text-gray-200">{message.body}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-2">
            <input className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900" placeholder="Сообщение" value={messageBody} onChange={(e) => setMessageBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void sendMessage()} />
            <Button size="sm" onClick={sendMessage} disabled={!messageBody.trim()}>
              Отправить
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
