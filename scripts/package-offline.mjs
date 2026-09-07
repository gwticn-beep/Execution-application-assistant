import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, unzipSync, strToU8 } from "fflate";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const files = {};
async function collect(directory, prefix) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name), key = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) await collect(path, key);
    else if (entry.isFile()) files[key] = new Uint8Array(await readFile(path));
  }
}
await collect(resolve(root, "dist"), "site");
for (const name of ["site/index.html", "site/ocr/runner.js", "site/ocr/worker.min.js", "site/ocr/lang/chi_sim.traineddata.gz", "site/ocr/lang/eng.traineddata.gz"]) assert.ok(files[name]?.length, `缺少资源：${name}`);
files["start.mjs"] = new Uint8Array(await readFile(resolve(root, "scripts/local-server.mjs")));
files["headers.json"] = new Uint8Array(await readFile(resolve(root, "vercel.json")));
files["README.txt"] = strToU8("执行申请材料助手 v1.1.1 本地运行包\n\n先安装 Node.js 22.12+ 或 24 LTS。解压本包，在该目录运行：\nnode start.mjs\n然后打开 http://127.0.0.1:4173/ 。端口冲突时可在命令末尾加空格和其他端口号。\n\n本包已包含网页、OCR程序和中英文模型，运行时不需要互联网。不要直接双击 site/index.html。服务器仅监听本机地址且仅提供静态文件，不接收案件材料。\n\nOCR、执行角色匹配及主文请求整理可能出错，所有字段仍须对照原件，且可自行修改。身份证明默认按姓名或名称匹配，也可在材料卡指定归属。案件仅在页面内存；关闭前保存草稿。导出文件含明文资料，请妥善保管。Word只是核对草稿，需由本人通过官方渠道提交。第三方许可证见 site/ocr/licenses 及各资源目录。\n");
const zipped = zipSync(files, { level: 6 });
const verified = unzipSync(zipped);
assert.deepEqual(Object.keys(verified).sort(), Object.keys(files).sort());
for (const [name, value] of Object.entries(files)) assert.deepEqual(verified[name], value, `压缩校验失败：${name}`);
const output = resolve(root, "output"); await mkdir(output, { recursive: true });
const path = resolve(output, "执行申请材料助手-v1.1.1-本地运行包.zip");
await writeFile(path, zipped);
console.log(JSON.stringify({ file: path, entries: Object.keys(files).length, bytes: zipped.length, verified: true }, null, 2));
