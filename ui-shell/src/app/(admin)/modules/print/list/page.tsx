"use client";

import Button from "@/components/ui/button/Button";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { PencilIcon, TrashBinIcon, EyeIcon, CopyIcon } from "@/icons/index";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type PrintFormListItem = {
  id: string;
  title: string;
  category_id?: string | null;
  category_name?: string;
  page_width_mm: number;
  page_height_mm: number;
  page_margin_mm: number;
  page_auto_height: boolean;
  page_offset_x_mm?: number | null;
  page_offset_y_mm?: number | null;
  page_rotation_deg?: number | null;
  qz_enabled: boolean;
  updated_at: string;
};

type PrintFormDetails = {
  id: string;
  title: string;
  content_html: string;
  content_json: any;
  category_id?: string | null;
  category_name?: string;
  page_width_mm: number;
  page_height_mm: number;
  page_margin_mm: number;
  page_auto_height: boolean;
  page_offset_x_mm?: number | null;
  page_offset_y_mm?: number | null;
  page_rotation_deg?: number | null;
  qz_enabled: boolean;
  updated_at: string;
};

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function pageSizeMm(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(2000, Math.round(parsed)));
}

function optionalPrintNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function printTransformCss(form: PrintFormDetails): string {
  const x = optionalPrintNumber(form.page_offset_x_mm);
  const y = optionalPrintNumber(form.page_offset_y_mm);
  const rotation = optionalPrintNumber(form.page_rotation_deg);
  const parts: string[] = [];
  if (x !== null || y !== null) parts.push(`translate(${x ?? 0}mm, ${y ?? 0}mm)`);
  if (rotation === 90) parts.push("rotate(90deg) translateY(-100%)");
  if (rotation === 180) parts.push("rotate(180deg) translate(-100%, -100%)");
  if (rotation === 270) parts.push("rotate(270deg) translateX(-100%)");
  return parts.length ? `transform:${parts.join(" ")};transform-origin:top left;` : "";
}

