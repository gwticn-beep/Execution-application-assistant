import test from "node:test";
import assert from "node:assert/strict";
import { caseErrors, compute, createInitialState, currentResult, outputIssues, updateCase, updateScope, validDate } from "../src/domain";
import { emptyMaterials, makeDraft, parseDraft } from "../src/drafts";
import { candidatesFromPages, readMaterial, validateFile } from "../src/extraction";
import { applicationBlocks, buildDocx, buildPackage, safeFilename } from "../src/outputs";
import { unzipSync, strFromU8 } from "fflate";
import type { AppState } from "../src/types";
const fixed = { mode: "fixed" as const, annualRate: "3.45", startDate: "2026-01-01", endDate: "2026-06-30", basisNote: "虚构验算数据" };
function readyState(): AppState {
  const s = createInitialState();
  s.scopeAnswers = { basis: true, money: true, partialPerformed: false, effectiveConfirmed: true, complex: false };
  s.caseData = { basisType: "民事判决书", court: "测试市甲区人民法院", executionCourt: "测试市乙区人民法院", caseNumber: "（2026）测0101民初100号", effectiveDate: "2026-01-01", applicantType: "自然人", applicantName: "虚构测试甲", applicantId: "", applicantPhone: "01000000000", applicantAddress: "仅供测试的虚构地址", respondentType: "法人或其他组织", respondentName: "虚构测试乙公司", respondentId: "", respondentAddress: "", assetClue: "", principal: "100000.00", requestSummary: "核对草稿中只整理虚构测试本金。" };
  s.calculation = fixed;
  s.result = compute(s.caseData.principal, fixed, "2026-09-05T00:00:00Z");
  s.result.confirmedAt = s.caseConfirmedAt = s.outputConfirmedAt = "2026-09-05T00:00:00Z";
  return s;
}
test("首次无预填案件，前四题待主动回答，第5题否", () => {
  const s = createInitialState(); assert.equal(s.scopeAnswers.complex, false); assert.equal(s.scopeAnswers.basis, null);
  assert.ok(Object.values(s.caseData).every(v => v === "")); assert.equal(s.result, null); assert.ok(outputIssues(s).length > 10);
});
for (const [principal, annualRate, interest, total] of [["100000", "3.45", "1710.82", "101710.82"], ["125000", "4.2", "2603.42", "127603.42"]]) {
  test(`公式样例 ${principal} / ${annualRate}`, () => {
    const result = compute(principal, { ...fixed, annualRate }); assert.equal(result.days, 181); assert.equal(result.interest, interest); assert.equal(result.total, total);
  });
}
test("同日起止0利率、闰日、跨夏令时", () => {
  assert.equal(compute("100000", { ...fixed, annualRate: "0", endDate: fixed.startDate }).total, "100000.00");
  assert.equal(compute("100", { ...fixed, startDate: "2024-02-28", endDate: "2024-03-01" }).days, 3);
  assert.equal(compute("100", { ...fixed, startDate: "2026-03-07", endDate: "2026-03-09" }).days, 3);
});
test("真实日期和金额精度拒绝无效输入", () => {
  for (const d of ["2026-02-29", "2026-13-01", "2026-04-31", "", "2026-1-01", "0099-01-01"]) assert.equal(validDate(d), false);
  assert.equal(validDate("2024-02-29"), true);
  for (const p of ["", " ", "-1", "NaN", "Infinity", "1e3", "01", "1.001", "1000000000000"]) assert.throws(() => compute(p, fixed));
  for (const rate of ["", "-1", "101", "1.1234567", "1e2"]) assert.throws(() => compute("100", { ...fixed, annualRate: rate }));
  assert.throws(() => compute("100", { ...fixed, startDate: "2026-06-30", endDate: "2026-01-01" }));
});
test("小数以分精确舍入且无初始假合计", () => {
  assert.equal(compute("0.01", { ...fixed, annualRate: "100", startDate: "2026-01-01", endDate: "2026-12-31" }).interest, "0.01");
  assert.equal(compute("0", fixed).total, "0.00"); assert.ok(caseErrors({ ...readyState().caseData, principal: "0" }).principal);
});
test("本金同源，上游修改使金额与导出确认失效", () => {
  const s = readyState(); assert.deepEqual(outputIssues(s), []);
  const changed = updateCase(s, "principal", "125000"); assert.equal(currentResult(changed), null); assert.ok(outputIssues(changed).length >= 3);
  const renamed = updateCase(s, "applicantName", "手工修改甲"); assert.equal(renamed.caseConfirmedAt, null); assert.equal(renamed.result?.confirmedAt, null);
});
test("第五题允许继续材料整理，但不放行复杂自动计息", () => {
  const s = readyState(); s.scopeAnswers.complex = true;
  assert.ok(outputIssues(s).some(x => x.includes("复杂情形")));
  s.calculation = { ...fixed, mode: "principal" }; s.result = compute(s.caseData.principal, s.calculation); s.result.confirmedAt = "2026-09-05";
  assert.deepEqual(outputIssues(s), []);
  assert.equal(updateScope(s, "partialPerformed", true).outputConfirmedAt, null);
});
test("导航不能绕过统一输出校验", async () => { await assert.rejects(buildDocx(createInitialState())); });
test("草稿v2往返，伪造合计与确认被忽略", () => {
  const d = makeDraft(readyState(), emptyMaterials()); d.state.result!.total = "999999999.00";
  const loaded = parseDraft(JSON.stringify(d));
  assert.equal(loaded.state.result!.total, "101710.82"); assert.equal(loaded.state.result!.confirmedAt, null); assert.equal(loaded.state.caseConfirmedAt, null);
  assert.equal(loaded.state.caseData.executionCourt, "测试市乙区人民法院"); assert.equal(loaded.state.scopeAnswers.basis, true);
});
test("恢复不持有原文件，只还原索引", () => {
  const d = makeDraft(readyState(), emptyMaterials()); d.materials.firstInstance = { name: "测试.pdf", size: 100 };
  const m = parseDraft(JSON.stringify(d)).materials.firstInstance!; assert.equal(m.file, null); assert.equal(m.status, "index");
});
test("旧草稿迁移不补演示值、不信旧本金副本", () => {
  const s = readyState(); const data = { ...s.caseData } as Partial<typeof s.caseData>; delete data.executionCourt; delete data.applicantName;
  const imported = parseDraft(JSON.stringify({ version: 1, caseData: data, calculation: { ...fixed, principal: "1", total: -1 }, checklist: {} }));
  assert.equal(imported.state.caseData.applicantName, ""); assert.equal(imported.state.caseData.executionCourt, ""); assert.equal(imported.state.result?.principal, "100000.00"); assert.equal(imported.state.scopeAnswers.basis, null);
});
test("无效或恶意草稿不被导入", () => {
  const d = makeDraft(readyState(), emptyMaterials());
  for (const text of ["{", "[]", "null", JSON.stringify({ ...d, version: 99 }), JSON.stringify({ ...d, state: [] })]) assert.throws(() => parseDraft(text));
  for (const value of [55, null, [], { html: "x" }]) assert.throws(() => parseDraft(JSON.stringify({ ...d, state: { ...d.state, caseData: { ...d.state.caseData, applicantName: value } } })));
  assert.throws(() => parseDraft(JSON.stringify({ ...d, state: { ...d.state, caseData: { ...d.state.caseData, effectiveDate: "2026-02-30" } } })));
  assert.throws(() => parseDraft(" ".repeat(1024 * 1024 + 1)));
});
test("不从原被告推定执行角色、不把普通日期当生效日", () => {
  const candidates = candidatesFromPages([{ location: "第1页", text: "原告：虚构甲\n被告：虚构乙\n于2026年1月1日签订合同\n本金100000元\n生效日期：2026年2月1日" }], "firstInstance", "测试.pdf");
  assert.ok(!candidates.some(c => c.field === "applicantName" || c.field === "respondentName"));
  assert.deepEqual(candidates.filter(c => c.field === "effectiveDate").map(c => c.value), ["2026-02-01"]);
  assert.equal(candidates.find(c => c.field === "principal")?.source.location, "第1页");
});
test("一审二审不同值独立保留来源", () => {
  const a = candidatesFromPages([{ location: "第1页", text: "民事判决书\n测试市甲区人民法院\n（2026）测0101民初100号\n本金100000元" }], "firstInstance", "一审.pdf");
  const b = candidatesFromPages([{ location: "第2页", text: "本金80000元" }], "secondInstance", "二审.pdf");
  assert.equal(a.find(c => c.field === "principal")?.value, "100000"); assert.equal(b[0].value, "80000"); assert.equal(b[0].source.material, "secondInstance");
});
test("文件容量、扩展名和路径处理", () => {
  assert.throws(() => validateFile({ name: "bad.exe", size: 2 })); assert.throws(() => validateFile({ name: "a.pdf", size: 0 })); assert.throws(() => validateFile({ name: "a.pdf", size: 20 * 1024 * 1024 + 1 }));
  assert.ok(!safeFilename("../../a\\b.txt").includes("/"));
});
test("真实UTF-8文本读取保留行号，并拒绝错误编码与空白文本", async () => {
  const pages = await readMaterial(new File(["测试市甲区人民法院\n\n本金100000元\n"], "虚构材料.txt"));
  assert.deepEqual(pages, [{ location: "第1行", text: "测试市甲区人民法院" }, { location: "第3行", text: "本金100000元" }]);
  await assert.rejects(readMaterial(new File([new Uint8Array([0xff, 0xfe, 0x61])], "错误编码.txt")), /编码/);
  await assert.rejects(readMaterial(new File([" \n\t"], "空白.txt")), /没有可读取/);
});
test("法院分离、请求和金额映射、文书包可打开", async () => {
  const s = readyState(); const blocks = applicationBlocks(s);
  assert.ok(blocks.some(b => b.text === "此致\n测试市乙区人民法院")); assert.ok(!blocks.some(b => b.text === "此致\n测试市甲区人民法院"));
  const bytes = await buildDocx(s); assert.ok(bytes.length > 1000);
  const unpacked = unzipSync(bytes);
  const xml = strFromU8(unpacked["word/document.xml"]); assert.ok(xml.includes("101710.82")); assert.ok(xml.includes(s.caseData.applicantName)); assert.ok(xml.includes("核对草稿"));
  const styles = strFromU8(unpacked["word/styles.xml"]);
  for (const style of ["Title", "Heading1"]) assert.equal(styles.match(new RegExp(`w:styleId="${style}"`, "g"))?.length, 1, `${style} 应只有一个定义，避免不同编辑器采用不同样式`);
  const pkg = unzipSync(await buildPackage(s, emptyMaterials(), false)); assert.equal(Object.keys(pkg).length, 5); assert.ok(pkg["01_执行申请书核对草稿.docx"]);
});
