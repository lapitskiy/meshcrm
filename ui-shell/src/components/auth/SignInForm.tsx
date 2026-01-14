"use client";
import Button from "@/components/ui/button/Button";
import { ChevronLeftIcon } from "@/icons";
import { getKeycloak } from "@/lib/keycloak";
import Link from "next/link";
import React from "react";

export default function SignInForm() {
  const onLogin = async () => {
    const kc = getKeycloak();
    await kc.login({
      redirectUri: "http://localhost:3000/",
    });
  };

  return (
    <div className="flex flex-col flex-1 lg:w-1/2 w-full">
      <div className="w-full max-w-md sm:pt-10 mx-auto mb-5">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300"
        >
          <ChevronLeftIcon />
          Back to dashboard
        </Link>
      </div>
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
              Sign In
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Use Keycloak (OIDC / PKCE).
            </p>
          </div>
          <div>
            <div className="space-y-4">
              <Button className="w-full" size="sm" onClick={onLogin}>
                Sign in with Keycloak
              </Button>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Demo user: <span className="font-medium">demo</span> / <span className="font-medium">demo</span>
              </p>
            </div>

            <div className="mt-5">
              <p className="text-sm font-normal text-center text-gray-700 dark:text-gray-400 sm:text-start">
                Don&apos;t have an account? {""}
                <Link
                  href="/signup"
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  Sign Up
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
