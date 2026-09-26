/**
 * A PresentationML package written from string templates, with no DOM: one master, one
 * "Title Only" layout, one notes master, and per slide a hidden title under one full-bleed
 * picture plus a notes slide. The fixed parts are byte-for-byte the ones validated against
 * the ECMA-376 schemas, PowerPoint's id rules, python-pptx and LibreOffice
 * (docs/adr/002-playbook-slides.md).
 *
 * Each of these makes PowerPoint offer a repair or refuse the file:
 *
 * - P1 a sldId outside 256..2147483647, or repeated: slide i is 255 + i.
 * - P2 a master or layout id below 2^31, or the two the same: fixed 2147483648 and 2147483649.
 * - P3 `presentation.xml` children out of order, no `notesSz`, no `notesMasterIdLst` (Keynote
 *   drops the notes), or a `sldSz` with a `type` (Keynote refuses): a fixed template.
 * - P4 a theme list with fewer than 3 styles, no `ea`/`cs`, or a notes master sharing theme1:
 *   the validated theme, written again as theme2 for the notes master.
 * - P5 an empty `txBody`, an `xfrm` without `off`/`ext`, or a decimal EMU or `sz`: templates,
 *   `emu()` and `sz()` round (and `sz()` clamps), and `Bad box.` is thrown.
 * - P6 repeated `cNvPr` ids: fixed 1, 2, 3 on slides and notes, 1 to 5 on the master.
 * - P7 a missing or untyped part, an Override naming a missing part, an unused Default, an
 *   orphan part, a dangling `r:id`/`r:embed`, a one-way notes link: every part, relationship
 *   and Override comes from the same slide list here. The Defaults are rels, xml and png, and
 *   every slide has a png.
 * - P8 an unreferenced notes master: `A slide has no notes.` unless every slide has notes.
 * - P9 a slide with no title, lost in the outline and to screen readers: `A slide has no
 *   title.`, and the title is first in the shape tree.
 * - P10 a stretched or corrupt picture: `slidePicture` checks the PNG signature and a
 *   1920 × 1080 IHDR, and the picture box is exactly 16:9.
 * - P11 Keynote's missing-font banner or PowerPoint's silent substitution: the theme names
 *   Arial, and no slide run carries an `<a:latin>`.
 * - P12 drifting from the validated shape: the templates are those parts; change one only with
 *   a fresh validation.
 */

import { clean, escAttr, escText, oneLine } from "./xml";
import { sealBytes, textEntry, zipBlob, type ZipEntry } from "./zip";

export const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** points */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A slide face, CRC'd and sealed as a Blob so its bytes are held once. */
export interface DeckPicture {
  body: Blob;
  size: number;
  crc: number;
}

export interface DeckSlide {
  /** the hidden title under the picture: the outline, the slide list, screen readers */
  title: string;
  titleBox: Box;
  /** points */
  titleSize: number;
  alt: string;
  /** one paragraph per line; never empty */
  notes: string;
  picture: DeckPicture;
}

export interface Deck {
  title: string;
  /** the master's team strip, as #rrggbb */
  band: string;
  slides: readonly DeckSlide[];
}

/** Every face is 1080p, so the 16:9 picture box never stretches it. */
const PICTURE_W = 1920, PICTURE_H = 1080;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR = [0x49, 0x48, 0x44, 0x52];

/** Checks the PNG signature and IHDR = 1920 × 1080, then seals it. */
export function slidePicture(png: Uint8Array): DeckPicture {
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ok =
    png.byteLength >= 24 &&
    PNG_SIGNATURE.every((b, i) => png[i] === b) &&
    IHDR.every((b, i) => png[12 + i] === b) &&
    v.getUint32(16) === PICTURE_W &&
    v.getUint32(20) === PICTURE_H;
  if (!ok) throw new Error("The slide picture is not a 1920 × 1080 PNG.");
  return sealBytes(png);
}

