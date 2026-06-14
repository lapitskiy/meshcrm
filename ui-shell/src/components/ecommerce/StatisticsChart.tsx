"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ApexOptions } from "apexcharts";
import flatpickr from "flatpickr";
import ChartTab from "../common/ChartTab";
import { CalenderIcon } from "../../icons";
import { getGatewayBaseUrl } from "@/lib/gateway";

const Chart = dynamic(() => import("react-apexcharts"), { ssr: false });

type MonthlyOrdersByKindPoint = {
  month: string;
  label: string;
  onsite_count: number;
  repair_count: number;
};

type MonthlyOrdersChartPoint = MonthlyOrdersByKindPoint & {
  total_count: number;
};

type MonthlyOrdersTotalPoint = {
  month: string;
  label: string;
  orders_count: number;
};

export default function StatisticsChart() {
  const datePickerRef = useRef<HTMLInputElement>(null);
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [items, setItems] = useState<MonthlyOrdersChartPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!datePickerRef.current) return;

    const today = new Date();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(today.getDate() - 6);

    const fp = flatpickr(datePickerRef.current, {
      mode: "range",
      static: true,
      monthSelectorType: "static",
      dateFormat: "M d",
      defaultDate: [sevenDaysAgo, today],
      clickOpens: true,
      prevArrow:
        '<svg class="stroke-current" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12.5 15L7.5 10L12.5 5" stroke="" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      nextArrow:
        '<svg class="stroke-current" width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7.5 15L12.5 10L7.5 5" stroke="" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    });

    return () => {
      if (!Array.isArray(fp)) {
        fp.destroy();
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = (window as any).__hubcrmAccessToken || "";
        const headers = token ? { authorization: `Bearer ${token}` } : {};
        const [byKindResp, totalResp] = await Promise.all([
          fetch(`${base}/orders/orders/stats/monthly-orders-by-kind`, {
            cache: "no-store",
            headers,
          }),
          fetch(`${base}/orders/orders/stats/monthly-orders`, {
            cache: "no-store",
            headers,
          }),
        ]);
        if (!byKindResp.ok) {
          const body = await byKindResp.text().catch(() => "");
          throw new Error(`orders by kind load failed: ${byKindResp.status} ${body}`);
        }
        if (!totalResp.ok) {
          const body = await totalResp.text().catch(() => "");
          throw new Error(`orders total load failed: ${totalResp.status} ${body}`);
        }
        const data = (await byKindResp.json()) as { items?: MonthlyOrdersByKindPoint[] };
        const totalData = (await totalResp.json()) as { items?: MonthlyOrdersTotalPoint[] };
        if (!cancelled) {
          const totalsByMonth = new Map(
            (Array.isArray(totalData?.items) ? totalData.items : []).map((item) => [item.month, item.orders_count])
          );
          const nextItems = (Array.isArray(data?.items) ? data.items : []).map((item) => ({
            ...item,
            total_count: totalsByMonth.get(item.month) ?? item.onsite_count + item.repair_count,
          }));
          setItems(nextItems);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Не удалось загрузить статистику заказов");
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

  const options: ApexOptions = useMemo(
    () => ({
      legend: {
        show: true,
        position: "top",
        horizontalAlign: "left",
      },
      colors: ["#465FFF", "#9CB9FF", "#22C55E"],
      chart: {
        fontFamily: "Outfit, sans-serif",
        height: 310,
        type: "line",
        toolbar: {
          show: false,
        },
      },
      stroke: {
        curve: "straight",
        width: [2, 2, 2],
      },
      fill: {
        type: "gradient",
        gradient: {
          opacityFrom: 0.55,
          opacityTo: 0,
        },
      },
      markers: {
        size: 0,
        strokeColors: "#fff",
        strokeWidth: 2,
        hover: {
          size: 6,
        },
      },
      grid: {
        xaxis: {
          lines: {
            show: false,
          },
        },
        yaxis: {
          lines: {
            show: true,
          },
        },
      },
      dataLabels: {
        enabled: false,
      },
      tooltip: {
        enabled: true,
        x: {
          show: true,
        },
        y: {
          formatter: (val: number) => `${val} заказов`,
        },
      },
      xaxis: {
        type: "category",
        categories: items.map((item) => item.label),
        axisBorder: {
          show: false,
        },
        axisTicks: {
          show: false,
        },
        tooltip: {
          enabled: false,
        },
      },
      yaxis: {
        min: 0,
        forceNiceScale: true,
        labels: {
          style: {
            fontSize: "12px",
            colors: ["#6B7280"],
          },
        },
        title: {
          text: "",
          style: {
            fontSize: "0px",
          },
        },
      },
    }),
    [items]
  );

  const series = useMemo(
    () => [
      {
        name: "Заказы Услуга на месте",
        data: items.map((item) => item.onsite_count),
      },
      {
        name: "Заказы в ремонт",
        data: items.map((item) => item.repair_count),
      },
      {
        name: "Все заказы",
        data: items.map((item) => item.total_count),
      },
    ],
    [items]
  );

  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 pb-5 pt-5 dark:border-gray-800 dark:bg-white/[0.03] sm:px-6 sm:pt-6">
      <div className="flex flex-col gap-5 mb-6 sm:flex-row sm:justify-between">
        <div className="w-full">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-white/90">
            Заказы по типам
          </h3>
          <p className="mt-1 text-gray-500 text-theme-sm dark:text-gray-400">
            Услуга на месте, ремонт и все заказы по месяцам
          </p>
        </div>
        <div className="flex items-center gap-3 sm:justify-end">
          <ChartTab />
          <div className="relative inline-flex items-center">
            <CalenderIcon className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 lg:left-3 lg:top-1/2 lg:translate-x-0 lg:-translate-y-1/2  text-gray-500 dark:text-gray-400 pointer-events-none z-10" />
            <input
              ref={datePickerRef}
              className="h-10 w-10 lg:w-40 lg:h-auto  lg:pl-10 lg:pr-3 lg:py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-transparent lg:text-gray-700 outline-none dark:border-gray-700 dark:bg-gray-800 dark:lg:text-gray-300 cursor-pointer"
              placeholder="Select date range"
            />
          </div>
        </div>
      </div>

      <div className="max-w-full overflow-x-auto custom-scrollbar">
        <div className="min-w-[1000px] xl:min-w-full">
          {loading ? (
            <div className="flex h-[310px] items-center justify-center text-sm text-gray-500 dark:text-gray-400">
              Загрузка...
            </div>
          ) : error ? (
            <div className="flex h-[310px] items-center justify-center text-center text-sm text-red-500">
              {error}
            </div>
          ) : (
            <Chart options={options} series={series} type="area" height={310} />
          )}
        </div>
      </div>
    </div>
  );
}