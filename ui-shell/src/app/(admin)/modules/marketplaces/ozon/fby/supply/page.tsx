"use client";

import React from "react";
import { getGatewayBaseUrl } from "@/lib/gateway";

type OzonSupply = {
  id: string;
  order_number: string;
  state: string;
  created_at?: string | null;
  supply_date?: string | null;
  warehouse_id?: number | null;
  warehouse_name?: string | null;
  city?: string | null;
};

type OzonGood = {
  sku: number;
  offer_id: string;
  name?: string;
  quantity: number;
  ozon_quantity?: number;
  stock_quantity?: number;
  stock_warehouses?: { warehouse_id?: number | null; warehouse_name: string; cluster_name?: string; quantity: number }[];
  barcodes: string[];
};

type DraftMode = "" | "new" | "draft";
type ScanSummary = {
  lastBarcode: string;
  lastStatus: "ok" | "error" | "";
  lastMessage: string;
  okCount: number;
  errorCount: number;
};

const normalizeScannedBarcode = (value: string) => {
  const map: Record<string, string> = {
    Й: "Q", Ц: "W", У: "E", К: "R", Е: "T", Н: "Y", Г: "U", Ш: "I", Щ: "O", З: "P", Х: "[", Ъ: "]",
    Ф: "A", Ы: "S", В: "D", А: "F", П: "G", Р: "H", О: "J", Л: "K", Д: "L", Ж: ";", Э: "'",
    Я: "Z", Ч: "X", С: "C", М: "V", И: "B", Т: "N", Ь: "M", Б: ",", Ю: ".",
  };
  return value.trim().split("").map((char) => map[char] || map[char.toUpperCase()]?.toLowerCase() || char).join("");
};

