"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PageBreadcrumb from "@/components/common/PageBreadCrumb";
import Button from "@/components/ui/button/Button";
import { Modal } from "@/components/ui/modal";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { getKeycloak } from "@/lib/keycloak";
import { useRouter } from "next/navigation";

type OrderOption = {
  id: string;
  order_number: number | null;
  status: string;
  service_category_id: string | null;
  serial_model: string;
};

type ServiceCategory = {
  id: string;
  name: string;
};

type PhotoDraft = {
  id: string;
  name: string;
  dataUrl: string;
  source: "upload" | "camera";
};

function getToken(): string {
  const raw = (window as any).__hubcrmAccessToken;
  if (!raw) return "";
  const token = String(raw).trim();
  if (!token || token === "undefined" || token === "null") return "";
  return token;
}

function formatOrderLabel(order: OrderOption): string {
  const numberPart = order.order_number ? `Заказ #${order.order_number}` : "Заказ без номера";
  const statusPart = order.status ? ` · ${order.status}` : "";
  const serialPart = order.serial_model ? ` · ${order.serial_model}` : "";
  return `${numberPart}${statusPart}${serialPart}`;
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`Не удалось прочитать файл ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export default function OrdersSupplyCreatePage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const router = useRouter();
  const orderBoxRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

  const [orderQuery, setOrderQuery] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<OrderOption | null>(null);
  const [orderOptions, setOrderOptions] = useState<OrderOption[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [ordersError, setOrdersError] = useState("");

  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const [requestText, setRequestText] = useState("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [formMessage, setFormMessage] = useState("");
  const [submitBusy, setSubmitBusy] = useState(false);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [capturedPhotoDataUrl, setCapturedPhotoDataUrl] = useState("");

  const authHeaders = useCallback(async () => {
    let token = getToken();
    if (!token) {
      try {
        const kc = await getKeycloak();
        try {
          await kc.updateToken(30);
        } catch {
          // API will return 401 if refresh fails.
        }
        token = kc.token || "";
        if (token) {
          (window as any).__hubcrmAccessToken = token;
        }
      } catch {
        // Keep empty token and show the API error in UI.
      }
    }
    return token ? { authorization: `Bearer ${token}` } : {};
  }, []);

  const stopCameraStream = useCallback(() => {
    const stream = cameraStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null;
    }
  }, []);

  const runOrderSearch = useCallback(
    async (query: string) => {
      setOrdersLoading(true);
      setOrdersError("");
      try {
        const searchValue = query.trim();
        const resp = await fetch(
          `${base}/orders/orders?page=1&page_size=10&search=${encodeURIComponent(searchValue)}`,
          {
            cache: "no-store",
            headers: await authHeaders(),
          }
        );
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить заказы: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as { items?: OrderOption[] };
        setOrderOptions(Array.isArray(payload.items) ? payload.items : []);
      } catch (e: any) {
        setOrderOptions([]);
        setOrdersError(e?.message || "Не удалось загрузить список заказов.");
      } finally {
        setOrdersLoading(false);
      }
    },
    [authHeaders, base]
  );

  useEffect(() => {
    let active = true;
    const loadCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError("");
      try {
        const resp = await fetch(`${base}/orders/settings/service-categories/accessible`, {
          cache: "no-store",
          headers: await authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`Не удалось загрузить категории: ${resp.status} ${body}`);
        }
        const payload = (await resp.json()) as ServiceCategory[];
        if (!active) return;
        setCategories(Array.isArray(payload) ? payload : []);
      } catch (e: any) {
        if (!active) return;
        setCategories([]);
        setCategoriesError(e?.message || "Не удалось загрузить категории.");
      } finally {
        if (active) {
          setCategoriesLoading(false);
        }
      }
    };
    void loadCategories();
    return () => {
      active = false;
    };
  }, [authHeaders, base]);

  useEffect(() => {
    if (!ordersOpen) return;
    const timer = window.setTimeout(() => {
      void runOrderSearch(orderQuery);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [orderQuery, ordersOpen, runOrderSearch]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!orderBoxRef.current?.contains(event.target as Node)) {
        setOrdersOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  const handleSelectOrder = (order: OrderOption) => {
    setSelectedOrder(order);
    setOrderQuery(order.order_number ? String(order.order_number) : "");
    setOrdersOpen(false);
    setOrdersError("");
    setFormMessage("");
    if (order.service_category_id) {
      setCategoryId(order.service_category_id);
    }
  };

  const onUploadPhotos = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    try {
      const loaded = await Promise.all(
        files.map(async (file, index) => ({
          id: `${Date.now()}-${index}-${file.name}`,
          name: file.name,
          dataUrl: await readFileAsDataUrl(file),
          source: "upload" as const,
        }))
      );
      setPhotos((prev) => [...prev, ...loaded]);
      setFormMessage("");
    } catch (e: any) {
      setFormMessage(e?.message || "Не удалось загрузить фото.");
    } finally {
      event.target.value = "";
    }
  };

  const removePhoto = (photoId: string) => {
    setPhotos((prev) => prev.filter((item) => item.id !== photoId));
  };

  const openCamera = async () => {
    setCameraError("");
    setCapturedPhotoDataUrl("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Браузер не поддерживает доступ к камере.");
      setCameraOpen(true);
      return;
    }
    try {
      stopCameraStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (cameraVideoRef.current) {
          cameraVideoRef.current.srcObject = stream;
          void cameraVideoRef.current.play().catch(() => {
            setCameraError("Не удалось запустить камеру.");
          });
        }
      }, 0);
    } catch (e: any) {
      setCameraOpen(true);
      setCameraError(e?.message ? `Не удалось открыть камеру: ${e.message}` : "Не удалось открыть камеру.");
    }
  };

  const closeCamera = () => {
    stopCameraStream();
    setCameraOpen(false);
    setCameraError("");
    setCapturedPhotoDataUrl("");
  };

  const capturePhoto = () => {
    const video = cameraVideoRef.current;
    if (!video) {
      setCameraError("Камера не готова.");
      return;
    }
    if (!video.videoWidth || !video.videoHeight) {
      setCameraError("Подождите, пока камера начнет передавать изображение.");
      return;
    }
    const maxWidth = 1600;
    const scale = Math.min(1, maxWidth / video.videoWidth);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Не удалось подготовить снимок.");
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    setCapturedPhotoDataUrl(canvas.toDataURL("image/jpeg", 0.9));
    setCameraError("");
    stopCameraStream();
  };

  const saveCapturedPhoto = () => {
    if (!capturedPhotoDataUrl) {
      setCameraError("Сначала сделайте снимок.");
      return;
    }
    setPhotos((prev) => [
      ...prev,
      {
        id: `${Date.now()}-camera`,
        name: `camera-${new Date().toISOString()}.jpg`,
        dataUrl: capturedPhotoDataUrl,
        source: "camera",
      },
    ]);
    closeCamera();
    setFormMessage("");
  };

  const onSubmit = async () => {
    if (!selectedOrder) {
      setFormMessage("Сначала выберите заказ.");
      return;
    }
    if (!categoryId) {
      setFormMessage("Выберите категорию.");
      return;
    }
    if (!requestText.trim()) {
      setFormMessage("Заполните описание заявки.");
      return;
    }
    setSubmitBusy(true);
    setFormMessage("");
    try {
      const resp = await fetch(`${base}/orders/supply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(await authHeaders()),
        },
        body: JSON.stringify({
          order_id: selectedOrder.id,
          service_category_id: categoryId,
          request_text: requestText.trim(),
          photos: photos.map((photo) => photo.dataUrl),
        }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`Не удалось сохранить заявку: ${resp.status} ${body}`);
      }
      router.push("/modules/orders/supply/list");
    } catch (e: any) {
      setFormMessage(e?.message || "Не удалось сохранить заявку.");
    } finally {
      setSubmitBusy(false);
    }
  };

  return (
    <div>
      <PageBreadcrumb pageTitle="Заказы · Снабжение · Создать заявку" />

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-7 dark:border-gray-800 dark:bg-white/[0.03] xl:px-10 xl:py-12">
        <div className="mx-auto max-w-4xl space-y-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-white/90">Новая заявка на снабжение</h1>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              Выберите заказ, затем укажите категорию, описание и при необходимости приложите фото.
            </p>
          </div>

          <div ref={orderBoxRef} className="relative">
            <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Номер заказа</label>
            <input
              value={orderQuery}
              onChange={(event) => {
                setOrderQuery(event.target.value);
                setSelectedOrder(null);
                setCategoryId("");
                setOrdersOpen(true);
                setFormMessage("");
              }}
              onFocus={() => {
                setOrdersOpen(true);
                if (!orderOptions.length) {
                  void runOrderSearch(orderQuery);
                }
              }}
              placeholder="Начните вводить номер заказа"
              className="h-11 w-full rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
            />

            {ordersOpen ? (
              <div className="absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-900">
                {ordersLoading ? (
                  <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">Загружаю заказы...</div>
                ) : ordersError ? (
                  <div className="px-4 py-3 text-sm text-red-600">{ordersError}</div>
                ) : orderOptions.length ? (
                  orderOptions.map((order) => (
                    <button
                      key={order.id}
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        handleSelectOrder(order);
                      }}
                      className="block w-full border-b border-gray-100 px-4 py-3 text-left text-sm text-gray-700 hover:bg-gray-50 last:border-b-0 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.04]"
                    >
                      <div className="font-medium">{order.order_number ? `Заказ #${order.order_number}` : "Заказ без номера"}</div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {order.status || "Без статуса"}
                        {order.serial_model ? ` · ${order.serial_model}` : ""}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">Заказы не найдены.</div>
                )}
              </div>
            ) : null}

            {selectedOrder ? (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
                Выбран: {formatOrderLabel(selectedOrder)}
              </div>
            ) : null}
          </div>

          {selectedOrder ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Категория</label>
              <select
                value={categoryId}
                onChange={(event) => {
                  setCategoryId(event.target.value);
                  setFormMessage("");
                }}
                className="h-11 w-full appearance-none rounded-lg border border-gray-300 bg-transparent px-4 py-2.5 text-sm text-gray-800 shadow-theme-xs focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90"
              >
                <option value="">{categoriesLoading ? "Загрузка категорий..." : "Выберите категорию"}</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
              {categoriesError ? <div className="mt-2 text-sm text-red-600">{categoriesError}</div> : null}
            </div>
          ) : null}

          {selectedOrder && categoryId ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Описание</label>
              <textarea
                value={requestText}
                onChange={(event) => {
                  setRequestText(event.target.value);
                  setFormMessage("");
                }}
                rows={5}
                placeholder="Опишите, что нужно заказать или подготовить"
                className="w-full rounded-lg border border-gray-300 bg-transparent px-4 py-3 text-sm text-gray-800 shadow-theme-xs placeholder:text-gray-400 focus:border-brand-300 focus:outline-hidden focus:ring-3 focus:ring-brand-500/10 dark:border-gray-700 dark:bg-gray-900 dark:text-white/90 dark:placeholder:text-white/30"
              />
            </div>
          ) : null}

          {selectedOrder && categoryId ? (
            <div className="space-y-4">
              <div>
                <div className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Фото</div>
                <div className="flex flex-wrap gap-3">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={onUploadPhotos}
                  />
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    Загрузить фото
                  </Button>
                  <Button variant="outline" onClick={() => void openCamera()}>
                    Сделать фото с камеры
                  </Button>
                </div>
              </div>

              {photos.length ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {photos.map((photo) => (
                    <div
                      key={photo.id}
                      className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900"
                    >
                      <img src={photo.dataUrl} alt={photo.name} className="h-48 w-full object-cover" />
                      <div className="space-y-2 px-3 py-3">
                        <div className="text-sm font-medium text-gray-700 dark:text-gray-200">{photo.name}</div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {photo.source === "camera" ? "Источник: камера" : "Источник: файл"}
                        </div>
                        <Button variant="outline" size="sm" onClick={() => removePhoto(photo.id)} className="w-full">
                          Удалить
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  Фото пока не добавлены.
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => void onSubmit()} disabled={submitBusy}>
              {submitBusy ? "Сохраняю..." : "Создать заявку"}
            </Button>
            <div className="text-sm text-gray-500 dark:text-gray-400">Сначала выберите заказ, затем заполните остальные поля.</div>
          </div>

          {formMessage ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300">
              {formMessage}
            </div>
          ) : null}
        </div>
      </div>

      <Modal isOpen={cameraOpen} onClose={closeCamera} className="mx-4 max-w-3xl p-6">
        <div className="space-y-4">
          <div className="text-lg font-semibold text-gray-800 dark:text-white/90">Фото для заявки снабжения</div>
          {capturedPhotoDataUrl ? (
            <img src={capturedPhotoDataUrl} alt="Снимок для заявки" className="max-h-[70vh] w-full rounded-xl object-contain" />
          ) : (
            <video ref={cameraVideoRef} autoPlay playsInline muted className="max-h-[70vh] w-full rounded-xl bg-black object-contain" />
          )}
          {cameraError ? <div className="text-sm text-red-600">Ошибка: {cameraError}</div> : null}
          <div className="flex flex-wrap justify-end gap-2">
            {capturedPhotoDataUrl ? (
              <>
                <Button variant="outline" onClick={() => void openCamera()}>
                  Переснять
                </Button>
                <Button onClick={saveCapturedPhoto}>Сохранить фото</Button>
              </>
            ) : (
              <Button onClick={capturePhoto}>Сделать снимок</Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
