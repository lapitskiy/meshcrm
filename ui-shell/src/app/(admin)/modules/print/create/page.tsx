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
import React, { useEffect, useMemo, useState } from "react";

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

function getToken(): string {
  return (window as any).__hubcrmAccessToken || "";
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

  const authHeaders = () => {
    const token = getToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };

  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image.configure({ allowBase64: false }),
    ],
    content: "<p></p>",
    editorProps: {
      attributes: {
        class:
          "min-h-[260px] rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-800 outline-none dark:border-gray-800 dark:bg-white/[0.03] dark:text-white/90 " +
          "[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:text-lg [&_h2]:font-semibold",
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
    const url = window.prompt("URL изображения");
    if (!url) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
  };

  const onSave = async () => {
    if (!editor) return;
    setBusy(true);
    setError(null);
    setSavedId(null);
    try {
      const cleanTitle = title.trim();
      if (!cleanTitle) throw new Error("Название формы обязательно");
      const cleanCategoryId = categoryId.trim();
      if (!cleanCategoryId) throw new Error("Категория обязательна");
      const payload = {
        title: cleanTitle,
        category_id: cleanCategoryId,
        content_json: editor.getJSON(),
        content_html: editor.getHTML(),
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
              disabled={!editor}
            >
              Bold
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => editor?.chain().focus().toggleItalic().run()}
              disabled={!editor}
            >
              Italic
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => editor?.chain().focus().toggleBulletList().run()}
              disabled={!editor}
            >
              • list
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              disabled={!editor}
            >
              1. list
            </button>
            <button
              className="rounded-lg border border-gray-200 px-3 py-1 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-200 dark:hover:bg-white/[0.06]"
              onClick={onInsertImageUrl}
              disabled={!editor}
            >
              Image URL
            </button>
          </div>

          <EditorContent editor={editor} />

          <Button size="sm" disabled={busy || !editor} onClick={onSave}>
            Сохранить
          </Button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-gray-200 bg-white px-5 py-6 dark:border-gray-800 dark:bg-white/[0.03]">
        <div className="mb-3 font-semibold text-gray-800 dark:text-white/90">Подсказки (переменные)</div>
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
                  <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">{moduleName}</div>
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

