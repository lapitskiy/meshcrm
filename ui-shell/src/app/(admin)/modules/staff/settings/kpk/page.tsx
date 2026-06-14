"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Label from "@/components/form/Label";
import Input from "@/components/form/input/InputField";
import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { PencilIcon, TrashBinIcon } from "@/icons/index";
import React, { useCallback, useEffect, useMemo, useState } from "react";

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

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

export default function StaffCompanyCodeSettingsPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [tree, setTree] = useState<KpkChapter[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [newChapterNo, setNewChapterNo] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");

  const [articleChapterId, setArticleChapterId] = useState("");
  const [newArticleNo, setNewArticleNo] = useState("");
  const [newArticleTitle, setNewArticleTitle] = useState("");

  const [pointChapterId, setPointChapterId] = useState("");
  const [pointArticleId, setPointArticleId] = useState("");
  const [newPointNo, setNewPointNo] = useState("");
  const [newPointDescription, setNewPointDescription] = useState("");

  const [editChapterId, setEditChapterId] = useState<string | null>(null);
  const [editChapterNo, setEditChapterNo] = useState("");
  const [editChapterTitle, setEditChapterTitle] = useState("");

  const [editArticleId, setEditArticleId] = useState<string | null>(null);
  const [editArticleNo, setEditArticleNo] = useState("");
  const [editArticleTitle, setEditArticleTitle] = useState("");

  const [editPointId, setEditPointId] = useState<string | null>(null);
  const [editPointNo, setEditPointNo] = useState("");
  const [editPointDescription, setEditPointDescription] = useState("");

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const loadTree = useCallback(async () => {
    const resp = await fetch(`${base}/staff/staff/kpk`, { cache: "no-store", headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`КПК: ${resp.status} ${body}`);
    }
    setTree((await resp.json()) as KpkChapter[]);
  }, [base]);

  useEffect(() => {
    void loadTree().catch((e: any) => setError(e?.message || "Не удалось загрузить КПК"));
  }, [loadTree]);

  const chaptersSorted = useMemo(
    () => [...tree].sort((a, b) => a.chapter_no - b.chapter_no),
    [tree]
  );

  const articlesForPointChapter = useMemo(() => {
    const ch = tree.find((c) => c.id === pointChapterId);
    return ch ? [...ch.articles].sort((a, b) => a.article_no - b.article_no) : [];
  }, [tree, pointChapterId]);

  const parseErr = async (resp: Response) => {
    try {
      const j = await resp.json();
      const d = (j as { detail?: unknown }).detail;
      return typeof d === "string" ? d : JSON.stringify(d);
    } catch {
      return await resp.text();
    }
  };

  const onAddChapter = async () => {
    const no = Number.parseInt(String(newChapterNo).trim(), 10);
    const title = newChapterTitle.trim();
    if (!Number.isFinite(no) || no < 1) {
      setError("Укажите номер главы (целое число от 1)");
      return;
    }
    if (!title) {
      setError("Введите название главы");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/kpk/chapters`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ chapter_no: no, title }),
      });
      if (!resp.ok) throw new Error(await parseErr(resp));
      setNewChapterNo("");
      setNewChapterTitle("");
      await loadTree();
      setOk("Глава добавлена");
    } catch (e: any) {
      setError(e?.message || "Не удалось добавить главу");
    } finally {
      setBusy(false);
    }
  };

  const onAddArticle = async () => {
    if (!articleChapterId) {
      setError("Выберите главу");
      return;
    }
    const no = Number.parseInt(String(newArticleNo).trim(), 10);
    const title = newArticleTitle.trim();
    if (!Number.isFinite(no) || no < 1) {
      setError("Укажите номер статьи");
      return;
    }
    if (!title) {
      setError("Введите название статьи");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/kpk/articles`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ chapter_id: articleChapterId, article_no: no, title }),
      });
      if (!resp.ok) throw new Error(await parseErr(resp));
      setNewArticleNo("");
      setNewArticleTitle("");
      await loadTree();
      setOk("Статья добавлена");
    } catch (e: any) {
      setError(e?.message || "Не удалось добавить статью");
    } finally {
      setBusy(false);
    }
  };

  const onAddPoint = async () => {
    if (!pointArticleId) {
      setError("Выберите статью");
      return;
    }
    const no = Number.parseInt(String(newPointNo).trim(), 10);
    const description = newPointDescription.trim();
    if (!Number.isFinite(no) || no < 1) {
      setError("Укажите номер пункта");
      return;
    }
    if (!description) {
      setError("Введите текст пункта");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/kpk/points`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ article_id: pointArticleId, point_no: no, description }),
      });
      if (!resp.ok) throw new Error(await parseErr(resp));
      setNewPointNo("");
      setNewPointDescription("");
      await loadTree();
      setOk("Пункт добавлен");
    } catch (e: any) {
      setError(e?.message || "Не удалось добавить пункт");
    } finally {
      setBusy(false);
    }
  };

  const deleteJson = async (url: string) => {
    const resp = await fetch(url, { method: "DELETE", headers: authHeaders() });
    if (!resp.ok) throw new Error(await parseErr(resp));
  };

  const onDeleteChapter = async (id: string) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await deleteJson(`${base}/staff/staff/kpk/chapters/${encodeURIComponent(id)}`);
      if (editChapterId === id) setEditChapterId(null);
      await loadTree();
      setOk("Глава удалена");
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteArticle = async (id: string) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await deleteJson(`${base}/staff/staff/kpk/articles/${encodeURIComponent(id)}`);
      if (editArticleId === id) setEditArticleId(null);
      await loadTree();
      setOk("Статья удалена");
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить");
    } finally {
      setBusy(false);
    }
  };

  const onDeletePoint = async (id: string) => {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await deleteJson(`${base}/staff/staff/kpk/points/${encodeURIComponent(id)}`);
      if (editPointId === id) setEditPointId(null);
      await loadTree();
      setOk("Пункт удалён");
    } catch (e: any) {
      setError(e?.message || "Не удалось удалить");
    } finally {
      setBusy(false);
    }
  };

  const saveChapter = async () => {
    if (!editChapterId) return;
    const no = Number.parseInt(String(editChapterNo).trim(), 10);
    const title = editChapterTitle.trim();
    if (!Number.isFinite(no) || no < 1 || !title) {
      setError("Проверьте номер и название главы");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/kpk/chapters/${encodeURIComponent(editChapterId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ chapter_no: no, title }),
      });
      if (!resp.ok) throw new Error(await parseErr(resp));
      setEditChapterId(null);
      await loadTree();
      setOk("Глава сохранена");
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const saveArticle = async () => {
    if (!editArticleId) return;
    const no = Number.parseInt(String(editArticleNo).trim(), 10);
    const title = editArticleTitle.trim();
    if (!Number.isFinite(no) || no < 1 || !title) {
      setError("Проверьте номер и название статьи");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/kpk/articles/${encodeURIComponent(editArticleId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ article_no: no, title }),
      });
      if (!resp.ok) throw new Error(await parseErr(resp));
      setEditArticleId(null);
      await loadTree();
      setOk("Статья сохранена");
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  const savePoint = async () => {
    if (!editPointId) return;
    const no = Number.parseInt(String(editPointNo).trim(), 10);
    const description = editPointDescription.trim();
    if (!Number.isFinite(no) || no < 1 || !description) {
      setError("Проверьте номер и текст пункта");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const resp = await fetch(`${base}/staff/staff/kpk/points/${encodeURIComponent(editPointId)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ point_no: no, description }),
      });
      if (!resp.ok) throw new Error(await parseErr(resp));
      setEditPointId(null);
      await loadTree();
      setOk("Пункт сохранён");
    } catch (e: any) {
      setError(e?.message || "Не удалось сохранить");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Настройки · КПК" />
      <div className="space-y-6 rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        {error ? <div className="text-sm text-red-600">Ошибка: {error}</div> : null}
        {ok ? <div className="text-sm text-green-600">{ok}</div> : null}

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Добавить главу</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div>
              <Label>Номер главы</Label>
              <Input
                type="number"
                min={1}
                value={newChapterNo}
                onChange={(e: any) => setNewChapterNo(e.target.value)}
                placeholder="Например: 1"
              />
            </div>
            <div className="md:col-span-2">
              <Label>Название главы</Label>
              <Input value={newChapterTitle} onChange={(e: any) => setNewChapterTitle(e.target.value)} placeholder="Название" />
            </div>
          </div>
          <div className="mt-4">
            <Button size="sm" disabled={busy} onClick={() => void onAddChapter()}>
              Добавить главу
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Добавить статью</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Глава</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={articleChapterId}
                onChange={(e) => setArticleChapterId(e.target.value)}
                disabled={!chaptersSorted.length}
              >
                <option value="">{chaptersSorted.length ? "Выберите главу" : "Нет глав"}</option>
                {chaptersSorted.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.chapter_no}. {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Номер статьи</Label>
              <Input
                type="number"
                min={1}
                value={newArticleNo}
                onChange={(e: any) => setNewArticleNo(e.target.value)}
                placeholder="Например: 2"
              />
            </div>
            <div>
              <Label>Название статьи</Label>
              <Input value={newArticleTitle} onChange={(e: any) => setNewArticleTitle(e.target.value)} placeholder="Название" />
            </div>
          </div>
          <div className="mt-4">
            <Button size="sm" disabled={busy || !chaptersSorted.length} onClick={() => void onAddArticle()}>
              Добавить статью
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Добавить пункт</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <Label>Глава</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={pointChapterId}
                onChange={(e) => {
                  setPointChapterId(e.target.value);
                  setPointArticleId("");
                }}
                disabled={!chaptersSorted.length}
              >
                <option value="">{chaptersSorted.length ? "Выберите главу" : "Нет глав"}</option>
                {chaptersSorted.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.chapter_no}. {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Статья</Label>
              <select
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                value={pointArticleId}
                onChange={(e) => setPointArticleId(e.target.value)}
                disabled={!pointChapterId || !articlesForPointChapter.length}
              >
                <option value="">
                  {!pointChapterId
                    ? "Сначала выберите главу"
                    : articlesForPointChapter.length
                      ? "Выберите статью"
                      : "В главе нет статей"}
                </option>
                {articlesForPointChapter.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.article_no}. {a.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Номер пункта</Label>
              <Input
                type="number"
                min={1}
                value={newPointNo}
                onChange={(e: any) => setNewPointNo(e.target.value)}
                placeholder="Например: 1"
              />
            </div>
            <div className="xl:col-span-2">
              <Label>Текст пункта</Label>
              <Input value={newPointDescription} onChange={(e: any) => setNewPointDescription(e.target.value)} placeholder="Формулировка" />
            </div>
          </div>
          <div className="mt-4">
            <Button size="sm" disabled={busy || !pointArticleId} onClick={() => void onAddPoint()}>
              Добавить пункт
            </Button>
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <h2 className="mb-4 text-lg font-semibold text-gray-800 dark:text-white/90">Дерево кодекса</h2>
          {!chaptersSorted.length ? (
            <div className="text-sm text-gray-500 dark:text-gray-400">Пока нет глав.</div>
          ) : (
            <ul className="space-y-6">
              {chaptersSorted.map((ch) => (
                <li key={ch.id} className="rounded-lg border border-gray-100 dark:border-gray-800">
                  <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
                    {editChapterId === ch.id ? (
                      <div className="grid w-full gap-3 md:grid-cols-3">
                        <div>
                          <Label>Номер</Label>
                          <Input type="number" min={1} value={editChapterNo} onChange={(e: any) => setEditChapterNo(e.target.value)} />
                        </div>
                        <div className="md:col-span-2">
                          <Label>Название</Label>
                          <Input value={editChapterTitle} onChange={(e: any) => setEditChapterTitle(e.target.value)} />
                        </div>
                        <div className="flex gap-2 md:col-span-3">
                          <Button size="sm" disabled={busy} onClick={() => void saveChapter()}>
                            Сохранить
                          </Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditChapterId(null)}>
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="text-sm font-semibold text-gray-800 dark:text-white/90">
                          Глава {ch.chapter_no}. {ch.title}
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className="text-brand-600 hover:text-brand-700 dark:text-brand-400"
                            title="Изменить"
                            onClick={() => {
                              setEditChapterId(ch.id);
                              setEditChapterNo(String(ch.chapter_no));
                              setEditChapterTitle(ch.title);
                            }}
                          >
                            <PencilIcon className="size-5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="text-red-600 hover:text-red-700 dark:text-red-400"
                            title="Удалить главу со всем содержимым"
                            onClick={() => void onDeleteChapter(ch.id)}
                          >
                            <TrashBinIcon className="size-5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  <ul className="space-y-3 px-4 py-3">
                    {[...ch.articles].sort((a, b) => a.article_no - b.article_no).map((art) => (
                      <li key={art.id} className="rounded-md bg-gray-50 px-3 py-2 dark:bg-white/[0.04]">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          {editArticleId === art.id ? (
                            <div className="grid w-full gap-3 md:grid-cols-3">
                              <div>
                                <Label>Номер статьи</Label>
                                <Input type="number" min={1} value={editArticleNo} onChange={(e: any) => setEditArticleNo(e.target.value)} />
                              </div>
                              <div className="md:col-span-2">
                                <Label>Название</Label>
                                <Input value={editArticleTitle} onChange={(e: any) => setEditArticleTitle(e.target.value)} />
                              </div>
                              <div className="flex gap-2 md:col-span-3">
                                <Button size="sm" disabled={busy} onClick={() => void saveArticle()}>
                                  Сохранить
                                </Button>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditArticleId(null)}>
                                  Отмена
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="text-sm text-gray-800 dark:text-gray-200">
                                Статья {art.article_no}. {art.title}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="text-brand-600 hover:text-brand-700 dark:text-brand-400"
                                  title="Изменить"
                                  onClick={() => {
                                    setEditArticleId(art.id);
                                    setEditArticleNo(String(art.article_no));
                                    setEditArticleTitle(art.title);
                                  }}
                                >
                                  <PencilIcon className="size-5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={busy}
                                  className="text-red-600 hover:text-red-700 dark:text-red-400"
                                  title="Удалить статью и пункты"
                                  onClick={() => void onDeleteArticle(art.id)}
                                >
                                  <TrashBinIcon className="size-5" />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        <ul className="mt-2 space-y-2 border-l border-gray-200 pl-3 dark:border-gray-700">
                          {[...art.points].sort((a, b) => a.point_no - b.point_no).map((pt) => (
                            <li key={pt.id} className="text-sm">
                              {editPointId === pt.id ? (
                                <div className="grid gap-3 md:grid-cols-3">
                                  <div>
                                    <Label>Номер</Label>
                                    <Input type="number" min={1} value={editPointNo} onChange={(e: any) => setEditPointNo(e.target.value)} />
                                  </div>
                                  <div className="md:col-span-2">
                                    <Label>Текст</Label>
                                    <Input value={editPointDescription} onChange={(e: any) => setEditPointDescription(e.target.value)} />
                                  </div>
                                  <div className="flex gap-2 md:col-span-3">
                                    <Button size="sm" disabled={busy} onClick={() => void savePoint()}>
                                      Сохранить
                                    </Button>
                                    <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditPointId(null)}>
                                      Отмена
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <span className="text-gray-700 dark:text-gray-300">
                                    {pt.point_no}. {pt.description}
                                  </span>
                                  <div className="flex shrink-0 gap-2">
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="text-brand-600 hover:text-brand-700 dark:text-brand-400"
                                      title="Изменить"
                                      onClick={() => {
                                        setEditPointId(pt.id);
                                        setEditPointNo(String(pt.point_no));
                                        setEditPointDescription(pt.description);
                                      }}
                                    >
                                      <PencilIcon className="size-5" />
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busy}
                                      className="text-red-600 hover:text-red-700 dark:text-red-400"
                                      title="Удалить пункт"
                                      onClick={() => void onDeletePoint(pt.id)}
                                    >
                                      <TrashBinIcon className="size-5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
