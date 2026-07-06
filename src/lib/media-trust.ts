// Media trust — pure, Node-testable. Two protections no mobile-first editor
// ships: a pre-export music copyright check and a license/attribution
// tracker for every third-party asset in the project.
//
// The copyright check is a METADATA scan (ID3v2 / ID3v1 / RIFF-INFO tags) —
// honest about not being audio fingerprinting. Platforms DO fingerprint, so
// the guidance errs conservative: an identified commercial release is
// flagged before the creator earns a strike, and untagged audio still gets
// a "platforms can detect what tags don't say" note.

export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  publisher?: string;
  copyright?: string;
}

export interface CopyrightRisk {
  level: "high" | "caution" | "unknown";
  headline: string;
  detail: string;
  tags: AudioTags;
}

// --- tag readers ------------------------------------------------------------------

const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, e)).replace(/\0+.*$/, "").trim();

function decodeText(b: Uint8Array): string {
  if (b.length === 0) return "";
  const enc = b[0];
  const body = b.subarray(1);
  try {
    if (enc === 1 || enc === 2) return new TextDecoder("utf-16").decode(body).replace(/\0/g, "").trim();
    return new TextDecoder(enc === 3 ? "utf-8" : "latin1").decode(body).replace(/\0/g, "").trim();
  } catch {
    return ascii(b, 1, b.length);
  }
}

const syncsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b: Uint8Array, o: number) => (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3];

export function readAudioTags(bytes: Uint8Array): AudioTags {
  const tags: AudioTags = {};

  // ID3v2 at the start
  if (bytes.length > 20 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const ver = bytes[3]; // 3 = v2.3, 4 = v2.4
    const size = syncsafe(bytes, 6);
    let o = 10;
    const end = Math.min(bytes.length, 10 + size);
    const WANT: Record<string, keyof AudioTags> = { TIT2: "title", TPE1: "artist", TALB: "album", TPUB: "publisher", TCOP: "copyright" };
    while (o + 10 <= end) {
      const id = ascii(bytes, o, o + 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const fsize = ver === 4 ? syncsafe(bytes, o + 4) : be32(bytes, o + 4);
      if (fsize <= 0 || o + 10 + fsize > end) break;
      const key = WANT[id];
      if (key && !tags[key]) {
        const v = decodeText(bytes.subarray(o + 10, o + 10 + fsize)).slice(0, 120);
        if (v) tags[key] = v;
      }
      o += 10 + fsize;
    }
  }

  // ID3v1 at the tail (only fills gaps)
  if (bytes.length >= 128) {
    const t = bytes.subarray(bytes.length - 128);
    if (ascii(t, 0, 3) === "TAG") {
      tags.title ||= ascii(t, 3, 33) || undefined;
      tags.artist ||= ascii(t, 33, 63) || undefined;
      tags.album ||= ascii(t, 63, 93) || undefined;
    }
  }

  // RIFF/WAVE LIST-INFO chunks
  if (bytes.length > 44 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WAVE") {
    const WANT: Record<string, keyof AudioTags> = { INAM: "title", IART: "artist", ICOP: "copyright", IPRD: "album" };
    let o = 12;
    while (o + 8 <= bytes.length) {
      const id = ascii(bytes, o, o + 4);
      const size = bytes[o + 4] | (bytes[o + 5] << 8) | (bytes[o + 6] << 16) | (bytes[o + 7] << 24);
      if (size < 0 || o + 8 + size > bytes.length) break;
      if (id === "LIST" && ascii(bytes, o + 8, o + 12) === "INFO") {
        let p = o + 12;
        const lend = o + 8 + size;
        while (p + 8 <= lend) {
          const cid = ascii(bytes, p, p + 4);
          const csize = bytes[p + 4] | (bytes[p + 5] << 8) | (bytes[p + 6] << 16) | (bytes[p + 7] << 24);
          if (csize < 0 || p + 8 + csize > lend) break;
          const key = WANT[cid];
          if (key && !tags[key]) {
            const v = ascii(bytes, p + 8, p + 8 + csize).slice(0, 120);
            if (v) tags[key] = v;
          }
          p += 8 + csize + (csize % 2);
        }
      }
      o += 8 + size + (size % 2);
    }
  }

  return tags;
}

export function assessCopyrightRisk(tags: AudioTags): CopyrightRisk {
  if (tags.copyright || tags.publisher) {
    return {
      level: "high",
      headline: "This track carries a copyright / label tag.",
      detail: `${tags.artist ? `“${tags.title ?? "Untitled"}” by ${tags.artist}` : "This file"} is tagged ${tags.copyright ? `“${tags.copyright}”` : `by publisher “${tags.publisher}”`}. Platforms fingerprint commercial releases — expect a mute, claim, or strike unless you have a license. Use the built-in score, or platform-licensed sounds added inside the app you post from.`,
      tags,
    };
  }
  if (tags.artist && tags.title) {
    return {
      level: "caution",
      headline: `Identified as “${tags.title}” by ${tags.artist}.`,
      detail: "A named commercial recording is likely in platform fingerprint databases even without an explicit copyright tag. Safe options: the built-in score, your own recordings, or tracks you hold a license for.",
      tags,
    };
  }
  return {
    level: "unknown",
    headline: "No rights metadata found in this track.",
    detail: "This scan reads the file's tags — it is not audio fingerprinting, and platforms DO fingerprint. If this is a commercial song, it can still be detected. Original or licensed music is the only safe answer.",
    tags,
  };
}

// --- license & attribution tracker ---------------------------------------------------------

export interface AssetLicense {
  id: string;
  name: string;
  kind: "music" | "video" | "image" | "sfx" | "font" | "other";
  source: string; // where it came from (Openverse, user upload, generated…)
  license: string; // e.g. "CC BY 4.0", "CC0", "purchased", "own recording"
  author?: string;
  url?: string;
}

const NEEDS_CREDIT = /^cc[- ]?by/i;

export function attributionText(assets: AssetLicense[]): string {
  if (assets.length === 0) return "";
  const lines = assets.map((a) => {
    const credit = [a.name, a.author ? `by ${a.author}` : "", `(${a.license}${a.source ? `, via ${a.source}` : ""})`, a.url ?? ""]
      .filter(Boolean)
      .join(" ");
    return `• ${credit}`;
  });
  const needCredit = assets.filter((a) => NEEDS_CREDIT.test(a.license)).length;
  const head =
    needCredit > 0
      ? `Credits (${needCredit} asset${needCredit > 1 ? "s" : ""} REQUIRE attribution — paste this in your description):`
      : "Asset licenses used in this edit:";
  return [head, ...lines].join("\n");
}

// Quick pre-export audit: anything missing a license entry, anything needing credit.
export function licenseAudit(assets: AssetLicense[]): { ok: boolean; warnings: string[] } {
  const warnings: string[] = [];
  for (const a of assets) {
    if (!a.license || a.license === "unknown") warnings.push(`“${a.name}” has no recorded license — track down where it came from before posting.`);
    else if (NEEDS_CREDIT.test(a.license) && !a.author) warnings.push(`“${a.name}” is ${a.license} but has no author recorded — attribution will be incomplete.`);
  }
  return { ok: warnings.length === 0, warnings };
}
