/**
 * The smallest ZIP Office opens: every entry stored (method 0), sizes and CRC in the local
 * header, no extras, no comment, no zip64. PNGs are deflated already and the XML is small
 * beside them, so there is no DEFLATE path to get wrong on a browser without it.
 *
 * The file comes back as a Blob of chunks (headers, then each part's own bytes or Blob), so
 * the deck is never copied whole into one buffer on a phone. The rules, each a way the
 * archive could be refused or repaired:
 *
 * - Z1 a data descriptor, encryption or the UTF-8 name flag: flags are always 0.
 * - Z2 any method but 0: every entry is stored.
 * - Z3 a CRC over the wrong bytes, or a size that is not the body's: CRC and size are taken
 *   from the exact bytes in `textEntry` and `sealBytes`, and `Part size mismatch.` is thrown.
 * - Z4 a local header that differs from its central one: both are written from one record.
 * - Z5 directory entries, extra fields, a trailing comment or zip64: none are ever written,
 *   and `Too many parts.` / `Too big for a zip.` are thrown instead.
 * - Z6 a non-ASCII, leading-slash or case-duplicate name: `Bad part name.` / `Duplicate part.`.
 * - Z7 a DOS month or day of 0, or a clock before 1980: the stamp is UTC and clamped.
 * - Z8 `[Content_Types].xml` not first: entries are written in the order given; the caller
 *   (pptx.ts) puts it first.
 *
 * Errors carry fixed wording, never a part name or anything a coach typed.
 */

export interface ZipEntry {
  /** part name without the leading "/", e.g. "ppt/slides/slide1.xml" */
  name: string;
  body: Uint8Array | Blob;
  size: number;
  crc: number;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC-32 (reflected 0xEDB88320, init and final XOR 0xFFFFFFFF). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

/** A text part as UTF-8, with its CRC and size taken from the encoded bytes. */
export function textEntry(name: string, text: string): ZipEntry {
  const body = enc.encode(text);
  return { name, body, size: body.byteLength, crc: crc32(body) };
}

/** CRC the bytes once, then wrap them as a Blob so the caller can drop the array. */
export function sealBytes(bytes: Uint8Array): { body: Blob; size: number; crc: number } {
  return { body: new Blob([bytes as BlobPart]), size: bytes.byteLength, crc: crc32(bytes) };
}

/** MS-DOS time and date from the UTC fields, clamped to what the format can hold (1980 to 2107). */
export function dosStamp(when: Date): { time: number; date: number } {
  const y = when.getUTCFullYear();
  if (y < 1980) return { time: 0, date: (1 << 5) | 1 };
  if (y > 2107) return { time: (23 << 11) | (59 << 5) | (58 >> 1), date: (127 << 9) | (12 << 5) | 31 };
  return {
    time: (when.getUTCHours() << 11) | (when.getUTCMinutes() << 5) | (when.getUTCSeconds() >> 1),
    date: ((y - 1980) << 9) | ((when.getUTCMonth() + 1) << 5) | when.getUTCDate(),
  };
}

const NAME = /^[A-Za-z0-9._\-\[\]]+(\/[A-Za-z0-9._\-\[\]]+)*$/;
/** zip64 starts here: no offset, size or directory end may reach it. */
const LIMIT = 0xffffffff;

/** `[local header + body]*`, then `[central header]*`, then the end record, and nothing after it. */
export function zipBlob(entries: readonly ZipEntry[], when: Date, type: string): Blob {
  if (entries.length > 0xffff) throw new Error("Too many parts.");
  const { time, date } = dosStamp(when);
  const chunks: BlobPart[] = [];
  const central: BlobPart[] = [];
  const seen = new Set<string>();
  let offset = 0, cdSize = 0;

  for (const e of entries) {
    if (!NAME.test(e.name)) throw new Error("Bad part name.");
    const key = e.name.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate part.");
    seen.add(key);
    const actual = e.body instanceof Blob ? e.body.size : e.body.byteLength;
    if (actual !== e.size) throw new Error("Part size mismatch.");
    if (e.size >= LIMIT || offset >= LIMIT) throw new Error("Too big for a zip.");
    const name = enc.encode(e.name);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed: 2.0
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, e.crc, true);
    lv.setUint32(18, e.size, true);
    lv.setUint32(22, e.size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by: 2.0 on MS-DOS
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, e.crc, true);
    cv.setUint32(20, e.size, true);
    cv.setUint32(24, e.size, true);
    cv.setUint16(28, name.length, true);
    // 30 extra, 32 comment, 34 disk, 36 internal (u16), 38 external (u32): all 0
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    chunks.push(local, e.body as BlobPart);
    central.push(cd);
    cdSize += cd.length;
    offset += local.length + e.size;
  }

  if (offset + cdSize >= LIMIT) throw new Error("Too big for a zip.");
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  // 4 this disk, 6 directory disk: 0
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  // 20 comment length: 0
  return new Blob([...chunks, ...central, eocd], { type });
}
