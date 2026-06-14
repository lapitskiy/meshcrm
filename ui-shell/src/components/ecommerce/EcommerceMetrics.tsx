"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChatIcon } from "@/icons";
import { getGatewayBaseUrl } from "@/lib/gateway";

export const EcommerceMetrics = () => {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [socialNeedsReplyCount, setSocialNeedsReplyCount] = useState(0);

  useEffect(() => {
    let alive = true;

    const loadSocialSummary = async () => {
      try {
        const token = String((window as any).__hubcrmAccessToken || "").trim();
        if (!token) {
          if (alive) setSocialNeedsReplyCount(0);
          return;
        }
        const resp = await fetch(`${base}/social/vk/inbox-summary`, {
          cache: "no-store",
          headers: { authorization: `Bearer ${token}` },
        });
        if (!resp.ok) {
          throw new Error(`social summary failed: ${resp.status}`);
        }
        const data = (await resp.json()) as { needs_reply_count?: number };
        if (alive) {
          setSocialNeedsReplyCount(Number(data?.needs_reply_count || 0));
        }
      } catch {
        if (alive) {
          setSocialNeedsReplyCount(0);
        }
      }
    };

    void loadSocialSummary();
    const timer = window.setInterval(() => {
      void loadSocialSummary();
    }, 15000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [base]);

  const cards = [
    {
      title: "Соцсети",
      value: String(socialNeedsReplyCount),
      icon: <ChatIcon className="text-gray-800 dark:text-white/90" />,
      actionHref: "/modules/social/vk",
      actionLabel: "Перейти",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4 md:gap-6">
      {cards.map((card, index) => (
        <div
          key={`${card.title}-${index}`}
          className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
            {card.icon}
          </div>
          <div className="mt-5 flex items-end justify-between">
            <div>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {card.title}
              </span>
              <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
                {card.value}
              </h4>
            </div>
          </div>
          {card.actionHref ? (
            <div className="mt-4">
              <Link
                href={card.actionHref}
                className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-white/[0.03]"
              >
                {card.actionLabel}
              </Link>
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
};
