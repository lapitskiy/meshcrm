"use client";

import Badge from "../ui/badge/Badge";
import { ArrowDownIcon, BoxIconLine } from "@/icons";

export default function OrdersPlaceholderCard() {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-white/[0.03] md:p-6">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
        <BoxIconLine className="text-gray-800 dark:text-white/90" />
      </div>
      <div className="mt-5 flex items-end justify-between">
        <div>
          <span className="text-sm text-gray-500 dark:text-gray-400">Orders</span>
          <h4 className="mt-2 font-bold text-gray-800 text-title-sm dark:text-white/90">
            5,359
          </h4>
        </div>
        <Badge color="error">
          <ArrowDownIcon className="text-error-500" />
          9.05%
        </Badge>
      </div>
    </div>
  );
}
