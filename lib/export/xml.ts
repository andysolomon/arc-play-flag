/**
 * Text on its way into XML: a slide's title, alt text and speaker notes, and the SVG a
 * face is drawn from. Everything that can go wrong here comes from what a coach typed or
 * an imported file carried:
 *
 * - T1 `& < > " '` in a book, team or play name, notes or a label make a part unparseable:
 *   `escText` escapes element text, `escAttr` attribute values.
 * - T2 C0 controls and U+FFFE/U+FFFF are illegal in XML 1.0, so the part will not parse and
 *   the SVG image will not load: `clean` strips them.
 * - T3 a lone surrogate, stored or left by slicing a string by code unit, throws a URIError in
 *   `encodeURIComponent` and is silently written as U+FFFD by `TextEncoder`: `clean` strips it.
 * - T4 a raw newline in an attribute is read back as a space: `escAttr` writes `&#10;`.
 */

/** Characters XML 1.0 forbids: C0 controls but tab/LF/CR, U+FFFE/U+FFFF and lone surrogates (the u flag makes a lone surrogate one code point). */
export const XML_BAD = /[^\t\n\r\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

export const clean = (s: string): string => s.replace(XML_BAD, "");

/** Cleaned, with every run of whitespace (newlines included) one space: titles and names. */
export const oneLine = (s: string): string => clean(s).replace(/\s+/g, " ").trim();

/** Element text: clean, then & < >. */
export function escText(s: string): string {
  return clean(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const ATTR: Record<string, string> = { '"': "&quot;", "'": "&apos;", "\t": "&#9;", "\n": "&#10;", "\r": "&#13;" };

/** Attribute value: clean, then & < > " ' and \t \n \r as &#9; &#10; &#13;. */
export function escAttr(s: string): string {
  return escText(s).replace(/["'\t\n\r]/g, (c) => ATTR[c] ?? c);
}
