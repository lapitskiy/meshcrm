"use client";
import Button from "@/components/ui/button/Button";
import { ChevronLeftIcon } from "@/icons";
import { getKeycloak } from "@/lib/keycloak";
import Link from "next/link";
import React from "react";

export default function SignInForm() {
  const onLogin = async () => {
    const kc = await getKeycloak();
    // keycloak-js expects init() before using login()/logout() (adapter is set up there).
    try {
      await kc.init({
        onLoad: "check-sso",
        pkceMethod: "S256",
        checkLoginIframe: false,
      });
    } catch {
      // If init fails, still try to proceed with login() to show a proper error/redirect.
    }
    await kc.login({
      redirectUri: `${window.location.origin}/`,
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
          Назад к панели
        </Link>
      </div>
      <div className="flex flex-col justify-center flex-1 w-full max-w-md mx-auto">
        <div>
          <div className="mb-5 sm:mb-8">
            <h1 className="mb-2 font-semibold text-gray-800 text-title-sm dark:text-white/90 sm:text-title-md">
              Вход
            </h1>
          </div>
          <div>
            <div className="space-y-4">
              <Button className="w-full" size="sm" onClick={onLogin}>
                Войти в MeshCRM
              </Button>
            </div>

            <div className="mt-5">
              <p className="text-sm font-normal text-center text-gray-700 dark:text-gray-400 sm:text-start">
                Нет аккаунта? {""}
                <Link
                  href="/signup"
                  className="text-brand-500 hover:text-brand-600 dark:text-brand-400"
                >
                  Регистрация
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
