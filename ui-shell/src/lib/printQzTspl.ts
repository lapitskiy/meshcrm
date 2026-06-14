/** Имя принтера по умолчанию для QZ raw (TSPL). */
export const QZ_DEFAULT_PRINTER_NAME = "Xprinter XP-365B";

/**
 * Минимальный TSPL 30×20 мм для проверки QZ (как в примерах TSC для QZ Tray: чанки с CRLF, шрифт "0" + масштаб).
 * @see https://github.com/qzind/tray/issues/470
 */
export const QZ_MIN_TEST_TSPL_CHUNKS: string[] = [
  "SIZE 30 mm,20 mm\r\n",
  "GAP 2 mm,0\r\n",
  "DIRECTION 1\r\n",
  "REFERENCE 0,0\r\n",
  "CODEPAGE 1251\r\n",
  "CLS\r\n",
  'TEXT 20,20,"3",0,1,1,"ТЕСТ"\r\n',
  'TEXT 20,60,"2",0,1,1,"30x20 мм"\r\n',
  "PRINT 1\r\n",
];

export function tsplEscapeText(value: unknown, maxLen = 64): string {
  return String(value ?? "")
    .replace(/№/g, "No")
    .replace(/[\r\n"]/g, " ")
    .replace(/[^\x20-\x7EА-Яа-яЁё]/g, " ")
    .trim()
    .slice(0, maxLen);
}

function decodeBasicHtmlEntities(s: string): string {
  return String(s || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

/** TipTap сохраняет строки в HTML; для raw TSPL убираем теги и переводы в строки команд. */
export function htmlToPlainLinesForTspl(s: string): string {
  let x = String(s || "");
  if (!/<[a-z][\s\S]*>/i.test(x)) {
    return x;
  }
  x = x.replace(/<br\s*\/?>/gi, "\n");
  x = x.replace(/<\/pre>/gi, "\n");
  x = x.replace(/<\/code>/gi, "\n");
  x = x.replace(/<\/p>/gi, "\n");
  x = x.replace(/<\/div>/gi, "\n");
  x = x.replace(/<\/tr>/gi, "\n");
  x = x.replace(/<\/li>/gi, "\n");
  x = x.replace(/<\/h[1-6]>/gi, "\n");
  x = x.replace(/<[^>]+>/g, "");
  return decodeBasicHtmlEntities(x);
}

export function normPrintPlaceholderKey(raw: string): string {
  return String(raw || "")
    .replace(/\u00a0/g, " ")
    .trim()
    .toLowerCase();
}

/** Имена {{ … }} в шаблоне, которых нет в ctx (только по исходному tpl — до подстановки значений). */
export function findUnknownPlaceholderKeys(tpl: string, ctx: Record<string, string>): string[] {
  const allowed = new Set(Object.keys(ctx).map((k) => normPrintPlaceholderKey(k)));
  const unknown = new Set<string>();
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl)) !== null) {
    const key = normPrintPlaceholderKey(String(m[1] || ""));
    if (!key) continue;
    if (allowed.has(key)) continue;
    const sizedQr = key.match(/^warehouse_qr_(site|yandex|vk|telegram)_svg_(\d{1,4})$/);
    if (sizedQr) {
      const channel = String(sizedQr[1] || "").toLowerCase();
      const rawKey = normPrintPlaceholderKey(`warehouse_qr_${channel}_svg_raw`);
      if (allowed.has(rawKey)) continue;
    }
    unknown.add(String(m[1] || "").replace(/\u00a0/g, " ").trim());
  }
  return [...unknown].sort((a, b) => a.localeCompare(b));
}

export function normalizeTsplPayload(raw: string): string {
  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  return lines.join("\r\n").trim() + "\r\n";
}

export function looksLikeTspl(raw: string): boolean {
  return /\b(SIZE|GAP|DIRECTION|REFERENCE|CLS|TEXT|BARCODE|BITMAP|BOX|PRINT)\b/i.test(String(raw || ""));
}

export function plainTextTo30x20TsplChunks(raw: string): string[] {
  const lines = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => tsplEscapeText(line, 28))
    .filter(Boolean)
    .slice(0, 3);
  const safeLines = lines.length ? lines : [" "];
  return [
    "SIZE 30 mm,20 mm\r\n",
    "GAP 2 mm,0\r\n",
    "DIRECTION 1\r\n",
    "REFERENCE 0,0\r\n",
    "CODEPAGE 1251\r\n",
    "CLS\r\n",
    ...safeLines.map((line, idx) => `TEXT 20,${20 + idx * 40},"2",0,1,1,"${line}"\r\n`),
    "PRINT 1\r\n",
  ];
}

