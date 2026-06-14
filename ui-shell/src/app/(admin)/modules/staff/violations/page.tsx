"use client";

import React, { useEffect, useMemo, useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Button from "@/components/ui/button/Button";
import DatePicker from "@/components/form/date-picker";
import { getGatewayBaseUrl } from "@/lib/gateway";

type KpkPoint = {
  id: string;
  point_no: number;
  description: string;
};

type KpkArticle = {
  id: string;
  article_no: number;
  title: string;
  points: KpkPoint[];
};

type KpkChapter = {
  id: string;
  chapter_no: number;
  title: string;
  articles: KpkArticle[];
};

type UserOption = {
  user_uuid: string;
  display_name: string;
};

type ViolationOut = {
  id: string;
  user_uuid: string;
  user_name: string;
  kpk_point_id: string | null;
  kpk_chapter_no: number | null;
  kpk_article_no: number | null;
  kpk_point_no: number | null;
  kpk_point_description: string | null;
  comment: string;
  created_by_name: string;
  created_at: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function toYmdLocal(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function StaffViolationsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [tree, setTree] = useState<KpkChapter[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [violations, setViolations] = useState<ViolationOut[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [filterUser, setFilterUser] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  const [newUser, setNewUser] = useState("");
  const [newChapterId, setNewChapterId] = useState("");
  const [newArticleId, setNewArticleId] = useState("");
  const [newPointId, setNewPointId] = useState("");
  const [newComment, setNewComment] = useState("");

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadInitialData = async () => {
    try {
      const [kpkResp, usersResp] = await Promise.all([
        fetch(`${base}/staff/staff/kpk`, { cache: "no-store", headers: authHeaders() }),
        fetch(`${base}/plugins/access/users/search?q=`, { cache: "no-store", headers: authHeaders() })
      ]);
      if (kpkResp.ok) {
        setTree(await kpkResp.json());
      }
      if (usersResp.ok) {
        setUsers(await usersResp.json());
      }
    } catch (e: any) {
      setError("Не удалось загрузить исходные данные");
    }
  };

  const loadViolations = async () => {
    try {
      const params = new URLSearchParams();
      if (filterUser) params.set("user_uuid", filterUser);
      if (filterDateFrom) params.set("from_date", filterDateFrom);
      if (filterDateTo) params.set("to_date", filterDateTo);
      const resp = await fetch(`${base}/staff/staff/violations?${params.toString()}`, {
        cache: "no-store",
        headers: authHeaders()
      });
      if (resp.ok) {
        setViolations(await resp.json());
      }
    } catch (e: any) {
      setError("Не удалось загрузить список предупреждений");
    }
  };

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    void loadViolations();
  }, [filterUser, filterDateFrom, filterDateTo]);

  const chaptersSorted = useMemo(() => [...tree].sort((a, b) => a.chapter_no - b.chapter_no), [tree]);
  const currentChapter = tree.find(c => c.id === newChapterId);
  const articlesSorted = currentChapter ? [...currentChapter.articles].sort((a, b) => a.article_no - b.article_no) : [];
  const currentArticle = articlesSorted.find(a => a.id === newArticleId);
  const pointsSorted = currentArticle ? [...currentArticle.points].sort((a, b) => a.point_no - b.point_no) : [];

  const onAddViolation = async () => {
    if (!newUser) {
      setError("Выберите пользователя");
      return;
    }
    if (!newComment) {
      setError("Введите комментарий");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/violations`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          user_uuid: newUser,
          kpk_point_id: newPointId || null,
          comment: newComment
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text().catch(() => "");
        throw new Error(errText);
      }
      setNewUser("");
      setNewChapterId("");
      setNewArticleId("");
      setNewPointId("");
      setNewComment("");
      setOk("Предупреждение выдано");
      await loadViolations();
    } catch (e: any) {
      setError(e?.message || "Не удалось выдать предупреждение");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Нарушения" />
      <div className="flex flex-col gap-6 xl:flex-row">
        {/* Список предупреждений */}
        <div className="flex-1 space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Список предупреждений</h2>
          
          {/* Фильтры */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label>Сотрудник</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={filterUser}
                onChange={(e) => setFilterUser(e.target.value)}
              >
                <option value="">Все</option>
                {users.map(u => (
                  <option key={u.user_uuid} value={u.user_uuid}>{u.display_name}</option>
                ))}
              </select>
            </div>
            <div className="lg:col-span-2">
              <Label>Дата</Label>
              <div className="flex">
                <DatePicker
                  options={{ mode: "range" }}
                  onChange={(list) => {
                    const from = list[0] ? toYmdLocal(list[0] as Date) : "";
                    const to = list[1] ? toYmdLocal(list[1] as Date) : from;
                    setFilterDateFrom(from);
                    setFilterDateTo(to);
                  }}
                />
              </div>
            </div>
          </div>
          
          <div className="text-sm font-medium text-gray-600 dark:text-gray-400">
            Всего предупреждений: {violations.length}
          </div>

          <div className="space-y-3">
            {violations.length === 0 ? (
              <div className="text-sm text-gray-500">Нет предупреждений</div>
            ) : (
              violations.map((v) => (
                <div key={v.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-semibold">{v.user_name}</span>
                    <span className="text-gray-500">{new Date(v.created_at).toLocaleString("ru-RU")}</span>
                  </div>
                  {v.kpk_chapter_no && (
                    <div className="mb-2 text-xs text-brand-600 dark:text-brand-400">
                      КПК: Глава {v.kpk_chapter_no}, Статья {v.kpk_article_no}, Пункт {v.kpk_point_no}
                      {v.kpk_point_description ? ` (${v.kpk_point_description})` : ""}
                    </div>
                  )}
                  <div className="text-sm text-gray-800 dark:text-gray-200">
                    {v.comment}
                  </div>
                  <div className="mt-2 text-xs text-gray-400">
                    Выдал(а): {v.created_by_name}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Форма выдачи */}
        <div className="w-full shrink-0 xl:w-[400px] space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03]">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-white/90">Выдать предупреждение</h2>
          {error ? <div className="text-sm text-red-600">{error}</div> : null}
          {ok ? <div className="text-sm text-green-600">{ok}</div> : null}
          
          <div className="space-y-4">
            <div>
              <Label>Кому</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={newUser}
                onChange={(e) => setNewUser(e.target.value)}
              >
                <option value="">Выберите сотрудника</option>
                {users.map(u => (
                  <option key={u.user_uuid} value={u.user_uuid}>{u.display_name}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Глава КПК</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={newChapterId}
                onChange={(e) => {
                  setNewChapterId(e.target.value);
                  setNewArticleId("");
                  setNewPointId("");
                }}
              >
                <option value="">(Не выбрано)</option>
                {chaptersSorted.map(c => (
                  <option key={c.id} value={c.id}>Глава {c.chapter_no}. {c.title}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Статья КПК</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={newArticleId}
                onChange={(e) => {
                  setNewArticleId(e.target.value);
                  setNewPointId("");
                }}
                disabled={!newChapterId}
              >
                <option value="">(Не выбрано)</option>
                {articlesSorted.map(a => (
                  <option key={a.id} value={a.id}>Статья {a.article_no}. {a.title}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Пункт КПК</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={newPointId}
                onChange={(e) => setNewPointId(e.target.value)}
                disabled={!newArticleId}
              >
                <option value="">(Не выбрано)</option>
                {pointsSorted.map(p => (
                  <option key={p.id} value={p.id}>Пункт {p.point_no}. {p.description}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Комментарий</Label>
              <Input
                value={newComment}
                onChange={(e: any) => setNewComment(e.target.value)}
                placeholder="Причина предупреждения"
              />
            </div>

            <Button size="sm" disabled={busy} onClick={() => void onAddViolation()}>
              Добавить
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}