const emu = (pt: number): number => Math.round(pt * 12700);
const sz = (pt: number): number => Math.max(100, Math.min(400000, Math.round(pt * 100)));
const iso = (when: Date): string => when.toISOString().replace(/\.\d{3}Z$/, "Z");

function hex6(c: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(c)) throw new Error("Bad colour.");
  return c.slice(1).toUpperCase();
}

const DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PML = "application/vnd.openxmlformats-officedocument.presentationml";

/** A relationships part: rId1, rId2, … in the order given. */
function rels(...to: readonly (readonly [type: string, target: string])[]): string {
  return (
    DECL + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    to.map(([type, target], i) => `<Relationship Id="rId${String(i + 1)}" Type="${type}" Target="${target}"/>`).join("") +
    "</Relationships>"
  );
}

function contentTypes(n: number): string {
  let slides = "", notes = "";
  for (let i = 1; i <= n; i++) {
    slides += `<Override PartName="/ppt/slides/slide${String(i)}.xml" ContentType="${PML}.slide+xml"/>`;
    notes += `<Override PartName="/ppt/notesSlides/notesSlide${String(i)}.xml" ContentType="${PML}.notesSlide+xml"/>`;
  }
  return (
    DECL +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>' +
    `<Override PartName="/ppt/presentation.xml" ContentType="${PML}.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${PML}.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${PML}.slideLayout+xml"/>` +
    `<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="${PML}.notesMaster+xml"/>` +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    '<Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' +
    `<Override PartName="/ppt/presProps.xml" ContentType="${PML}.presProps+xml"/>` +
    `<Override PartName="/ppt/viewProps.xml" ContentType="${PML}.viewProps+xml"/>` +
    `<Override PartName="/ppt/tableStyles.xml" ContentType="${PML}.tableStyles+xml"/>` +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
    `${slides}${notes}</Types>`
  );
}

const ROOT_RELS = rels(
  [`${RT}/officeDocument`, "ppt/presentation.xml"],
  ["http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"],
  [`${RT}/extended-properties`, "docProps/app.xml"],
);

function core(title: string, when: Date): string {
  return (
    DECL +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escText(title)}</dc:title><dc:creator>Flag Football Play Designer</dc:creator>` +
    "<cp:lastModifiedBy>Flag Football Play Designer</cp:lastModifiedBy><cp:revision>1</cp:revision>" +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso(when)}</dcterms:created>` +
    `<dcterms:modified xsi:type="dcterms:W3CDTF">${iso(when)}</dcterms:modified></cp:coreProperties>`
  );
}

function app(n: number): string {
  return (
    DECL +
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    "<Application>Flag Football Play Designer</Application><PresentationFormat>Widescreen</PresentationFormat>" +
    `<Slides>${String(n)}</Slides><Notes>${String(n)}</Notes><HiddenSlides>0</HiddenSlides></Properties>`
  );
}

function presentation(n: number): string {
  let ids = "";
  for (let i = 1; i <= n; i++) ids += `<p:sldId id="${String(255 + i)}" r:id="rId${String(6 + i)}"/>`;
  return (
    DECL +
    `<p:presentation ${NS} saveSubsetFonts="1" autoCompressPictures="0"><p:sldMasterIdLst>` +
    '<p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/>' +
    `</p:notesMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/>` +
    '<p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>' +
    '<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' +
    '<a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>' +
    '<a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:defaultTextStyle></p:presentation>'
  );
}

function presentationRels(n: number): string {
  const slides: [string, string][] = [];
  for (let i = 1; i <= n; i++) slides.push([`${RT}/slide`, `slides/slide${String(i)}.xml`]);
  return rels(
    [`${RT}/slideMaster`, "slideMasters/slideMaster1.xml"],
    [`${RT}/notesMaster`, "notesMasters/notesMaster1.xml"],
    [`${RT}/presProps`, "presProps.xml"],
    [`${RT}/viewProps`, "viewProps.xml"],
    [`${RT}/theme`, "theme/theme1.xml"],
    [`${RT}/tableStyles`, "tableStyles.xml"],
    ...slides,
  );
}