function tsplFontByCssPx(px: number | null): { font: string; scale: number; step: number; maxLen: number } {
  if (px != null && px >= 28) return { font: "3", scale: 2, step: 72, maxLen: 12 };
  if (px != null && px >= 20) return { font: "3", scale: 1, step: 48, maxLen: 22 };
  return { font: "2", scale: 1, step: 40, maxLen: 28 };
}

function parseHtmlTextBlocks(raw: string): { text: string; fontSizePx: number | null }[] {
  return String(raw || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, "\n")
    .split("\n")
    .map((html) => {
      const pxRaw = html.match(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i)?.[1];
      const text = decodeBasicHtmlEntities(html.replace(/<[^>]+>/g, "")).trim();
      return { text, fontSizePx: pxRaw ? Number(pxRaw) : null };
    })
    .filter((line) => line.text)
    .slice(0, 3);
}

export function htmlTo30x20TsplChunks(raw: string): string[] {
  const blocks = parseHtmlTextBlocks(raw);
  const safeBlocks = blocks.length ? blocks : [{ text: " ", fontSizePx: null }];
  let y = 20;
  const textCommands = safeBlocks.map((line) => {
    const style = tsplFontByCssPx(line.fontSizePx);
    const command = `TEXT 20,${y},"${style.font}",0,${style.scale},${style.scale},"${tsplEscapeText(line.text, style.maxLen)}"\r\n`;
    y += style.step;
    return command;
  });
  return ["SIZE 30 mm,20 mm\r\n", "GAP 2 mm,0\r\n", "DIRECTION 1\r\n", "REFERENCE 0,0\r\n", "CODEPAGE 1251\r\n", "CLS\r\n", ...textCommands, "PRINT 1\r\n"];
}

function asciiBytes(value: string): number[] {
  return Array.from(value, (ch) => ch.charCodeAt(0) & 0xff);
}

function bytesToHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function htmlTo30x20TsplHex(raw: string): string {
  const width = 240;
  const height = 160;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("QZ: canvas unavailable for bitmap text");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  let y = 18;
  const blocks = parseHtmlTextBlocks(raw).length ? parseHtmlTextBlocks(raw) : [{ text: " ", fontSizePx: null }];
  for (const block of blocks) {
    const px = block.fontSizePx && block.fontSizePx >= 10 ? block.fontSizePx : 18;
    ctx.font = `bold ${px}px Arial, sans-serif`;
    ctx.fillText(block.text, 18, y, width - 36);
    y += Math.ceil(px * 1.55);
  }
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const bitmap: number[] = [];
  for (let row = 0; row < height; row += 1) {
    for (let bx = 0; bx < width / 8; bx += 1) {
      let value = 0;
      for (let bit = 0; bit < 8; bit += 1) {
        const x = bx * 8 + bit;
        const i = (row * width + x) * 4;
        if ((pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3 >= 180) value |= 0x80 >> bit;
      }
      bitmap.push(value);
    }
  }
  const bytes = [
    ...asciiBytes("SIZE 30 mm,20 mm\r\nGAP 2 mm,0\r\nDIRECTION 1\r\nREFERENCE 0,0\r\nCLS\r\n"),
    ...asciiBytes(`BITMAP 0,0,${width / 8},${height},0,`),
    ...bitmap,
    ...asciiBytes("\r\nPRINT 1\r\n"),
  ];
  return bytesToHex(bytes);
}

export function ensureTsplPrintFooter(tspl: string): string {
  let normalized = tspl;
  if (!/\bCODEPAGE\s+/i.test(normalized)) {
    normalized = normalized.replace(/(\bREFERENCE\s+[-\d]+,\s*[-\d]+\s*\r?\n)/i, `$1CODEPAGE 1251\r\n`);
  }
  if (/\bPRINT\s+\d+/i.test(normalized)) return normalized;
  return normalized.trimEnd() + "\r\nPRINT 1\r\n";
}
