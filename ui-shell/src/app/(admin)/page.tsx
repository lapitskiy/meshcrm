import type { Metadata } from "next";
import React from "react";
import StatisticsChart from "@/components/ecommerce/StatisticsChart";
import RecentOrders from "@/components/ecommerce/RecentOrders";
import PendingReportsCard from "@/components/orders/PendingReportsCard";

export const metadata: Metadata = {
  title: "Главная",
  description: "This is Next.js Home for TailAdmin Dashboard Template",
};

export default function Ecommerce() {
  return (
    <div className="grid grid-cols-12 gap-4 md:gap-6">
      <div className="col-span-12">
        <RecentOrders />
      </div>

      <div className="col-span-12">
        <PendingReportsCard />
      </div>

      <div className="col-span-12">
        <StatisticsChart />
      </div>
    </div>
  );
}
