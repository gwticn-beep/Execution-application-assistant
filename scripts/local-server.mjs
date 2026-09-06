import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// This launcher serves only packaged static assets. It has no upload or case-data endpoint.
const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(root, "site");
const config = JSON.parse(await readFile(resolve(root, "headers.json"), "utf8"));
const port = Number(process.argv[2] ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("端口须为1024至65535之间的整数。");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".wasm": "application/wasm", ".png": "image/png", ".ttf": "font/ttf" };
const server = http.createServer(async (request, response) => {
  for (const header of config.headers[0].headers) response.setHeader(header.key, header.value);
  if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return; }
  try {
    const url = new URL(request.url, "http://localhost");
    const path = resolve(publicRoot, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
    if (!path.startsWith(publicRoot + sep) || !(await stat(path)).isFile()) { response.writeHead(404); response.end(); return; }
    const bytes = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] ?? "application/octet-stream", "Content-Length": bytes.length });
    response.end(request.method === "HEAD" ? undefined : bytes);
  } catch { response.writeHead(404); response.end(); }
});
server.on("error", error => { console.error(error.code === "EADDRINUSE" ? "端口已被占用，请尝试 node start.mjs 4177" : "本地服务启动失败，请检查运行目录与权限。"); process.exitCode = 1; });
server.listen(port, "127.0.0.1", () => console.log(`请在浏览器打开 http://127.0.0.1:${port}/ 。全部OCR资源均在本机；关闭本窗口或按 Ctrl+C 停止服务。`));
