"use client";

import KeycloakGate from "@/components/auth/KeycloakGate";
import CallbackReminderBanner from "@/components/orders/CallbackReminderBanner";
import AppHeader from "@/layout/AppHeader";
import AppSidebar from "@/layout/AppSidebar";
import Backdrop from "@/layout/Backdrop";
import React from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <KeycloakGate>
      <div className="min-h-screen lg:flex">
        {/* Sidebar and Backdrop */}
        <AppSidebar />
        <Backdrop />
        {/* Main Content Area */}
        <div
          className="min-w-0 flex-1 transition-all duration-300 ease-in-out"
        >
          {/* Header */}
          <AppHeader />
          {/* Page Content */}
          <div className="p-4 mx-auto max-w-(--breakpoint-2xl) md:p-6">{children}</div>
          <CallbackReminderBanner />
        </div>
      </div>
    </KeycloakGate>
  );
}
