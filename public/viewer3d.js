/* D.EIGHT — 3D preview of design files (STL, PLY, OBJ) right in the page: rotate, zoom, pan, preset views, full screen.
   No plug-in and no file to open: the file is read by the browser and drawn with WebGL.
   D8.view3d.is(name) · D8.view3d.open({url, name, size}) (full-screen window) · D8.view3d.gallery(host, files) (inline card:
   one file at a time, or up to four in one view — upper, lower and bite scans keep their own coordinates, so they line up). */
(() => {
  "use strict";
  const D8 = (window.D8 = window.D8 || {});
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const IS3D = /\.(stl|ply|obj)$/i;
  const mb = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace(".", ",") + " MB";
  const nfmt = (n) => Number(n).toLocaleString("vi-VN");
  const yieldUI = () => new Promise((r) => setTimeout(r, 0));

  /* ---------------------------------------------------------------- reading the file */
  async function fetchBuf(url, onProg, signal) {
    const r = await fetch(url, { credentials: "same-origin", headers: D8.authHeaders ? D8.authHeaders() : {}, signal });
    if (!r.ok) throw new Error(r.status === 410 ? "File đã hết hạn lưu." : "Không tải được file (" + r.status + ").");
    const total = +r.headers.get("content-length") || 0;
    if (!r.body || !r.body.getReader) return r.arrayBuffer();
    const reader = r.body.getReader(), parts = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value); got += value.length;
      if (onProg) onProg(got, total);
    }
    const out = new Uint8Array(got);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  }

  // STL (binary or text) → a flat list of triangle corners
  function parseSTL(buf) {
    const dv = new DataView(buf), len = buf.byteLength;
    const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(len, 1024)));
    const n = len >= 84 ? dv.getUint32(80, true) : 0;
    const textual = /^\s*solid/i.test(head) && /facet|endsolid/i.test(head);
    if (n && 84 + n * 50 <= len && (84 + n * 50 === len || !textual)) {
      const tri = new Float32Array(n * 9);
      for (let i = 0, o = 84; i < n; i++, o += 50) for (let k = 0; k < 9; k++) tri[i * 9 + k] = dv.getFloat32(o + 12 + k * 4, true);
      return { tri };
    }
    const text = new TextDecoder().decode(new Uint8Array(buf));
    const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g, out = [];
    let m;
    while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
    if (out.length < 9) throw new Error("File STL không có tam giác nào.");
    return { tri: new Float32Array(out.length - (out.length % 9)).map((_, i) => out[i]) };
  }

  // PLY (binary little / big endian or text): vertices (x y z, colours if any) and faces
  function parsePLY(buf) {
    const bytes = new Uint8Array(buf);
    let end = -1;
    for (let i = 0; i < Math.min(bytes.length, 65536) - 10; i++) if (bytes[i] === 101 && new TextDecoder().decode(bytes.subarray(i, i + 10)) === "end_header") { end = i; break; }
    if (end < 0) throw new Error("File PLY không đọc được.");
    const headText = new TextDecoder().decode(bytes.subarray(0, end));
    let bodyAt = end + 10;
    while (bodyAt < bytes.length && (bytes[bodyAt] === 13 || bytes[bodyAt] === 10)) { bodyAt++; if (bytes[bodyAt - 1] === 10) break; }
    const lines = headText.split(/\r?\n/), els = [];
    let format = "ascii";
    for (const l of lines) {
      const t = l.trim().split(/\s+/);
      if (t[0] === "format") format = t[1];
      else if (t[0] === "element") els.push({ name: t[1], count: +t[2], props: [] });
      else if (t[0] === "property" && els.length) els[els.length - 1].props.push(t[1] === "list" ? { list: true, ct: t[2], it: t[3], name: t[4] } : { type: t[1], name: t[2] });
    }
    const SZ = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
    const vEl = els.find((e) => e.name === "vertex"), fEl = els.find((e) => e.name === "face");
    if (!vEl) throw new Error("File PLY không có đỉnh.");
    const nv = vEl.count, pos = new Float32Array(nv * 3), pi = ["x", "y", "z"].map((k) => vEl.props.findIndex((p) => p.name === k));
    const ci = ["red", "green", "blue"].map((k) => vEl.props.findIndex((p) => p.name === k));
    const col = ci.every((i) => i >= 0) ? new Uint8Array(nv * 3) : null;
    const idx = [];
    if (format === "ascii") {
      const text = new TextDecoder().decode(bytes.subarray(bodyAt)).split(/\r?\n/);
      let li = 0;
      for (const el of els) {
        for (let r = 0; r < el.count; r++, li++) {
          const t = (text[li] || "").trim().split(/\s+/).map(Number);
          if (el === vEl) { for (let k = 0; k < 3; k++) pos[r * 3 + k] = t[pi[k]]; if (col) for (let k = 0; k < 3; k++) col[r * 3 + k] = t[ci[k]]; }
          else if (el === fEl) { const c = t[0]; for (let k = 2; k < c; k++) idx.push(t[1], t[k], t[k + 1]); }
        }
      }
    } else {
      const dv = new DataView(buf), le = format !== "binary_big_endian";
      const rd = (type, o) => {
        switch (type) {
          case "char": case "int8": return dv.getInt8(o);
          case "uchar": case "uint8": return dv.getUint8(o);
          case "short": case "int16": return dv.getInt16(o, le);
          case "ushort": case "uint16": return dv.getUint16(o, le);
          case "int": case "int32": return dv.getInt32(o, le);
          case "uint": case "uint32": return dv.getUint32(o, le);
          case "float": case "float32": return dv.getFloat32(o, le);
          default: return dv.getFloat64(o, le);
        }
      };
      let o = bodyAt;
      for (const el of els) {
        const fixed = el.props.every((p) => !p.list);
        for (let r = 0; r < el.count; r++) {
          if (el === vEl && fixed) {
            let q = o;
            el.props.forEach((p, k) => {
              const v = rd(p.type, q);
              const a = pi.indexOf(k); if (a >= 0) pos[r * 3 + a] = v;
              if (col) { const b = ci.indexOf(k); if (b >= 0) col[r * 3 + b] = v; }
              q += SZ[p.type];
            });
            o = q;
            continue;
          }
          for (const p of el.props) {
            if (p.list) {
              const c = rd(p.ct, o); o += SZ[p.ct];
              const vs = [];
              for (let k = 0; k < c; k++) { vs.push(rd(p.it, o)); o += SZ[p.it]; }
              if (el === fEl && p.name.startsWith("vertex")) for (let k = 1; k < c - 1; k++) idx.push(vs[0], vs[k], vs[k + 1]);
            } else o += SZ[p.type];
          }
        }
      }
    }
    if (!idx.length) throw new Error("File PLY không có mặt nào (chỉ có điểm).");
    return { pos, idx: Uint32Array.from(idx), col };
  }

  // OBJ: v / f (polygons are split into triangles)
  function parseOBJ(buf) {
    const lines = new TextDecoder().decode(new Uint8Array(buf)).split(/\r?\n/), pos = [], col = [], idx = [];
    let colours = false;
    for (const l of lines) {
      if (l.startsWith("v ")) { const t = l.trim().split(/\s+/); pos.push(+t[1], +t[2], +t[3]); if (t.length >= 7) { colours = true; col.push(+t[4] * 255, +t[5] * 255, +t[6] * 255); } else col.push(230, 222, 205); }
      else if (l.startsWith("f ")) {
        const vs = l.trim().split(/\s+/).slice(1).map((x) => { const i = parseInt(x, 10); return i < 0 ? pos.length / 3 + i : i - 1; });
        for (let k = 1; k < vs.length - 1; k++) idx.push(vs[0], vs[k], vs[k + 1]);
      }
    }
    if (!idx.length) throw new Error("File OBJ không có mặt nào.");
    return { pos: Float32Array.from(pos), idx: Uint32Array.from(idx), col: colours ? Uint8Array.from(col) : null };
  }

  // STL corners → shared vertices (so the surface can be shaded smoothly)
  function weld(tri) {
    const nv = tri.length / 3, bits = new Uint32Array(tri.buffer, tri.byteOffset, tri.length);
    let size = 1;
    while (size < nv * 2) size <<= 1;
    const mask = size - 1, table = new Int32Array(size).fill(-1), pos = new Float32Array(tri.length), pb = new Uint32Array(pos.buffer), idx = new Uint32Array(nv);
    let count = 0;
    for (let v = 0; v < nv; v++) {
      const a = bits[v * 3], b = bits[v * 3 + 1], c = bits[v * 3 + 2];
      let h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mask;
      for (;;) {
        const e = table[h];
        if (e < 0) { table[h] = count; pb[count * 3] = a; pb[count * 3 + 1] = b; pb[count * 3 + 2] = c; idx[v] = count++; break; }
        if (pb[e * 3] === a && pb[e * 3 + 1] === b && pb[e * 3 + 2] === c) { idx[v] = e; break; }
        h = (h + 1) & mask;
      }
    }
    return { pos: pos.slice(0, count * 3), idx };
  }
  function normalsOf(pos, idx) {
    const n = new Float32Array(pos.length);
    for (let i = 0; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
      const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
      for (const k of [a, b, c]) { n[k] += x; n[k + 1] += y; n[k + 2] += z; }
    }
    for (let i = 0; i < n.length; i += 3) { const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1; n[i] /= l; n[i + 1] /= l; n[i + 2] /= l; }
    return n;
  }
  async function readModel(buf, name) {
    const ext = (String(name).match(/\.(\w+)$/) || ["", "stl"])[1].toLowerCase();
    let m;
    if (ext === "stl") { const s = parseSTL(buf); await yieldUI(); m = weld(s.tri); m.col = null; }
    else if (ext === "ply") m = parsePLY(buf);
    else m = parseOBJ(buf);
    await yieldUI();
    m.nrm = normalsOf(m.pos, m.idx);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.pos.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.pos[i + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    m.lo = lo; m.hi = hi;
    m.center = lo.map((v, k) => (v + hi[k]) / 2);
    m.radius = Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2);
    m.size = hi.map((v, k) => v - lo[k]);
    m.tris = m.idx.length / 3;
    return m;
  }

  /* ---------------------------------------------------------------- small maths */
  const qmul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
  const qaxis = (x, y, z, ang) => { const l = Math.hypot(x, y, z) || 1, s = Math.sin(ang / 2); return [x / l * s, y / l * s, z / l * s, Math.cos(ang / 2)]; };
  const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); };
  function qmat(q) { // column-major 3x3
    const [x, y, z, w] = q;
    return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
  }
  const VIEWS = { top: [0, 0, 0, 1], front: qaxis(1, 0, 0, -Math.PI / 2), side: qmul(qaxis(0, 1, 0, -Math.PI / 2), qaxis(1, 0, 0, -Math.PI / 2)), tilt: qaxis(1, 0, 0, -0.6) };

  /* ---------------------------------------------------------------- drawing */
  const VS = `attribute vec3 p; attribute vec3 n; attribute vec3 c; uniform mat4 mv; uniform mat4 pr; uniform mat3 nm; varying vec3 vn; varying vec3 vp; varying vec3 vc;
    void main() { vec4 q = mv * vec4(p, 1.0); vp = q.xyz; vn = nm * n; vc = c; gl_Position = pr * q; }`;
  const FS = `precision highp float; varying vec3 vn; varying vec3 vp; varying vec3 vc; uniform vec3 base; uniform float useCol; uniform float alpha;
    void main() {
      vec3 N = normalize(vn); if (!gl_FrontFacing) N = -N;
      vec3 V = normalize(-vp), L1 = normalize(vec3(0.35, 0.55, 1.0)), L2 = normalize(vec3(-0.6, -0.25, 0.45));
      vec3 col = mix(base, vc, useCol);
      float d1 = max(dot(N, L1), 0.0), d2 = max(dot(N, L2), 0.0);
      float sp = pow(max(dot(N, normalize(L1 + V)), 0.0), 40.0) * 0.22;
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0) * 0.16;
      gl_FragColor = vec4(col * (0.30 + 0.60 * d1 + 0.20 * d2) + vec3(sp + rim), alpha);
    }`;
  // models without colours of their own (STL): the first keeps the usual ivory, the next ones are told apart by colour
  const TINTS = [null, [0.62, 0.76, 0.93], [0.93, 0.68, 0.66], [0.64, 0.86, 0.72]];
  const GHOST = 0.4;        // a see-through model
  const MAX_SHOWN = 4;      // models in one view at a time (each one costs memory, on phones too)

  // One WebGL view holding one or several models. They keep their own coordinates, so files of one scan
  // (upper, lower, bite) sit together the way they were scanned.
  function Viewer(wrap) {
    const canvas = document.createElement("canvas");
    canvas.className = "v3d-canvas";
    canvas.setAttribute("aria-label", "Bản xem 3D: kéo để xoay, cuộn hoặc chụm hai ngón để phóng to, kéo chuột phải hoặc hai ngón để di chuyển");
    canvas.tabIndex = 0;
    wrap.appendChild(canvas);
    const opts = { antialias: true, alpha: true, preserveDrawingBuffer: true };
    const gl = canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    if (!gl) throw new Error("Trình duyệt này không hỗ trợ xem 3D (WebGL).");
    const gl2 = typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext;
    const uint = gl2 || !!gl.getExtension("OES_element_index_uint");
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
    gl.useProgram(prog);
    const U = (k) => gl.getUniformLocation(prog, k), A = (k) => gl.getAttribLocation(prog, k);
    const at = { p: A("p"), n: A("n"), c: A("c") };
    const un = { mv: U("mv"), pr: U("pr"), nm: U("nm"), base: U("base"), useCol: U("useCol"), alpha: U("alpha") };
    let items = [], box = null, q = VIEWS.tilt.slice(), dist = 1, pan = [0, 0], raf = 0;
    const fov = 30 * Math.PI / 180;
    const fit = () => (box ? box.radius / Math.sin(fov / 2) * 1.08 : 1);
    const buffer = (target, data) => { const b = gl.createBuffer(); gl.bindBuffer(target, b); gl.bufferData(target, data, gl.STATIC_DRAW); return b; };
    const free = (it) => [it.pos, it.nrm, it.col, it.idx].forEach((b) => b && gl.deleteBuffer(b));
    function add(m, tint) {
      let pos = m.pos, nrm = m.nrm, col = m.col, idx = m.idx;
      if (!uint && pos.length / 3 > 65535) { // no 32-bit indices: draw the triangles one by one
        const P = new Float32Array(idx.length * 3), N = new Float32Array(idx.length * 3), C = col ? new Uint8Array(idx.length * 3) : null;
        for (let i = 0; i < idx.length; i++) for (let k = 0; k < 3; k++) { P[i * 3 + k] = pos[idx[i] * 3 + k]; N[i * 3 + k] = nrm[idx[i] * 3 + k]; if (C) C[i * 3 + k] = col[idx[i] * 3 + k]; }
        pos = P; nrm = N; col = C; idx = null;
      } else if (!uint) idx = Uint16Array.from(idx);
      const it = { m, tint: tint || null, alpha: 1, pos: buffer(gl.ARRAY_BUFFER, pos), nrm: buffer(gl.ARRAY_BUFFER, nrm),
        col: col ? buffer(gl.ARRAY_BUFFER, col) : null, idx: idx ? buffer(gl.ELEMENT_ARRAY_BUFFER, idx) : null, count: idx ? idx.length : pos.length / 3 };
      items.push(it);
      frame(items.length === 1);
      return it;
    }
    function remove(it) {
      const i = items.indexOf(it);
      if (i < 0) return;
      items.splice(i, 1);
      free(it);
      frame(false);
    }
    // frame every model shown; the first one brings the usual view, later ones keep the turn the user gave it
    function frame(view) {
      box = null;
      if (items.length) {
        const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
        for (const it of items) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], it.m.lo[k]); hi[k] = Math.max(hi[k], it.m.hi[k]); }
        box = { center: lo.map((v, k) => (v + hi[k]) / 2), radius: Math.max(1e-6, Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2) };
      }
      if (view) q = VIEWS.tilt.slice();
      pan = [0, 0]; dist = fit(); draw();
    }
    function reset(view) { q = (VIEWS[view] || VIEWS.tilt).slice(); pan = [0, 0]; dist = fit(); draw(); }
    function draw() { if (!raf) raf = requestAnimationFrame(render); }
    function drawItem(it, base) {
      gl.bindBuffer(gl.ARRAY_BUFFER, it.pos); gl.enableVertexAttribArray(at.p); gl.vertexAttribPointer(at.p, 3, gl.FLOAT, false, 0, 0);
      if (at.n >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, it.nrm); gl.enableVertexAttribArray(at.n); gl.vertexAttribPointer(at.n, 3, gl.FLOAT, false, 0, 0); }
      if (at.c >= 0) {
        if (it.col) { gl.bindBuffer(gl.ARRAY_BUFFER, it.col); gl.enableVertexAttribArray(at.c); gl.vertexAttribPointer(at.c, 3, gl.UNSIGNED_BYTE, true, 0, 0); }
        else { gl.disableVertexAttribArray(at.c); gl.vertexAttrib3f(at.c, 0.9, 0.87, 0.8); }
      }
      gl.uniform1f(un.useCol, it.col ? 1 : 0);
      gl.uniform3fv(un.base, it.tint || base);
      gl.uniform1f(un.alpha, it.alpha);
      if (it.idx) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, it.idx); gl.drawElements(gl.TRIANGLES, it.count, uint ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0); }
      else gl.drawArrays(gl.TRIANGLES, 0, it.count);
    }
    function render() {
      raf = 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, w, h);
      gl.colorMask(true, true, true, true); gl.depthMask(true);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!box) return;
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
      const r = qmat(q), c = box.center, near = Math.max(dist - box.radius * 2, dist * 0.01), far = dist + box.radius * 2;
      // model-view = translate(pan, -dist) · rotate(q) · translate(-center)
      const t = [-(r[0] * c[0] + r[3] * c[1] + r[6] * c[2]) + pan[0], -(r[1] * c[0] + r[4] * c[1] + r[7] * c[2]) + pan[1], -(r[2] * c[0] + r[5] * c[1] + r[8] * c[2]) - dist];
      gl.uniformMatrix4fv(un.mv, false, [r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, t[0], t[1], t[2], 1]);
      const f = 1 / Math.tan(fov / 2), asp = w / h;
      gl.uniformMatrix4fv(un.pr, false, [f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
      gl.uniformMatrix3fv(un.nm, false, r);
      const base = document.documentElement.dataset.theme === "dark" ? [0.92, 0.89, 0.82] : [0.9, 0.86, 0.77];
      for (const it of items) if (it.alpha >= 1) drawItem(it, base);
      // see-through models last, their nearest surface only (depth first, then colour where it matches), blended over the rest
      const ghosts = items.filter((it) => it.alpha < 1);
      if (!ghosts.length) return;
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      for (const it of ghosts) {
        gl.colorMask(false, false, false, false); gl.depthFunc(gl.LESS); drawItem(it, base);
        gl.colorMask(true, true, true, true); gl.depthFunc(gl.LEQUAL); drawItem(it, base);
      }
      gl.disable(gl.BLEND); gl.depthFunc(gl.LESS);
    }
    // pointer: one finger / left button rotates, two fingers pinch and move, right button or shift pans, wheel zooms
    const pts = new Map();
    let lastPinch = 0, lastMid = null;
    const rotate = (dx, dy) => { const ang = Math.hypot(dx, dy) * 0.009; if (ang) { q = qnorm(qmul(qaxis(dy, dx, 0, ang), q)); draw(); } };
    const move = (dx, dy) => { const s = (2 * dist * Math.tan(fov / 2)) / Math.max(1, canvas.clientHeight); pan[0] += dx * s; pan[1] -= dy * s; draw(); };
    const zoom = (k) => { if (!box) return; dist = Math.min(box.radius * 30, Math.max(box.radius * 0.25, dist * k)); draw(); };
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey }); lastPinch = 0; lastMid = null; });
    canvas.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        if (lastPinch) zoom(lastPinch / d);
        if (lastMid) move(mid[0] - lastMid[0], mid[1] - lastMid[1]);
        lastPinch = d; lastMid = mid;
      } else if (p.pan) move(dx, dy); else rotate(dx, dy);
    });
    const up = (e) => { pts.delete(e.pointerId); lastPinch = 0; lastMid = null; };
    canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0015))); }, { passive: false });
    canvas.addEventListener("dblclick", () => reset());
    canvas.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] }[e.key];
      if (k) { e.preventDefault(); rotate(k[0], k[1]); } else if (e.key === "+" || e.key === "=") zoom(0.85); else if (e.key === "-") zoom(1.18); else if (e.key === "0") reset();
    });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(draw) : null;
    if (ro) ro.observe(canvas);
    this.add = add; this.remove = remove; this.reset = reset; this.zoom = zoom; this.canvas = canvas;
    this.ghost = (it, on) => { it.alpha = on ? GHOST : 1; draw(); };
    this.destroy = () => { if (ro) ro.disconnect(); if (raf) cancelAnimationFrame(raf); items.forEach(free); items = []; const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); canvas.remove(); };
  }

  /* ---------------------------------------------------------------- a viewer with its toolbar */
  const ICON = {
    top: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><ellipse cx="10" cy="10" rx="6.5" ry="6.5"/><circle cx="10" cy="10" r="2"/></svg>',
    front: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M5 4h10l-1.5 12h-7z"/></svg>',
    side: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 7c3-3 9-3 12 0v7H4z"/></svg>',
    reset: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 10a6 6 0 1 0 2-4.5M4 3v3.5h3.5"/></svg>',
    full: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3.5 7.5v-4h4M16.5 7.5v-4h-4M3.5 12.5v4h4M16.5 12.5v4h-4"/></svg>',
    dl: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M10 3v10M6 9l4 4 4-4M4 16.5h12"/></svg>',
    x: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>',
    plus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M10 5v10M5 10h10"/></svg>',
    minus: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M5 10h10"/></svg>',
  };
  const facts = (bytes, m) => [mb(bytes), nfmt(m.tris) + " tam giác", m.size.map((x) => x.toFixed(1).replace(".", ",")).join(" × ") + " mm"].join(" · ");
  let rowSeq = 0;
  // The box with its toolbar. set(files) puts one or several files in the view: new ones load one after the other,
  // the ones left out are dropped. One file: its name and facts under the view. Several (multi): a row per file with
  // its colour, a see-through switch and its download. Test hooks: data-models (models drawn), data-tris (their triangles).
  function scene(host, { onClose, big } = {}) {
    host.innerHTML = `<div class="v3d${big ? " big" : ""}"><div class="v3d-stage"><div class="v3d-msg" role="status">Đang tải bản 3D…</div></div>
      <div class="v3d-bar"><div class="v3d-info"></div>
        <div class="v3d-tools">
          <button type="button" data-v="top" title="Mặt nhai" aria-label="Nhìn mặt nhai">${ICON.top}</button><button type="button" data-v="front" title="Phía trước" aria-label="Nhìn phía trước">${ICON.front}</button>
          <button type="button" data-v="side" title="Bên cạnh" aria-label="Nhìn bên cạnh">${ICON.side}</button><button type="button" data-z="in" title="Phóng to" aria-label="Phóng to">${ICON.plus}</button>
          <button type="button" data-z="out" title="Thu nhỏ" aria-label="Thu nhỏ">${ICON.minus}</button><button type="button" data-v="reset" title="Đặt lại góc nhìn" aria-label="Đặt lại góc nhìn">${ICON.reset}</button>
          <button type="button" data-full title="Toàn màn hình" aria-label="Toàn màn hình">${ICON.full}</button>
          <a data-dl href="#" download title="Tải file" aria-label="Tải file" hidden>${ICON.dl}</a>
          ${onClose ? `<button type="button" data-close title="Đóng" aria-label="Đóng">${ICON.x}</button>` : ""}</div></div></div>`;
    const root = host.querySelector(".v3d"), stage = root.querySelector(".v3d-stage"), msg = root.querySelector(".v3d-msg"),
      info = root.querySelector(".v3d-info"), dl = root.querySelector("[data-dl]");
    const shown = new Map();   // url → { k, file, state: wait | load | ok | err, text, m, it, tint, ctl }
    let v = null, dead = false, busy = false, multi = false;
    root.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => v && v.reset(b.dataset.v === "reset" ? "" : b.dataset.v)));
    root.querySelectorAll("[data-z]").forEach((b) => b.addEventListener("click", () => v && v.zoom(b.dataset.z === "in" ? 0.8 : 1.25)));
    root.querySelector("[data-full]").addEventListener("click", () => { if (document.fullscreenElement) document.exitFullscreen(); else if (root.requestFullscreen) root.requestFullscreen().catch(() => {}); });
    if (onClose) root.querySelector("[data-close]").addEventListener("click", onClose);
    // the first colour no other plain model in the view is using
    const tintFor = (e) => {
      const used = new Set([...shown.values()].filter((x) => x !== e && x.state === "ok" && !x.m.col).map((x) => x.tint));
      for (let i = 0; i < TINTS.length; i++) if (!used.has(i)) return i;
      return 0;
    };
    // loading progress without redrawing the toolbar (keeps the focus on its buttons)
    const tell = (e) => {
      const row = multi && info.querySelector(`li[data-k="${e.k}"] small`);
      if (row) row.textContent = e.text;
      if (root.dataset.models === "0") { msg.hidden = false; msg.textContent = e.text; }
    };
    function paint() {
      const list = [...shown.values()], ok = list.filter((e) => e.state === "ok");
      root.classList.toggle("multi", multi);
      root.dataset.models = ok.length;
      if (ok.length) root.dataset.tris = ok.reduce((t, e) => t + e.m.tris, 0); else delete root.dataset.tris;
      if (!multi) {
        const e = list[0];
        info.innerHTML = e ? `<b title="${esc(e.file.name)}">${esc(e.file.name)}</b><small data-info>${esc(e.state === "ok" ? e.text : e.file.size ? mb(e.file.size) : "")}</small>` : "";
      } else {
        info.innerHTML = list.length ? `<ul class="v3d-legend">${list.map((e) => `<li data-k="${e.k}"${e.state === "err" ? ' class="err"' : ""}>` +
          `<span class="v3d-dot ${e.state === "ok" && e.m.col ? "scan" : "t" + (e.tint || 0)}" aria-hidden="true"></span>` +
          `<b title="${esc(e.file.name)}">${esc(e.file.name)}</b><small>${esc(e.text || "Chờ tải…")}</small>` +
          (e.state === "ok" ? `<button type="button" data-ghost aria-pressed="${e.it.alpha < 1 ? "true" : "false"}" title="Làm mờ để nhìn xuyên qua" aria-label="Làm mờ ${esc(e.file.name)}">Mờ</button>` : "") +
          `<a href="${esc(e.file.url)}" download="${esc(e.file.name)}" title="Tải file" aria-label="Tải ${esc(e.file.name)}">${ICON.dl}</a></li>`).join("")}</ul>` : "";
        info.querySelectorAll("[data-ghost]").forEach((b) => b.addEventListener("click", () => {
          const e = list.find((x) => String(x.k) === b.closest("li").dataset.k);
          if (!e || !e.it || !v) return;
          const on = e.it.alpha >= 1;
          v.ghost(e.it, on);
          b.setAttribute("aria-pressed", on ? "true" : "false");
        }));
      }
      // the toolbar's download is for the one file shown; several files: each row has its own
      const one = !multi && list.length === 1 ? list[0].file : null;
      dl.hidden = !one;
      if (one) { dl.href = one.url; dl.download = one.name; dl.setAttribute("aria-label", "Tải " + one.name); }
      msg.classList.remove("err"); delete root.dataset.error;
      if (ok.length) { msg.hidden = true; return; }
      msg.hidden = false;
      const loading = list.find((e) => e.state === "load" || e.state === "wait"), bad = list.find((e) => e.state === "err");
      if (loading) msg.textContent = loading.text || "Đang tải bản 3D…";
      else if (bad) { msg.textContent = bad.text; msg.classList.add("err"); root.dataset.error = "1"; }
      else msg.textContent = "Chọn file để xem.";
    }
    // one file at a time: a phone does not have to hold two downloads and two meshes being built at once
    async function pump() {
      if (busy || dead) return;
      const e = [...shown.values()].find((x) => x.state === "wait");
      if (!e) return;
      busy = true; e.state = "load"; e.text = "Đang tải bản 3D…"; paint();
      const live = () => !dead && shown.get(e.file.url) === e;
      try {
        e.ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const buf = await fetchBuf(e.file.url, (got, total) => { e.text = "Đang tải bản 3D… " + mb(got) + (total ? " / " + mb(total) : ""); if (live()) tell(e); }, e.ctl && e.ctl.signal);
        if (live()) {
          e.text = "Đang dựng hình…"; tell(e);
          await yieldUI();
          const m = await readModel(buf, e.file.name);
          if (live()) {
            if (!v) v = new Viewer(stage);
            e.m = m; e.tint = m.col ? 0 : tintFor(e);
            e.it = v.add(m, TINTS[e.tint]);
            e.state = "ok"; e.text = facts(buf.byteLength, m);
          }
        }
      } catch (err) { if (live()) { e.state = "err"; e.text = err.message || "Không xem được file này."; } }
      busy = false;
      if (!dead) { paint(); pump(); }
    }
    function set(files) {
      const want = new Set(files.map((f) => f.url));
      for (const [url, e] of shown) if (!want.has(url)) { if (e.ctl) e.ctl.abort(); if (e.it && v) v.remove(e.it); shown.delete(url); }
      // rows follow the order the files were picked in
      const had = new Map(shown);
      shown.clear();
      for (const f of files) shown.set(f.url, had.get(f.url) || { k: ++rowSeq, file: f, state: "wait", text: "" });
      paint(); pump();
    }
    return {
      set, root,
      loaded: () => [...shown.values()].filter((e) => e.state === "ok").map((e) => e.file.url),
      multi(on) { if (multi !== !!on) { multi = !!on; paint(); } },
      destroy() { dead = true; shown.forEach((e) => e.ctl && e.ctl.abort()); shown.clear(); if (v) v.destroy(); v = null; host.innerHTML = ""; },
    };
  }
  function mount(host, file, opts) {
    const s = scene(host, opts);
    s.set([file]);
    return { destroy: s.destroy };
  }

  // full-screen window over the page
  function open(file) {
    const ov = document.createElement("div");
    ov.className = "v3d-overlay"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true"); ov.setAttribute("aria-label", "Xem 3D " + file.name);
    document.body.appendChild(ov);
    const prevFocus = document.activeElement;
    const close = () => { h.destroy(); ov.remove(); document.removeEventListener("keydown", onKey); if (prevFocus && prevFocus.focus) prevFocus.focus(); };
    const onKey = (e) => { if (e.key === "Escape" && !document.fullscreenElement) close(); };
    const h = mount(ov, file, { onClose: close, big: true });
    document.addEventListener("keydown", onKey);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
    const c = ov.querySelector("[data-close]"); if (c) c.focus();
    return close;
  }

  // Inline card: a chip per file (newest first). "Từng file" shows the one picked; "Xem cùng lúc" puts up to four
  // in one view (chips switch files on and off). A large file waits for a click. The page calls this again and again
  // (the order chat refreshes every 15 s, the case page redraws on news): the same files leave the view as it is,
  // a new file only adds its chip, and a redrawn page takes over the view it had (same host id), turned and loaded.
  const kept = new Map();   // host id → gallery state, so a redrawn page keeps its view
  let galSeq = 0;
  function dropGallery(g) { if (g.sc) g.sc.destroy(); g.sc = null; }
  function gallery(host, files) {
    const list = files.filter((f) => IS3D.test(f.name));
    let g = host._g;
    if (!g && host.id) {
      const old = kept.get(host.id);
      if (old && old.host !== host && !old.host.isConnected) { host.replaceChildren(...old.host.childNodes); g = old; }
    }
    if (!g) g = { id: ++galSeq, key: null, multi: false, sel: [], sc: null };
    g.host = host; host._g = g;
    if (host.id) kept.set(host.id, g);
    host.hidden = !list.length;
    const key = list.map((f) => f.url).join("|");
    if (g.key === key) return;
    g.key = key;
    if (!list.length) { dropGallery(g); g.sel = []; host.innerHTML = ""; return; }
    if (list.length < 2) g.multi = false;
    // what was picked stays picked; nothing picked (first time, or those files are gone): the newest
    g.sel = g.sel.filter((u) => list.some((f) => f.url === u));
    if (!g.sel.length) g.sel = [list[0].url];
    const H = host.classList.contains("card") ? "h2" : "h3";
    if (!host.querySelector(".v3d-slot")) {
      host.innerHTML = `<div class="card-head-row"><${H} class="h-caps">Xem trước 3D</${H}><span class="chip" data-n></span></div><div class="v3d-pick"></div><div class="v3d-slot"></div>`;
    }
    host.querySelector("[data-n]").textContent = list.length + " file";
    const pick = host.querySelector(".v3d-pick"), slot = host.querySelector(".v3d-slot"), radio = "v3dm" + g.id;
    pick.innerHTML = list.length > 1 ? `<div class="seg v3d-mode" role="radiogroup" aria-label="Cách xem file 3D">
        <label><input type="radio" name="${radio}" value="one"${g.multi ? "" : " checked"}><span>Từng file</span></label>
        <label><input type="radio" name="${radio}" value="multi"${g.multi ? " checked" : ""}><span>Xem cùng lúc</span></label></div>
      <div class="v3d-chips"></div><p class="hint v3d-hint" role="status"></p>` : "";
    const chips = pick.querySelector(".v3d-chips"), hint = pick.querySelector(".v3d-hint");
    const MULTI_HINT = `Bấm tên file để thêm hoặc bỏ khỏi khung xem (tối đa ${MAX_SHOWN} file). File của cùng một lần quét (hàm trên, hàm dưới, khớp cắn) nằm đúng vị trí với nhau.`;
    const drawChips = () => {
      if (!chips) return;
      chips.className = "v3d-chips" + (g.multi ? " multi" : "");
      chips.setAttribute("role", g.multi ? "group" : "tablist");
      chips.setAttribute("aria-label", g.multi ? "File trong khung xem" : "Chọn file");
      chips.innerHTML = list.map((f, i) => {
        const on = g.sel.includes(f.url);
        return `<button type="button" class="v3d-chip${on ? " on" : ""}" data-f="${i}" title="${esc(f.name)}" ${g.multi ? `aria-pressed="${on}"` : `role="tab" aria-selected="${on}"`}>${esc(f.name)}</button>`;
      }).join("");
      chips.querySelectorAll(".v3d-chip").forEach((b) => b.addEventListener("click", () => choose(+b.dataset.f)));
      hint.textContent = g.multi ? MULTI_HINT : "";
    };
    const show = (auto) => {
      const picked = g.sel.map((u) => list.find((f) => f.url === u)).filter(Boolean);
      // a large file is not downloaded by itself: one click to load it
      if (auto && !g.sc && picked.length === 1 && picked[0].size > 40 * 1048576) {
        slot.innerHTML = `<div class="v3d v3d-wait"><button class="btn small" type="button" data-load>Xem 3D ${esc(picked[0].name)} (${esc(mb(picked[0].size))})</button></div>`;
        slot.querySelector("[data-load]").addEventListener("click", () => show(false));
        return;
      }
      if (!g.sc) g.sc = scene(slot);
      g.sc.multi(g.multi);
      g.sc.set(picked);
    };
    const choose = (i) => {
      const u = list[i].url;
      if (!g.multi) g.sel = [u];
      else if (g.sel.includes(u)) g.sel = g.sel.filter((x) => x !== u);
      else if (g.sel.length >= MAX_SHOWN) { hint.textContent = `Khung xem đã có ${MAX_SHOWN} file. Bỏ bớt một file rồi thêm file khác.`; return; }
      else g.sel = [...g.sel, u];
      drawChips(); show(false);
    };
    pick.querySelectorAll(`input[name="${radio}"]`).forEach((r) => r.addEventListener("change", () => {
      g.multi = r.value === "multi";
      if (!g.multi) {   // back to one file: the last one picked that shows (not one that failed), else the newest
        const good = g.sc ? g.sc.loaded() : [];
        g.sel = [[...g.sel].reverse().find((u) => good.includes(u)) || g.sel[g.sel.length - 1] || list[0].url];
      }
      drawChips(); show(false);
    }));
    drawChips(); show(true);
  }
  // a page left for another one: free its view (models and the WebGL context) if no redraw took it over
  window.addEventListener("hashchange", () => setTimeout(() => kept.forEach((g, id) => { if (!g.host.isConnected) { dropGallery(g); kept.delete(id); } }), 1500));

  D8.view3d = { is: (name) => IS3D.test(String(name || "")), open, gallery, mount, read: readModel };
  // any element with data-v3d="url" opens the viewer (chat file chips, case file lists)
  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest("[data-v3d]");
    if (!b) return;
    e.preventDefault();
    open({ url: b.dataset.v3d, name: b.dataset.name || "model.stl", size: +b.dataset.size || 0 });
  });
})();