export default function OzonFbySupplyPage() {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");
  const [supplies, setSupplies] = React.useState<OzonSupply[]>([]);
  const [selectedId, setSelectedId] = React.useState("");
  const [draftLoading, setDraftLoading] = React.useState(false);
  const [draftExists, setDraftExists] = React.useState(false);
  const [draftUpdatedAt, setDraftUpdatedAt] = React.useState("");
  const [draftMode, setDraftMode] = React.useState<DraftMode>("");
  const [allGoods, setAllGoods] = React.useState<OzonGood[]>([]);
  const [goods, setGoods] = React.useState<OzonGood[]>([]);
  const [goodsLoading, setGoodsLoading] = React.useState(false);
  const [goodsError, setGoodsError] = React.useState("");
  const [articleQuery, setArticleQuery] = React.useState("");
  const [saveStatus, setSaveStatus] = React.useState("");
  const [ozonUpdateStatus, setOzonUpdateStatus] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [ozonUpdating, setOzonUpdating] = React.useState(false);
  const [stocksUpdatedAt, setStocksUpdatedAt] = React.useState("");
  const [scanSummary, setScanSummary] = React.useState<ScanSummary>({
    lastBarcode: "",
    lastStatus: "",
    lastMessage: "Сканер ожидает штрихкод",
    okCount: 0,
    errorCount: 0,
  });
  const goodsRef = React.useRef<OzonGood[]>([]);
  const scanBufferRef = React.useRef("");
  const scanTimerRef = React.useRef<number | null>(null);
  const selectedSupply = React.useMemo(() => supplies.find((item) => item.id === selectedId) || null, [supplies, selectedId]);

  const getToken = () => (window as any).__hubcrmAccessToken || "";

  React.useEffect(() => {
    goodsRef.current = goods;
  }, [goods]);

  const apiGet = async (path: string) => {
    const r = await fetch(`${getGatewayBaseUrl()}${path}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.detail || `HTTP ${r.status}`);
    return j;
  };

  const loadSupplies = async () => {
    setLoading(true);
    setError("");
    try {
      const j = await apiGet("/marketplaces/ozon/fby/supplies");
      const next = Array.isArray(j?.items) ? j.items : [];
      setSupplies(next);
      setSelectedId(next[0]?.id || "");
    } catch (e: any) {
      setError(e?.message || String(e));
      setSupplies([]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void loadSupplies();
  }, []);

  React.useEffect(() => {
    if (!selectedId) {
      setDraftExists(false);
      setDraftMode("");
      setGoods([]);
      setAllGoods([]);
      return;
    }
    setDraftLoading(true);
    setDraftMode("");
    setGoods([]);
    setAllGoods([]);
    apiGet(`/marketplaces/ozon/fby/supplies/${selectedId}/draft`)
      .then((j) => {
        setDraftExists(Boolean(j?.exists));
        setDraftUpdatedAt(j?.updated_at || "");
      })
      .catch((e: any) => setGoodsError(e?.message || String(e)))
      .finally(() => setDraftLoading(false));
  }, [selectedId]);

  React.useEffect(() => {
    if (!selectedId) return;
    const target = supplies.find((item) => item.id === selectedId);
    if (!target) return;
    if ((target.city || "").trim() || (target.warehouse_name || "").trim()) return;
    apiGet(`/marketplaces/ozon/fby/supplies/${selectedId}/details`)
      .then((j) => {
        setSupplies((prev) =>
          prev.map((item) =>
            item.id === selectedId
              ? {
                  ...item,
                  warehouse_id: Number(j?.warehouse_id || 0) || null,
                  warehouse_name: j?.warehouse_name ? String(j.warehouse_name) : "",
                  city: j?.city ? String(j.city) : "",
                }
              : item
          )
        );
      })
      .catch((e: any) => setGoodsError(e?.message || String(e)));
  }, [selectedId, supplies]);

  const loadStocks = async (items: OzonGood[]) => {
    const skus = items.map((item) => item.sku).filter(Boolean);
    if (!skus.length) return items;
    const j = await apiGet(`/marketplaces/ozon/fby/stocks?skus=${encodeURIComponent(skus.join(","))}`);
    const bySku = new Map(
      (j?.items || []).map((row: any) => [
        Number(row.sku),
        {
          stock_quantity: Number(row.stock_quantity || 0),
          stock_warehouses: Array.isArray(row.warehouses) ? row.warehouses : [],
        },
      ])
    );
    setStocksUpdatedAt(j?.updated_at || "");
    return items.map((item) => ({ ...item, ...(bySku.get(item.sku) || { stock_quantity: 0, stock_warehouses: [] }) }));
  };

  const mergeDraftWithSupply = (draftItems: OzonGood[], supplyItems: OzonGood[], catalogItems: OzonGood[] = []) => {
    const catalogBySku = new Map(catalogItems.map((item) => [item.sku, item]));
    const supplyBySku = new Map(supplyItems.map((item) => [item.sku, item]));
    const merged = draftItems.map((draft) => {
      const catalog = catalogBySku.get(draft.sku);
      const supply = supplyBySku.get(draft.sku);
      const barcodes = Array.from(new Set([...(catalog?.barcodes || []), ...(supply?.barcodes || []), ...(draft.barcodes || [])]));
      return {
        ...catalog,
        ...supply,
        ...draft,
        barcodes,
        ozon_quantity: supply?.ozon_quantity || 0,
      } as OzonGood;
    });
    for (const supply of supplyItems) {
      if (!merged.some((item) => item.sku === supply.sku)) {
        merged.push({ ...(catalogBySku.get(supply.sku) || {}), ...supply });
      }
    }
    return merged.sort((a, b) => a.offer_id.localeCompare(b.offer_id));
  };

  const openDraft = async () => {
    if (!selectedId) return;
    setGoodsLoading(true);
    setGoodsError("");
    try {
      const [draft, supply, catalog] = await Promise.all([
        apiGet(`/marketplaces/ozon/fby/supplies/${selectedId}/draft`),
        apiGet(`/marketplaces/ozon/fby/supplies/${selectedId}/goods`),
        apiGet(`/marketplaces/ozon/fby/supplies/${selectedId}/sellable-goods`),
      ]);
      const supplyItems = Array.isArray(supply?.items) ? supply.items : [];
      const catalogItems = Array.isArray(catalog?.items) ? catalog.items : [];
      const catalogWithStocks = await loadStocks(catalogItems);
      const merged = mergeDraftWithSupply(Array.isArray(draft?.items) ? draft.items : [], supplyItems, catalogWithStocks);
      const withStocks = await loadStocks(merged);
      setAllGoods(catalogWithStocks);
      setGoods(withStocks);
      setDraftMode("draft");
    } catch (e: any) {
      setGoodsError(e?.message || String(e));
    } finally {
      setGoodsLoading(false);
    }
  };

  const createNew = async () => {
    if (!selectedId) return;
    setGoodsLoading(true);
    setGoodsError("");
    try {
      const j = await apiGet(`/marketplaces/ozon/fby/supplies/${selectedId}/sellable-goods`);
      const withStocks = await loadStocks(Array.isArray(j?.items) ? j.items : []);
      setAllGoods(withStocks);
      setGoods(withStocks);
      setDraftMode("new");
    } catch (e: any) {
      setGoodsError(e?.message || String(e));
    } finally {
      setGoodsLoading(false);
    }
  };

  const setItemQuantity = (sku: number, value: string | number) => {
    const quantity = Math.max(0, Number(value || 0));
    setGoods((prev) => prev.map((item) => item.sku === sku ? {
      ...item,
      quantity,
    } : item));
  };

  const removeGood = (sku: number) => {
    setGoods((prev) => prev.filter((item) => {
      if (item.sku !== sku) return true;
      return Number(item.quantity || 0) > 0 || Number(item.ozon_quantity || 0) > 0;
    }));
  };

  const saveDraft = async () => {
    if (!selectedId) return;
    setSaving(true);
    setSaveStatus("");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/ozon/fby/supplies/${selectedId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ items: goods }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.detail || `HTTP ${r.status}`);
      setDraftExists(true);
      setSaveStatus("Черновик сохранён");
    } catch (e: any) {
      setSaveStatus(e?.message || String(e));
    } finally {
      setSaving(false);
    }
  };

  const updateOzonContent = async () => {
    if (!selectedId) return;
    setOzonUpdating(true);
    setOzonUpdateStatus("Отправляю состав в Ozon...");
    try {
      const r = await fetch(`${getGatewayBaseUrl()}/marketplaces/ozon/fby/supplies/${selectedId}/content-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ items: goods }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.detail || `HTTP ${r.status}`);
      setOzonUpdateStatus(`Состав отправлен в Ozon: ${j?.items_total || 0} поз.`);
    } catch (e: any) {
      setOzonUpdateStatus(e?.message || String(e));
    } finally {
      setOzonUpdating(false);
    }
  };

  const availableGoods = React.useMemo(() => {
    const q = articleQuery.trim().toLowerCase();
    if (!q) return [];
    const used = new Set(goods.map((item) => item.sku));
    return allGoods.filter((item) => !used.has(item.sku) && (item.offer_id.toLowerCase().includes(q) || String(item.sku).includes(q))).slice(0, 8);
  }, [allGoods, goods, articleQuery]);

  const addGood = (item: OzonGood) => {
    if (goods.some((row) => row.sku === item.sku)) return;
    setGoods((prev) => [...prev, item].sort((a, b) => a.offer_id.localeCompare(b.offer_id)));
    setArticleQuery("");
  };

  const playScanSound = (ok: boolean) => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    const tone = (frequency: number, start: number, duration: number, type: OscillatorType = "triangle") => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.16, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + duration);
    };
    if (ok) {
      tone(740, 0, 0.09); tone(980, 0.1, 0.1); tone(1320, 0.21, 0.14);
    } else {
      tone(160, 0, 0.45, "sawtooth");
    }
  };

  const handleScan = (raw: string) => {
    const barcode = normalizeScannedBarcode(raw);
    let foundName = "";
    setGoods((prev) => prev.map((item) => {
      if (!(item.barcodes || []).includes(barcode)) {
        return item;
      }
      foundName = item.offer_id;
      return {
        ...item,
        quantity: Number(item.quantity || 0) + 1,
      };
    }));
    const ok = Boolean(foundName);
    playScanSound(ok);
    setScanSummary((prev) => ({
      lastBarcode: barcode,
      lastStatus: ok ? "ok" : "error",
      lastMessage: ok ? `Принят: ${foundName}` : "Штрихкод не найден в списке",
      okCount: prev.okCount + (ok ? 1 : 0),
      errorCount: prev.errorCount + (ok ? 0 : 1),
    }));
  };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || target?.isContentEditable || !draftMode) return;
      if (event.key === "Enter") {
        const value = scanBufferRef.current;
        scanBufferRef.current = "";
        if (value.length >= 4) handleScan(value);
        return;
      }
      if (event.key.length === 1) {
        scanBufferRef.current += event.key;
        if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
        scanTimerRef.current = window.setTimeout(() => {
          const value = scanBufferRef.current;
          scanBufferRef.current = "";
          if (value.length >= 4) handleScan(value);
        }, 80);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draftMode]);

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Ozon → FBY → Поставки</h1>
      <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <button onClick={loadSupplies} disabled={loading} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {loading ? "Загрузка..." : "Обновить поставки"}
        </button>
        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} className="mt-4 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950">
          <option value="">Поставка не выбрана</option>
          {supplies.map((item) => (
            <option key={item.id} value={item.id}>
              {item.order_number} • {item.state} {item.supply_date ? `• ${new Date(item.supply_date).toLocaleString("ru-RU")}` : ""}
            </option>
          ))}
        </select>
      </div>
      {selectedId && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="mb-3 text-sm text-gray-600">
            Город поставки: {selectedSupply?.city || "Не найден"} • Склад: {selectedSupply?.warehouse_name || "Не найден"}
          </div>
          {draftLoading ? "Проверяю черновик..." : (
            <div className="flex flex-wrap gap-3">
              {draftExists && <button onClick={openDraft} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white">Открыть черновик</button>}
              <button onClick={createNew} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium dark:border-gray-700">
                Создать новый список
              </button>
              {draftUpdatedAt && <span className="text-sm text-gray-500">Сохранён: {new Date(draftUpdatedAt).toLocaleString("ru-RU")}</span>}
            </div>
          )}
        </div>
      )}
      {draftMode && (
        <div className="space-y-4">
          <div className="relative">
            <input value={articleQuery} onChange={(e) => setArticleQuery(e.target.value)} placeholder="Добавить по артикулу из кеша" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
            {availableGoods.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-800 dark:bg-gray-900">
                {availableGoods.map((item) => <button key={item.sku} onClick={() => addGood(item)} className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800">{item.offer_id} • {item.name}</button>)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={saveDraft} disabled={saving} className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? "Сохраняю..." : "Сохранить черновик"}</button>
            <button onClick={updateOzonContent} disabled={ozonUpdating || !goods.length} className="rounded-lg border border-brand-500 px-4 py-2 text-sm font-medium text-brand-600 disabled:opacity-50">
              {ozonUpdating ? "Отправляю в Ozon..." : "Обновить состав в Ozon"}
            </button>
            {saveStatus && <span className="text-sm text-gray-600 dark:text-gray-300">{saveStatus}</span>}
            {ozonUpdateStatus && <span className="text-sm text-gray-600 dark:text-gray-300">{ozonUpdateStatus}</span>}
            {stocksUpdatedAt && <span className="text-sm text-gray-500">Остатки: {new Date(stocksUpdatedAt).toLocaleString("ru-RU")}</span>}
          </div>
          {goodsLoading && <div>Загрузка товаров...</div>}
          {goodsError && <div className="text-sm text-red-600">{goodsError}</div>}
          {goods.map((item) => {
            const draftTotal = Number(item.quantity || 0);
            const ozonTotal = Number(item.ozon_quantity || 0);
            const selectedWarehouseId = Number(selectedSupply?.warehouse_id || 0);
            const selectedWarehouseName = String(selectedSupply?.warehouse_name || "").trim().toLowerCase();
            const stockAtSupplyWarehouse = Number(
              (item.stock_warehouses || []).find((row) => {
                const rowWarehouseId = Number(row.warehouse_id || 0);
                const rowWarehouseName = String(row.warehouse_name || row.cluster_name || "").trim().toLowerCase();
                if (selectedWarehouseId > 0 && rowWarehouseId > 0) return rowWarehouseId === selectedWarehouseId;
                return selectedWarehouseName ? rowWarehouseName === selectedWarehouseName : false;
              })?.quantity || 0
            );
            return (
              <div key={item.sku} className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-semibold">{item.offer_id} <span className="text-xs font-normal text-gray-500">Черновик: {draftTotal} • Ozon: {ozonTotal} • Остаток на складах: {item.stock_quantity || 0} • На складе поставки: {stockAtSupplyWarehouse}</span></div>
                    <div className="text-sm text-gray-500">SKU: {item.sku} • {item.name}</div>
                  </div>
                  <button onClick={() => removeGood(item.sku)} className="text-xl text-gray-400 hover:text-red-500">×</button>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_140px] sm:items-start">
                  <div className="text-sm text-gray-600 dark:text-gray-300">
                    <div className="mb-1 text-xs uppercase text-gray-400">Штрихкоды</div>
                    {(item.barcodes || []).map((barcode) => <div key={barcode}>{barcode}</div>)}
                  </div>
                  <input type="number" min="0" value={draftTotal} onChange={(e) => setItemQuantity(item.sku, e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950" />
                </div>
              </div>
            );
          })}
        </div>
      )}
      <div className="fixed bottom-4 right-4 z-50 w-[320px] rounded-xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-800 dark:bg-gray-900">
        <div className="text-sm font-semibold">Сканер штрихкодов</div>
        <div className={scanSummary.lastStatus === "error" ? "text-sm text-red-600" : "text-sm text-green-600"}>{scanSummary.lastMessage}</div>
        <div className="mt-1 text-xs text-gray-500">Barcode: {scanSummary.lastBarcode || "—"}</div>
        <div className="text-xs text-gray-500">Принято: {scanSummary.okCount} • Ошибок: {scanSummary.errorCount}</div>
      </div>
    </div>
  );
}
