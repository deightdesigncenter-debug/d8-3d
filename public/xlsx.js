/* D.EIGHT — small Excel (.xlsx) writer and reader, all in the browser (no upload, no library).
   D8X.write(sheets, fileName)   sheets: [{ name, cols: [{ h, w, t }], rows: [[...]], sum: [colIndex...] }]
       t: "s" text · "i" whole number · "n" number · "usd" money 0.00 · "vnd" money 0 · "d" date (YYYY-MM-DD or ms) · "p" percent
   D8X.read(file) → [{ name, rows: [[cell...]] }]   (.xlsx or .csv; dates come back as "YYYY-MM-DD") */
(function () {
  "use strict";
  const enc = new TextEncoder();
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const canZip = typeof CompressionStream === "function";
  async function deflate(u8) {
    if (!canZip) return null;
    try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); } catch { return null; }
  }
  async function inflate(u8) {
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
  }

  /* ---------------------------------------------------------------- zip */
  async function zip(files) {
    const parts = [], central = [];
    let offset = 0;
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data), z = await deflate(data), body = z && z.length < data.length ? z : data, method = body === data ? 0 : 8;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, method, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true); lh.setUint32(18, body.length, true);
      lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(lh.buffer, name, body);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, method, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true); ch.setUint32(20, body.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + body.length;
    }
    const size = central.reduce((t, x) => t + (x.byteLength || x.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  async function unzip(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error("not a zip");
    const n = dv.getUint16(e + 10, true);
    let p = dv.getUint32(e + 16, true);
    const out = new Map(), dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true),
        clen = dv.getUint16(p + 32, true), loc = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
      out.set(name, { method, csize, loc });
      p += 46 + nlen + xlen + clen;
    }
    return {
      has: (name) => out.has(name),
      async text(name) {
        const f = out.get(name);
        if (!f) return null;
        const start = f.loc + 30 + dv.getUint16(f.loc + 26, true) + dv.getUint16(f.loc + 28, true);
        const raw = u8.subarray(start, start + f.csize);
        return dec.decode(f.method === 8 ? await inflate(raw) : raw);
      },
    };
  }

  /* ---------------------------------------------------------------- writer */
  const xml = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const serial = (v) => {
    if (typeof v === "number") return (v + 7 * 3600000) / 86400000 + 25569; // ms → Vietnam date/time
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000 + 25569 : null;
  };
  // style index per column type; header = 1, total row = +10
  const STYLE = { s: 2, i: 3, n: 4, usd: 5, vnd: 6, d: 7, p: 8 };
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="#,##0"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/><numFmt numFmtId="167" formatCode="0.##"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF05316E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEBF0EF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top style="thin"><color rgb="FF8FACCB"/></top><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="19">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="49" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
<xf numFmtId="10" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
  function sheetXml(sh) {
    const cols = sh.cols || [], rows = sh.rows || [];
    const out = [];
    const cell = (r, c, v, t, total) => {
      const ref = colName(c) + r, st = (STYLE[t] || 2) + (total ? 10 : 0);
      if (v === null || v === undefined || v === "") return total ? `<c r="${ref}" s="${st}"/>` : "";
      if (typeof v === "object" && v.f) return `<c r="${ref}" s="${st}"><f>${xml(v.f)}</f></c>`;
      if (t === "d") { const s = serial(v); return s === null ? `<c r="${ref}" s="${st}" t="inlineStr"><is><t>${xml(v)}</t></is></c>` : `<c r="${ref}" s="${st}"><v>${s}</v></c>`; }
      if (t !== "s" && typeof v === "number" && isFinite(v)) return `<c r="${ref}" s="${st}"><v>${t === "p" ? v / 100 : v}</v></c>`;
      return `<c r="${ref}" s="${total ? 12 : 2}" t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    };
    out.push(`<row r="1" ht="30" customHeight="1">` + cols.map((c, i) => `<c r="${colName(i)}1" s="1" t="inlineStr"><is><t xml:space="preserve">${xml(c.h)}</t></is></c>`).join("") + "</row>");
    rows.forEach((row, ri) => { out.push(`<row r="${ri + 2}">` + row.map((v, ci) => cell(ri + 2, ci, v, (cols[ci] || {}).t || "s")).join("") + "</row>"); });
    const last = rows.length + 1;
    if (sh.sum && rows.length) {
      const r = last + 1;
      out.push(`<row r="${r}">` + cols.map((c, ci) => ci === 0 ? cell(r, 0, sh.sumLabel || "Tổng", "s", true)
        : sh.sum.includes(ci) ? cell(r, ci, { f: `SUBTOTAL(9,${colName(ci)}2:${colName(ci)}${last})` }, c.t, true) : cell(r, ci, "", c.t, true)).join("") + "</row>");
    }
    const width = cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.w || 14}" customWidth="1"/>`).join("");
    const ref = "A1:" + colName(Math.max(0, cols.length - 1)) + Math.max(1, last);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr filterMode="0"/><dimension ref="${ref}"/>
<sheetViews><sheetView workbookViewId="0"${sh.zoom ? ` zoomScale="${sh.zoom}"` : ""}><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/><cols>${width}</cols><sheetData>${out.join("")}</sheetData>${cols.length && sh.filter !== false ? `<autoFilter ref="${ref}"/>` : ""}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  }
  const safeName = (s, used) => {
    let n = String(s || "Sheet").replace(/[\[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet", k = 2;
    while (used.has(n.toLowerCase())) n = n.slice(0, 28) + " " + k++;
    used.add(n.toLowerCase());
    return n;
  };
  async function build(sheets) {
    const used = new Set();
    const list = sheets.map((s) => ({ ...s, name: safeName(s.name, used) }));
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
      { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>D.EIGHT DESIGN CENTER</dc:title><dc:creator>D.EIGHT Workspace</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>` },
      { name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>D.EIGHT Workspace</Application></Properties>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews><sheets>${list.map((s, i) => `<sheet name="${xml(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
<definedNames>${list.map((s, i) => s.cols && s.cols.length && s.filter !== false ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(s.name.replace(/'/g, "''"))}'!$A$1:$${colName(s.cols.length - 1)}$${Math.max(1, (s.rows || []).length + 1)}</definedName>` : "").join("")}</definedNames>
<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: STYLES },
      ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    ];
    return zip(files);
  }
  async function write(sheets, fileName) {
    const blob = await build(sheets);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = fileName.replace(/[\\/:*?"<>|]+/g, "-");
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    return blob;
  }

  /* ---------------------------------------------------------------- reader */
  const tags = (node, name) => Array.from(node.getElementsByTagNameNS("*", name));
  const parse = (s) => new DOMParser().parseFromString(s, "application/xml");
  const colIndex = (ref) => { const m = /^([A-Z]+)/.exec(ref || ""); if (!m) return -1; let n = 0; for (const ch of m[1]) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  const dayOfSerial = (n) => { const d = new Date(Math.round((n - 25569) * 86400000)); return isNaN(d) ? "" : d.toISOString().slice(0, 10); };
  const DATE_IDS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);
  async function readXlsx(buf) {
    const z = await unzip(buf);
    const wb = parse(await z.text("xl/workbook.xml"));
    const rels = parse((await z.text("xl/_rels/workbook.xml.rels")) || "<Relationships/>");
    const target = {};
    for (const r of tags(rels, "Relationship")) target[r.getAttribute("Id")] = r.getAttribute("Target");
    const shared = [];
    const ss = await z.text("xl/sharedStrings.xml");
    if (ss) for (const si of tags(parse(ss), "si")) shared.push(tags(si, "t").map((t) => t.textContent).join(""));
    const dateStyle = [];
    const st = await z.text("xl/styles.xml");
    if (st) {
      const sd = parse(st), custom = {};
      for (const f of tags(sd, "numFmt")) custom[f.getAttribute("numFmtId")] = f.getAttribute("formatCode") || "";
      const xfs = tags(sd, "cellXfs")[0];
      if (xfs) for (const xf of tags(xfs, "xf")) {
        const id = +xf.getAttribute("numFmtId") || 0, code = (custom[id] || "").replace(/"[^"]*"|\[[^\]]*\]/g, "");
        dateStyle.push(DATE_IDS.has(id) || (id >= 164 && /[dy]/i.test(code) && !/^[#0.,\s%]+$/.test(code)));
      }
    }
    const out = [];
    for (const s of tags(wb, "sheet")) {
      const rid = s.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") || s.getAttribute("r:id");
      let path = target[rid] || "";
      path = path.startsWith("/") ? path.slice(1) : "xl/" + path.replace(/^\.\//, "");
      const text = await z.text(path);
      if (!text) continue;
      const rows = [];
      for (const row of tags(parse(text), "row")) {
        const ri = (+row.getAttribute("r") || rows.length + 1) - 1, arr = [];
        for (const c of tags(row, "c")) {
          const ci = colIndex(c.getAttribute("r")), t = c.getAttribute("t") || "n", v = tags(c, "v")[0];
          let val = "";
          if (t === "s") val = v ? shared[+v.textContent] || "" : "";
          else if (t === "inlineStr") val = tags(c, "t").map((x) => x.textContent).join("");
          else if (t === "b") val = v ? v.textContent === "1" : "";
          else if (t === "str" || t === "e") val = v ? v.textContent : "";
          else if (v) { const n = Number(v.textContent); val = dateStyle[+c.getAttribute("s") || 0] && isFinite(n) ? dayOfSerial(n) : n; }
          arr[ci >= 0 ? ci : arr.length] = val;
        }
        rows[ri] = Array.from(arr, (x) => (x === undefined ? "" : x));
      }
      out.push({ name: s.getAttribute("name") || "Sheet", rows: Array.from(rows, (r) => r || []) });
    }
    return out;
  }
  function readCsv(text) {
    text = text.replace(/^﻿/, "");
    const first = text.split(/\r?\n/, 1)[0] || "";
    const sep = (first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ";" : (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : ",";
    const rows = [];
    let row = [], cur = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === sep) { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return [{ name: "CSV", rows }];
  }
  async function read(file) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (head[0] === 0x50 && head[1] === 0x4b) return readXlsx(buf);
    if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error("File .xls (Excel 97-2003) chưa đọc được. Mở bằng Excel rồi Lưu thành .xlsx.");
    return readCsv(new TextDecoder().decode(buf));
  }

  /* ---------------------------------------------------------------- helpers for imports */
  const fold = (s) => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();
  // A typed date in any common form → "YYYY-MM-DD". Day first, as in Vietnam (05/08/2026 = 5 Aug 2026), unless
  // mdy is set (US sheets: 10/21/2026); a value that only makes sense the other way round (21/10 vs 10/21) is read that way.
  function day(v, mdy) {
    if (v == null || v === "") return "";
    if (typeof v === "number") return v > 20000 && v < 80000 ? dayOfSerial(v) : "";
    const s = String(v).trim();
    let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (m) return m[1] + "-" + m[2].padStart(2, "0") + "-" + m[3].padStart(2, "0");
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
    if (m) {
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      let d = +m[1], mo = +m[2];
      if (mdy) [d, mo] = [mo, d];
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return "INVALID:" + s;
      return y + "-" + String(mo).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    }
    return "INVALID:" + s;
  }
  // Which way a column of a/b/yyyy dates is written: "mdy" when some value only fits month-first, else "dmy".
  function dateOrder(values) {
    let dmy = false, mdy = false;
    for (const v of values) {
      const m = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{2,4}/.exec(String(v == null ? "" : v).trim());
      if (!m) continue;
      if (+m[1] > 12) dmy = true;
      if (+m[2] > 12) mdy = true;
    }
    return mdy && !dmy ? "mdy" : "dmy";
  }
  // Header row → index of each wanted column; wanted = { key: ["header name", "other name"...] }
  function mapHeader(row, wanted) {
    const idx = {}, names = (row || []).map(fold);
    for (const [key, list] of Object.entries(wanted)) {
      const opts = list.map(fold);
      let i = names.findIndex((n) => opts.includes(n));
      if (i < 0) i = names.findIndex((n) => opts.some((o) => o.length > 3 && n.startsWith(o)));
      if (i >= 0) idx[key] = i;
    }
    return idx;
  }
  window.D8X = { write, build, read, fold, day, dateOrder, mapHeader };
})();
