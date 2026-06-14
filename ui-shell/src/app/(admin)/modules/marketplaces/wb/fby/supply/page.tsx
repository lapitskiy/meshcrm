"use client";

import React from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

type WbSupply = {
  id: string;
  supply_id?: number | null;
  preorder_id?: number | null;
  warehouse_id?: number | null;
  warehouse_name?: string | null;
  status_id: number;
  status_name: string;
  created_at?: string | null;
  supply_date?: string | null;
  box_type_id?: number | null;
};

type WbGood = {
  nm_id: number;
  offer_id: string;
  quantity?: number;
  stock_quantity?: number;
  stock_warehouses?: { warehouse_id: number; warehouse_name: string; quantity: number }[];
  subject_name?: string;
  brand?: string;
  color?: string;
  barcodes?: { barcode: string; quantity: number; wb_quantity?: number; tech_size?: string }[];
  discount: number;
  currency: string;
  sizes: { size_id: number; name: string; price: number; discounted_price: number }[];
};

type WbSupplyGoodQuantity = {
  nm_id: number;
  offer_id: string;
  quantity: number;
  barcode: string;
};

type DraftMode = "" | "new" | "draft";

type ScanSummary = {
  lastBarcode: string;
  lastStatus: "ok" | "error" | "";
  lastMessage: string;
  okCount: number;
  errorCount: number;
};

