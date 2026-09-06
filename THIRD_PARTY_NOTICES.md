# 第三方组件说明

以下版本以 package-lock.json 和构建时复制出的 ocr/versions.json 为准。软件与模型在用户设备中运行，不向下列项目或其作者发送案件材料。

| 组件 | 当前版本 | 包声明的许可证 | 用途与来源 |
| --- | --- | --- | --- |
| Tesseract.js | 7.0.0 | Apache-2.0 | [浏览器 OCR](https://github.com/naptha/tesseract.js) |
| tesseract.js-core | 7.0.0 | Apache-2.0 | [Tesseract WASM 引擎](https://github.com/naptha/tesseract.js-core) |
| @tesseract.js-data/chi_sim、eng | 各 1.0.0 | MIT（npm 包元数据声明） | [语言资源](https://github.com/naptha/tessdata)，使用包中的 4.0.0_best_int 压缩模型 |
| PDF.js | 6.3.289 | Apache-2.0 | [PDF 页面渲染](https://github.com/mozilla/pdf.js) |
| UTIF.js | 3.1.0 | MIT | [多页 TIFF 解码](https://github.com/photopea/UTIF.js) |
| pako | 由 UTIF 的锁定依赖提供 | MIT / Zlib，见随包 LICENSE | [TIFF 压缩数据解码](https://github.com/nodeca/pako) |
| docx | 9.7.1 | MIT | [生成可编辑 Word](https://github.com/dolanmiu/docx) |
| fflate | 0.8.3 | MIT | [ZIP 及 DOCX 容器处理](https://github.com/101arrowz/fflate) |
| React、React DOM | 19.2.8 | MIT | [界面与状态管理](https://github.com/facebook/react) |

构建脚本复制 OCR 引擎、PDF.js、UTIF、pako 的原始许可证到 `ocr/licenses/`，并保留语言包元数据。PDF 辅助字体、CMap、WASM 的许可证保留在各自资源目录。完整依赖版权与使用条件以各包原始 LICENSE、NOTICE 及上游资源声明为准；此表不替代原始许可证。

开发和构建时从 npm 安装锁定依赖；用户运行时使用本网站或本地运行包提供的副本，不从公共 CDN 动态拉取 OCR 代码或模型。
