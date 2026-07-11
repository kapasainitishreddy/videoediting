// Shared asset library — pure, Node-testable. The "shared library" half of a
// team workspace, delivered local-first: a persistent, cross-project shelf of
// the things you reuse — brand kits, LUTs (.cube), caption styles, saved
// looks/presets, and your own edit templates. Lives in IndexedDB on-device
// (see storage.ts) and exports as one .viraledit-library.json file so a team
// can hand the whole kit around. Multi-user cloud sync + roles are the
// "coming soon" layer; the reusable shelf itself ships today.

export type LibraryKind = "brand" | "lut" | "captionStyle" | "look" | "preset" | "template";

export interface LibraryItem {
  id: string;
  kind: LibraryKind;
  name: string;
  createdAt: number;
  data: unknown; // payload: brand-kit object / .cube text / style id / studio look / blueprint
  tags?: string[];
}

export const LIBRARY_KINDS: { kind: LibraryKind; label: string; emoji: string }[] = [
  { kind: "brand", label: "Brand kits", emoji: "🎨" },
  { kind: "look", label: "Looks & grades", emoji: "🎬" },
  { kind: "lut", label: "LUTs (.cube)", emoji: "🧊" },
  { kind: "captionStyle", label: "Caption styles", emoji: "💬" },
  { kind: "preset", label: "Studio presets", emoji: "🎛️" },
  { kind: "template", label: "My templates", emoji: "⭐" },
];

const kindLabel = (k: LibraryKind) => LIBRARY_KINDS.find((x) => x.kind === k)?.label ?? k;

export function makeItem(
  fields: { kind: LibraryKind; name: string; data: unknown; tags?: string[] },
  meta: { id: string; createdAt: number },
): LibraryItem {
  return {
    id: meta.id,
    kind: fields.kind,
    name: fields.name.trim() || kindLabel(fields.kind),
    createdAt: meta.createdAt,
    data: fields.data,
    tags: fields.tags?.map((t) => t.trim()).filter(Boolean),
  };
}

// Newest first; replacing any existing item with the same id.
export function sortItems(list: LibraryItem[]): LibraryItem[] {
  return [...list].sort((a, b) => b.createdAt - a.createdAt);
}

export function addItem(list: LibraryItem[], item: LibraryItem): LibraryItem[] {
  return sortItems([...list.filter((x) => x.id !== item.id), item]);
}

export function removeItem(list: LibraryItem[], id: string): LibraryItem[] {
  return list.filter((x) => x.id !== id);
}

export function renameItem(list: LibraryItem[], id: string, name: string): LibraryItem[] {
  const n = name.trim();
  return list.map((x) => (x.id === id ? { ...x, name: n || x.name } : x));
}

export function itemsOfKind(list: LibraryItem[], kind: LibraryKind): LibraryItem[] {
  return sortItems(list.filter((x) => x.kind === kind));
}

// Free-text filter across name + tags + kind label.
export function searchItems(list: LibraryItem[], q: string): LibraryItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return sortItems(list);
  return sortItems(
    list.filter(
      (x) =>
        x.name.toLowerCase().includes(s) ||
        kindLabel(x.kind).toLowerCase().includes(s) ||
        (x.tags ?? []).some((t) => t.toLowerCase().includes(s)),
    ),
  );
}

export function libraryStats(list: LibraryItem[]): { total: number; byKind: Record<LibraryKind, number> } {
  const byKind = Object.fromEntries(LIBRARY_KINDS.map((k) => [k.kind, 0])) as Record<LibraryKind, number>;
  for (const x of list) byKind[x.kind] = (byKind[x.kind] ?? 0) + 1;
  return { total: list.length, byKind };
}

// --- portable library file (.viraledit-library.json) ---------------------------

interface LibraryFile {
  magic: "viraledit-library";
  version: 1;
  exportedAt: number;
  items: LibraryItem[];
}

export function exportLibrary(list: LibraryItem[], exportedAt: number): string {
  const out: LibraryFile = { magic: "viraledit-library", version: 1, exportedAt, items: sortItems(list) };
  return JSON.stringify(out, null, 2);
}

const VALID_KINDS = new Set(LIBRARY_KINDS.map((k) => k.kind));

function isItem(x: unknown): x is LibraryItem {
  const i = x as Partial<LibraryItem>;
  return !!i && typeof i.id === "string" && typeof i.name === "string" && VALID_KINDS.has(i.kind as LibraryKind);
}

export function importLibrary(text: string): { ok: true; items: LibraryItem[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Not a valid JSON file." };
  }
  const f = parsed as Partial<LibraryFile>;
  if (f?.magic !== "viraledit-library") return { ok: false, error: "Not a ViralEdit library file." };
  if (f.version !== 1) return { ok: false, error: `Unsupported library version ${String(f.version)}.` };
  if (!Array.isArray(f.items)) return { ok: false, error: "Library file has no items." };
  const items = f.items.filter(isItem);
  return { ok: true, items };
}

// Merge an imported library into the current one, de-duplicating by id
// (keeping the newer copy) so re-importing the same kit is idempotent.
export function mergeLibrary(existing: LibraryItem[], incoming: LibraryItem[]): LibraryItem[] {
  const byId = new Map<string, LibraryItem>();
  for (const x of [...existing, ...incoming]) {
    const prev = byId.get(x.id);
    if (!prev || x.createdAt >= prev.createdAt) byId.set(x.id, x);
  }
  return sortItems([...byId.values()]);
}
