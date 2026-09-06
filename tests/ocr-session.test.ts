import test from "node:test";
import assert from "node:assert/strict";
import { createOcr } from "../src/ocr";

type Reply = { id: number; type: string; pages?: unknown[]; message?: string };
class TestWorker {
  static instances: TestWorker[] = [];
  onmessage: ((event: { data: Reply }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  sent: { id: number; type: string }[] = [];
  terminated = false;
  constructor(readonly url: string) { TestWorker.instances.push(this); }
  postMessage(message: { id: number; type: string }) { this.sent.push(message); }
  terminate() { this.terminated = true; }
  reply(data: Reply) { this.onmessage?.({ data }); }
}
test("OCR会话取消、加载失败、过期响应及正常释放", async t => {
  const oldWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "Worker", { configurable: true, value: TestWorker });
  Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://localhost/app/" } });
  t.after(() => {
    if (oldWorker) Object.defineProperty(globalThis, "Worker", oldWorker); else Reflect.deleteProperty(globalThis, "Worker");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument); else Reflect.deleteProperty(globalThis, "document");
  });
  const controller = new AbortController();
  const loading = createOcr({ signal: controller.signal });
  const first = TestWorker.instances.at(-1)!;
  assert.equal(first.url, "http://localhost/app/ocr/runner.js");
  const aborted = assert.rejects(loading, { name: "AbortError" });
  controller.abort(); await aborted; assert.equal(first.terminated, true);
  first.reply({ id: 1, type: "ready" });

  const failing = createOcr({});
  const second = TestWorker.instances.at(-1)!;
  const failed = assert.rejects(failing, /OCR程序加载失败/);
  second.onerror?.({ preventDefault() {} }); await failed; assert.equal(second.terminated, true);

  const nextController = new AbortController();
  const starting = createOcr({ signal: nextController.signal });
  const third = TestWorker.instances.at(-1)!;
  third.reply({ id: 1, type: "ready" });
  const session = await starting;
  const recognizing = session.recognizeTiff(new ArrayBuffer(4));
  third.reply({ id: 1, type: "result", pages: [{ text: "过期响应" }] });
  third.reply({ id: 2, type: "result", pages: [{ text: "有效响应", location: "第1页" }] });
  assert.equal((await recognizing)[0].text, "有效响应");
  const pending = session.recognizeTiff(new ArrayBuffer(4));
  const canceled = assert.rejects(pending, { name: "AbortError" });
  nextController.abort(); await canceled; assert.equal(third.terminated, true);
  session.close();
});
