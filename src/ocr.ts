import type { ReadProgress, TextPage } from "./types";

export type ReadOptions = { signal?: AbortSignal; onProgress?: (progress: ReadProgress) => void };
export const abortError = () => new DOMException("已取消识别，本次结果没有自动填入。", "AbortError");
export function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
export function resourceUrl(path: string) { return new URL(`ocr/${path}`, document.baseURI).href; }

export async function createOcr(options: ReadOptions) {
  throwIfAborted(options.signal);
  if (typeof Worker === "undefined" || typeof WebAssembly === "undefined") throw new Error("当前浏览器不支持本地OCR，请使用新版Chrome、Edge、Firefox或Safari。");
  const worker = new Worker(resourceUrl("runner.js"));
  let sequence = 0;
  let closed = false;
  let pending: { id: number; resolve: (pages: TextPage[]) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>; totalTimer: ReturnType<typeof setTimeout> } | null = null;
  const close = (reason: Error = abortError()) => {
    if (closed) return;
    closed = true;
    worker.terminate(); options.signal?.removeEventListener("abort", abort);
    if (pending) { clearTimeout(pending.timer); clearTimeout(pending.totalTimer); pending.reject(reason); pending = null; }
  };
  const abort = () => close();
  const expire = () => close(new Error("OCR加载或本页识别超时，请检查网络、降低图片尺寸或拆分文件后重试。"));
  const perPageMs = 120000;
  worker.onerror = event => { event.preventDefault(); close(new Error("OCR程序加载失败。请重新加载页面或检查静态资源是否完整；案件文件未上传。")); };
  worker.onmessage = ({ data }: MessageEvent<{ id: number; type: string; message: string; progress?: number; page?: number; total?: number; pages?: TextPage[] }>) => {
    if (closed || !pending || data.id !== pending.id) return;
    if (data.type === "progress") options.onProgress?.({ message: data.message, progress: data.progress });
    else if (data.type === "page-done") {
      clearTimeout(pending.timer); pending.timer = setTimeout(expire, perPageMs);
      options.onProgress?.({ message: `已完成TIFF第${data.page}/${data.total}页`, progress: data.page! / data.total! });
    } else if (data.type === "error") close(new Error(data.message));
    else if (data.type === "ready" || data.type === "result") {
      clearTimeout(pending.timer); clearTimeout(pending.totalTimer);
      const resolve = pending.resolve; pending = null; resolve(data.pages ?? []);
    }
  };
  options.signal?.addEventListener("abort", abort, { once: true });
  const request = (type: string, bytes?: ArrayBuffer, location?: string) => {
    throwIfAborted(options.signal);
    if (closed || pending) return Promise.reject(new Error("OCR会话已结束或仍在处理上一页，请重试。"));
    return new Promise<TextPage[]>((resolve, reject) => {
      const id = ++sequence;
      pending = { id, resolve, reject, timer: setTimeout(expire, perPageMs), totalTimer: setTimeout(expire, 15 * 60 * 1000) };
      worker.postMessage({ id, type, bytes, location }, bytes ? [bytes] : []);
    });
  };
  try { await request("init"); } catch (error) { close(); throw error; }
  return { recognize: async (blob: Blob, location: string) => (await request("recognize", await blob.arrayBuffer(), location))[0],
    recognizeTiff: (bytes: ArrayBuffer) => request("tiff", bytes), close };
}
