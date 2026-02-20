"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
interface MerchProduct {
  id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
  checkout_url: string | null;
  is_active: boolean;
  sort_order: number;
  category: string | null;
  created_at: string;
  updated_at: string;
}

interface FormState {
  id: string | null;
  name: string;
  description: string;
  price: string; // dollars string e.g. "4.50"
  image_url: string;
  is_active: boolean;
  category: "menu" | "merch";
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  description: "",
  price: "",
  image_url: "",
  is_active: true,
  category: "menu",
};

const BUCKET = "menu-images";
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function dollarsToCents(dollars: string): number {
  const parsed = parseFloat(dollars);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").toLowerCase();
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

/** Responsive product card shown in the grid */
function ProductCard({
  product,
  onEdit,
  onToggleActive,
  onDelete,
}: {
  product: MerchProduct;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`bg-[#1a1a1a] border border-[#333] rounded-xl overflow-hidden
                 transition-all duration-200 ${
                   product.is_active ? "" : "opacity-50"
                 }`}
    >
      {/* Image / emoji fallback — click opens edit */}
      <button
        type="button"
        onClick={onEdit}
        className="w-full text-left focus:outline-none focus:ring-2 focus:ring-blue-500
                   hover:brightness-110 transition-all"
      >
        <div className="relative w-full aspect-square bg-[#222] flex items-center justify-center overflow-hidden">
          {product.image_url ? (
            <img
              src={product.image_url}
              alt={product.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="text-5xl select-none" aria-hidden>
              ☕
            </span>
          )}
          {/* Status badge */}
          <span
            className={`absolute top-2 right-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
              product.is_active
                ? "bg-green-500/20 text-green-400"
                : "bg-red-500/20 text-red-400"
            }`}
          >
            {product.is_active ? "Active" : "Hidden"}
          </span>
        </div>

        <div className="p-4 pb-2">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-[#f5f5f5] truncate">{product.name}</h3>
            <span
              className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                product.category === "merch"
                  ? "bg-purple-500/20 text-purple-300"
                  : "bg-amber-500/20 text-amber-300"
              }`}
            >
              {product.category === "merch" ? "Merch" : "Menu"}
            </span>
          </div>
          <p className="text-green-400 text-sm mt-1">
            ${centsToDollars(product.price_cents)}
          </p>
        </div>
      </button>

      {/* Action buttons */}
      <div className="flex border-t border-[#333]">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 py-2 text-xs font-medium text-gray-400 hover:text-white
                     hover:bg-[#222] transition-colors"
        >
          ✏️ Edit
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          className="flex-1 py-2 text-xs font-medium text-gray-400 hover:text-white
                     hover:bg-[#222] transition-colors border-x border-[#333]"
        >
          {product.is_active ? "👁 Hide" : "👁 Show"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex-1 py-2 text-xs font-medium text-red-400 hover:text-red-300
                     hover:bg-red-500/10 transition-colors"
        >
          🗑 Delete
        </button>
      </div>
    </div>
  );
}

/** Drag-and-drop zone + file input */
function ImageDropZone({
  currentUrl,
  onUploaded,
  uploading,
  setUploading,
}: {
  currentUrl: string;
  onUploaded: (url: string) => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (uploading) return; // guard against double-drop / double-click
      setError(null);

      if (!ALLOWED_TYPES.includes(file.type)) {
        setError("Only PNG, JPEG, WebP, or GIF images are allowed.");
        return;
      }
      if (file.size > MAX_SIZE_BYTES) {
        setError("Image must be smaller than 5 MB.");
        return;
      }

      setUploading(true);
      try {
        const ext = file.name.split(".").pop() ?? "png";
        const safeName = sanitizeFileName(
          `${Date.now()}_${file.name.replace(`.${ext}`, "")}`
        );
        const path = `catalog/${safeName}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { cacheControl: "3600", upsert: false });

        if (uploadErr) throw uploadErr;

        const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
        onUploaded(urlData.publicUrl);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        setError(msg);
      } finally {
        setUploading(false);
      }
    },
    [uploading, onUploaded, setUploading],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="space-y-2">
      <label className="block text-sm text-gray-400">Image</label>

      {currentUrl && (
        <img
          src={currentUrl}
          alt="Preview"
          className="w-full h-40 object-cover rounded-lg border border-[#333]"
        />
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed rounded-lg cursor-pointer
          transition-colors ${
            dragOver
              ? "border-blue-500 bg-blue-500/10"
              : "border-[#444] hover:border-[#666]"
          }`}
      >
        {uploading ? (
          <span className="text-sm text-gray-400 animate-pulse">Uploading…</span>
        ) : (
          <>
            <span className="text-2xl">📁</span>
            <span className="text-sm text-gray-400">
              Drag &amp; drop an image or <span className="text-blue-400 underline">browse</span>
            </span>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
export default function CatalogManager() {
  const [products, setProducts] = useState<MerchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  /* --- Fetch products -------------------------------------------- */
  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("merch_products")
      .select("*")
      .order("sort_order", { ascending: true });

    if (!error && data) setProducts(data as MerchProduct[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  /* --- Delete product -------------------------------------------- */
  const handleDelete = async (productId: string) => {
    if (!confirm("Delete this product? This cannot be undone.")) return;
    const { error } = await supabase
      .from("merch_products")
      .delete()
      .eq("id", productId);
    if (error) {
      alert("Failed to delete: " + error.message);
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== productId));
  };

  /* --- Toggle active/hidden -------------------------------------- */
  const handleToggleActive = async (productId: string, currentlyActive: boolean) => {
    const newStatus = !currentlyActive;
    const { error } = await supabase
      .from("merch_products")
      .update({ is_active: newStatus })
      .eq("id", productId);
    if (error) {
      alert("Failed to update: " + error.message);
      return;
    }
    setProducts((prev) =>
      prev.map((p) =>
        p.id === productId ? { ...p, is_active: newStatus } : p
      )
    );
  };

  /* --- Drawer open / close --------------------------------------- */
  const openNew = () => {
    setForm(EMPTY_FORM);
    setSaveError(null);
    setDrawerOpen(true);
  };

  const openEdit = (p: MerchProduct) => {
    setForm({
      id: p.id,
      name: p.name,
      description: p.description ?? "",
      price: centsToDollars(p.price_cents),
      image_url: p.image_url ?? "",
      is_active: p.is_active,
      category: (p.category === "merch" ? "merch" : "menu") as "menu" | "merch",
    });
    setSaveError(null);
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  /* --- Save (upsert) --------------------------------------------- */
  const handleSave = async () => {
    setSaveError(null);

    // Client-side validation
    const trimmedName = form.name.trim();
    if (!trimmedName) {
      setSaveError("Name is required.");
      return;
    }
    const cents = dollarsToCents(form.price);
    if (cents <= 0) {
      setSaveError("Price must be greater than $0.00.");
      return;
    }

    setSaving(true);
    try {
      const row = {
        name: trimmedName,
        description: form.description.trim() || null,
        price_cents: cents,
        image_url: form.image_url || null,
        is_active: form.is_active,
        category: form.category,
        updated_at: new Date().toISOString(),
      };

      let result;
      if (form.id) {
        // Update
        result = await supabase
          .from("merch_products")
          .update(row)
          .eq("id", form.id);
      } else {
        // Insert
        result = await supabase.from("merch_products").insert(row);
      }

      if (result.error) throw result.error;

      await fetchProducts();
      closeDrawer();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  /* --- Field helpers --------------------------------------------- */
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* --- Render ---------------------------------------------------- */
  return (
    <section className="mt-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">🛍️ Catalog Manager</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={fetchProducts}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium
                       px-4 py-2 rounded-lg transition-colors"
          >
            + Add New
          </button>
        </div>
      </div>

      {/* Product grid */}
      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="bg-[#1a1a1a] border border-[#333] rounded-xl animate-pulse aspect-square"
            />
          ))}
        </div>
      ) : products.length === 0 ? (
        <p className="text-gray-500 text-center py-12">
          No products yet. Click <strong>+ Add New</strong> to create one.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {products.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              onEdit={() => openEdit(p)}
              onToggleActive={() => handleToggleActive(p.id, p.is_active)}
              onDelete={() => handleDelete(p.id)}
            />
          ))}
        </div>
      )}

      {/* Overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 transition-opacity"
          onClick={closeDrawer}
          aria-hidden
        />
      )}

      {/* Slide-out drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-[#111] border-l border-[#333]
                     z-50 transform transition-transform duration-300 ease-in-out
                     ${drawerOpen ? "translate-x-0" : "translate-x-full"}
                     overflow-y-auto`}
      >
        <div className="p-6 space-y-6">
          {/* Drawer header */}
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">
              {form.id ? "Edit Product" : "New Product"}
            </h3>
            <button
              type="button"
              onClick={closeDrawer}
              className="text-gray-400 hover:text-white text-xl leading-none"
              aria-label="Close drawer"
            >
              ✕
            </button>
          </div>

          {/* Image upload */}
          <ImageDropZone
            currentUrl={form.image_url}
            onUploaded={(url) => setField("image_url", url)}
            uploading={uploading}
            setUploading={setUploading}
          />

          {/* Name */}
          <div>
            <label htmlFor="catalog-name" className="block text-sm text-gray-400 mb-1">
              Name
            </label>
            <input
              id="catalog-name"
              type="text"
              maxLength={100}
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm
                         text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Oat Milk Latte"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="catalog-desc" className="block text-sm text-gray-400 mb-1">
              Description
            </label>
            <textarea
              id="catalog-desc"
              rows={3}
              maxLength={500}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm
                         text-[#f5f5f5] resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="A smooth espresso with oat milk…"
            />
          </div>

          {/* Price */}
          <div>
            <label htmlFor="catalog-price" className="block text-sm text-gray-400 mb-1">
              Price ($)
            </label>
            <input
              id="catalog-price"
              type="text"
              inputMode="decimal"
              value={form.price}
              onChange={(e) => {
                // Allow only digits and one decimal point
                const v = e.target.value;
                if (/^\d*\.?\d{0,2}$/.test(v) || v === "") {
                  setField("price", v);
                }
              }}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm
                         text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="4.50"
            />
          </div>

          {/* Category */}
          <div>
            <label htmlFor="catalog-category" className="block text-sm text-gray-400 mb-1">
              Category
            </label>
            <select
              id="catalog-category"
              value={form.category}
              onChange={(e) => setField("category", e.target.value as "menu" | "merch")}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-3 py-2 text-sm
                         text-[#f5f5f5] focus:outline-none focus:ring-2 focus:ring-blue-500
                         appearance-none cursor-pointer"
            >
              <option value="menu">☕ Cafe Menu</option>
              <option value="merch">🛍 Merch &amp; Beans</option>
            </select>
          </div>

          {/* Active toggle */}
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              className={`relative w-11 h-6 rounded-full transition-colors ${
                form.is_active ? "bg-green-500" : "bg-[#444]"
              }`}
              onClick={() => setField("is_active", !form.is_active)}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  form.is_active ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
            <span className="text-sm text-gray-300">
              {form.is_active ? "Active (visible to customers)" : "Inactive (86'd)"}
            </span>
          </label>

          {/* Error */}
          {saveError && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {saveError}
            </p>
          )}

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50
                       disabled:cursor-not-allowed text-white font-medium py-2.5
                       rounded-lg transition-colors text-sm"
          >
            {saving ? "Saving…" : form.id ? "Update Product" : "Create Product"}
          </button>
        </div>
      </div>
    </section>
  );
}
