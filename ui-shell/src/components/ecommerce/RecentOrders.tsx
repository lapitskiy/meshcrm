"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getGatewayBaseUrl } from "@/lib/gateway";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "../ui/table";

type ProblemItem = {
  kind: "order" | "report";
  id: string;
  number: number | null;
  serial_model?: string;
  created_by_uuid?: string | null;
  created_by_name?: string;
  problem_since?: string;
  days_overdue?: number;
  priority?: number;
};

type ProblemOrderReminder = {
  order_id: string;
  order_number: number | null;
  serial_model?: string;
  created_by_uuid?: string | null;
  problem_since?: string;
  days_overdue?: number;
};

type CreatorInfo = {
  user_uuid?: string | null;
  username?: string;
  email?: string;
  full_name?: string;
};

function creatorDisplayName(creator: CreatorInfo | null | undefined): string {
  if (!creator) return "-";
  const fullName = String(creator.full_name || "").trim();
  if (fullName) return fullName;
  const username = String(creator.username || "").trim();
  if (username) return username;
  const email = String(creator.email || "").trim();
  return email || "-";
}

function formatProblemCreatedAt(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU");
}

function formatProblemAgeDays(value: string | null | undefined): string {
  if (!value) return "-";
  const startedAt = new Date(value);
  if (Number.isNaN(startedAt.getTime())) return "-";
  const diffDays = Math.max(0, Math.floor((Date.now() - startedAt.getTime()) / (1000 * 60 * 60 * 24)));
  if (diffDays === 0) return "сегодня";
  const mod10 = diffDays % 10;
  const mod100 = diffDays % 100;
  if (mod10 === 1 && mod100 !== 11) return `${diffDays} день`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${diffDays} дня`;
  return `${diffDays} дней`;
}

export default function RecentOrders() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const router = useRouter();
  const [items, setItems] = useState<ProblemItem[]>([]);
  const [creatorByItemId, setCreatorByItemId] = useState<Record<string, CreatorInfo | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = (window as any).__hubcrmAccessToken || "";
        const headers = token ? { authorization: `Bearer ${token}` } : {};
        const [problemResp, reportResp] = await Promise.all([
          fetch(`${base}/orders/orders/problem-reminders?limit=1000`, { cache: "no-store", headers }),
          fetch(`${base}/orders/report/problem-reminders?limit=1000`, { cache: "no-store", headers }),
        ]);
        if (!problemResp.ok) {
          const body = await problemResp.text().catch(() => "");
          throw new Error(`problem orders load failed: ${problemResp.status} ${body}`);
        }
        if (!reportResp.ok) {
          const body = await reportResp.text().catch(() => "");
          throw new Error(`problem reports load failed: ${reportResp.status} ${body}`);
        }
        const problemData = (await problemResp.json()) as ProblemOrderReminder[];
        const reportData = (await reportResp.json()) as Array<{
          report_id: string;
          report_number: number | null;
          created_by_uuid?: string | null;
          created_by_name?: string;
          problem_since?: string;
          days_overdue?: number;
        }>;
        const orderItems: ProblemItem[] = (Array.isArray(problemData) ? problemData : []).map((order) => ({
          kind: "order",
          id: order.order_id,
          number: order.order_number,
          serial_model: order.serial_model,
          created_by_uuid: order.created_by_uuid,
          problem_since: order.problem_since,
          days_overdue: order.days_overdue,
          priority: 1,
        }));
        const reportItems: ProblemItem[] = (Array.isArray(reportData) ? reportData : []).map((report) => ({
          kind: "report",
          id: report.report_id,
          number: report.report_number,
          created_by_uuid: report.created_by_uuid,
          created_by_name: report.created_by_name,
          problem_since: report.problem_since,
          days_overdue: report.days_overdue,
          priority: 0,
        }));
        const nextItems = [...orderItems, ...reportItems]
          .sort((a, b) => {
            const priorityDiff = (b.priority || 0) - (a.priority || 0);
            if (priorityDiff) return priorityDiff;
            return new Date(b.problem_since || 0).getTime() - new Date(a.problem_since || 0).getTime();
          });

        const creatorEntries = await Promise.all(
          nextItems.map(async (item) => {
            if (item.kind === "report") {
              return [item.id, { full_name: item.created_by_name || "", user_uuid: item.created_by_uuid || "" }] as const;
            }
            try {
              const resp = await fetch(`${base}/orders/orders/${encodeURIComponent(item.id)}/creator`, {
                cache: "no-store",
                headers,
              });
              if (!resp.ok) return [item.id, null] as const;
              const creator = (await resp.json()) as CreatorInfo;
              return [item.id, creator] as const;
            } catch {
              return [item.id, null] as const;
            }
          })
        );

        if (!cancelled) {
          setItems(nextItems);
          setCreatorByItemId(Object.fromEntries(creatorEntries));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить проблемы");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [base]);

  const getProblemHref = (item: ProblemItem) => {
    const params = new URLSearchParams();
    if (item.kind === "order") {
      params.set("order_ids", item.id);
      params.set("open_order_id", item.id);
      return `/modules/orders/list?${params.toString()}`;
    }
    params.set("open_report_id", item.id);
    return `/modules/orders/report/list?${params.toString()}`;
  };

  const openProblem = (item: ProblemItem) => {
    router.push(getProblemHref(item));
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white px-4 pb-3 pt-4 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6">
      <div className="mb-4">
        <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
          Проблемы
        </h3>
      </div>
      <div className="max-w-full overflow-x-auto">
        {loading ? (
          <div className="py-10 text-center text-sm text-gray-500 dark:text-gray-400">Загрузка...</div>
        ) : error ? (
          <div className="py-10 text-center text-sm text-red-500">{error}</div>
        ) : (
          <Table>
            <TableHeader className="border-gray-100 dark:border-gray-800 border-y">
              <TableRow>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Номер
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Тип
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Мастер
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Дата проблемы
                </TableCell>
                <TableCell isHeader className="py-3 font-medium text-gray-500 text-start text-theme-xs dark:text-gray-400">
                  Возраст
                </TableCell>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
              {items.length ? (
                items.map((item) => (
                  <TableRow
                    key={`${item.kind}-${item.id}`}
                    className="cursor-pointer hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                    onClick={() => openProblem(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openProblem(item);
                      }
                    }}
                    tabIndex={0}
                    role="link"
                  >
                    <TableCell className="py-3 text-theme-sm">
                      <span className="font-medium text-gray-800 dark:text-white/90">
                        {item.number ? `#${item.number}` : "-"}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-gray-500 text-theme-sm dark:text-gray-400">
                      {item.kind === "order" ? "Заказ" : "Отчет"}
                    </TableCell>
                    <TableCell className="py-3 text-gray-500 text-theme-sm dark:text-gray-400">
                      {creatorDisplayName(creatorByItemId[item.id])}
                    </TableCell>
                    <TableCell className="py-3 text-gray-500 text-theme-sm dark:text-gray-400">
                      {formatProblemCreatedAt(item.problem_since)}
                    </TableCell>
                    <TableCell className="py-3 text-gray-500 text-theme-sm dark:text-gray-400">
                      {formatProblemAgeDays(item.problem_since)}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
                    Проблем нет
                  </TableCell>
                  <TableCell className="py-6" />
                  <TableCell className="py-6" />
                  <TableCell className="py-6" />
                  <TableCell className="py-6" />
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
