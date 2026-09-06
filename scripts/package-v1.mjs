import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");
const output = resolve(root, "..", "执行申请材料助手-v1.0-离线版.html");
let html = await readFile(resolve(dist, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
const styles = [...html.matchAll(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="([^"]+)"[^>]*>/g)];
assert.equal(scripts.length, 1); assert.equal(styles.length, 1);
assert.ok(!html.includes('rel="modulepreload"'));
async function asset(name) {
  assert.ok(!/^(?:https?:)?\/\//.test(name));
  const path = resolve(dist, name.replace(/^\//, ""));
  assert.ok(path.startsWith(dist + sep));
  return readFile(path, "utf8");
}
const [js, css] = await Promise.all([asset(scripts[0][1]), asset(styles[0][1])]);
assert.ok(!/@import|url\(\s*['"]?(?!data:)[^\s'"\)]/.test(css), "CSS仍引用外部资源");
html = html.replace(scripts[0][0], () => `<script type="module">${js.replace(/<\/script/gi, "<\\/script")}</script>`);
html = html.replace(styles[0][0], () => `<style>${css.replace(/<\/style/gi, "<\\/style")}</style>`);
// Single-file mode has no case-data network channel, including from embedded workers.
html = html.replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\' blob:; style-src \'unsafe-inline\'; img-src data: blob:; worker-src blob:; connect-src \'none\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'" />');
html = html.replace("<body>", '<body><noscript>请使用启用JavaScript的现代桌面浏览器打开本工具。</noscript>');
assert.ok(!/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="(?:stylesheet|modulepreload)"/.test(html));
await writeFile(output, html, "utf8");
console.log(JSON.stringify({ file: output, bytes: Buffer.byteLength(html), sha256: createHash("sha256").update(html).digest("hex") }, null, 2));
