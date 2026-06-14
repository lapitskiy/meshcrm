"use client";

import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Link from "next/link";

export default function StaffNotificationCreatePage() {
  return (
    <div>
      <PageBreadcrumb pageTitle="Персонал · Создать уведомление" />
      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-800 dark:text-white/90">Создать уведомление</h1>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Раздел для создания уведомлений персоналу.</p>
          </div>
          <Link className="text-sm font-medium text-brand-500" href="/modules/staff/notifications/list">
            Список уведомлений
          </Link>
        </div>
        <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Форма создания уведомления будет добавлена здесь.
        </div>
      </div>
    </div>
  );
}
