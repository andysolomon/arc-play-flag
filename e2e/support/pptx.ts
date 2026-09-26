import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { Page, TestInfo } from "@playwright/test";

/**
 * An independent reader for the slide decks the app writes. It imports nothing from
 * `lib/` (its own CRC, its own ZIP walk, the browser's own XML parser), so a writer bug
 * cannot pass because the check shares it (E2). What it rejects, written down first:
 *
 * - Z1 flags with encryption, a data descriptor or UTF-8 names (bits 0, 3, 11).
 * - Z2 a method other than stored; deflate is inflated, so the journey fails on the
 *   method by name rather than on garbled bytes.
 * - Z3 a CRC or size that does not match the body.
 * - Z4 a local header that disagrees with its central record.
 * - Z5 directory entries, extra fields, comments, anything after the end record, zip64.
 * - Z6 names outside printable ASCII, a leading or trailing slash, a backslash, or two
 *   names equal ignoring case.
 * - Z7 a DOS date with month or day 0, or an impossible time.
 * - Z8 `[Content_Types].xml` not first.
 * - P1, P2 slide ids out of 256..2147483647 or repeated; master and layout ids other than
 *   2147483648 and 2147483649.
 * - P3 `presentation.xml` children out of schema order, or no `notesSz`.
 * - P4 a slide master not on theme1, or a notes master not on theme2.
 * - P5 a `txBody` that does not open with `bodyPr` or has no paragraph; an `a:xfrm`
 *   without `a:off` and `a:ext`.
 * - P6 two shapes with one id in a part.
 * - P7, P8 a part that does not parse or lacks the declaration; a part with no content
 *   type, an Override for a missing part, Defaults other than rels, xml and png; a
 *   relationship that dangles, is not `rId<n>`, repeats, or reaches a part of the wrong
 *   type; an `r:id` or `r:embed` with no relationship; a part unreachable from
 *   `_rels/.rels`; a slide without exactly one layout, image and notes link; a one-way
 *   notes link.
 *
 * P9–P11 (titles, pictures, fonts) are facts `readDeck` and `pngSize` read out for the
 * journey to assert.
 */

export const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** The clock and zone the slides journey pins, so the manifest says what the bytes depend on. */
export const PINNED = { clock: "2026-09-01T12:00:00Z", timezone: "UTC" } as const;

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PML = "application/vnd.openxmlformats-officedocument.presentationml";

/** CRC-32 (reflected 0xEDB88320), bit by bit: slow, and nothing like the writer's table. */
export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipItem {
  name: string;
  madeBy: number;
  needed: number;
  flags: number;
  method: number;
  time: number;
  date: number;
  crc: number;
  /** uncompressed bytes */
  size: number;
  /** where the local header starts */
  offset: number;
  data: Buffer;
}

const bad = (name: string, reason: string): Error => new Error(`${name}: ${reason}`);
const hex = (n: number): string => n.toString(16).padStart(8, "0");

/**
 * Every entry of a ZIP, walked from the end record back through the central directory
 * to each local header. Throws `<name>: <reason>` on the first structural defect.
 */
