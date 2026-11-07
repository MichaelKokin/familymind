#!/usr/bin/env node
import { constants } from "node:fs";
import { open, mkdir, lstat, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { text as t } from "./research-report-text.mjs";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_REPORT = 20 * 1024 * 1024;
const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; object-src 'none'; base-uri 'none'; form-action 'none'";
export const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export function safeLink(value) {
  if (typeof value !== "string" || /[\u0000-\u0020\u007f]/.test(value)) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
const list = (value) => { if (value === undefined) return []; if (!Array.isArray(value) || value.length > 2000) throw new Error("INVALID_LIST"); return value; };
const str = (value) => { if (typeof value !== "string" || value.length > 100000) throw new Error("INVALID_TEXT"); return value; };
const optionalText = (value) => value === undefined ? "" : str(value);
const e = (value) => escapeHtml(str(value));
const paragraphs = (value) => list(value).map(x => `<p>${e(x)}</p>`).join("");
const bulletList = (value) => `<ul>${list(value).map(x => `<li>${e(x)}</li>`).join("")}</ul>`;
const inside = (root, target) => target === root || target.startsWith(root + path.sep);

async function boundedRead(filename, limit) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error("FILE_TOO_LARGE_OR_UNSAFE");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error("FILE_TOO_LARGE");
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

async function inlineImage(filename, imageRoot) {
  if (!imageRoot) throw new Error("IMAGE_ROOT_REQUIRED");
  const root = await realpath(imageRoot);
  const requested = path.resolve(root, str(filename));
  const actual = await realpath(requested);
  if (!inside(root, actual) || (await lstat(requested)).isSymbolicLink()) throw new Error("IMAGE_OUTSIDE_ROOT");
  const bytes = await boundedRead(requested, 8 * 1024 * 1024);
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
      : bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP" ? "image/webp" : null;
  if (!mime) throw new Error("UNSUPPORTED_IMAGE");
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

const css = `:root{color-scheme:light;--ink:#183c36;--muted:#6b776d;--line:#d7dbcd;--paper:#f7f5ed;--gold:#966e32}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 system-ui,-apple-system,sans-serif}a{color:#356b5e;text-underline-offset:3px;overflow-wrap:anywhere}a:focus-visible{outline:3px solid #bc965b;outline-offset:4px}header{background:#163b34;color:#f6f4e9;padding:76px max(24px,calc((100% - 1080px)/2)) 64px}.kicker{font-size:11px;letter-spacing:.2em;font-weight:700}.subtitle{color:#b9c8ba}h1,h2,h3{overflow-wrap:anywhere;font-family:Georgia,serif;line-height:1.2;font-weight:400}h1{font-size:clamp(36px,6vw,64px);max-width:950px;letter-spacing:-.035em;margin:24px 0}h2{font-size:34px;margin:0 0 28px}h3{font-size:24px;margin:0 0 13px}p{margin:0 0 15px;white-space:pre-line;overflow-wrap:anywhere}main{max-width:1128px;margin:auto;padding:48px 24px}nav{display:flex;gap:12px 24px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:24px;margin-bottom:48px;font-size:13px}section{margin:0 0 72px;scroll-margin-top:24px}.lead{font:23px/1.65 Georgia,serif;max-width:900px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:20px}.card{background:#fffdf7;border:1px solid var(--line);padding:26px;border-radius:4px}.eyebrow,.muted,figcaption{font-size:13px;color:var(--muted)}.status{display:inline-block;border:1px solid #d5c9ad;color:#6b5a3d;background:#f0eee4;padding:3px 9px;font-size:11px;letter-spacing:.03em;border-radius:3px;margin-bottom:17px}.refs{display:flex;flex-wrap:wrap;gap:8px;font-size:12px;margin-top:14px}.refs a{border-bottom:1px solid #bbcbbd;text-decoration:none}.legend{background:#e9eee1;border-left:3px solid #86946d;padding:22px 28px}.legend h3{font-size:21px}.person-name{font-size:25px}.dates{color:var(--gold);font-variant-numeric:tabular-nums}.relation{font-size:13px;text-transform:uppercase;letter-spacing:.05em}.timeline{border-left:2px solid #a7b69b;margin-left:10px;padding-left:32px}.event{position:relative;padding-bottom:30px}.event:before{content:'';position:absolute;left:-39px;top:8px;width:12px;height:12px;border-radius:50%;background:#698168;border:2px solid var(--paper)}.event h3{font-size:22px;margin:8px 0}.conflict{border-left:3px solid #ac7742}.variants{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:20px;margin:18px 0}.variant{padding:16px;background:#f3eee0}.source{padding:28px 0;border-bottom:1px solid var(--line)}.source h3{font-size:24px}.source img{display:block;max-width:100%;max-height:900px;object-fit:contain;margin:20px auto;background:#eee;box-shadow:0 6px 24px #183c3610}figure{margin:18px 0}figcaption{margin-top:12px}.count{font:32px Georgia;color:var(--gold)}ul{padding-left:20px}li{margin-bottom:8px}.footer{border-top:1px solid var(--line);padding-top:28px;color:var(--muted);font-size:12px}.relationship{padding:18px 0;border-bottom:1px solid var(--line)}@media(max-width:600px){header{padding-top:40px}main{padding-top:28px}h2{font-size:29px}section{margin-bottom:48px}.card{padding:21px}.lead{font-size:21px}}@media print{body{background:white;font-size:11pt}header{padding:24px;background:white;color:#183c36}main{padding:24px}nav{display:none}.card,.event,figure{break-inside:avoid}section{margin-bottom:30px}a{color:inherit}}`;

export async function renderReport(data, { imageRoot } = {}) {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("INVALID_REPORT");
  const sources = list(data.sources), people = list(data.people);
  const sourceMap = new Map(sources.map((s, i) => [str(s.id), i + 1]));
  const personMap = new Map(people.map((p) => [str(p.id), str(p.name)]));
  if (sourceMap.size !== sources.length || personMap.size !== people.length) throw new Error("DUPLICATE_ID");
  const refs = (ids) => `<div class="refs">${list(ids).map(id => { const n = sourceMap.get(str(id)); if (!n) throw new Error("MISSING_SOURCE"); return `<a href="#source-${n}">${t.source} ${n}</a>`; }).join("")}</div>`;
  const badge = value => {
    const raw = str(value);
    const label = Object.hasOwn(t.statuses, raw) ? t.statuses[raw] : raw;
    return `<span class="status" title="${escapeHtml(raw)}">${escapeHtml(label)}</span>`;
  };
  const section = (id, title, content) => `<section id="${id}"><h2>${title}</h2>${content}</section>`;
  const parts = [];
  parts.push(section("summary", t.summary, `<div class="lead">${paragraphs(data.summary)}</div><div class="legend"><h3>${t.legend}</h3><p>${t.legendText}</p></div>`));
  if (list(data.familyStory).length) parts.push(section("family-story", t.familyStory, data.familyStory.map(chapter => `<article class="card" style="margin-bottom:20px"><h3>${e(chapter.title)}</h3>${paragraphs(chapter.paragraphs)}${refs(chapter.sourceIds)}</article>`).join("")));
  if (list(data.gallery).length) {
    const photos = [];
    let imageBytes = 0;
    for (const photo of data.gallery) {
      const img = await inlineImage(photo.localImage, imageRoot);
      imageBytes += Buffer.byteLength(img);
      if (imageBytes > MAX_REPORT) throw new Error("REPORT_TOO_LARGE");
      photos.push(`<figure class="card" style="margin:0"><img src="${img}" alt="${e(photo.title)}" style="display:block;width:100%;height:360px;object-fit:contain;background:#e9e6dd"><figcaption><h3 style="margin-top:18px">${e(photo.title)}</h3><p>${e(photo.caption)}</p><p class="dates">${e(photo.dateText)}</p><details><summary>${t.photoProvenance}</summary><p>${e(photo.attribution)}</p>${refs(photo.sourceIds)}</details></figcaption></figure>`);
    }
    parts.push(section("gallery", t.gallery, `<div class="grid">${photos.join("")}</div>`));
  }
  if (list(data.findings).length) parts.push(section("findings", t.findings, `<div class="grid">${data.findings.map(f => `<article class="card">${badge(f.status)}<h3>${e(f.title)}</h3><p>${e(f.text)}</p>${refs(f.sourceIds)}</article>`).join("")}</div>`));
  if (people.length) {
    const primaryIds = data.primaryPersonIds === undefined ? people.map(p => p.id) : list(data.primaryPersonIds).map(str);
    if (primaryIds.some(id => !personMap.has(id))) throw new Error("MISSING_PERSON");
    const cards = (rows) => `<div class="grid">${rows.map(p => `<article class="card"><div class="relation">${e(p.relation)}</div><h3 class="person-name">${e(p.name)}</h3><p class="dates">${e(p.dates)}</p><p>${e(p.note)}</p></article>`).join("")}</div>`;
    const additional = people.filter(p => !primaryIds.includes(p.id));
    parts.push(section("people", t.people, cards(people.filter(p => primaryIds.includes(p.id))) + (additional.length ? `<details style="margin-top:24px"><summary>${t.otherPeople} (${additional.length})</summary>${cards(additional)}</details>` : "")));
  }
  if (list(data.relationships).length) parts.push(section("relationships", t.relationships, `<p class="muted">${t.relationshipHint}</p>${data.relationships.map(r => { const from = personMap.get(str(r.from)), to = personMap.get(str(r.to)); if (!from || !to) throw new Error("MISSING_PERSON"); return `<article class="relationship">${badge(r.status)}<p><strong>${e(from)}</strong> → ${e(r.label)} → <strong>${e(to)}</strong></p>${refs(r.sourceIds)}</article>`; }).join("")}`));
  if (list(data.timeline).length) parts.push(section("timeline", t.timeline, `<div class="timeline">${data.timeline.map(x => `<article class="event"><div class="dates">${e(x.date)}</div><h3>${e(x.title)}</h3><p>${e(x.text)}</p>${refs(x.sourceIds)}</article>`).join("")}</div>`));
  if (list(data.conflicts).length) parts.push(section("conflicts", t.conflicts, data.conflicts.map(c => `<article class="card conflict"><h3>${e(c.title)}</h3><div class="variants">${list(c.variants).map(v => `<div class="variant"><p>${e(v.text)}</p>${refs(v.sourceIds)}</div>`).join("")}</div><p>${e(c.note)}</p></article>`).join("")));
  if (list(data.branches).length) parts.push(section("branches", t.branches, `<div class="grid">${data.branches.map(b => `<article class="card">${badge(b.status)}<h3>${e(b.title)}</h3><p>${e(b.text)}</p></article>`).join("")}</div>`));
  if (sources.length) {
    const content = [];
    let embeddedBytes = 0;
    for (const [i, s] of sources.entries()) {
      const url = safeLink(optionalText(s.url));
      const image = s.localImage ? `<figure><img src="${await inlineImage(s.localImage, imageRoot)}" alt="${e(s.title)}"><figcaption>${t.imageNote}</figcaption></figure>` : "";
      embeddedBytes += Buffer.byteLength(image);
      if (embeddedBytes > MAX_REPORT) throw new Error("REPORT_TOO_LARGE");
      content.push(`<article class="source" id="source-${i + 1}"><div class="eyebrow">${t.source} ${i + 1} · ${e(s.kind)}</div><h3>${e(s.title)}</h3><p>${e(s.locator)}</p>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${t.openSource} ↗</a><p class="muted">${escapeHtml(url)}</p>` : `<p class="muted">${t.unsafeUrl}</p>`}${image}</article>`);
    }
    parts.push(section("sources", t.sources, content.join("")));
  }
  if (list(data.questions).length) parts.push(section("questions", t.questions, `<div class="grid">${data.questions.map((q,i) => `<article class="card"><div class="eyebrow">${String(i+1).padStart(2,"0")}</div><h3>${e(q.title)}</h3><p>${e(q.why)}</p><strong>${t.nextStep}</strong><p>${e(q.nextStep)}</p></article>`).join("")}</div>`));
  const coverage = data.coverage ?? {};
  const counts = Object.entries(coverage.counts ?? {}).map(([key, value]) => { if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("INVALID_COUNT"); return `<div><div class="count">${escapeHtml(value)}</div><div class="muted">${escapeHtml(key)}</div></div>`; }).join("");
  parts.push(section("coverage", t.coverage, `${counts ? `<div class="grid">${counts}</div>` : ""}<div class="grid">${[[t.searched, coverage.searched],[t.notSearched, coverage.notSearched],[t.limitations, coverage.limitations]].map(([title, value]) => `<div><h3>${title}</h3>${list(value).length ? bulletList(value) : `<p class="muted">${t.empty}</p>`}</div>`).join("")}</div>`));
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(CSP)}"><meta name="referrer" content="no-referrer"><title>${e(data.title)} · Family Mind</title><style>${css}</style></head><body><header><div class="kicker">${t.brand}</div><h1>${e(data.title)}</h1><p class="subtitle">${t.subtitle}</p><div class="subtitle">${t.generated}: ${e(data.generatedAt)}</div></header><main><nav aria-label="${t.navigation}">${[["summary",t.summary],["family-story",t.familyStory],["gallery",t.gallery],["people",t.people],["sources",t.sources],["questions",t.questions],["coverage",t.coverage]].filter(([id]) => parts.some(p => p.startsWith(`<section id="${id}"`))).map(([id,title]) => `<a href="#${id}">${title}</a>`).join("")}</nav>${parts.join("")}<footer class="footer">${t.footer}</footer></main></body></html>`;
  if (Buffer.byteLength(html) > MAX_REPORT) throw new Error("REPORT_TOO_LARGE");
  return html;
}

async function main() {
  const args = process.argv.slice(2), flags = {};
  for (let i=0;i<args.length;i+=2) { if (!["--input","--output","--image-root"].includes(args[i]) || !args[i+1] || flags[args[i]]) throw new Error("USAGE: --input JSON --output HTML [--image-root DIRECTORY]"); flags[args[i]]=args[i+1]; }
  if (!flags["--input"] || !flags["--output"]) throw new Error("INPUT_AND_OUTPUT_REQUIRED");
  const output = path.resolve(flags["--output"]);
  if (path.extname(output) !== ".html" || inside(checkout, output)) throw new Error("OUTPUT_MUST_BE_HTML_OUTSIDE_CHECKOUT");
  // Validate the closest existing ancestor before mkdir; reject symlink escapes into checkout.
  let ancestor = path.dirname(output);
  while (true) { try { const actual = await realpath(ancestor); if (inside(await realpath(checkout), actual)) throw new Error("OUTPUT_IN_CHECKOUT"); break; } catch(error) { if (error.code !== "ENOENT") throw error; ancestor = path.dirname(ancestor); } }
  await mkdir(path.dirname(output), {recursive:true,mode:0o700});
  const parent = await realpath(path.dirname(output));
  if (inside(await realpath(checkout), parent)) throw new Error("OUTPUT_IN_CHECKOUT");
  try { if (!(await lstat(output)).isFile() || (await lstat(output)).isSymbolicLink()) throw new Error("UNSAFE_OUTPUT"); } catch(error) { if (error.code !== "ENOENT") throw error; }
  const data = JSON.parse((await boundedRead(path.resolve(flags["--input"]),4*1024*1024)).toString("utf8"));
  const html = await renderReport(data,{imageRoot:flags["--image-root"]});
  const temp = path.join(parent,`.report-${randomUUID()}.tmp`);
  try { const file = await open(temp,"wx",0o600); try { await file.writeFile(html); await file.sync(); } finally { await file.close(); } await rename(temp,output); } finally { await unlink(temp).catch(()=>undefined); }
  process.stdout.write(`Report generated: ${Buffer.byteLength(html)} bytes\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`Report failed: ${error instanceof Error && /^[A-Z_ :\[\]-]+$/.test(error.message) ? error.message : "INVALID_INPUT_OR_IO"}\n`); process.exitCode=1; });
