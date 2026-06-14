import { getGatewayBaseUrl } from "@/lib/gateway";

declare global {
  interface Window {
    qz?: any;
    __hubcrmAccessToken?: string;
  }
}

const QZ_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js";

function authHeaders(): Record<string, string> {
  const token = window.__hubcrmAccessToken || "";
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function loadQzScript(): Promise<any> {
  if (window.qz) return window.qz;
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = QZ_SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Не удалось загрузить qz-tray.js"));
    document.head.appendChild(script);
  });
  if (!window.qz) throw new Error("QZ Tray script loaded, but qz is unavailable");
  return window.qz;
}

export async function connectQzTray(): Promise<any> {
  const qz = await loadQzScript();
  const base = getGatewayBaseUrl();

  qz.security.setCertificatePromise((resolve: (cert: string) => void, reject: (err: any) => void) => {
    fetch(`${base}/qz/cert`, { cache: "no-store", headers: authHeaders() })
      .then((resp) => (resp.ok ? resp.text() : Promise.reject(new Error(`qz cert failed: ${resp.status}`))))
      .then(resolve)
      .catch(reject);
  });

  qz.security.setSignatureAlgorithm("SHA512");
  qz.security.setSignaturePromise((toSign: string) => {
    return (resolve: (signature: string) => void, reject: (err: any) => void) => {
      fetch(`${base}/qz/sign`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ request: toSign }),
      })
        .then((resp) => (resp.ok ? resp.text() : Promise.reject(new Error(`qz sign failed: ${resp.status}`))))
        .then(resolve)
        .catch(reject);
    };
  });

  if (!qz.websocket.isActive()) {
    await qz.websocket.connect({ retries: 2, delay: 1 });
  }
  return qz;
}

export type QzPrintRawOptions = {
  /** Windows: часть драйверов не отдаёт raw на принтер — обход (см. qz.io raw printing). По умолчанию true. */
  forceRaw?: boolean;
};

export async function qzPrintRaw(
  printerName: string,
  commands: string[],
  opts?: QzPrintRawOptions
): Promise<void> {
  const qz = await connectQzTray();
  const forceRaw = opts?.forceRaw !== false;
  const config = qz.configs.create(printerName, { encoding: "Cp1251", ...(forceRaw ? { forceRaw: true } : {}) });
  await qz.print(config, commands);
}

export async function qzPrintRawHex(
  printerName: string,
  hex: string,
  opts?: QzPrintRawOptions
): Promise<void> {
  const qz = await connectQzTray();
  const forceRaw = opts?.forceRaw !== false;
  const config = qz.configs.create(printerName, forceRaw ? { forceRaw: true } : {});
  await qz.print(config, [{ type: "raw", format: "command", flavor: "hex", data: hex }]);
}
