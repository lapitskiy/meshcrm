"use client";

import { getKeycloak } from "@/lib/keycloak";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";

type Props = {
  children: React.ReactNode;
};

const KC_TOKENS_STORAGE_KEY = "hubcrm.keycloak.tokens";

type PersistedTokens = {
  token?: string;
  refreshToken?: string;
  idToken?: string;
};

function loadPersistedTokens(): PersistedTokens {
  try {
    const raw = window.localStorage.getItem(KC_TOKENS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedTokens;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePersistedTokens(tokens: PersistedTokens) {
  try {
    window.localStorage.setItem(KC_TOKENS_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // Ignore localStorage write failures (private mode, quota, etc).
  }
}

function clearPersistedTokens() {
  try {
    window.localStorage.removeItem(KC_TOKENS_STORAGE_KEY);
  } catch {
    // no-op
  }
}

export default function KeycloakGate({ children }: Props) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const kc = await getKeycloak();
        const persisted = loadPersistedTokens();
        const authenticated = await kc.init({
          onLoad: "login-required",
          pkceMethod: "S256",
          checkLoginIframe: false,
          token: persisted.token,
          refreshToken: persisted.refreshToken,
          idToken: persisted.idToken,
        });

        if (!authenticated) {
          clearPersistedTokens();
          await kc.login();
          return;
        }

        // Make token available to client-side API calls
        (window as any).__hubcrmAccessToken = kc.token;
        savePersistedTokens({
          token: kc.token,
          refreshToken: kc.refreshToken,
          idToken: kc.idToken,
        });

        // Refresh loop
        const interval = window.setInterval(async () => {
          try {
            const refreshed = await kc.updateToken(30);
            if (refreshed || kc.token) {
              (window as any).__hubcrmAccessToken = kc.token;
              savePersistedTokens({
                token: kc.token,
                refreshToken: kc.refreshToken,
                idToken: kc.idToken,
              });
            }
          } catch {
            window.clearInterval(interval);
            clearPersistedTokens();
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


