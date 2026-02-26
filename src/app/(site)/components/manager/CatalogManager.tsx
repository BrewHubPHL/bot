"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useOpsSessionOptional } from "@/components/OpsGate";
import { toUserSafeMessageFromUnknown } from "@/lib/errorCatalog";
import { RefreshCw } from "lucide-react";

/**
 * Sanitise an image URL: only allows https:// (and http://localhost for dev).
 * Returns empty string for anything unsafe — prevents DOM-based XSS (CWE-79).
 */
function safeImageUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const u = new URL(raw);
    // Only allow HTTPS from a small set of trusted hostnames, or http://localhost in dev
    const TRUSTED_HOSTNAMES = [
      'brewhubphl.com',
      'www.brewhubphl.com',
      'storage.googleapis.com',
      'i.imgur.com',
    ];

    if (u.protocol === 'https:') {
      const hn = u.hostname.toLowerCase();
      if (TRUSTED_HOSTNAMES.some(t => hn === t || hn.endsWith('.' + t))) return u.href;
      return '';
    }

    if (u.protocol === 'http:' && u.hostname === 'localhost') return u.href;
    return '';
  } catch {
    return "";
  }
}

// Trusted hostnames for product images
const TRUSTED_HOSTNAMES = [
  'brewhubphl.com',
  'www.brewhubphl.com',
  'storage.googleapis.com',
  'i.imgur.com',
];

const API_BASE =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8888/.netlify/functions"
    : "/.netlify/functions";

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
  category: "menu" | "merch" | null;
  stock_quantity: number | null;
  archived_at: string | null;
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
  stock_quantity: string; // "" = unlimited (NULL), digits = tracked
}

const EMPTY_FORM: FormState = {
  id: null,
  name: "",
  description: "",
  price: "",
  image_url: "",
  is_active: true,
  category: "menu",
  stock_quantity: "",
};

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

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

