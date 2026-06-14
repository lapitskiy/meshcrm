"use client";
import React, { useEffect, useMemo, useState } from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

export default function UserAchievementsCard() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [socialRepliesCount, setSocialRepliesCount] = useState(0);
  const [problemOrdersCount, setProblemOrdersCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const loadStats = async () => {
      try {
        const token = (window as any).__hubcrmAccessToken || "";
        const headers = token ? { authorization: `Bearer ${token}` } : {};
        const [socialResp, problemResp] = await Promise.all([
          fetch(`${base}/social/vk/reply-stats/me`, {
            cache: "no-store",
            headers,
          }),
          fetch(`${base}/orders/orders/problem-stats/me`, {
            cache: "no-store",
            headers,
          }),
        ]);
        if (!socialResp.ok) {
          throw new Error(`reply stats load failed: ${socialResp.status}`);
        }
        if (!problemResp.ok) {
          throw new Error(`problem stats load failed: ${problemResp.status}`);
        }
        const [socialData, problemData] = await Promise.all([socialResp.json(), problemResp.json()]);
        if (!active) return;
        setSocialRepliesCount(Number(socialData?.social_replies_count || 0));
        setProblemOrdersCount(Number(problemData?.problem_orders_count || 0));
      } catch {
        if (!active) return;
        setSocialRepliesCount(0);
        setProblemOrdersCount(0);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void loadStats();
    return () => {
      active = false;
    };
  }, [base]);

  return (
    <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6">
      <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-6">
        Достижения
      </h4>

      <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <p className="text-sm text-gray-700 dark:text-gray-300">Ответил в соцсетях</p>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {isLoading ? "..." : socialRepliesCount}
        </span>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <p className="text-sm text-gray-700 dark:text-gray-300">Проблемные заказы</p>
        <span className="rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
          {isLoading ? "..." : problemOrdersCount}
        </span>
      </div>
    </div>
  );
}