export default function WbFbySupplyPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [items, setItems] = React.useState<WbSupply[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [draftLoading, setDraftLoading] = React.useState(false);
  const [draftExists, setDraftExists] = React.useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = React.useState("");
  const [draftItems, setDraftItems] = React.useState<WbGood[]>([]);
  const [draftMode, setDraftMode] = React.useState<DraftMode>("");
  const [goodsLoading, setGoodsLoading] = React.useState(false);
  const [goodsError, setGoodsError] = React.useState("");
  const [allGoods, setAllGoods] = React.useState<WbGood[]>([]);
  const [goods, setGoods] = React.useState<WbGood[]>([]);
  const [stocksUpdatedAt, setStocksUpdatedAt] = React.useState("");
  const [articleQuery, setArticleQuery] = React.useState("");
  const [saveStatus, setSaveStatus] = React.useState("");
  const [excelUrl, setExcelUrl] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [scanSummary, setScanSummary] = React.useState<ScanSummary>({
    lastBarcode: "",
    lastStatus: "",
    lastMessage: "Сканер ожидает штрихкод",
    okCount: 0,
    errorCount: 0,
  });
  const goodsRef = React.useRef<WbGood[]>([]);
  const scanBufferRef = React.useRef("");
  const scanTimerRef = React.useRef<number | null>(null);
  const lastScanTsRef = React.useRef(0);
  const selectedSupply = React.useMemo(() => items.find((item) => item.id === selectedId) || null, [items, selectedId]);
  const selectedSupplyWarehouseId = Number(selectedSupply?.warehouse_id || 0);

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  React.useEffect(() => {
    goodsRef.current = goods;
  }, [goods]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setError(j?.detail || `HTTP ${r.status}`);
        setItems([]);
        setSelectedId("");
        return;
      }
      const nextItems = Array.isArray(j?.items) ? j.items : [];
      setItems(nextItems);
      setSelectedId(nextItems[0]?.id || "");
    } catch (e: any) {
      setError(e?.message || String(e));
      setItems([]);
      setSelectedId("");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void load();
  }, []);

  React.useEffect(() => {
    if (!selectedId) {
      setDraftExists(false);
      setDraftUpdatedAt("");
      setDraftItems([]);
      setDraftMode("");
      setAllGoods([]);
      setGoods([]);
      return;
    }
    const loadDraft = async () => {
      setDraftLoading(true);
      setGoodsError("");
      setSaveStatus("");
      setExcelUrl("");
      setDraftMode("");
      setAllGoods([]);
      setGoods([]);
      try {
        const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies/${selectedId}/draft`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const j = await r.json().catch(() => null);
        if (!r.ok) {
          setGoodsError(j?.detail || `HTTP ${r.status}`);
          setDraftExists(false);
          setDraftItems([]);
          return;
        }
        const exists = Boolean(j?.exists);
        setDraftExists(exists);
        setDraftUpdatedAt(j?.updated_at ? String(j.updated_at) : "");
        setExcelUrl(j?.download_url ? String(j.download_url) : "");
        setDraftItems(Array.isArray(j?.items) ? j.items : []);
      } catch (e: any) {
        setGoodsError(e?.message || String(e));
        setDraftExists(false);
        setDraftItems([]);
      } finally {
        setDraftLoading(false);
      }
    };
    void loadDraft();
  }, [selectedId]);

  React.useEffect(() => {
    if (!selectedId) return;
    const selected = items.find((item) => item.id === selectedId);
    if (!selected) return;
    if (Number(selected.warehouse_id || 0) > 0) return;
    const loadSupplyDetails = async () => {
      try {
        const isOrderId = !selected.supply_id && !!selected.preorder_id;
        const r = await fetch(
          `${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies/${selectedId}/details?is_order_id=${isOrderId ? "true" : "false"}`,
          { headers: { Authorization: `Bearer ${getToken()}` } }
        );
        const j = await r.json().catch(() => null);
        if (!r.ok) {
          setError(j?.detail || `Ошибка получения склада поставки: HTTP ${r.status}`);
          return;
        }
        setItems((prev) =>
          prev.map((item) =>
            item.id === selectedId
              ? {
                  ...item,
                  warehouse_id: Number(j?.warehouse_id || 0) || null,
                  warehouse_name: j?.warehouse_name ? String(j.warehouse_name) : "",
                }
              : item
          )
        );
      } catch (e: any) {
        setError(e?.message || String(e));
      }
    };
    void loadSupplyDetails();
  }, [selectedId, items]);

  const loadNewGoods = async () => {
    if (!selectedId) return;
    setDraftMode("new");
    setSaveStatus("");
    setExcelUrl("");
    setGoodsLoading(true);
    setGoodsError("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies/${selectedId}/goods`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setGoodsError(j?.detail || `HTTP ${r.status}`);
        setGoods([]);
        return;
      }
      const nextGoods = Array.isArray(j?.items) ? j.items : [];
      const preparedGoods = nextGoods.map((item: WbGood) => ({
        ...item,
        quantity: 0,
        barcodes: (item.barcodes || []).map((row) => ({ ...row, quantity: 0, wb_quantity: 0 })),
      }));
      setAllGoods(preparedGoods);
      setGoods(preparedGoods);
      void loadStocksForGoods(preparedGoods);
    } catch (e: any) {
      setGoodsError(e?.message || String(e));
      setGoods([]);
    } finally {
      setGoodsLoading(false);
    }
  };

  const loadAllGoods = async (): Promise<WbGood[] | null> => {
    if (!selectedId) return null;
    setGoodsLoading(true);
    setGoodsError("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies/${selectedId}/goods`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setGoodsError(j?.detail || `HTTP ${r.status}`);
        return null;
      }
      const nextGoods = Array.isArray(j?.items) ? j.items : [];
      const preparedGoods = nextGoods.map((item: WbGood) => ({
        ...item,
        quantity: 0,
        barcodes: (item.barcodes || []).map((row) => ({ ...row, quantity: 0, wb_quantity: 0 })),
      }));
      setAllGoods(preparedGoods);
      void loadStocksForGoods(preparedGoods);
      return preparedGoods;
    } catch (e: any) {
      setGoodsError(e?.message || String(e));
      return null;
    } finally {
      setGoodsLoading(false);
    }
  };

  const loadWbSupplyGoods = async (): Promise<WbSupplyGoodQuantity[] | null> => {
    if (!selectedId) return null;
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies/${selectedId}/wb-goods`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setGoodsError(j?.detail || `HTTP ${r.status}`);
        return null;
      }
      return Array.isArray(j?.items) ? j.items : [];
    } catch (e: any) {
      setGoodsError(e?.message || String(e));
      return null;
    }
  };

  const loadStocksForGoods = async (targetGoods: WbGood[]) => {
    const nmIds = Array.from(new Set(targetGoods.map((item) => item.nm_id).filter(Boolean)));
    if (!nmIds.length) return;
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/stocks?nm_ids=${encodeURIComponent(nmIds.join(","))}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setGoodsError(j?.detail || `HTTP ${r.status}`);
        return;
      }
      const stockByNm = new Map(
        (Array.isArray(j?.items) ? j.items : []).map((item: any) => [
          Number(item.nm_id),
          {
            stock_quantity: Number(item.total_quantity || 0),
            stock_warehouses: Array.isArray(item.warehouses) ? item.warehouses : [],
          },
        ])
      );
      const mergeStock = (item: WbGood) => ({ ...item, ...(stockByNm.get(item.nm_id) || { stock_quantity: 0, stock_warehouses: [] }) });
      setStocksUpdatedAt(j?.updated_at ? String(j.updated_at) : "");
      setGoods((prev) => prev.map(mergeStock));
      setAllGoods((prev) => prev.map(mergeStock));
    } catch (e: any) {
      setGoodsError(e?.message || String(e));
    }
  };

  const openDraft = async () => {
    setDraftMode("draft");
    setSaveStatus("");
    setGoodsError("");
    const cachedGoods = allGoods.length ? allGoods : await loadAllGoods();
    if (!cachedGoods) return;
    const wbSupplyGoods = await loadWbSupplyGoods();
    if (!wbSupplyGoods) return;
    const wbByKey = new Map<string, Map<string, number>>();
    for (const item of wbSupplyGoods) {
      const key = item.nm_id > 0 ? `nm:${item.nm_id}` : `offer:${item.offer_id}`;
      const target = wbByKey.get(key) || new Map<string, number>();
      const barcode = item.barcode || "Без штрихкода";
      target.set(barcode, (target.get(barcode) || 0) + Number(item.quantity || 0));
      wbByKey.set(key, target);
    }
    const draftNmIds = new Set(draftItems.map((item) => item.nm_id));
    const mergedGoods = draftItems.map((item) => {
      const source = cachedGoods.find((good) => good.nm_id === item.nm_id || good.offer_id === item.offer_id);
      const wbByBarcode = wbByKey.get(`nm:${item.nm_id}`) || wbByKey.get(`offer:${item.offer_id}`) || new Map<string, number>();
      const draftByBarcode = new Map((item.barcodes || []).map((row) => [row.barcode, Number(row.quantity || 0)]));
      if (!draftByBarcode.size && Number(item.quantity || 0) > 0 && source?.barcodes?.[0]?.barcode) {
        draftByBarcode.set(source.barcodes[0].barcode, Number(item.quantity || 0));
      }
      const barcodeSet = new Set<string>([
        ...((source?.barcodes || item.barcodes || []).map((row) => row.barcode)),
        ...Array.from(draftByBarcode.keys()),
        ...Array.from(wbByBarcode.keys()),
      ]);
      return {
        ...(source || item),
        quantity: 0,
        barcodes: Array.from(barcodeSet).map((barcode) => ({
          barcode,
          quantity: draftByBarcode.get(barcode) || 0,
          wb_quantity: wbByBarcode.get(barcode) || 0,
        })),
      };
    });
    for (const wbItem of wbSupplyGoods) {
      if (draftNmIds.has(wbItem.nm_id)) continue;
      const source = cachedGoods.find((item) => item.nm_id === wbItem.nm_id || item.offer_id === wbItem.offer_id);
      if (source) {
        const wbByBarcode = wbByKey.get(`nm:${source.nm_id}`) || wbByKey.get(`offer:${source.offer_id}`) || new Map<string, number>();
        const barcodeSet = new Set<string>([
          ...((source.barcodes || []).map((row) => row.barcode)),
          ...Array.from(wbByBarcode.keys()),
        ]);
        mergedGoods.push({
          ...source,
          quantity: 0,
          barcodes: Array.from(barcodeSet).map((barcode) => ({
            barcode,
            quantity: 0,
            wb_quantity: wbByBarcode.get(barcode) || 0,
          })),
        });
      }
    }
    const sortedGoods = mergedGoods.sort((a, b) => a.offer_id.localeCompare(b.offer_id));
    setGoods(sortedGoods);
    void loadStocksForGoods(sortedGoods);
  };

  const addGood = (item: WbGood) => {
    if (goods.some((good) => good.nm_id === item.nm_id)) return;
    setGoods((prev) => [
      ...prev,
      { ...item, quantity: 0, barcodes: (item.barcodes || []).map((row) => ({ ...row, quantity: 0, wb_quantity: 0 })) },
    ].sort((a, b) => a.offer_id.localeCompare(b.offer_id)));
    setArticleQuery("");
  };

  const setBarcodeQuantity = (nmId: number, barcode: string, value: string) => {
    const quantity = Math.max(0, Number(value || 0));
    setGoods((prev) =>
      prev.map((item) =>
        item.nm_id === nmId
          ? {
              ...item,
              barcodes: (item.barcodes || []).map((row) => (row.barcode === barcode ? { ...row, quantity } : row)),
            }
          : item
      )
    );
  };

  const playScanSound = (ok: boolean) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    void ctx.resume?.();
    const playTone = (frequency: number, start: number, duration: number, volume = 0.18, type: OscillatorType = "triangle") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(volume, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    if (ok) {
      playTone(740, 0, 0.10, 0.16);
      playTone(980, 0.11, 0.10, 0.18);
      playTone(1320, 0.22, 0.16, 0.20);
      return;
    }
    playTone(160, 0, 0.45, 0.20, "sawtooth");
  };

  const normalizeScannedBarcode = (value: string) => {
    const layoutMap: Record<string, string> = {
      й: "q", ц: "w", у: "e", к: "r", е: "t", н: "y", г: "u", ш: "i", щ: "o", з: "p", х: "[", ъ: "]",
      ф: "a", ы: "s", в: "d", а: "f", п: "g", р: "h", о: "j", л: "k", д: "l", ж: ";", э: "'",
      я: "z", ч: "x", с: "c", м: "v", и: "b", т: "n", ь: "m", б: ",", ю: ".", ё: "`",
    };
    return value
      .trim()
      .split("")
      .map((char) => {
        const lower = char.toLowerCase();
        const mapped = layoutMap[lower];
        if (!mapped) return char;
        return char === lower ? mapped : mapped.toUpperCase();
      })
      .join("");
  };

  const handleBarcodeScan = (barcode: string) => {
    const cleanBarcode = normalizeScannedBarcode(barcode);
    if (!cleanBarcode || !draftMode) return;
    let found = false;
    let foundOfferId = "";
    setGoods((prev) =>
      prev.map((item) => {
        const hasBarcode = (item.barcodes || []).some((row) => row.barcode === cleanBarcode);
        if (!hasBarcode) return item;
        found = true;
        foundOfferId = item.offer_id;
        return {
          ...item,
          barcodes: (item.barcodes || []).map((row) =>
            row.barcode === cleanBarcode ? { ...row, quantity: Number(row.quantity || 0) + 1 } : row
          ),
        };
      })
    );
    if (!found) {
      const source = allGoods.find((item) => (item.barcodes || []).some((row) => row.barcode === cleanBarcode));
      if (source && !goodsRef.current.some((item) => item.nm_id === source.nm_id)) {
        setGoods((prev) =>
          [
            ...prev,
            {
              ...source,
              quantity: 0,
              barcodes: (source.barcodes || []).map((row) => ({
                ...row,
                quantity: row.barcode === cleanBarcode ? 1 : 0,
                wb_quantity: 0,
              })),
            },
          ].sort((a, b) => a.offer_id.localeCompare(b.offer_id))
        );
        found = true;
        foundOfferId = source.offer_id;
      }
    }
    playScanSound(found);
    setScanSummary((prev) => ({
      lastBarcode: cleanBarcode,
      lastStatus: found ? "ok" : "error",
      lastMessage: found ? `Принят: ${foundOfferId}` : "Штрихкод не найден в списке",
      okCount: prev.okCount + (found ? 1 : 0),
      errorCount: prev.errorCount + (found ? 0 : 1),
    }));
    setSaveStatus(found ? `Скан принят: ${cleanBarcode}` : `Штрихкод не найден: ${cleanBarcode}`);
  };

  const removeGood = (nmId: number) => {
    const target = goods.find((item) => item.nm_id === nmId);
    const draftTotal = (target?.barcodes || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
    const wbTotal = (target?.barcodes || []).reduce((sum, row) => sum + Number(row.wb_quantity || 0), 0);
    if (!target || draftTotal !== 0 || wbTotal !== 0) return;
    setGoods((prev) => prev.filter((item) => item.nm_id !== nmId));
  };

  const saveDraft = async () => {
    if (!selectedId) return;
    setSaving(true);
    setSaveStatus("Сохраняю...");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies/${selectedId}/draft`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          items: goods.map((item) => ({
            ...item,
            quantity: 0,
            barcodes: (item.barcodes || []).map(({ wb_quantity, ...row }) => row),
          })),
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        setSaveStatus(j?.detail || `HTTP ${r.status}`);
        return;
      }
      const nextItems = Array.isArray(j?.items) ? j.items : goods;
      setDraftExists(true);
      setDraftItems(nextItems);
      setGoods(nextItems);
      setDraftMode("draft");
      setExcelUrl(j?.download_url ? String(j.download_url) : "");
      setSaveStatus("Черновик сохранен");
    } catch (e: any) {
      setSaveStatus(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const downloadExcel = async () => {
    if (!selectedId) return;
    const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/wb/fby/supplies/${selectedId}/draft/excel-token`, {
      method: "POST",
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!r.ok) {
      setSaveStatus(`Ошибка подготовки Excel: HTTP ${r.status}`);
      return;
    }
    const j = await r.json().catch(() => null);
    const nextUrl = j?.download_url ? String(j.download_url) : excelUrl;
    if (!nextUrl) {
      setSaveStatus("Excel не подготовлен");
      return;
    }
    window.open(`${getGatewayBaseUrl()}${nextUrl}`, "_blank", "noopener,noreferrer");
  };

  const availableGoods = React.useMemo(() => {
    const query = articleQuery.trim().toLowerCase();
    if (!query) return [];
    const usedNmIds = new Set(goods.map((item) => item.nm_id));
    return allGoods
      .filter((item) => !usedNmIds.has(item.nm_id))
      .filter((item) => item.offer_id.toLowerCase().includes(query) || String(item.nm_id).includes(query))
      .slice(0, 10);
  }, [articleQuery, allGoods, goods]);

  React.useEffect(() => {
    const isEditableTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tagName = el.tagName.toLowerCase();
      return tagName === "input" || tagName === "textarea" || tagName === "select" || el.isContentEditable;
    };

    const flushScan = () => {
      const barcode = scanBufferRef.current;
      scanBufferRef.current = "";
      if (barcode.length >= 4) handleBarcodeScan(barcode);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!draftMode || isEditableTarget(event.target)) return;
      const now = Date.now();
      if (now - lastScanTsRef.current > 150) scanBufferRef.current = "";
      lastScanTsRef.current = now;

      if (event.key === "Enter") {
        event.preventDefault();
        flushScan();
        return;
      }

      if (event.key.length !== 1) return;
      scanBufferRef.current += event.key;
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = window.setTimeout(flushScan, 180);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    };
  }, [draftMode, allGoods]);

  return (
    <div className="p-6 max-w-3xl">
      {draftMode ? (
        <div className="fixed bottom-4 right-4 z-50 w-[320px] rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold">Сканер штрихкодов</div>
            <div
              className={`rounded-full px-2 py-0.5 text-xs ${
                scanSummary.lastStatus === "ok"
                  ? "bg-green-100 text-green-700"
                  : scanSummary.lastStatus === "error"
                  ? "bg-red-100 text-red-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {scanSummary.lastStatus === "ok" ? "Принято" : scanSummary.lastStatus === "error" ? "Ошибка" : "Ожидание"}
            </div>
          </div>
          <div className="text-sm text-gray-700 dark:text-gray-300">{scanSummary.lastMessage}</div>
          {scanSummary.lastBarcode ? (
            <div className="mt-1 break-all text-xs text-gray-500">Barcode: {scanSummary.lastBarcode}</div>
          ) : null}
          <div className="mt-3 flex gap-3 text-xs text-gray-500">
            <span>Принято: {scanSummary.okCount}</span>
            <span>Ошибок: {scanSummary.errorCount}</span>
          </div>
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold mb-2">WB → FBY → Поставки</h1>
      <div className="mb-4">
        <button
          type="button"
          className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
          disabled={loading}
          onClick={load}
        >
          {loading ? "Загружаю..." : "Обновить список"}
        </button>
      </div>
      {error ? <div className="text-sm text-red-600 mb-4">{error}</div> : null}
      {items.length > 0 ? (
        <select
          className="h-11 w-full rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setSaveStatus("");
          }}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              №{item.id} — {item.status_name}
              {item.supply_date ? ` — ${item.supply_date.slice(0, 10)}` : ""}
            </option>
          ))}
        </select>
      ) : !loading && !error ? (
        <div className="text-sm text-gray-500">Поставок пока нет</div>
      ) : null}

      {selectedId ? (
        <div className="mt-4 rounded-xl border border-gray-200 p-4 dark:border-gray-800">
          <div className="mb-3 text-sm text-gray-600">
            Склад поставки:{" "}
            {selectedSupplyWarehouseId > 0
              ? `${selectedSupply?.warehouse_name || "Без названия"} (ID: ${selectedSupplyWarehouseId})`
              : "Не найден в WB ответе"}
          </div>
          {draftLoading ? <div className="text-sm text-gray-500">Проверяю черновик...</div> : null}
          {!draftLoading && draftExists ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" className="px-4 py-2 rounded bg-brand-500 text-white" onClick={openDraft}>
                Открыть черновик
              </button>
              <button type="button" className="px-4 py-2 rounded border border-gray-300" onClick={loadNewGoods}>
                Создать заново
              </button>
              <span className="text-sm text-gray-500">
                {draftUpdatedAt ? `Сохранен: ${draftUpdatedAt}` : "Черновик найден"}
              </span>
            </div>
          ) : null}
          {!draftLoading && !draftExists ? (
            <button type="button" className="px-4 py-2 rounded bg-brand-500 text-white" onClick={loadNewGoods}>
              Создать новый список
            </button>
          ) : null}
        </div>
      ) : null}

      {selectedId && draftMode ? (
        <div className="mt-6">
          <h2 className="mb-3 text-lg font-semibold">Товары WB</h2>
          {stocksUpdatedAt ? (
            <div className="mb-3 text-xs text-gray-500">Остатки на складах обновлены: {stocksUpdatedAt}</div>
          ) : null}
          {goodsLoading ? <div className="text-sm text-gray-500">Загружаю товары...</div> : null}
          {goodsError ? <div className="mb-4 text-sm text-red-600">{goodsError}</div> : null}
          {allGoods.length ? (
            <div className="relative mb-4">
              <input
                className="h-11 w-full rounded-lg border border-gray-300 px-4 text-sm dark:border-gray-700 dark:bg-gray-900"
                placeholder="Добавить товар по артикулу или nmID"
                value={articleQuery}
                onChange={(e) => setArticleQuery(e.target.value)}
              />
              {articleQuery ? (
                <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
                  {availableGoods.map((item) => (
                    <button
                      key={item.nm_id}
                      type="button"
                      className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                      onClick={() => addGood(item)}
                    >
                      <span className="font-medium">{item.offer_id}</span>
                      <span className="ml-2 text-gray-500">nmID: {item.nm_id}</span>
                    </button>
                  ))}
                  {!availableGoods.length ? (
                    <div className="px-4 py-2 text-sm text-gray-500">Нет товаров для добавления</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
            {goods.map((item) => {
              const firstSize = item.sizes[0];
              const draftTotal = (item.barcodes || []).reduce((sum, row) => sum + Number(row.quantity || 0), 0);
              const wbTotal = (item.barcodes || []).reduce((sum, row) => sum + Number(row.wb_quantity || 0), 0);
              const stockQuantity = Number(item.stock_quantity || 0);
              const stockAtSupplyWarehouse =
                selectedSupplyWarehouseId > 0
                  ? Number((item.stock_warehouses || []).find((row) => Number(row.warehouse_id) === selectedSupplyWarehouseId)?.quantity || 0)
                  : 0;
              return (
                <div key={item.nm_id} className="grid grid-cols-[1fr_44px] gap-3 border-b border-gray-100 p-3 text-sm last:border-b-0 dark:border-gray-800">
                  <div>
                    <div className="font-semibold">
                      {item.offer_id}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        Черновик: {draftTotal} • WB: {wbTotal} • Остаток на складах: {stockQuantity} • На складе поставки: {stockAtSupplyWarehouse}
                      </span>
                    </div>
                    <div className="text-gray-600">
                      nmID: {item.nm_id}
                      {firstSize ? ` • цена: ${firstSize.discounted_price || firstSize.price} ${item.currency}` : ""}
                      {item.discount ? ` • скидка: ${item.discount}%` : ""}
                    </div>
                    <div className="mt-3 space-y-2">
                      {(item.barcodes || []).map((row) => {
                        const rowDraft = Number(row.quantity || 0);
                        const rowWb = Number(row.wb_quantity || 0);
                        return (
                          <div key={`${item.nm_id}-${row.barcode}`} className="grid grid-cols-[1fr_110px_130px] items-center gap-3 rounded-lg bg-gray-50 p-2 dark:bg-white/[0.03]">
                            <div className="text-xs text-gray-600">
                              <div className="font-medium text-gray-800 dark:text-gray-200">{row.barcode || "Без штрихкода"}</div>
                              <div>WB: {rowWb} • Черновик: {rowDraft}</div>
                            </div>
                            <input
                              type="number"
                              min="0"
                              className="h-9 rounded-lg border border-gray-300 px-3 text-sm dark:border-gray-700 dark:bg-gray-900"
                              value={rowDraft}
                              onChange={(e) => setBarcodeQuantity(item.nm_id, row.barcode, e.target.value)}
                            />
                            <div className="text-xs text-gray-500">{rowDraft === rowWb ? "Совпадает с WB" : "Не совпадает с WB"}</div>
                          </div>
                        );
                      })}
                      {!item.barcodes?.length ? (
                        <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-900/20 dark:text-red-400">
                          У товара нет штрихкодов в карточке WB
                        </div>
                      ) : null}
                      </div>
                  </div>
                  <button
                    type="button"
                    className="h-10 rounded-lg border border-gray-300 text-lg disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={draftTotal !== 0 || wbTotal !== 0}
                    onClick={() => removeGood(item.nm_id)}
                    title={draftTotal === 0 && wbTotal === 0 ? "Удалить товар" : "Можно удалить только при количестве 0 в черновике и WB"}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
          {!goodsLoading && !goodsError && !goods.length ? (
            <div className="text-sm text-gray-500">Товаров нет</div>
          ) : null}
          {goods.length ? (
            <div className="mt-4 flex items-center gap-4">
              <button
                type="button"
                className="px-4 py-2 rounded bg-brand-500 text-white disabled:opacity-50"
                disabled={saving}
                onClick={saveDraft}
              >
                Сохранить черновик
              </button>
              {excelUrl ? (
                <button
                  type="button"
                  className="px-4 py-2 rounded border border-gray-300"
                  onClick={downloadExcel}
                >
                  Скачать Excel
                </button>
              ) : null}
              <div className="text-sm text-gray-600">{saveStatus}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
