"use client";

import { getGatewayBaseUrl } from "@/lib/gateway";
import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULT_PROFILE_AVATAR_SRC = "/images/user/owner.jpg";
const PROFILE_AVATAR_UPDATED_EVENT = "hubcrm:profile-avatar-updated";
const MAX_AVATAR_BYTES = 200 * 1024;
const TARGET_AVATAR_BYTES = 180 * 1024;
const MAX_AVATAR_DIMENSION = 512;

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.split(",", 2)[1] || "";
  const padding = (base64.match(/=*$/)?.[0].length || 0);
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Не удалось прочитать изображение."));
    };
    image.src = objectUrl;
  });
}

async function compressAvatarFile(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Можно загружать только изображения.");
  }

  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas недоступен в браузере.");
  }

  let width = image.width;
  let height = image.height;
  const initialScale = Math.min(1, MAX_AVATAR_DIMENSION / Math.max(width, height));
  width = Math.max(1, Math.round(width * initialScale));
  height = Math.max(1, Math.round(height * initialScale));

  const qualities = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42, 0.34];

  for (let scaleStep = 0; scaleStep < 6; scaleStep += 1) {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    for (const quality of qualities) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrlByteSize(dataUrl) <= TARGET_AVATAR_BYTES) {
        return dataUrl;
      }
    }

    width = Math.max(1, Math.round(width * 0.85));
    height = Math.max(1, Math.round(height * 0.85));
  }

  const fallback = canvas.toDataURL("image/jpeg", 0.3);
  if (dataUrlByteSize(fallback) <= MAX_AVATAR_BYTES) {
    return fallback;
  }
  throw new Error("Не удалось ужать аватар до 200 КБ.");
}

export function emitProfileAvatarUpdated(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROFILE_AVATAR_UPDATED_EVENT));
}

export function useProfileAvatar(): {
  avatarSrc: string;
  isLoading: boolean;
  isUploading: boolean;
  error: string | null;
  uploadAvatar: (file: File) => Promise<string>;
  reloadAvatar: () => Promise<void>;
} {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const [avatarSrc, setAvatarSrc] = useState(DEFAULT_PROFILE_AVATAR_SRC);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reloadAvatar = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setAvatarSrc(DEFAULT_PROFILE_AVATAR_SRC);
      setIsLoading(false);
      return;
    }
    try {
      const resp = await fetch(`${base}/profile/avatar`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`load avatar failed: ${resp.status} ${body}`);
      }
      const data = (await resp.json()) as { avatar_data_url?: string };
      setAvatarSrc(data.avatar_data_url || DEFAULT_PROFILE_AVATAR_SRC);
      setError(null);
    } catch (e: any) {
      setAvatarSrc(DEFAULT_PROFILE_AVATAR_SRC);
      setError(e?.message || "Не удалось загрузить аватар.");
    } finally {
      setIsLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void reloadAvatar();
    const handleAvatarUpdated = () => {
      void reloadAvatar();
    };
    window.addEventListener(PROFILE_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
    return () => window.removeEventListener(PROFILE_AVATAR_UPDATED_EVENT, handleAvatarUpdated);
  }, [reloadAvatar]);

  const uploadAvatar = useCallback(async (file: File) => {
    const token = getToken();
    if (!token) {
      throw new Error("Нет авторизации.");
    }
    setIsUploading(true);
    setError(null);
    try {
      const dataUrl = await compressAvatarFile(file);
      const resp = await fetch(`${base}/profile/avatar`, {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ data_url: dataUrl }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`upload avatar failed: ${resp.status} ${body}`);
      }
      const data = (await resp.json()) as { avatar_data_url?: string };
      const nextSrc = data.avatar_data_url || DEFAULT_PROFILE_AVATAR_SRC;
      setAvatarSrc(nextSrc);
      emitProfileAvatarUpdated();
      return nextSrc;
    } catch (e: any) {
      const message = e?.message || "Не удалось загрузить аватар.";
      setError(message);
      throw new Error(message);
    } finally {
      setIsUploading(false);
    }
  }, [base]);

  return { avatarSrc, isLoading, isUploading, error, uploadAvatar, reloadAvatar };
}
