"use client";

import { getKeycloak } from "@/lib/keycloak";
import { useEffect, useMemo, useState } from "react";

export type CurrentUser = {
  fullName: string;
  email: string;
  firstName: string;
  lastName: string;
  username?: string;
};

function deriveFirstLast(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] || fullName, lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function readUserFromToken(tokenParsed: any): CurrentUser {
  if (!tokenParsed) throw new Error("Keycloak tokenParsed is empty");

  const email = tokenParsed.email as string | undefined;
  if (!email) throw new Error("Keycloak token missing `email` claim");

  const username = tokenParsed.preferred_username as string | undefined;
  const fullName =
    (tokenParsed.name as string | undefined) ||
    [tokenParsed.given_name, tokenParsed.family_name].filter(Boolean).join(" ") ||
    username ||
    email;
  if (!fullName) throw new Error("Keycloak token missing user name");

  const { firstName, lastName } =
    tokenParsed.given_name || tokenParsed.family_name
      ? {
          firstName: (tokenParsed.given_name as string | undefined) || "",
          lastName: (tokenParsed.family_name as string | undefined) || "",
        }
      : deriveFirstLast(fullName);

  return { fullName, email, firstName, lastName, username };
}

export function useCurrentUser(): {
  user: CurrentUser | null;
  isLoading: boolean;
  error: string | null;
} {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let prevRefresh: any;
    let prevSuccess: any;
    let wrappedRefresh: any;
    let wrappedSuccess: any;

    (async () => {
      try {
        const kc = await getKeycloak();
        if (!kc.authenticated) {
          throw new Error("Not authenticated in Keycloak");
        }

        const update = () => {
          // Identity claims are typically present in idTokenParsed (OIDC),
          // while access token may omit them depending on client scopes/mappers.
          const parsed = (kc as any).idTokenParsed ?? (kc as any).tokenParsed;
          const next = readUserFromToken(parsed);
          if (!alive) return;
          setUser(next);
          setError(null);
        };

        update();

        prevRefresh = (kc as any).onAuthRefreshSuccess;
        prevSuccess = (kc as any).onAuthSuccess;

        wrappedRefresh = () => {
          update();
          if (typeof prevRefresh === "function") prevRefresh();
        };
        wrappedSuccess = () => {
          update();
          if (typeof prevSuccess === "function") prevSuccess();
        };
        (kc as any).onAuthRefreshSuccess = wrappedRefresh;
        (kc as any).onAuthSuccess = wrappedSuccess;
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to read user from Keycloak");
      }
    })();

    return () => {
      alive = false;
      (async () => {
        try {
          const kc = await getKeycloak();
          if ((kc as any).onAuthRefreshSuccess === wrappedRefresh) {
            (kc as any).onAuthRefreshSuccess = prevRefresh;
          }
          if ((kc as any).onAuthSuccess === wrappedSuccess) {
            (kc as any).onAuthSuccess = prevSuccess;
          }
        } catch {
          // ignore
        }
      })();
    };
  }, []);

  return useMemo(
    () => ({ user, isLoading: !user && !error, error }),
    [user, error]
  );
}

