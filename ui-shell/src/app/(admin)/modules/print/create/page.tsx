"use client";

import Button from "@/components/ui/button/Button";
import Input from "@/components/form/input/InputField";
import Label from "@/components/form/Label";
import { getGatewayBaseUrl } from "@/lib/gateway";
import { useSearchParams } from "next/navigation";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import React, { useEffect, useMemo, useRef, useState } from "react";

type PrintVariable = {
  module_name: string;
  var_key: string;
  label: string;
  allowed: boolean;
};

type PrintCategory = {
  id: string;
  name: string;
};

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: "100%",
        parseHTML: (element) =>
          element.getAttribute("data-width") || element.style.width || "100%",
        renderHTML: (attributes) => {
          const width = String(attributes.width || "100%");
          return { "data-width": width, style: `width: ${width}; height: auto; max-width: 100%;` };
        },
      },
    };
  },
});

function parseWidthPercent(raw: string): number {
  const value = Number.parseInt(String(raw || "").replace("%", "").trim(), 10);
  if (!Number.isFinite(value)) return 100;
  return Math.max(10, Math.min(100, value));
}

function makeHtmlReadable(html: string): { readableHtml: string; srcMap: Record<string, string> } {
  const srcMap: Record<string, string> = {};
  let idx = 0;
  const readableHtml = String(html || "").replace(
    /src=(['"])(data:image\/[^'"]+)\1/gi,
    (_m, quote: string, value: string) => {
      idx += 1;
      const token = `__IMG_DATA_${idx}__`;
      srcMap[token] = value;
      return `src=${quote}${token}${quote}`;
    }
  );
  return { readableHtml, srcMap };
}

function restoreReadableHtml(html: string, srcMap: Record<string, string>): string {
  let restored = String(html || "");
  for (const [token, original] of Object.entries(srcMap || {})) {
    restored = restored.split(token).join(original);
  }
  return restored;
}

function ensureCssDecl(style: string, decl: string): string {
  const [prop] = decl.split(":");
  if (style.toLowerCase().includes(`${String(prop).trim().toLowerCase()}:`)) return style;
  return `${style.trim()}${style.trim().endsWith(";") || !style.trim() ? "" : ";"} ${decl}`.trim();
}

function normalizeTablesForPrint(html: string): string {
  return String(html || "").replace(/<table\b([^>]*)>/gi, (full: string, attrs: string) => {
    const styleMatch = attrs.match(/\sstyle=(['"])(.*?)\1/i);
    const styleQuote = styleMatch?.[1] || '"';
    const currentStyle = styleMatch?.[2] || "";
    const nextStyle = [
      "width: 100%",
      "table-layout: fixed",
      "border-collapse: collapse",
    ].reduce((acc, decl) => ensureCssDecl(acc, decl), currentStyle);
    if (styleMatch) {
      return full.replace(styleMatch[0], ` style=${styleQuote}${nextStyle}${styleQuote}`);
    }
    return `<table${attrs} style="${nextStyle}">`;
  });
}

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
}

function moduleLabel(moduleName: string): string {
  const key = String(moduleName || "").trim().toLowerCase();
  if (key === "contacts") return "Контакты";
  if (key === "orders") return "Заказы";
  if (key === "finance") return "Финансы";
  if (key === "warehouses") return "Склады";
  if (key === "skupka") return "Скупка";
  return moduleName;
}

export default function PrintCreateFormPage() {
  const base = useMemo(() => getGatewayBaseUrl(), []);
  const search = useSearchParams();
  const editingId = String(search.get("id") || "").trim() || null;
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categories, setCategories] = useState<PrintCategory[]>([]);
  const [vars, setVars] = useState<PrintVariable[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [htmlMode, setHtmlMode] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState("");
  const [htmlSrcMap, setHtmlSrcMap] = useState<Record<string, string>>({});
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Table.configure({
        resizable: false,
        HTMLAttributes: { style: "width: 100%; table-layout: fixed; border-collapse: collapse;" },
      }),
      TableRow,
      TableHeader,
      TableCell,
      ResizableImage.configure({ allowBase64: true }),
    ],
    content: "<p></p>",
    editorProps: {
      attributes: {
        class:
          "min-h-[260px] w-full max-w-[210mm] mx-auto rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 outline-none dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 " +
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold " +
          "[&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-gray-200 [&_td]:align-top [&_td]:p-2 dark:[&_td]:border-gray-700",
      },
    },
  });

  useEffect(() => {
    (async () => {
      try {
        const catsResp = await fetch(`${base}/documents/print/categories?limit=500`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!catsResp.ok) {
          const body = await catsResp.text().catch(() => "");
          throw new Error(`categories load failed: ${catsResp.status} ${body}`);
        }
        setCategories((await catsResp.json()) as PrintCategory[]);

        if (editingId) {
          const formResp = await fetch(`${base}/documents/print/forms/${encodeURIComponent(editingId)}`, {
            cache: "no-store",
            headers: authHeaders(),
          });
          if (!formResp.ok) {
            const body = await formResp.text().catch(() => "");
            throw new Error(`form load failed: ${formResp.status} ${body}`);
          }
          const form = await formResp.json();
          setTitle(String(form?.title || ""));
          setCategoryId(String(form?.category_id || ""));
          if (editor) {
            editor.commands.setContent(form?.content_json || "<p></p>");
          }
          setSavedId(String(form?.id || ""));
        }

        const resp = await fetch(`${base}/documents/print/variables?respect_links=true`, {
          cache: "no-store",
          headers: authHeaders(),
        });
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(`variables load failed: ${resp.status} ${body}`);
        }
        setVars((await resp.json()) as PrintVariable[]);
      } catch (e: any) {
        setError(e?.message || "failed to load variables");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId, editor]);

  useEffect(() => {
    if (!editor) return;
    const syncHtml = () => {
      if (!htmlMode) setHtmlDraft(editor.getHTML());
    };
    syncHtml();
    editor.on("update", syncHtml);
    return () => {
      editor.off("update", syncHtml);
    };
  }, [editor, htmlMode]);

  const insertVariable = (v: PrintVariable) => {
    if (!editor) return;
    if (!v.allowed) {
      setError(`Переменная из модуля "${v.module_name}" недоступна: включите связь documents → ${v.module_name} в настройках модулей`);
      return;
    }
    editor.chain().focus().insertContent(`{{ ${v.var_key} }}`).run();
  };

  const onInsertImageUrl = () => {
    if (!editor) return;
    if (htmlMode) {
      setError("В HTML mode вставка через кнопки отключена. Переключись в Visual mode.");
      return;
    }
    const url = window.prompt("URL изображения");
    if (!url) return;
    editor.chain().focus().setImage({ src: url.trim(), width: "100%" }).run();
  };

  const onPickImageFile = () => {
    imageInputRef.current?.click();
  };

  const onImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!editor || !file) return;
    if (htmlMode) {
      setError("В HTML mode вставка через кнопки отключена. Переключись в Visual mode.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Можно загрузить только изображение");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result || "");
      if (!src.startsWith("data:image/")) {
        setError("Не удалось прочитать изображение");
        return;
      }
      editor.chain().focus().setImage({ src, width: "100%" }).run();
    };
    reader.onerror = () => {
      setError("Ошибка чтения файла изображения");
    };
    reader.readAsDataURL(file);
  };

  const onSave = async () => {
    if (!editor) return;
    setBusy(true);
    setError(null);
    setSavedId(null);
    try {
      let htmlForEditor = editor.getHTML();
      if (htmlMode) {
        htmlForEditor = restoreReadableHtml(htmlDraft, htmlSrcMap) || "<p></p>";
        editor.commands.setContent(htmlForEditor);
      }
      const normalizedHtml = normalizeTablesForPrint(htmlForEditor);
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error("Название формы обязательно");
      const cleanCategoryId = categoryId.trim();
      if (!cleanCategoryId) throw new Error("Категория обязательна");
      const payload = {
        title: cleanTitle,
        category_id: cleanCategoryId,
        content_json: editor.getJSON(),
        content_html: normalizedHtml,
      };
      const url = editingId ? `${base}/documents/print/forms/${encodeURIComponent(editingId)}` : `${base}/documents/print/forms`;
      const method = editingId ? "PUT" : "POST";
      const resp = await fetch(url, {
        method,
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        throw new Error(`save failed: ${resp.status} ${body}`);
      }
      const saved = await resp.json();
      setSavedId(String(saved?.id || ""));
    } catch (e: any) {
      setError(e?.message || "save failed");
    } finally {
      setBusy(false);
    }
  };

  const resizeSelectedImage = (delta: number) => {
    if (!editor) return;
    if (htmlMode) {
      setError("Изменение размера доступно только в Visual mode");
      return;
    }
    if (!editor.isActive("image")) {
      setError("Сначала выдели изображение в редакторе");
      return;
    }
    const attrs = editor.getAttributes("image") as { width?: string };
    const current = parseWidthPercent(String(attrs?.width || "100%"));
    const next = Math.max(10, Math.min(100, current + delta));
    editor.chain().focus().updateAttributes("image", { width: `${next}%` }).run();
  };

  const insertImageGrid = (cols: number) => {
    if (!editor) return;
    if (htmlMode) {
      setError("Сетка вставляется только в Visual mode");
      return;
    }
    editor.chain().focus().insertTable({ rows: 1, cols, withHeaderRow: false }).run();
  };

  const insertTableGrid = (rows: number, cols: number) => {
    if (!editor) return;
    if (htmlMode) {
      setError("Сетка вставляется только в Visual mode");
      return;
    }
    editor.chain().focus().insertTable({ rows, cols, withHeaderRow: false }).run();
  };

  const onToggleHtmlMode = () => {
    if (!editor) return;
    if (!htmlMode) {
      const { readableHtml, srcMap } = makeHtmlReadable(editor.getHTML());
      setHtmlDraft(readableHtml);
      setHtmlSrcMap(srcMap);
      setHtmlMode(true);
      return;
    }
    editor.commands.setContent(restoreReadableHtml(htmlDraft, htmlSrcMap) || "<p></p>");
    setHtmlMode(false);
  };

  const varsByModule = vars.reduce<Record<string, PrintVariable[]>>((acc, v) => {
    (acc[v.module_name] ||= []).push(v);
    return acc;
  }, {});

  return (
    <div className="p-6">
      <h3 className="mb-2 font-semibold text-gray-800 text-theme-xl dark:text-white/90">Печать</h3>
      <div className="text-sm text-gray-600 dark:text-white/70 mb-6">
        {editingId ? "Редактировать форму" : "Создать форму"}
      </div>

      {error && <div className="text-sm text-red-600 mb-4">Ошибка: {error}</div>}
      {savedId && <div className="text-sm text-green-600 mb-4">Сохранено: {savedId}</div>}

      <div className="rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="grid grid-cols-1 gap-4">
          <div>
            <Label>Название</Label>
            <Input value={title} onChange={(e: any) => setTitle(e.target.value)} placeholder="Например: Акт приёма" />
          </div>

          <div>
            <Label>Категория</Label>
            <select
              className="h-11 w-full rounded-lg border border-gray-200 bg-transparent px-4 py-2.5 text-sm text-gray-800 dark:border-gray-800 dark:text-white/90"
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              <option value="">— выбери категорию —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!categories.length && (
              <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Категорий нет. Создай их в Печать → Настройки.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => editor?.chain().focus().toggleBold().run()}
              disabled={!editor || htmlMode}
            >
              Bold
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              disabled={!editor || htmlMode}
            >
              Italic
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              disabled={!editor || htmlMode}
            >
              • list
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              disabled={!editor || htmlMode}
            >
              1. list
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={onInsertImageUrl}
              disabled={!editor || htmlMode}
            >
              Image URL
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={onPickImageFile}
              disabled={!editor || htmlMode}
            >
              Upload image
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => resizeSelectedImage(-10)}
              disabled={!editor || htmlMode}
            >
              Image -10%
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => resizeSelectedImage(10)}
              disabled={!editor || htmlMode}
            >
              Image +10%
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => insertImageGrid(2)}
              disabled={!editor || htmlMode}
            >
              Grid 1x2
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => insertImageGrid(3)}
              disabled={!editor || htmlMode}
            >
              Grid 1x3
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => insertTableGrid(2, 2)}
              disabled={!editor || htmlMode}
            >
              Grid 2x2
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => insertTableGrid(3, 3)}
              disabled={!editor || htmlMode}
            >
              Grid 3x3
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={onToggleHtmlMode}
              disabled={!editor}
            >
              {htmlMode ? "Visual mode" : "HTML mode"}
            </button>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onImageFileChange} />
          </div>

          {htmlMode ? (
            <textarea
              className="min-h-[320px] w-full rounded-xl border border-gray-200 bg-white p-4 text-sm font-mono text-gray-800 outline-none dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90"
              value={htmlDraft}
              onChange={(e) => setHtmlDraft(e.target.value)}
              placeholder="<p>HTML...</p>"
            />
          ) : (
            <EditorContent editor={editor} />
          )}
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {htmlMode
              ? "Режим HTML: base64 src у изображений скрыт токенами (__IMG_DATA_N__), при применении восстанавливается."
              : "Режим предпросмотра: ширина листа A4 (210mm), таблицы сохраняются с fixed-layout для стабильной печати."}
          </div>

          <Button size="sm" disabled={busy || !editor} onClick={onSave}>
            Сохранить
          </Button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-3 font-semibold text-gray-800 dark:text-white/90">Подсказки (переменные)</div>
        <div className="mb-3 text-sm text-gray-600 dark:text-white/70">
          Переменные ниже сгруппированы по модулям. Для `Скупка` добавлены отдельные подсказки.
        </div>
        {!vars.length ? (
          <div className="text-sm text-gray-600 dark:text-white/70">
            Переменные не найдены. Проверь, что в `documents` есть переменные и настроены связи documents → модули.
          </div>
        ) : (
          <div className="space-y-4">
            {Object.keys(varsByModule)
              .sort()
              .map((moduleName) => (
                <div key={moduleName}>
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                    {moduleLabel(moduleName)} · модуль `{moduleName}`
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {varsByModule[moduleName].map((v) => (
                      <button
                        key={`${v.module_name}:${v.var_key}`}
                        onClick={() => insertVariable(v)}
                        className={`rounded-lg border px-3 py-1 text-sm ${
                          v.allowed
                            ? "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
                            : "border-gray-200 text-gray-400 cursor-not-allowed dark:border-gray-800 dark:text-white/30"
                        }`}
                        title={v.allowed ? "Вставить в текст" : "Недоступно: включи связь documents → модуль"}
                      >
                        <span className="font-mono">{`{{ ${v.var_key} }}`}</span> — {v.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

