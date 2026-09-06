console.error("v1.1 的本地OCR需要独立的 Worker、WASM 和语言模型，不再生成单文件HTML。请运行 npm run build:offline 生成完整本地运行包，或 npm run build 后部署 dist/。已有 v1.0 文件不会被覆盖。");
process.exitCode = 1;
