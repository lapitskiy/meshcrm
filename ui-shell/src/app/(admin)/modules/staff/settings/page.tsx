import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Link from "next/link";
import React from "react";

export default function StaffSettingsPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Настройки" />
      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white px-5 py-7 text-sm text-gray-600 dark:border-gray-800 dark:bg-white/[0.03] dark:text-gray-300 xl:px-10 xl:py-12">
        <div>
          Здесь можно будет вынести общие настройки модуля `staff`: правила отметки начала дня, допуски по опозданию,
          обязательность филиала и служебные роли.
        </div>
        <Link
          className="inline-flex rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          href="/modules/staff/settings/kpk"
        >
          КПК
        </Link>
      </div>
    </div>
  );
}
