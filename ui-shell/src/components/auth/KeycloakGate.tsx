"use client";

import { getKeycloak } from "@/lib/keycloak";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

type Props = {
  children: React.ReactNode;
};

export default function KeycloakGate({ children }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const kc = getKeycloak();

    (async () => {
      try {
        const authenticated = await kc.init({
          onLoad: "login-required",
          pkceMethod: "S256",
          checkLoginIframe: false,
        });

        if (!authenticated) {
          await kc.login();
          return;
        }

        // Make token available to client-side API calls
        (window as any).__hubcrmAccessToken = kc.token;

        // Refresh loop
        const interval = window.setInterval(async () => {
          try {
            const refreshed = await kc.updateToken(30);
            if (refreshed) {
              (window as any).__hubcrmAccessToken = kc.token;
            }
          } catch {
            window.clearInterval(interval);
            await kc.login();
          }
        }, 10_000);

        setReady(true);
      } catch (e: any) {
        setError(e?.message || "Keycloak init failed");
        // fallback: go to template signin page
        router.push("/signin");
      }
    })();
  }, [router]);

  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-600 font-medium">Auth error</div>
        <div className="text-sm text-gray-600 mt-2">{error}</div>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="p-6">
        <div className="text-sm text-gray-600">Signing you in...</div>
      </div>
    );
  }

  return <>{children}</>;
}