export function readZip(raw: Buffer): ZipItem[] {
  if (raw.length < 22) throw bad("zip", "shorter than an end record");
  const end = raw.length - 22;
  if (raw.readUInt32LE(end) !== 0x06054b50) throw bad("zip", "the end record is not the last 22 bytes (a comment, trailing bytes or zip64)");
  const disk = raw.readUInt16LE(end + 4), cdDisk = raw.readUInt16LE(end + 6);
  const onDisk = raw.readUInt16LE(end + 8), count = raw.readUInt16LE(end + 10);
  const cdSize = raw.readUInt32LE(end + 12), cdOffset = raw.readUInt32LE(end + 16);
  if (disk !== 0 || cdDisk !== 0) throw bad("zip", "spans more than one disk");
  if (onDisk !== count) throw bad("zip", `counts ${String(onDisk)} entries on this disk and ${String(count)} in all`);
  if (raw.readUInt16LE(end + 20) !== 0) throw bad("zip", "has a comment");
  if (cdOffset + cdSize !== end) throw bad("zip", "the central directory does not end where the end record begins");
  if (count === 0) throw bad("zip", "has no entries");

  const items: ZipItem[] = [];
  const seen = new Set<string>();
  let at = cdOffset, body = 0;
  for (let i = 0; i < count; i++) {
    const where = `entry ${String(i + 1)}`;
    if (at + 46 > end) throw bad(where, "its central header runs past the central directory");
    if (raw.readUInt32LE(at) !== 0x02014b50) throw bad(where, "bad central header signature");
    const central = {
      needed: raw.readUInt16LE(at + 6), flags: raw.readUInt16LE(at + 8), method: raw.readUInt16LE(at + 10),
      time: raw.readUInt16LE(at + 12), date: raw.readUInt16LE(at + 14), crc: raw.readUInt32LE(at + 16),
      csize: raw.readUInt32LE(at + 20), size: raw.readUInt32LE(at + 24),
    };
    const madeBy = raw.readUInt16LE(at + 4), nameLen = raw.readUInt16LE(at + 28), extra = raw.readUInt16LE(at + 30);
    const comment = raw.readUInt16LE(at + 32), diskStart = raw.readUInt16LE(at + 34), offset = raw.readUInt32LE(at + 42);
    if (at + 46 + nameLen > end) throw bad(where, "its name runs past the central directory");
    const nameBytes = raw.subarray(at + 46, at + 46 + nameLen);
    if (!nameLen || !nameBytes.every((c) => c >= 0x21 && c <= 0x7e)) throw bad(where, "its name is empty or not printable ASCII");
    const name = nameBytes.toString("latin1");
    if (name.startsWith("/") || name.endsWith("/")) throw bad(name, "a directory entry or a leading slash");
    if (name.includes("\\")) throw bad(name, "a backslash in the name");
    if (seen.has(name.toLowerCase())) throw bad(name, "a second entry with the same name, ignoring case");
    seen.add(name.toLowerCase());
    if (extra !== 0) throw bad(name, "an extra field in its central header");
    if (comment !== 0) throw bad(name, "a comment in its central header");
    if (diskStart !== 0) throw bad(name, "starts on another disk");
    if (central.flags & 0x0001) throw bad(name, "encrypted");
    if (central.flags & 0x0008) throw bad(name, "uses a data descriptor");
    if (central.flags & 0x0800) throw bad(name, "flags its name as UTF-8");
    if (central.needed > 20) throw bad(name, `needs version ${String(central.needed)} (zip64 or newer features)`);
    if (central.csize === 0xffffffff || central.size === 0xffffffff || offset === 0xffffffff) throw bad(name, "a zip64 marker");
    const month = (central.date >> 5) & 0xf, day = central.date & 0x1f;
    if (month < 1 || month > 12 || day < 1) throw bad(name, `DOS date 0x${central.date.toString(16)} has month or day 0`);
    if (central.time >> 11 > 23 || ((central.time >> 5) & 0x3f) > 59 || (central.time & 0x1f) > 29) throw bad(name, `DOS time 0x${central.time.toString(16)} is not a time of day`);

    if (offset !== body) throw bad(name, `its local header is at ${String(offset)}, not ${String(body)}: the bodies are not contiguous from 0`);
    if (offset + 30 > cdOffset) throw bad(name, "its local header runs into the central directory");
    if (raw.readUInt32LE(offset) !== 0x04034b50) throw bad(name, "bad local header signature");
    const local = {
      needed: raw.readUInt16LE(offset + 4), flags: raw.readUInt16LE(offset + 6), method: raw.readUInt16LE(offset + 8),
      time: raw.readUInt16LE(offset + 10), date: raw.readUInt16LE(offset + 12), crc: raw.readUInt32LE(offset + 14),
      csize: raw.readUInt32LE(offset + 18), size: raw.readUInt32LE(offset + 22),
    };
    for (const k of Object.keys(central) as (keyof typeof central)[]) {
      if (local[k] !== central[k]) throw bad(name, `local header ${k} ${String(local[k])} differs from the central ${String(central[k])}`);
    }
    const localNameLen = raw.readUInt16LE(offset + 26);
    if (raw.readUInt16LE(offset + 28) !== 0) throw bad(name, "an extra field in its local header");
    if (localNameLen !== nameLen || !raw.subarray(offset + 30, offset + 30 + localNameLen).equals(nameBytes)) throw bad(name, "its local header names another entry");
    const start = offset + 30 + nameLen;
    body = start + central.csize;
    if (body > cdOffset) throw bad(name, "its body runs into the central directory");
    const stored = raw.subarray(start, body);
    let data: Buffer;
    if (central.method === 0) {
      if (central.csize !== central.size) throw bad(name, "stored, but its compressed and uncompressed sizes differ");
      data = stored;
    } else if (central.method === 8) {
      data = inflateRawSync(stored);
    } else {
      throw bad(name, `compression method ${String(central.method)}`);
    }
    if (data.length !== central.size) throw bad(name, `${String(data.length)} bytes, but the header says ${String(central.size)}`);
    const sum = crc32(data);
    if (sum !== central.crc) throw bad(name, `CRC-32 ${hex(sum)}, but the header says ${hex(central.crc)}`);
    items.push({ name, madeBy, needed: central.needed, flags: central.flags, method: central.method, time: central.time, date: central.date, crc: central.crc, size: central.size, offset, data });
    at += 46 + nameLen + extra + comment;
  }
  if (at !== end) throw bad("zip", "the central headers do not run contiguously up to the end record");
  if (body !== cdOffset) throw bad("zip", "the bodies do not run contiguously up to the central directory");
  const first = items[0]?.name ?? "";
  if (first !== "[Content_Types].xml") throw bad(first, "the first entry, where [Content_Types].xml must be");
  return items;
}

