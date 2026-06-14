import type { Metadata } from "next";
import { headers } from "next/headers";
import { Outfit } from "next/font/google";
import "./globals.css";
import "flatpickr/dist/flatpickr.css";
import RouteTitleSync from "@/components/common/RouteTitleSync";
import { SidebarProvider } from "@/context/SidebarContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { formatDocumentTitle, getPageTitle } from "@/lib/pageTitle";

const outfit = Outfit({
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-pathname") || "/";

  return {
    title: formatDocumentTitle(getPageTitle(pathname)),
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${outfit.className} dark:bg-gray-900`}>
        <ThemeProvider>
          <SidebarProvider>
            <RouteTitleSync />
            {children}
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
