"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import { getGatewayBaseUrl } from "@/lib/gateway";
import Link from "next/link";
import React, { useEffect, useMemo, useState } from "react";

type KpkPoint = { id: string; point_no: number; description: string };
type KpkArticle = { id: string; article_no: number; title: string; points: KpkPoint[] };
type KpkChapter = { id: string; chapter_no: number; title: string; articles: KpkArticle[] };

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

export default function StaffCompanyCodePage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [tree, setTree] = useState<KpkChapter[]>([]);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${base}/staff/staff/kpk`, { cache: "no-store", headers: authHeaders() });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`КПК: ${resp.status} ${body}`);
        }
        setTree((await resp.json()) as KpkChapter[]);
      } catch (e: any) {
        setError(e?.message || "Не удалось загрузить КПК");
      }
    })();
  }, [base]);

  const chaptersSorted = useMemo(
    () => [...tree].sort((a, b) => a.chapter_no - b.chapter_no),
    [tree]
  );

  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · КПК" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Кодекс Правил Компании</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Главы, статьи и пункты по номерам.</p>
          </div>
          <Link className="text-sm font-medium text-brand-500" href="/modules/staff/settings/kpk">
            Настроить КПК
          </Link>
        </div>

        {error ? <div className="text-sm text-red-600">Ошибка: {error}</div> : null}
        {!error && !chaptersSorted.length ? (
          <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
            КПК пока пуст.
          </div>
        ) : null}
        {!!chaptersSorted.length ? (
          <ul className="space-y-6">
            {chaptersSorted.map((ch) => (
              <li key={ch.id} className="rounded-xl border border-gray-200 p-4 dark:border-gray-800">
                <div className="text-base font-semibold text-gray-800 dark:text-white/90">
                  Глава {ch.chapter_no}. {ch.title}
                </div>
                <ul className="mt-3 space-y-4 border-l border-gray-200 pl-4 dark:border-gray-700">
                  {[...ch.articles].sort((a, b) => a.article_no - b.article_no).map((art) => (
                    <li key={art.id}>
                      <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        Статья {art.article_no}. {art.title}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {[...art.points].sort((a, b) => a.point_no - b.point_no).map((pt) => (
                          <li key={pt.id} className="text-sm text-gray-600 dark:text-gray-400">
                            {pt.point_no}. {pt.description}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