/** Responsive product card shown in the grid */
function ProductCard({
  product,
  onEdit,
  onToggleActive,
  onDelete,
  onReportShrinkage,
}: {
  product: MerchProduct;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onReportShrinkage: () => void;
}) {
  return (
    <div
      className={`bg-stone-900 border border-stone-800 rounded-xl overflow-hidden
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
        <div className="relative w-full aspect-square bg-stone-800 flex items-center justify-center overflow-hidden">
          {product.image_url ? (
            <img
              src={safeImageUrl(product.image_url)}
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
            <h3 className="font-semibold text-stone-100 truncate">{product.name}</h3>
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
      <div className="flex border-t border-stone-800">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 py-2 text-xs font-medium text-stone-400 hover:text-white
                     hover:bg-stone-800 transition-colors"
        >
          ✏️ Edit
        </button>
        <button
          type="button"
          onClick={onToggleActive}
          className="flex-1 py-2 text-xs font-medium text-stone-400 hover:text-white
                     hover:bg-stone-800 transition-colors border-x border-stone-800"
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
      {/* Shrinkage report button — only for tracked-stock items */}
      {product.stock_quantity !== null && (
        <div className="border-t border-stone-800">
          <button
            type="button"
            onClick={onReportShrinkage}
            className="w-full py-2 text-xs font-medium text-orange-400 hover:text-orange-300
                       hover:bg-orange-500/10 transition-colors"
          >
            📋 Report Spoilage / Breakage
          </button>
        </div>
      )}
    </div>
  );
}

/** Drag-and-drop zone + file input */
function ImageDropZone({
  currentUrl,
  onUploaded,
  uploading,
  setUploading,
  token,
}: {
  currentUrl: string;
  onUploaded: (url: string) => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  token: string;
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
        // Convert file to base64 for JSON transport
        const arrayBuffer = await file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
        );

        const res = await fetch(`${API_BASE}/upload-menu-image`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-BrewHub-Action": "true",
          },
          body: JSON.stringify({
            fileBase64: base64,
            contentType: file.type,
            fileName: file.name,
          }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Upload failed");
        }

        const data = await res.json();
        onUploaded(data.url);
      } catch (err: unknown) {
        const msg = toUserSafeMessageFromUnknown(err, "Unable to upload image right now.");
        setError(msg);
      } finally {
        setUploading(false);
      }
    },
    [uploading, onUploaded, setUploading, token],
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
      <label className="block text-sm text-stone-400">Image</label>

      {safeImageUrl(currentUrl) && (
        <img
          src={safeImageUrl(currentUrl)}
          alt="Preview"
          className="w-full h-40 object-cover rounded-lg border border-stone-800"
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
              : "border-stone-700 hover:border-stone-600"
          }`}
      >
        {uploading ? (
          <span className="text-sm text-stone-400 animate-pulse">Uploading…</span>
        ) : (
          <>
            <span className="text-2xl">📁</span>
            <span className="text-sm text-stone-400">
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

/**
 * Safely assign image src at runtime after validation to avoid direct JSX injection.
 */
function ProductImage({ src, alt }: { src: string; alt: string }) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!src) return;
    try {
      if (imgRef.current) {
        const proxied = `/.netlify/functions/proxy-image?u=${encodeURIComponent(src)}`;
        imgRef.current.src = proxied;
      }
    } catch {
      // swallow any assignment errors
    }
  }, [src]);
  return <img ref={imgRef} alt={alt} className="w-full h-full object-cover" loading="lazy" src="" />;
}
/** Sanitise image_url on every product at ingestion time. */
function sanitizeProducts(list: MerchProduct[]): MerchProduct[] {
  return list.map((p) => ({
    ...p,
    image_url: safeImageUrl(p.image_url) || null,
  }));
}
/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */
export default function CatalogManager() {
  const token = useOpsSessionOptional()?.token ?? "";
  const [products, setProducts] = useState<MerchProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [viewArchived, setViewArchived] = useState(false);

  /* --- Shrinkage reporting state -------------------------------- */
  const [shrinkageTarget, setShrinkageTarget] = useState<MerchProduct | null>(null);
  const [shrinkageCategory, setShrinkageCategory] = useState<"breakage" | "spoilage" | "theft" | "other">("breakage");
  const [shrinkageQty, setShrinkageQty] = useState("1");
  const [shrinkageReason, setShrinkageReason] = useState("");
  const [shrinkageSaving, setShrinkageSaving] = useState(false);
  const [shrinkageError, setShrinkageError] = useState<string | null>(null);
  const [shrinkageSuccess, setShrinkageSuccess] = useState<string | null>(null);

  /* --- Fetch products -------------------------------------------- */
  const fetchProducts = useCallback(async () => {
    if (!token) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/manage-catalog`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Catalog fetch failed");
      const data = await res.json();
      setProducts(sanitizeProducts(data.products ?? []));
    } catch (err: unknown) {
      console.error("Catalog fetch failed");
    }
    setLoading(false);
  }, [token]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  /* --- Delete (archive) product ---------------------------------- */
  const handleDelete = async (productId: string) => {
    if (!confirm("Archive this product? It can be restored later from the Archived tab.")) return;
    try {
      const res = await fetch(`${API_BASE}/manage-catalog`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ id: productId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Delete failed");
      }
      setProducts((prev) => prev.filter((p) => p.id !== productId));
    } catch (err: unknown) {
      alert(toUserSafeMessageFromUnknown(err, "Unable to archive this product right now."));
    }
  };

  /* --- Restore archived product ---------------------------------- */
  const handleRestore = async (productId: string) => {
    try {
      const res = await fetch(`${API_BASE}/manage-catalog`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ id: productId, archived_at: null, is_active: true }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Restore failed");
      }
      await fetchProducts();
    } catch (err: unknown) {
      alert(toUserSafeMessageFromUnknown(err, "Unable to restore this product right now."));
    }
  };

  /* --- Toggle active/hidden -------------------------------------- */
  const handleToggleActive = async (productId: string, currentlyActive: boolean) => {
    const newStatus = !currentlyActive;
    try {
      const res = await fetch(`${API_BASE}/manage-catalog`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ id: productId, is_active: newStatus }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Update failed");
      }
      setProducts((prev) =>
        prev.map((p) =>
          p.id === productId ? { ...p, is_active: newStatus } : p
        )
      );
    } catch (err: unknown) {
      alert(toUserSafeMessageFromUnknown(err, "Unable to update this product right now."));
    }
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
      stock_quantity: p.stock_quantity !== null && p.stock_quantity !== undefined
        ? String(p.stock_quantity)
        : "",
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
      // Parse stock_quantity: empty string → null (unlimited), otherwise integer
      const parsedStock = form.stock_quantity.trim() === ""
        ? null
        : parseInt(form.stock_quantity, 10);
      if (parsedStock !== null && (Number.isNaN(parsedStock) || parsedStock < 0)) {
        setSaveError("Stock quantity must be a non-negative number, or leave blank for unlimited.");
        setSaving(false);
        return;
      }

      const row: Record<string, unknown> = {
        name: trimmedName,
        description: form.description.trim() || null,
        price_cents: cents,
        image_url: form.image_url || null,
        is_active: form.is_active,
        category: form.category,
        stock_quantity: parsedStock,
      };

      let res: Response;
      if (form.id) {
        // Update
        res = await fetch(`${API_BASE}/manage-catalog`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-BrewHub-Action": "true",
          },
          body: JSON.stringify({ id: form.id, ...row }),
        });
      } else {
        // Create
        res = await fetch(`${API_BASE}/manage-catalog`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-BrewHub-Action": "true",
          },
          body: JSON.stringify(row),
        });
      }

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Save failed");
      }

      await fetchProducts();
      closeDrawer();
    } catch (err: unknown) {
      setSaveError(toUserSafeMessageFromUnknown(err, "Unable to save catalog changes right now."));
    } finally {
      setSaving(false);
    }
  };

  /* --- Report shrinkage (breakage / spoilage / theft) ----------- */
  const openShrinkage = (p: MerchProduct) => {
    setShrinkageTarget(p);
    setShrinkageCategory("breakage");
    setShrinkageQty("1");
    setShrinkageReason("");
    setShrinkageError(null);
    setShrinkageSuccess(null);
  };

  const closeShrinkage = () => {
    setShrinkageTarget(null);
    setShrinkageError(null);
    setShrinkageSuccess(null);
  };

  const handleShrinkage = async () => {
    if (!shrinkageTarget) return;
    setShrinkageError(null);
    setShrinkageSuccess(null);
    const qty = parseInt(shrinkageQty, 10);
    if (!Number.isInteger(qty) || qty < 1) {
      setShrinkageError("Quantity must be at least 1.");
      return;
    }
    if (shrinkageReason.trim().length < 2) {
      setShrinkageError("A reason is required (min 2 characters).");
      return;
    }
    setShrinkageSaving(true);
    try {
      const res = await fetch(`${API_BASE}/log-shrinkage`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({
          product_id: shrinkageTarget.id,
          category: shrinkageCategory,
          quantity: qty,
          reason: shrinkageReason.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to record shrinkage");
      }
      setShrinkageSuccess(
        `Recorded: ${qty}× ${data.shrinkage?.product_name ?? shrinkageTarget.name} ` +
        `(${shrinkageCategory}) — loss $${((data.shrinkage?.total_loss_cents ?? 0) / 100).toFixed(2)}. ` +
        `Stock: ${data.shrinkage?.old_stock ?? "?"} → ${data.shrinkage?.new_stock ?? "?"}`
      );
      // Refresh product list to reflect updated stock
      await fetchProducts();
    } catch (err: unknown) {
      setShrinkageError(toUserSafeMessageFromUnknown(err, "Unable to record shrinkage right now."));
    } finally {
      setShrinkageSaving(false);
    }
  };

  /* --- Field helpers --------------------------------------------- */
  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* --- Render ---------------------------------------------------- */
  return (
    <section>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">🛍️ Catalog Manager</h2>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={fetchProducts}
            className="flex items-center gap-2 px-4 py-2 min-h-[44px] rounded-xl
                       bg-stone-900 border border-stone-800 text-stone-400 text-sm
                       hover:border-stone-600 hover:text-white transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNew}
            className="bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium
                       px-4 py-2 rounded-lg transition-colors"
          >
            + Add New
          </button>
        </div>
      </div>

      {/* Active / Archived tabs */}
      <div className="flex gap-1 mb-6 bg-stone-900 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setViewArchived(false)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            !viewArchived ? "bg-stone-700 text-white" : "text-stone-400 hover:text-white"
          }`}
        >
          Active ({products.filter((p) => !p.archived_at).length})
        </button>
        <button
          type="button"
          onClick={() => setViewArchived(true)}
          className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
            viewArchived ? "bg-stone-700 text-white" : "text-stone-400 hover:text-white"
          }`}
        >
          Archived ({products.filter((p) => !!p.archived_at).length})
        </button>
      </div>

      {/* Product grid */}
      {(() => {
        const filtered = products.filter((p) =>
          viewArchived ? !!p.archived_at : !p.archived_at
        );
        if (loading) {
          return (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-stone-900 border border-stone-800 rounded-xl animate-pulse aspect-square"
                />
              ))}
            </div>
          );
        }
        if (filtered.length === 0) {
          return (
            <p className="text-stone-500 text-center py-12">
              {viewArchived
                ? "No archived products."
                : <>No products yet. Click <strong>+ Add New</strong> to create one.</>}
            </p>
          );
        }
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {filtered.map((p) => {
              // Inline-validate hostname and protocol to make sanitizer explicit for static analysis
              let imgSrc = '';
              try {
                const u = new URL(p.image_url || '');
                const hn = u.hostname.toLowerCase();
                if (u.protocol === 'https:' && (TRUSTED_HOSTNAMES.some(t => hn === t || hn.endsWith('.' + t)))) {
                  imgSrc = u.href;
                } else if (u.protocol === 'http:' && u.hostname === 'localhost') {
                  imgSrc = u.href;
                }
              } catch { imgSrc = ''; }
              return viewArchived ? (
                <div
                  key={p.id}
                  className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden opacity-60"
                >
                  <div className="relative w-full aspect-square bg-stone-800 flex items-center justify-center overflow-hidden">
                    {imgSrc ? (
                      <ProductImage src={imgSrc} alt={p.name} />
                    ) : (
                      <span className="text-5xl select-none" aria-hidden>☕</span>
                    )}
                    <span className="absolute top-2 right-2 text-xs font-semibold px-2 py-0.5 rounded-full bg-zinc-500/20 text-zinc-400">
                      Archived
                    </span>
                  </div>
                  <div className="p-4 pb-2">
                    <h3 className="font-semibold text-stone-100 truncate">{p.name}</h3>
                    <p className="text-green-400 text-sm mt-1">${centsToDollars(p.price_cents)}</p>
                  </div>
                  <div className="border-t border-stone-800">
                    <button
                      type="button"
                      onClick={() => handleRestore(p.id)}
                      className="w-full py-2 text-xs font-medium text-emerald-400 hover:text-emerald-300
                                 hover:bg-emerald-500/10 transition-colors"
                    >
                      ↩ Restore
                    </button>
                  </div>
                </div>
              ) : (
                <ProductCard
                  key={p.id}
                  product={p}
                  onEdit={() => openEdit(p)}
                  onToggleActive={() => handleToggleActive(p.id, p.is_active)}
                  onDelete={() => handleDelete(p.id)}
                  onReportShrinkage={() => openShrinkage(p)}
                />
              );
            })}
          </div>
        );
      })()}

      {/* ── Shrinkage Report Modal ───────────────────────────── */}
      {shrinkageTarget && (
        <>
          <div
            className="fixed inset-0 bg-black/60 z-50"
            onClick={closeShrinkage}
            aria-hidden
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold text-orange-400">📋 Report Shrinkage</h3>
                <button
                  type="button"
                  onClick={closeShrinkage}
                  className="text-stone-400 hover:text-white text-xl leading-none"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <p className="text-sm text-stone-300">
                Product: <strong>{shrinkageTarget.name}</strong>
                {shrinkageTarget.stock_quantity !== null && (
                  <> — Current stock: <strong>{shrinkageTarget.stock_quantity}</strong></>
                )}
              </p>

              {/* Category */}
              <div>
                <label className="block text-sm text-stone-400 mb-1">Category</label>
                <select
                  value={shrinkageCategory}
                  onChange={(e) => setShrinkageCategory(e.target.value as typeof shrinkageCategory)}
                  className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                             text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500
                             appearance-none cursor-pointer"
                >
                  <option value="breakage">💔 Breakage</option>
                  <option value="spoilage">🗑 Spoilage</option>
                  <option value="theft">🚨 Theft</option>
                  <option value="other">📝 Other</option>
                </select>
              </div>

              {/* Quantity */}
              <div>
                <label className="block text-sm text-stone-400 mb-1">Quantity Lost</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={shrinkageQty}
                  onChange={(e) => {
                    if (/^\d*$/.test(e.target.value)) setShrinkageQty(e.target.value);
                  }}
                  className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                             text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500"
                  placeholder="1"
                />
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm text-stone-400 mb-1">Reason (required for IRS trail)</label>
                <textarea
                  value={shrinkageReason}
                  onChange={(e) => setShrinkageReason(e.target.value)}
                  maxLength={500}
                  rows={3}
                  className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                             text-stone-100 focus:outline-none focus:ring-2 focus:ring-orange-500
                             resize-none"
                  placeholder="e.g. Customer dropped mug on tile floor"
                />
                <p className="text-xs text-stone-500 mt-1">{shrinkageReason.length}/500</p>
              </div>

              {/* Error */}
              {shrinkageError && (
                <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                  {shrinkageError}
                </p>
              )}

              {/* Success */}
              {shrinkageSuccess && (
                <p className="text-green-400 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
                  ✅ {shrinkageSuccess}
                </p>
              )}

              {/* Submit */}
              <button
                type="button"
                onClick={handleShrinkage}
                disabled={shrinkageSaving}
                className="w-full bg-orange-600 hover:bg-orange-500 disabled:opacity-50
                           disabled:cursor-not-allowed text-white font-medium py-2.5
                           rounded-lg transition-colors text-sm"
              >
                {shrinkageSaving ? "Recording…" : "Record Shrinkage & Decrement Stock"}
              </button>
            </div>
          </div>
        </>
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
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-stone-950 border-l border-stone-800
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
              className="text-stone-400 hover:text-white text-xl leading-none"
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
            token={token}
          />

          {/* Name */}
          <div>
            <label htmlFor="catalog-name" className="block text-sm text-stone-400 mb-1">
              Name
            </label>
            <input
              id="catalog-name"
              type="text"
              maxLength={100}
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                         text-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Oat Milk Latte"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="catalog-desc" className="block text-sm text-stone-400 mb-1">
              Description
            </label>
            <textarea
              id="catalog-desc"
              rows={3}
              maxLength={500}
              value={form.description}
              onChange={(e) => setField("description", e.target.value)}
              className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                         text-stone-100 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="A smooth espresso with oat milk…"
            />
          </div>

          {/* Price */}
          <div>
            <label htmlFor="catalog-price" className="block text-sm text-stone-400 mb-1">
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
              className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                         text-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="4.50"
            />
          </div>

          {/* Stock Quantity */}
          <div>
            <label htmlFor="catalog-stock" className="block text-sm text-stone-400 mb-1">
              Stock Quantity
            </label>
            <input
              id="catalog-stock"
              type="text"
              inputMode="numeric"
              value={form.stock_quantity}
              onChange={(e) => {
                const v = e.target.value;
                if (/^\d*$/.test(v) || v === "") {
                  setField("stock_quantity", v);
                }
              }}
              className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                         text-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Leave blank for unlimited"
            />
            <p className="text-xs text-stone-500 mt-1">
              Leave blank for unlimited stock (e.g. cafe drinks). Enter a number for tracked inventory (e.g. bags of beans, hoodies).
            </p>
          </div>

          {/* Category */}
          <div>
            <label htmlFor="catalog-category" className="block text-sm text-stone-400 mb-1">
              Category
            </label>
            <select
              id="catalog-category"
              value={form.category}
              onChange={(e) => setField("category", e.target.value as "menu" | "merch")}
              className="w-full bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 text-sm
                         text-stone-100 focus:outline-none focus:ring-2 focus:ring-blue-500
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
                form.is_active ? "bg-green-500" : "bg-stone-600"
              }`}
              onClick={() => setField("is_active", !form.is_active)}
            >
              <div
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  form.is_active ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </div>
            <span className="text-sm text-stone-300">
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
            className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50
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
