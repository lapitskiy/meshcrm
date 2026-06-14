"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Link from "next/link";

export default function StaffNotificationListPage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Список уведомлений" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Список уведомлений</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Раздел для просмотра уведомлений персонала.</p>
          </div>
          <Link className="text-sm font-medium text-brand-500" href="/modules/staff/notifications/create">
            Создать уведомление
          </Link>
        </div>
        <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Список уведомлений будет добавлен здесь.
        </div>
      </div>
    </div>
  );
}