export default function PrintFormsListPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<PrintFormListItem[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, PrintFormDetails>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const load = async () => {
    const resp = await fetch(`${base}/documents/print/forms?limit=200`, { cache: "no-store", headers: authHeaders() });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`forms load failed: ${resp.status} ${body}`);
    }
    setItems((await resp.json()) as PrintFormListItem[]);
  };

  useEffect(() => {
    (async () => {
      try {
        await load();
      } catch (e: any) {
        setError(e?.message || "failed to load forms");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureDetails = async (id: string): Promise<PrintFormDetails> => {
    if (details[id]) return details[id];
    const resp = await fetch(`${base}/documents/print/forms/${encodeURIComponent(id)}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`form load failed: ${resp.status} ${body}`);
    }
    const data = (await resp.json()) as PrintFormDetails;
    setDetails((prev) => ({ ...prev, [id]: data }));
    return data;
  };

  const onToggleOpen = async (id: string) => {
    setError(null);
    if (openId === id) {
      setOpenId(null);
      return;
    }
    try {
      await ensureDetails(id);
      setOpenId(id);
    } catch (e: any) {
      setError(e?.message || "failed to load form");
    }
  };

  const onDelete = async (id: string) => {
    if (!window.confirm("Удалить форму?")) return;
    setBusyId(id);
    setError(null);
    try {
      const resp = await fetch(`${base}/documents/print/forms/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: authHeaders(),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`delete failed: ${resp.status} ${body}`);
      }
      setOpenId((prev) => (prev === id ? null : prev));
      setDetails((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await load();
    } catch (e: any) {
      setError(e?.message || "delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const onPrintSample = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const form = await ensureDetails(id);
      const html = form.content_html || "";
      const widthMm = pageSizeMm(form.page_width_mm, 200);
      const heightMm = pageSizeMm(form.page_height_mm, 300);
      const marginMm = pageSizeMm(form.page_margin_mm, 0);
      const autoHeight = Boolean(form.page_auto_height);
      const pageHeight = autoHeight ? "auto" : `${heightMm}mm`;
      const transformCss = printTransformCss(form);
      const popupWidth = Math.round(widthMm * 3.8);
      const popupHeight = autoHeight ? 900 : Math.round(heightMm * 3.8);
      const w = window.open("", "_blank", `width=${popupWidth},height=${popupHeight}`);
      if (!w) throw new Error("popup blocked");
      w.document.open();
      w.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>Print</title>
        <style>
          @page{size:${widthMm}mm ${pageHeight};margin:${marginMm}mm;}
          html,body{width:${widthMm}mm;margin:0;padding:0;}
          body{font-family:Arial, sans-serif;}
          .print-page{width:${widthMm}mm;${autoHeight ? "" : `min-height:${heightMm}mm;`}box-sizing:border-box;${transformCss}}
          img{max-width:100%;}
          table{max-width:100%;}
        </style>
      </head><body><div class="print-page">${html}</div></body></html>`);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 300);
    } catch (e: any) {
      setError(e?.message || "print failed");
    } finally {
      setBusyId(null);
    }
  };

  const onCopyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-6">
      <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Печать</h3>
      <div className="text-sm text-gray-600 dark:text-white/70 mb-6">Список форм</div>

      {error && <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="text-sm text-gray-600 dark:text-white/70">Всего: {items.length}</div>
          <Link href="/modules/print/create">
            <Button size="sm">Создать форму</Button>
          </Link>
        </div>

        {!items.length ? (
          <div className="text-sm text-gray-600 dark:text-white/70">Пока нет форм.</div>
        ) : (
          <div className="space-y-3">
            {items.map((f) => {
              const isOpen = openId === f.id;
              const d = details[f.id];
              return (
                <div key={f.id} className="rounded-xl border border-gray-100 dark:border-gray-800">
                  <button
                    className="w-full px-4 py-3 flex items-center gap-3 text-left"
                    onClick={() => void onToggleOpen(f.id)}
                  >
                    <span className="font-medium text-gray-800 dark:text-white/90">{f.title}</span>
                    {!!(f.category_name || "").trim() && (
                      <span className="rounded-full border border-gray-200 px-2 py-0.5 text-xs text-gray-600 dark:border-gray-800 dark:text-white/70">
                        {String(f.category_name)}
                      </span>
                    )}
                    {f.qz_enabled && (
                      <span className="rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 text-xs text-brand-700 dark:border-brand-900/40 dark:bg-brand-900/20 dark:text-brand-300">
                        QZ
                      </span>
                    )}
                    <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">
                      {new Date(f.updated_at).toLocaleString()}
                    </span>
                  </button>

                  <div className="px-4 pb-3 flex flex-wrap gap-2">
                    <Link href={`/modules/print/create?id=${encodeURIComponent(f.id)}`}>
                      <button
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                        title="Редактировать"
                        disabled={busyId === f.id}
                      >
                        <PencilIcon className="w-4 h-4" />
                        Редактировать
                      </button>
                    </Link>
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                      title="Печать образца"
                      onClick={() => void onPrintSample(f.id)}
                      disabled={busyId === f.id}
                    >
                      <EyeIcon className="w-4 h-4" />
                      Печать образца
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                      title="Скопировать id"
                      onClick={() => void onCopyId(f.id)}
                      disabled={busyId === f.id}
                    >
                      <CopyIcon className="w-4 h-4" />
                      ID
                    </button>
                    <button
                      className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-1 text-sm text-red-700 hover:bg-red-50 dark:border-red-900/40 dark:text-red-300 dark:hover:bg-red-900/20"
                      title="Удалить"
                      onClick={() => void onDelete(f.id)}
                      disabled={busyId === f.id}
                    >
                      <TrashBinIcon className="w-4 h-4" />
                      Удалить
                    </button>
                  </div>

                  {isOpen && (
                    <div className="px-4 pb-4">
                      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-black/10">
                        {!d ? (
                          <div className="text-sm text-gray-600 dark:text-white/70">Загрузка…</div>
                        ) : (
                          <div
                            className="text-sm text-gray-800 dark:text-white/90 [&_img]:max-w-full"
                            dangerouslySetInnerHTML={{ __html: d.content_html || "<p>(пусто)</p>" }}
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

