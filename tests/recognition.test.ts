import test from "node:test";
import assert from "node:assert/strict";
import { automaticFill, candidatesFromPages, normalizeRecognitionText } from "../src/recognition";
import { createInitialState, compute, currentResult, updateCase } from "../src/domain";
import { emptyMaterials, makeDraft, parseDraft } from "../src/drafts";
import { imageDimensions, readMaterial, validateFile, validateImageSize } from "../src/extraction";
import type { Candidate, CaseMaterialKey, TextPage } from "../src/types";

const page = (text: string, confidence = 95): TextPage => ({ location: "第2页（PDF OCR）", text, method: "ocr", confidence });
const candidates = (text: string, confidence = 95, material: CaseMaterialKey = "firstInstance") => candidatesFromPages([page(text, confidence)], material, "虚构OCR材料.pdf");
test("中文OCR的字间空格、全角标点和日期空格可结构化", () => {
  const recognized = candidates("测试 市 第 一 人 民法 院\n民事 判决 书\n( 2026 ) 测 0101 民 初 100 号\n申请 执行 人 : 张 三\n申请 人 联系 电话 : 01012345678\n被 执行 人 : 李 四\n生效 日 期 : 2026 年 1 月 1 日\n请求 本金 : 100,000.00 元");
  const state = automaticFill(createInitialState(), recognized);
  assert.equal(state.caseData.court, "测试市第一人民法院");
  assert.equal(state.caseData.caseNumber, "（2026）测0101民初100号");
  assert.equal(state.caseData.applicantName, "张三");
  assert.equal(state.caseData.respondentName, "李四");
  assert.equal(state.caseData.applicantPhone, "01012345678");
  assert.equal(state.caseData.effectiveDate, "2026-01-01");
  assert.equal(state.caseData.principal, "100000.00");
  assert.equal(state.caseData.executionCourt, "");
  assert.equal(state.caseConfirmedAt, null);
  assert.match(state.sources.applicantName!.quote, /张 三/);
  assert.equal(normalizeRecognitionText("ＡＢＣ：１２３"), "ABC:123");
});
test("自动填入保护手工值及主动清空的字段，保留原OCR来源", () => {
  const fromOcr = automaticFill(createInitialState(), candidates("申请执行人：张三\n请求本金：100000元"));
  const renamed = updateCase(fromOcr, "applicantName", "用户修改名");
  const cleared = updateCase(renamed, "principal", "");
  const after = automaticFill(cleared, candidates("申请执行人：李四\n请求本金：80000元"));
  assert.equal(after.caseData.applicantName, "用户修改名");
  assert.equal(after.caseData.principal, "");
  assert.equal(after.sources.applicantName?.value, "张三");
  assert.equal(after.userEdited.principal, true);
});
test("草稿往返保留主动清空与OCR分数，但不恢复已确认状态", () => {
  let state = automaticFill(createInitialState(), candidates("申请执行人：张三"));
  state = updateCase(state, "applicantName", "");
  const draft = makeDraft(state, emptyMaterials());
  const restored = parseDraft(JSON.stringify(draft)).state;
  assert.equal(restored.sources.applicantName?.method, "ocr");
  assert.equal(restored.sources.applicantName?.confidence, 95);
  assert.equal(restored.sources.applicantName?.value, "张三");
  assert.equal(restored.userEdited.applicantName, true);
  assert.equal(automaticFill(restored, candidates("申请执行人：李四")).caseData.applicantName, "");
});
test("兼容没有新增标记的v1.0草稿，已有值不被OCR覆盖", () => {
  const state = createInitialState(); state.caseData.applicantName = "旧草稿姓名";
  const draft = makeDraft(state, emptyMaterials());
  const json = JSON.parse(JSON.stringify(draft)); delete json.state.userEdited;
  const restored = parseDraft(JSON.stringify(json)).state;
  assert.equal(automaticFill(restored, candidates("申请执行人：张三")).caseData.applicantName, "旧草稿姓名");
});
test("较长的请求简述和财产线索来源可以保存并恢复", () => {
  const value = "仅供软件测试的虚构说明".repeat(40);
  const recognized = candidates(`请求事项简述：${value}\n财产线索：${value}`);
  const state = automaticFill(createInitialState(), recognized);
  const restored = parseDraft(JSON.stringify(makeDraft(state, emptyMaterials()))).state;
  assert.equal(restored.caseData.requestSummary, value);
  assert.equal(restored.sources.requestSummary?.value, value);
  assert.equal(restored.sources.assetClue?.value, value);
});
test("同一批次的一审二审冲突不自动填入，金额格式相同可合并", () => {
  const a = candidates("本金100000元\n申请执行人：张三");
  const b = candidates("本金80000元\n申请执行人：李四", 96, "secondInstance");
  const state = automaticFill(createInitialState(), [...a, ...b]);
  assert.equal(state.caseData.principal, ""); assert.equal(state.caseData.applicantName, "");
  const equal = automaticFill(createInitialState(), [...a, ...candidates("本金100000.00元", 96, "secondInstance")]);
  assert.equal(equal.caseData.principal, "100000");
});
test("低分数与缺失分数的OCR仅给候选，高分行不被全页均分误伤", () => {
  assert.equal(automaticFill(createInitialState(), candidates("本金100000元", 74)).caseData.principal, "");
  const low: TextPage = { location: "图片1", text: "本金100000元", method: "ocr" };
  assert.equal(automaticFill(createInitialState(), candidatesFromPages([low], "firstInstance", "虚构.png")).caseData.principal, "");
  const varied = { ...page("本金100000元", 40), lines: [{ text: "本金100000元", confidence: 96 }] };
  assert.equal(automaticFill(createInitialState(), candidatesFromPages([varied], "firstInstance", "虚构.png")).caseData.principal, "100000");
});
test("日期、金额和号码格式异常不会自动填入", () => {
  const recognized = candidates("生效日期：2026年2月30日\n本金1000000000000元\n申请人证件号码：123\n申请人联系电话：12");
  const state = automaticFill(createInitialState(), recognized);
  assert.ok(recognized.length >= 3);
  assert.ok(recognized.every(candidate => candidate.autoFill === false));
  assert.equal(state.caseData.effectiveDate, ""); assert.equal(state.caseData.principal, ""); assert.equal(state.caseData.applicantId, "");
});
test("不从原被告、上诉人或无归属证件推定执行角色", () => {
  const recognized = candidates("原告：张三\n被告：李四\n上诉人：王五\n被申请人：赵六\n姓名：张三\n住址：测试路一号\n公民身份号码：990101199001010001");
  assert.equal(recognized.length, 0);
});
test("明确的执行角色段落与独立标签可提取地址、号码和主体类型", () => {
  const state = automaticFill(createInitialState(), candidates("申请执行人：张三\n主体类型：自然人\n住址：虚构测试路一号\n证件号码：990101199001010001\n被执行人：测试公司\n被执行人类型：法人或其他组织\n被执行人已知地址：虚构测试路二号\n拟申请执行法院：测试市第二人民法院"));
  assert.equal(state.caseData.applicantAddress, "虚构测试路一号");
  assert.equal(state.caseData.applicantId, "990101199001010001");
  assert.equal(state.caseData.applicantType, "自然人");
  assert.equal(state.caseData.respondentType, "法人或其他组织");
  assert.equal(state.caseData.respondentAddress, "虚构测试路二号");
  assert.equal(state.caseData.executionCourt, "测试市第二人民法院");
});
test("诉称金额只保留候选，裁判主文中明确的本金可填入", () => {
  const claimed = candidates("原告诉称\n本金100000元\n本院认为\n本金90000元");
  assert.ok(claimed.every(candidate => candidate.autoFill === false));
  assert.equal(automaticFill(createInitialState(), claimed).caseData.principal, "");
  const ordered = candidates("判决如下\n被告偿还借款本金80000元");
  assert.equal(automaticFill(createInitialState(), ordered).caseData.principal, "80000");
});
test("万元换算保留精确金额，不从普通日期推定生效", () => {
  const state = automaticFill(createInitialState(), candidates("请求本金：12.34万元\n于2026年1月1日签订合同"));
  assert.equal(state.caseData.principal, "123400.00"); assert.equal(state.caseData.effectiveDate, "");
});
test("新识别值使旧确认失效且计算沿用同一本金", () => {
  const state = createInitialState(); state.caseData.principal = "100000";
  state.result = compute(state.caseData.principal, state.calculation); state.result.confirmedAt = "2026-01-01";
  state.caseConfirmedAt = state.outputConfirmedAt = "2026-01-01";
  const filled = automaticFill(state, candidates("申请执行人：张三"));
  assert.equal(filled.caseConfirmedAt, null); assert.equal(filled.outputConfirmedAt, null); assert.equal(currentResult(filled)?.confirmedAt, null);
  assert.equal(state.caseConfirmedAt, "2026-01-01", "不能就地修改之前的React状态");
});
test("来源和手工标记拒绝不合法类型或OCR分数", () => {
  const base = makeDraft(automaticFill(createInitialState(), candidates("申请执行人：张三")), emptyMaterials());
  for (const value of [-1, 101, "99", null]) {
    const draft = JSON.parse(JSON.stringify(base)); draft.state.sources.applicantName.confidence = value;
    assert.throws(() => parseDraft(JSON.stringify(draft)), /参考分数/);
  }
  const draft = JSON.parse(JSON.stringify(base)); draft.state.userEdited.applicantName = "true";
  assert.throws(() => parseDraft(JSON.stringify(draft)), /手工修改/);
});
test("新增图片格式、尺寸边界与JPEG/PNG/WebP头部校验", () => {
  for (const ext of ["jpg", "JPEG", "png", "webp", "bmp", "tif", "TIFF"]) assert.doesNotThrow(() => validateFile({ name: `虚构.${ext}`, size: 100 }));
  for (const ext of ["svg", "gif", "heic", "exe"]) assert.throws(() => validateFile({ name: `虚构.${ext}`, size: 100 }));
  for (const [w, h] of [[0, 10], [16001, 2], [5001, 5000], [Infinity, 5], [100, -10]]) assert.throws(() => validateImageSize(w, h));
  assert.doesNotThrow(() => validateImageSize(5000, 5000));
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]); const view = new DataView(png.buffer); view.setUint32(16, 1600); view.setUint32(20, 2100);
  assert.deepEqual(imageDimensions(png), { width: 1600, height: 2100 });
  assert.equal(imageDimensions(new Uint8Array([0, 1, 2])), null);
});
test("已取消或伪装图片的读取不启动OCR", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readMaterial(new File(["测试"], "虚构.png"), { signal: controller.signal }), { name: "AbortError" });
  await assert.rejects(readMaterial(new File(["<html>not an image</html>"], "虚构.png")), /格式无效/);
  await assert.rejects(readMaterial(new File(["not tiff"], "虚构.tiff")), /不是支持的TIFF/);
});
test("不接受超多候选，冲突时也不写入对象原型字段", () => {
  const many = candidates(Array.from({ length: 200 }, (_, n) => `申请人：虚构人员${n}`).join("\n"));
  assert.equal(many.length, 120);
  const unknown = { field: "__proto__", value: "unsafe", source: { material: "firstInstance", name: "虚构.txt", location: "行1", quote: "unsafe" } } as unknown as Candidate;
  const state = automaticFill(createInitialState(), [unknown]);
  assert.equal(Object.getPrototypeOf(state.caseData), Object.prototype);
});
