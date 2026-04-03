"use client";
import React from "react";

export default function UserAchievementsCard() {
  const socialRepliesCount = 0;

  return (
    <div className="p-5 border border-gray-200 rounded-2xl dark:border-gray-800 lg:p-6">
      <h4 className="text-lg font-semibold text-gray-800 dark:text-white/90 lg:mb-6">
        Достижения
      </h4>

      <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-white/[0.02]">
        <p className="text-sm text-gray-700 dark:text-gray-300">Ответил в соцсетях</p>
        <span className="rounded-full bg-brand-50 px-3 py-1 text-sm font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          {socialRepliesCount}
        </span>
      </div>
    </div>
  );
}