const PRES_PROPS = DECL + `<p:presentationPr ${NS}/>`;

const VIEW_PROPS =
  DECL +
  `<p:viewPr ${NS}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr>` +
  '<p:gridSpacing cx="76200" cy="76200"/></p:viewPr>';

const TABLE_STYLES =
  DECL + '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>';

/**
 * The design's colours, and Arial for any text a coach adds: "Patrick Hand" is never named.
 * Ink is accent1, which PowerPoint fills an inserted shape, table header or SmartArt with under
 * white text; on the highlighter, last, that text would not read.
 */
const THEME =
  DECL +
  '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Flag Football"><a:themeElements>' +
  '<a:clrScheme name="Flag Football"><a:dk1><a:srgbClr val="1B1A17"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>' +
  '<a:dk2><a:srgbClr val="3A372F"/></a:dk2><a:lt2><a:srgbClr val="F4EFE2"/></a:lt2><a:accent1><a:srgbClr val="1B1A17"/>' +
  '</a:accent1><a:accent2><a:srgbClr val="C2261A"/></a:accent2><a:accent3><a:srgbClr val="4A8FE0"/></a:accent3>' +
  '<a:accent4><a:srgbClr val="E5675E"/></a:accent4><a:accent5><a:srgbClr val="6F6C66"/></a:accent5><a:accent6>' +
  '<a:srgbClr val="F2B705"/></a:accent6><a:hlink><a:srgbClr val="C2513F"/></a:hlink><a:folHlink><a:srgbClr val="8F3529"/>' +
  '</a:folHlink></a:clrScheme><a:fontScheme name="Flag Football"><a:majorFont><a:latin typeface="Arial"/>' +
  '<a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/>' +
  '<a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Flag Football"><a:fillStyleLst><a:solidFill>' +
  '<a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill>' +
  '<a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst>' +
  '<a:ln w="6350" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln><a:ln w="12700" cap="flat" cmpd="sng" algn="ctr"><a:solidFill>' +
  '<a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>' +
  '<a:ln w="19050" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
  '<a:prstDash val="solid"/><a:miter lim="800000"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/>' +
  '</a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>' +
  '</a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill>' +
  '<a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
  '</a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';

/** Paper behind everything and the team strip across the top, so a slide the coach adds matches the deck. */
function master(band: string): string {
  return (
    DECL +
    `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="F4EFE2"/></a:solidFill><a:effectLst/></p:bgPr>` +
    '</p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm>' +
    '<a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp>' +
    '<p:nvSpPr><p:cNvPr id="2" name="Team band 1"><a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}">' +
    '<adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>' +
    '</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="127000"/>' +
    `</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${band}"/></a:solidFill><a:ln>` +
    "<a:noFill/></a:ln></p:spPr><p:txBody>" +
    '<a:bodyPr vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"><a:noAutofit/>' +
    '</a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody></p:sp><p:sp>' +
    '<p:nvSpPr><p:cNvPr id="3" name="Band rule 2"><a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}">' +
    '<adec:decorative xmlns:adec="http://schemas.microsoft.com/office/drawing/2017/decorative" val="1"/></a:ext></a:extLst>' +
    '</p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="127000"/><a:ext cx="12192000" cy="25400"/>' +
    '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="1B1A17"/></a:solidFill><a:ln>' +
    "<a:noFill/></a:ln></p:spPr><p:txBody>" +
    '<a:bodyPr vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"><a:noAutofit/>' +
    '</a:bodyPr><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody></p:sp><p:sp>' +
    '<p:nvSpPr><p:cNvPr id="4" name="Title Placeholder 3"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' +
    '<p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="355600"/>' +
    '<a:ext cx="11277600" cy="711200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody>' +
    '<a:bodyPr vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"><a:normAutofit/>' +
    '</a:bodyPr><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>' +
    '</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="5" name="Text Placeholder 4"/><p:cNvSpPr><a:spLocks noGrp="1"/>' +
    '</p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="457200" y="1270000"/>' +
    '<a:ext cx="11277600" cy="5181600"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody>' +
    '<a:bodyPr vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0"><a:normAutofit/></a:bodyPr>' +
    '<a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p>' +
    "</p:txBody></p:sp></p:spTree></p:cSld>" +
    '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
    'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
    '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle>' +
    '<a:lvl1pPr algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:lnSpc>' +
    '<a:spcPct val="90000"/></a:lnSpc><a:spcBef><a:spcPct val="0"/></a:spcBef><a:buNone/><a:defRPr sz="4000" kern="1200">' +
    '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/>' +
    '<a:cs typeface="+mj-cs"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle>' +
    '<a:lvl1pPr marL="0" indent="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' +
    '<a:lnSpc><a:spcPct val="100000"/></a:lnSpc><a:spcBef><a:spcPts val="600"/></a:spcBef><a:buNone/>' +
    '<a:defRPr sz="2400" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>' +
    '<a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr>' +
    '<a:defRPr lang="en-US"/></a:defPPr>' +
    '<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' +
    '<a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>' +
    '<a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>'
  );
}