/** A PNG's pixel size from its IHDR. Throws unless the signature and IHDR are where they belong. */
export function pngSize(b: Buffer): { w: number; h: number } {
  const signed = b.length >= 24 && b.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
  if (!signed || b.readUInt32BE(8) !== 13 || b.subarray(12, 16).toString("latin1") !== "IHDR") throw new Error("png: no signature and IHDR");
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

export interface Rel { id: string; type: string; target: string; external: boolean }

/** What the browser's own XML parser found in one `.xml` or `.rels` part. */
export interface PartRead {
  /** no `parsererror` anywhere in the document */
  parsed: boolean;
  /** starts with the exact declaration and a line feed */
  declared: boolean;
  root: string;
  /** the root's child elements, by local name */
  children: string[];
  defaults: { ext: string; type: string }[];
  overrides: { part: string; type: string }[];
  rels: Rel[];
  /** every attribute in the `r` namespace */
  refs: { attr: string; value: string }[];
  /** every `p:cNvPr` id, in document order */
  ids: number[];
  /** each `txBody`'s child elements, by local name */
  txBodies: string[][];
  /** each `a:xfrm`: whether it has both `a:off` and `a:ext` */
  xfrms: boolean[];
  slide: {
    spTree: string[];
    ids: number[];
    title: string | null;
    titleXfrm: number[] | null;
    descr: string | null;
    embed: string | null;
    picXfrm: number[] | null;
  } | null;
  /** a notes slide's `idx="3"` body, its paragraphs joined with `\n` */
  notes: string | null;
  pres: { sldSz: { cx: number; cy: number; type: string | null } | null; sldIds: { id: number; rid: string }[]; masterIds: number[]; notesSz: boolean } | null;
  layoutIds: number[];
  core: { title: string; created: string; modified: string } | null;
  app: { slides: number; notes: number } | null;
}

export interface SlideRead {
  part: string;
  spTree: string[];
  ids: number[];
  title: string | null;
  titleXfrm: number[] | null;
  descr: string | null;
  embed: string | null;
  picXfrm: number[] | null;
  /** the part the picture's `r:embed` resolves to */
  media: string | null;
  notes: string | null;
}

export interface DeckRead {
  slides: SlideRead[];
  coreTitle: string;
  created: string;
  modified: string;
  appSlides: number;
  appNotes: number;
  sldSz: { cx: number; cy: number; type: string | null };
  sldIds: number[];
  notesSz: boolean;
  notesMasterBeforeSldIds: boolean;
  masterIds: number[];
  layoutIds: number[];
  parts: Record<string, PartRead>;
}

/** The rels part that holds a part's relationships; "" is the package itself. */
export function relsPart(part: string): string {
  if (part === "") return "_rels/.rels";
  const dir = posix.dirname(part);
  return `${dir === "." ? "" : `${dir}/`}_rels/${posix.basename(part)}.rels`;
}

/** The part a rels part speaks for, or null when it is not a rels part. */
function sourceOf(rels: string): string | null {
  const m = /^((?:[^/]+\/)*)_rels\/([^/]*)\.rels$/.exec(rels);
  return m ? `${m[1] ?? ""}${m[2] ?? ""}` : null;
}

/** A relationship target as a part name, relative to the source part's folder, posix-normalised. */
export function resolve(source: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  return posix.normalize(posix.join(posix.dirname(source), target));
}

/** Runs in the page: every part through `DOMParser`, facts out as plain data. Self-contained. */
function readParts({ texts, decl }: { texts: [string, string][]; decl: string }): Record<string, PartRead> {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  const EP = "http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";
  const DC = "http://purl.org/dc/elements/1.1/";
  const TERMS = "http://purl.org/dc/terms/";
  const kids = (el: Element | null, ns: string, name: string): Element[] =>
    el ? Array.from(el.children).filter((c) => c.namespaceURI === ns && c.localName === name) : [];
  const kid = (el: Element | null, ns: string, name: string): Element | null => kids(el, ns, name)[0] ?? null;
  const all = (el: Element | Document | null, ns: string, name: string): Element[] => (el ? Array.from(el.getElementsByTagNameNS(ns, name)) : []);
  const num = (el: Element | null, attr: string): number => Number(el?.getAttribute(attr) ?? Number.NaN);
  const box = (xfrm: Element | null): number[] | null => {
    const off = kid(xfrm, A, "off"), ext = kid(xfrm, A, "ext");
    return off && ext ? [num(off, "x"), num(off, "y"), num(ext, "cx"), num(ext, "cy")] : null;
  };
  const paras = (txBody: Element | null): string | null =>
    txBody ? kids(txBody, A, "p").map((p) => all(p, A, "t").map((t) => t.textContent ?? "").join("")).join("\n") : null;
  const text = (el: Element | null): string => el?.textContent ?? "";

  const out: Record<string, PartRead> = {};
  for (const [name, source] of texts) {
    const doc = new DOMParser().parseFromString(source, "application/xml");
    const root = doc.documentElement;
    const refs: PartRead["refs"] = [];
    for (const el of Array.from(doc.getElementsByTagName("*"))) {
      for (const a of Array.from(el.attributes)) if (a.namespaceURI === R) refs.push({ attr: a.localName, value: a.value });
    }
    const read: PartRead = {
      parsed: doc.getElementsByTagNameNS("*", "parsererror").length === 0,
      declared: source.startsWith(decl),
      root: root.localName,
      children: Array.from(root.children).map((c) => c.localName),
      defaults: kids(root, CT, "Default").map((d) => ({ ext: d.getAttribute("Extension") ?? "", type: d.getAttribute("ContentType") ?? "" })),
      overrides: kids(root, CT, "Override").map((o) => ({ part: o.getAttribute("PartName") ?? "", type: o.getAttribute("ContentType") ?? "" })),
      rels: kids(root, REL, "Relationship").map((r) => ({
        id: r.getAttribute("Id") ?? "", type: r.getAttribute("Type") ?? "", target: r.getAttribute("Target") ?? "", external: r.getAttribute("TargetMode") === "External",
      })),
      refs,
      ids: all(doc, P, "cNvPr").map((c) => num(c, "id")),
      txBodies: [...all(doc, P, "txBody"), ...all(doc, A, "txBody")].map((t) => Array.from(t.children).map((c) => c.localName)),
      xfrms: all(doc, A, "xfrm").map((x) => kid(x, A, "off") !== null && kid(x, A, "ext") !== null),
      slide: null,
      notes: null,
      pres: null,
      layoutIds: all(doc, P, "sldLayoutId").map((l) => num(l, "id")),
      core: null,
      app: null,
    };
    if (root.namespaceURI === P && root.localName === "sld") {
      const tree = all(doc, P, "spTree")[0] ?? null;
      const shapes = tree ? Array.from(tree.children).filter((c) => c.localName !== "nvGrpSpPr" && c.localName !== "grpSpPr") : [];
      const title = shapes.find((s) => s.localName === "sp" && all(s, P, "ph").some((ph) => ph.getAttribute("type") === "title")) ?? null;
      const pic = shapes.find((s) => s.localName === "pic") ?? null;
      read.slide = {
        spTree: shapes.map((s) => s.localName),
        ids: all(tree, P, "cNvPr").map((c) => num(c, "id")),
        title: paras(kid(title, P, "txBody")),
        titleXfrm: box(kid(kid(title, P, "spPr"), A, "xfrm")),
        descr: all(pic, P, "cNvPr")[0]?.getAttribute("descr") ?? null,
        embed: all(pic, A, "blip")[0]?.getAttributeNS(R, "embed") ?? null,
        picXfrm: box(kid(kid(pic, P, "spPr"), A, "xfrm")),
      };
    }
    if (root.namespaceURI === P && root.localName === "notes") {
      const body = all(doc, P, "sp").find((sp) => all(sp, P, "ph").some((ph) => ph.getAttribute("idx") === "3")) ?? null;
      read.notes = paras(kid(body, P, "txBody"));
    }
    if (root.namespaceURI === P && root.localName === "presentation") {
      const sz = kid(root, P, "sldSz");
      read.pres = {
        sldSz: sz ? { cx: num(sz, "cx"), cy: num(sz, "cy"), type: sz.getAttribute("type") } : null,
        sldIds: all(root, P, "sldId").map((s) => ({ id: num(s, "id"), rid: s.getAttributeNS(R, "id") ?? "" })),
        masterIds: all(root, P, "sldMasterId").map((m) => num(m, "id")),
        notesSz: kid(root, P, "notesSz") !== null,
      };
    }
    if (root.localName === "coreProperties") {
      read.core = { title: text(all(doc, DC, "title")[0] ?? null), created: text(all(doc, TERMS, "created")[0] ?? null), modified: text(all(doc, TERMS, "modified")[0] ?? null) };
    }
    if (root.namespaceURI === EP && root.localName === "Properties") {
      read.app = { slides: Number(text(kid(root, EP, "Slides")) || Number.NaN), notes: Number(text(kid(root, EP, "Notes")) || Number.NaN) };
    }
    out[name] = read;
  }
  return out;
}

/**
 * Parses every `.xml` and `.rels` part with the page's own `DOMParser` in one round
 * trip, then follows the presentation's slide list through the relationships to each
 * slide's title, picture and notes. It never throws on a broken package: what it cannot
 * find reads as null or empty, and `packageProblems` says why.
 */
export async function readDeck(page: Page, items: readonly ZipItem[]): Promise<DeckRead> {
  const texts = items.filter((i) => /\.(xml|rels)$/.test(i.name)).map((i): [string, string] => [i.name, i.data.toString("utf8")]);
  const parts = await page.evaluate(readParts, { texts, decl: DECL });
  const relsOf = (part: string): Rel[] => parts[relsPart(part)]?.rels ?? [];
  const target = (part: string, id: string | null): string | null => {
    const r = relsOf(part).find((x) => x.id === id);
    return r ? resolve(part, r.target) : null;
  };
  const presPart = parts["ppt/presentation.xml"];
  const pres = presPart?.pres ?? null;
  const slides = (pres?.sldIds ?? []).map(({ rid }): SlideRead => {
    const part = target("ppt/presentation.xml", rid) ?? `(${rid})`;
    const s = parts[part]?.slide ?? null;
    const notes = relsOf(part).find((r) => r.type === `${RT}/notesSlide`);
    return {
      part,
      spTree: s?.spTree ?? [],
      ids: s?.ids ?? [],
      title: s?.title ?? null,
      titleXfrm: s?.titleXfrm ?? null,
      descr: s?.descr ?? null,
      embed: s?.embed ?? null,
      picXfrm: s?.picXfrm ?? null,
      media: target(part, s?.embed ?? null),
      notes: notes ? (parts[resolve(part, notes.target)]?.notes ?? null) : null,
    };
  });
  const order = presPart?.children ?? [];
  const core = parts["docProps/core.xml"]?.core ?? null;
  const app = parts["docProps/app.xml"]?.app ?? null;
  return {
    slides,
    coreTitle: core?.title ?? "",
    created: core?.created ?? "",
    modified: core?.modified ?? "",
    appSlides: app?.slides ?? Number.NaN,
    appNotes: app?.notes ?? Number.NaN,
    sldSz: pres?.sldSz ?? { cx: Number.NaN, cy: Number.NaN, type: null },
    sldIds: pres?.sldIds.map((s) => s.id) ?? [],
    notesSz: pres?.notesSz ?? false,
    notesMasterBeforeSldIds: order.includes("notesMasterIdLst") && order.indexOf("notesMasterIdLst") < order.indexOf("sldIdLst"),
    masterIds: pres?.masterIds ?? [],
    layoutIds: Object.entries(parts).filter(([name]) => /^ppt\/slideMasters\/[^/]+\.xml$/.test(name)).flatMap(([, p]) => p.layoutIds),
    parts,
  };
}

/** The content type a part must have to be the target of each relationship type the deck uses. */
const TARGET_TYPE: Record<string, string> = {
  [`${RT}/officeDocument`]: `${PML}.presentation.main+xml`,
  "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties": "application/vnd.openxmlformats-package.core-properties+xml",
  [`${RT}/extended-properties`]: "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  [`${RT}/slideMaster`]: `${PML}.slideMaster+xml`,
  [`${RT}/slideLayout`]: `${PML}.slideLayout+xml`,
  [`${RT}/slide`]: `${PML}.slide+xml`,
  [`${RT}/notesMaster`]: `${PML}.notesMaster+xml`,
  [`${RT}/notesSlide`]: `${PML}.notesSlide+xml`,
  [`${RT}/theme`]: "application/vnd.openxmlformats-officedocument.theme+xml",
  [`${RT}/presProps`]: `${PML}.presProps+xml`,
  [`${RT}/viewProps`]: `${PML}.viewProps+xml`,
  [`${RT}/tableStyles`]: `${PML}.tableStyles+xml`,
  [`${RT}/image`]: "image/png",
};
const DEFAULTS: Record<string, string> = { png: "image/png", rels: "application/vnd.openxmlformats-package.relationships+xml", xml: "application/xml" };
/** `p:presentation`'s children in schema order (ECMA-376 CT_Presentation). */
const PRESENTATION = [
  "sldMasterIdLst", "notesMasterIdLst", "handoutMasterIdLst", "sldIdLst", "sldSz", "notesSz", "smartTags", "embeddedFontLst",
  "custShowLst", "photoAlbum", "custDataLst", "kinsoku", "defaultTextStyle", "modifyVerifier", "extLst",
];

/** Every broken package rule, one readable line each; empty for a sound deck. */
export function packageProblems(deck: DeckRead, items: readonly ZipItem[]): string[] {
  const out: string[] = [];
  const names = new Set(items.map((i) => i.name));
  const { parts } = deck;
  const relsOf = (part: string): Rel[] => parts[relsPart(part)]?.rels ?? [];
  const linked = (part: string, type: string): string[] => relsOf(part).filter((r) => r.type === `${RT}/${type}`).map((r) => resolve(part, r.target));

  for (const { name } of items) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const p = parts[name];
    if (!p) { out.push(`${name} was not read`); continue; }
    if (!p.parsed) out.push(`${name} does not parse`);
    if (!p.declared) out.push(`${name} does not start with the XML declaration`);
  }

  const ct = parts["[Content_Types].xml"];
  const defaults = new Map((ct?.defaults ?? []).map((d) => [d.ext.toLowerCase(), d.type]));
  const overrides = new Map((ct?.overrides ?? []).map((o) => [o.part.replace(/^\//, ""), o.type]));
  // OPC extensions: `_rels/.rels` is a rels part, which path.extname would call extensionless
  const extOf = (name: string): string => { const base = posix.basename(name), dot = base.lastIndexOf("."); return dot < 0 ? "" : base.slice(dot + 1).toLowerCase(); };
  const typeOf = (name: string): string | null => overrides.get(name) ?? defaults.get(extOf(name)) ?? null;
  for (const name of names) if (name !== "[Content_Types].xml" && !typeOf(name)) out.push(`${name} has no content type`);
  for (const part of overrides.keys()) if (!names.has(part)) out.push(`an Override names /${part}, which is not in the package`);
  const exts = (ct?.defaults ?? []).map((d) => d.ext).sort().join(", ");
  if (exts !== "png, rels, xml") out.push(`the Defaults are ${exts || "none"}, not png, rels and xml`);
  for (const [ext, type] of defaults) if (DEFAULTS[ext] !== undefined && DEFAULTS[ext] !== type) out.push(`the ${ext} Default is ${type}`);

  for (const { name } of items) {
    const source = sourceOf(name);
    const p = parts[name];
    if (source === null || !p) continue;
    if (source !== "" && !names.has(source)) out.push(`${name} speaks for ${source}, which is not in the package`);
    const ids = new Set<string>();
    for (const r of p.rels) {
      if (!/^rId\d+$/.test(r.id)) out.push(`${name}: relationship Id "${r.id}" is not rId<n>`);
      if (ids.has(r.id)) out.push(`${name}: ${r.id} is used twice`);
      ids.add(r.id);
      if (r.external) { out.push(`${name}: ${r.id} is external`); continue; }
      const to = resolve(source, r.target);
      if (!names.has(to)) { out.push(`${name}: ${r.id} points at ${to}, which is not in the package`); continue; }
      const want = TARGET_TYPE[r.type];
      if (want === undefined) out.push(`${name}: ${r.id} has a relationship type the deck never uses: ${r.type}`);
      else if (typeOf(to) !== want) out.push(`${to} is ${typeOf(to) ?? "untyped"}, but a ${r.type.slice(r.type.lastIndexOf("/") + 1)} relationship needs ${want}`);
    }
  }

  const reached = new Set<string>();
  const queue = [""];
  for (let from = queue.shift(); from !== undefined; from = queue.shift()) {
    for (const r of relsOf(from)) {
      const to = resolve(from, r.target);
      if (r.external || reached.has(to) || !names.has(to)) continue;
      reached.add(to);
      queue.push(to);
    }
  }
  for (const name of names) {
    if (name !== "[Content_Types].xml" && sourceOf(name) === null && !reached.has(name)) out.push(`${name} is not reachable from _rels/.rels`);
  }

  for (const { name } of items) {
    const p = parts[name];
    if (!p || sourceOf(name) !== null) continue;
    const ids = new Set(relsOf(name).map((r) => r.id));
    for (const ref of p.refs) if (!ids.has(ref.value)) out.push(`${name}: r:${ref.attr}="${ref.value}" has no relationship`);
  }

  const { sldIds } = deck;
  if (sldIds.some((id) => !Number.isInteger(id) || id < 256 || id > 2147483647) || new Set(sldIds).size !== sldIds.length) {
    out.push(`slide ids ${sldIds.join(", ")} are out of 256..2147483647 or repeated`);
  }
  if (deck.masterIds.join(", ") !== "2147483648") out.push(`the master id is ${deck.masterIds.join(", ") || "missing"}, not 2147483648`);
  if (deck.layoutIds.join(", ") !== "2147483649") out.push(`the layout id is ${deck.layoutIds.join(", ") || "missing"}, not 2147483649`);
  const order = parts["ppt/presentation.xml"]?.children ?? [];
  const rank = order.map((k) => PRESENTATION.indexOf(k));
  if (rank.some((r, i) => r < 0 || r <= (rank[i - 1] ?? -1))) out.push(`presentation.xml children are ${order.join(", ")}, not in schema order`);
  if (!order.includes("notesSz")) out.push("presentation.xml has no notesSz");

  for (const name of names) {
    if (/^ppt\/slides\/slide\d+\.xml$/.test(name)) {
      const notes = linked(name, "notesSlide");
      if (linked(name, "slideLayout").length !== 1 || linked(name, "image").length !== 1 || notes.length !== 1) {
        out.push(`${name} does not have exactly one layout, one image and one notes relationship`);
      }
      for (const n of notes) if (linked(n, "slide").join() !== name) out.push(`${n} does not link back to ${name}`);
    }
    if (/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)) {
      if (linked(name, "notesMaster").length !== 1) out.push(`${name} does not have exactly one notes master relationship`);
      const back = linked(name, "slide");
      if (back.length !== 1 || !linked(back[0] ?? "", "notesSlide").includes(name)) out.push(`${name} and its slide do not link to each other`);
    }
  }
  const masterTheme = linked("ppt/slideMasters/slideMaster1.xml", "theme").join(", ");
  if (masterTheme !== "ppt/theme/theme1.xml") out.push(`the slide master's theme is ${masterTheme || "missing"}, not ppt/theme/theme1.xml`);
  const notesTheme = linked("ppt/notesMasters/notesMaster1.xml", "theme").join(", ");
  if (notesTheme !== "ppt/theme/theme2.xml") out.push(`the notes master's theme is ${notesTheme || "missing"}, not ppt/theme/theme2.xml`);

  for (const { name } of items) {
    const p = parts[name];
    if (!p) continue;
    if (new Set(p.ids).size !== p.ids.length) out.push(`${name} repeats a shape id: ${p.ids.join(", ")}`);
    for (const t of p.txBodies) if (t[0] !== "bodyPr" || !t.includes("p")) out.push(`${name} has a txBody of ${t.join(", ") || "nothing"}`);
    if (p.xfrms.includes(false)) out.push(`${name} has an a:xfrm without a:off and a:ext`);
  }
  return out;
}

/**
 * Keeps the deck as a verifiable, repeatable artifact in the output folder:
 * `slides-<project>.pptx` (the exact download), `slides-<project>.json` (sizes, CRCs and
 * sha256 of the file and every entry, and each slide's title, alt text, notes and face)
 * and `slides-<project>-<i>.png` (every face, straight from `ppt/media`). The XML hashes
 * never depend on font metrics; the PNG hashes hold per Chromium build, which is recorded.
 */
export async function keepDeck(testInfo: TestInfo, browserVersion: string, raw: Buffer, items: readonly ZipItem[], deck: DeckRead): Promise<void> {
  const project = testInfo.project.name;
  const dir = testInfo.project.outputDir;
  const base = `slides-${project}`;
  const sha256 = (b: Buffer): string => createHash("sha256").update(b).digest("hex");
  const media = new Map(items.map((i) => [i.name, i.data]));
  await mkdir(dir, { recursive: true });
  const slides: { title: string | null; alt: string | null; notes: string | null; media: string | null; width: number | null; height: number | null; sha256: string | null }[] = [];
  for (const [n, s] of deck.slides.entries()) {
    const png = media.get(s.media ?? "");
    const size = png ? pngSize(png) : null;
    if (png) await writeFile(join(dir, `${base}-${String(n + 1)}.png`), png);
    slides.push({ title: s.title, alt: s.descr, notes: s.notes, media: s.media, width: size?.w ?? null, height: size?.h ?? null, sha256: png ? sha256(png) : null });
  }
  const manifest = {
    file: `${base}.pptx`,
    bytes: raw.length,
    sha256: sha256(raw),
    clock: PINNED.clock,
    timezone: PINNED.timezone,
    project,
    browser: browserVersion,
    entries: items.map((i) => ({ name: i.name, size: i.size, crc32: hex(i.crc), sha256: sha256(i.data) })),
    slides,
  };
  const pptx = join(dir, `${base}.pptx`), json = join(dir, `${base}.json`);
  await writeFile(pptx, raw);
  await writeFile(json, JSON.stringify(manifest, null, 2) + "\n");
  await testInfo.attach(`${base}.pptx`, { path: pptx, contentType: PPTX_TYPE });
  await testInfo.attach(`${base}.json`, { path: json, contentType: "application/json" });
}
