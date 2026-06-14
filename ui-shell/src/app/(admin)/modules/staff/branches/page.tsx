import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import React from "react";

export default function StaffBranchesPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Филиалы" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 xl:px-10 xl:py-12">
        Раздел филиалов подготовлен. Backend API для филиалов уже добавлен в модуль `staff`, а здесь можно будет
        развернуть CRUD и привязку графиков смен к филиалам.
      </div>
    </div>
  );
}