const MASTER_RELS = rels([`${RT}/slideLayout`, "../slideLayouts/slideLayout1.xml"], [`${RT}/theme`, "../theme/theme1.xml"]);

const LAYOUT =
  DECL +
  `<p:sldLayout ${NS} type="titleOnly" preserve="1"><p:cSld name="Title Only"><p:spTree><p:nvGrpSpPr>` +
  '<p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
  '<a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr>' +
  '<p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr>' +
  '</p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/>' +
  "<a:t>Click to edit Master title style</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr>" +
  "<a:masterClrMapping/></p:clrMapOvr></p:sldLayout>";

const LAYOUT_RELS = rels([`${RT}/slideMaster`, "../slideMasters/slideMaster1.xml"]);

const NOTES_MASTER =
  DECL +
  `<p:notesMaster ${NS}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>` +
  '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/>' +
  '<a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr>' +
  '<p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/>' +
  '</p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/>' +
  '<a:ext cx="5486400" cy="3086100"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700">' +
  '<a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr><p:txBody>' +
  '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p>' +
  '<a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/>' +
  '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>' +
  '<p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect">' +
  "<a:avLst/></a:prstGeom></p:spPr><p:txBody>" +
  '<a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p>' +
  '<a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>' +
  "</p:spTree></p:cSld>" +
  '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" ' +
  'accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>' +
  '<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' +
  '<a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/>' +
  '<a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>';

const NOTES_MASTER_RELS = rels([`${RT}/theme`, "../theme/theme2.xml"]);

/** The title first, so it sits under the picture and is read first; the picture fills the slide. */
function slide(s: DeckSlide): string {
  const b = s.titleBox;
  return (
    DECL +
    `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>` +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' +
    `<p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="${String(emu(b.x))}" y="${String(emu(b.y))}"/>` +
    `<a:ext cx="${String(emu(b.w))}" cy="${String(emu(b.h))}"/></a:xfrm></p:spPr><p:txBody>` +
    '<a:bodyPr vert="horz" wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" rtlCol="0" anchor="ctr"><a:normAutofit/>' +
    `</a:bodyPr><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr lang="en-US" sz="${String(sz(s.titleSize))}" dirty="0">` +
    `<a:solidFill><a:srgbClr val="1B1A17"/></a:solidFill></a:rPr><a:t>${escText(oneLine(s.title))}</a:t></a:r></a:p>` +
    "</p:txBody></p:sp><p:pic><p:nvPicPr>" +
    `<p:cNvPr id="3" name="Picture 2" descr="${escAttr(s.alt)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>` +
    '<p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' +
    '<a:xfrm><a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' +
    "</p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"
  );
}

