"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { formatDocumentTitle, getPageTitle } from "@/lib/pageTitle";

export default function RouteTitleSync() {
  const pathname = usePathname();

  useEffect(() => {
    document.title = formatDocumentTitle(getPageTitle(pathname || "/"));
  }, [pathname]);

  return null;
}