const slideRels = (i: number): string =>
  rels(
    [`${RT}/slideLayout`, "../slideLayouts/slideLayout1.xml"],
    [`${RT}/image`, `../media/image${String(i)}.png`],
    [`${RT}/notesSlide`, `../notesSlides/notesSlide${String(i)}.xml`],
  );

/** One paragraph per line: a raw newline inside `<a:t>` is not a line break. */
function notesSlide(notes: string): string {
  const paras = clean(notes)
    .split(/\r\n|\r|\n/)
    .map((line) =>
      line
        ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escText(line)}</a:t></a:r></a:p>`
        : '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>',
    )
    .join("");
  return (
    DECL +
    `<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    '<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm>' +
    '</p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr>' +
    '<a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr>' +
    '</p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr>' +
    '<a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr/>' +
    `<p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr>` +
    "<a:masterClrMapping/></p:clrMapOvr></p:notes>"
  );
}

const notesRels = (i: number): string =>
  rels([`${RT}/notesMaster`, "../notesMasters/notesMaster1.xml"], [`${RT}/slide`, `../slides/slide${String(i)}.xml`]);

/** Every part of the package: `[Content_Types].xml` first, the fixed parts, each slide with its notes, then the pictures (17 + 5n). */
export function pptxParts(deck: Deck, when: Date): ZipEntry[] {
  const n = deck.slides.length;
  if (!n) throw new Error("No slides.");
  for (const s of deck.slides) {
    if (!oneLine(s.title)) throw new Error("A slide has no title.");
    if (!clean(s.notes).trim()) throw new Error("A slide has no notes.");
    const b = s.titleBox;
    if (![b.x, b.y, b.w, b.h, s.titleSize].every(Number.isFinite) || b.w < 0 || b.h < 0) throw new Error("Bad box.");
  }
  const band = hex6(deck.band);
  const parts: ZipEntry[] = [
    textEntry("[Content_Types].xml", contentTypes(n)),
    textEntry("_rels/.rels", ROOT_RELS),
    textEntry("docProps/core.xml", core(deck.title, when)),
    textEntry("docProps/app.xml", app(n)),
    textEntry("ppt/presentation.xml", presentation(n)),
    textEntry("ppt/_rels/presentation.xml.rels", presentationRels(n)),
    textEntry("ppt/presProps.xml", PRES_PROPS),
    textEntry("ppt/viewProps.xml", VIEW_PROPS),
    textEntry("ppt/tableStyles.xml", TABLE_STYLES),
    textEntry("ppt/theme/theme1.xml", THEME),
    textEntry("ppt/theme/theme2.xml", THEME),
    textEntry("ppt/slideMasters/slideMaster1.xml", master(band)),
    textEntry("ppt/slideMasters/_rels/slideMaster1.xml.rels", MASTER_RELS),
    textEntry("ppt/slideLayouts/slideLayout1.xml", LAYOUT),
    textEntry("ppt/slideLayouts/_rels/slideLayout1.xml.rels", LAYOUT_RELS),
    textEntry("ppt/notesMasters/notesMaster1.xml", NOTES_MASTER),
    textEntry("ppt/notesMasters/_rels/notesMaster1.xml.rels", NOTES_MASTER_RELS),
  ];
  deck.slides.forEach((s, k) => {
    const i = String(k + 1);
    parts.push(
      textEntry(`ppt/slides/slide${i}.xml`, slide(s)),
      textEntry(`ppt/slides/_rels/slide${i}.xml.rels`, slideRels(k + 1)),
      textEntry(`ppt/notesSlides/notesSlide${i}.xml`, notesSlide(s.notes)),
      textEntry(`ppt/notesSlides/_rels/notesSlide${i}.xml.rels`, notesRels(k + 1)),
    );
  });
  deck.slides.forEach((s, k) => {
    parts.push({ name: `ppt/media/image${String(k + 1)}.png`, body: s.picture.body, size: s.picture.size, crc: s.picture.crc });
  });
  return parts;
}

export function buildPptx(deck: Deck, when: Date): Blob {
  return zipBlob(pptxParts(deck, when), when, PPTX_TYPE);
}
