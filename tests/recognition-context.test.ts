import test from "node:test";
import assert from "node:assert/strict";
import { recognizeDocuments, automaticFill } from "../src/recognition";
import { createInitialState, updateCase } from "../src/domain";
import { makeDraft, emptyMaterials, parseDraft } from "../src/drafts";
import type { RecognitionDocument } from "../src/recognition-shared";
import { identityText, judgmentFirstPage, judgmentSecondPage } from "./recognition-fixtures";

const document = (material: RecognitionDocument["material"], ...texts: string[]): RecognitionDocument => ({ material, name: `虚构-${material}.pdf`, pages: texts.map((text, index) => ({ location: `第${index + 1}页`, text, method: "ocr", confidence: 96 })) });
const judgment = (...texts: string[]) => document("firstInstance", ...texts);
const fill = (texts: string[]) => automaticFill(createInitialState(), recognizeDocuments([judgment(...texts)]).candidates);

test("裁判文书加身份证明一次填入四组信息，诉称和代理人资料不串入", () => {
  const recognized = recognizeDocuments([judgment(judgmentFirstPage, judgmentSecondPage), document("identity", identityText)]);
  const state = automaticFill(createInitialState(), recognized.candidates);
  assert.deepEqual(state.caseData, { basisType: "民事判决书", court: "测试市第一人民法院", caseNumber: "（2026）测0101民初100号", effectiveDate: "2026-01-01", executionCourt: "",
    applicantName: "张三", applicantType: "自然人", applicantId: "990101199001010001", applicantPhone: "01012345678", applicantAddress: "测试市测试路一号",
    respondentName: "李四", respondentType: "自然人", respondentId: "990101198802020002", respondentAddress: "测试市测试路二号", assetClue: "", principal: "100000.00",
    requestSummary: `请求依法执行下列裁判主文确定的给付义务（请核对未履行范围）：\n${judgmentSecondPage.split("\n")[2].normalize("NFKC")}` });
  assert.equal(state.sources.applicantId?.material, "identity");
  assert.match(state.sources.applicantId!.quote, /张三/);
  assert.match(state.sources.applicantName!.location, /第1页.*第2页/);
  assert.ok(!state.caseData.requestSummary.includes("150000"));
  assert.ok(!state.caseData.requestSummary.includes("2300"));
  assert.ok(!state.caseData.requestSummary.includes("驳回"));
  assert.equal(state.caseConfirmedAt, null);
  assert.deepEqual(recognized.notices, []);
});
test("反向给付时原告是被执行人，原审及反诉括号不改变给付方向", () => {
  const header = "原告（反诉被告）：张三，男，住测试路一号。\n被告（反诉原告）：李四，女，住测试路二号。";
  const state = fill([header, "判决如下：\n一、原告张三向被告李四返还借款80000元。"]);
  assert.equal(state.caseData.applicantName, "李四"); assert.equal(state.caseData.respondentName, "张三"); assert.equal(state.caseData.principal, "80000.00");
  assert.equal(state.caseData.applicantAddress, "测试路二号");
});
test("真实OCR出现反诉角色括号前后空格及分项空格时仍正确匹配", () => {
  const state = fill(["原告 ( 反诉 被 告 ) : 张 三 ， 男 ， 住 测试 市 测试 路 一 号 。\n被 告 ( 反诉 原告 ) : 李 四 ， 男 ， 住 测试 市 测试 路 二 号 。\n本 院 认 为 ， 应 根据 反诉 审理 结果 确定 给 付 。\n判决 如 下 :\n一 、 原 告 张 三 向 被 告 李 四 返 还 借款 80000 元 。\n二 、 驱 回 其 他 诉讼 请 求 。"]);
  assert.equal(state.caseData.applicantName, "李四"); assert.equal(state.caseData.respondentName, "张三"); assert.equal(state.caseData.principal, "80000.00");
});
test("支付后接收款人、无冒号、分页换行和OCR空格均可匹配", () => {
  const state = fill(["原 告 张 三，男，住测试市\n测试路一号。\n被告李四，男，住测试市测试路二号。", "判决如下：\n一、被告李四支付原告张三货款", "12.34 万元。"]);
  assert.equal(state.caseData.applicantName, "张三"); assert.equal(state.caseData.principal, "123400.00");
  assert.equal(state.caseData.applicantAddress, "测试市测试路一号");
  assert.match(state.sources.principal!.location, /第2页.*第3页/);
});
test("主文仅用原告被告称谓时必须各唯一，不能按文字出现顺序猜测", () => {
  const header = "原告：张三，男。\n被告：李四，女。";
  const state = fill([header, "判决如下：\n被告应向原告支付货款900元。"]);
  assert.equal(state.caseData.applicantName, "张三"); assert.equal(state.caseData.respondentName, "李四");
  assert.equal(fill([`${header}\n被告：赵六，男。`, "判决如下：\n被告向原告支付货款900元。"]).caseData.applicantName, "");
});
test("公司和营业执照按名称匹配，法定代表人号码不能当公司号码", () => {
  const header = "原告：张三，男，住测试路一号。\n被告：测试科技有限公司，住所地测试市工业路十号。\n法定代表人：李四，身份证号码990101198802020002。";
  const license = "营业执照字段识别测试\n统一社会信用代码：990000000000000001\n名称：测试科技有限公司\n类型：有限责任公司\n住所：测试市工业路十号\n法定代表人：李四\n身份证号码：990101198802020002";
  const recognized = recognizeDocuments([judgment(header, "判决如下：\n一、测试科技有限公司向张三支付货款50000元。"), document("identity", license)]);
  const state = automaticFill(createInitialState(), recognized.candidates);
  assert.equal(state.caseData.respondentType, "法人或其他组织"); assert.equal(state.caseData.respondentName, "测试科技有限公司");
  assert.equal(state.caseData.respondentId, "990000000000000001"); assert.equal(state.caseData.respondentAddress, "测试市工业路十号");
});
test("OCR丢失被告标签时可用独立证照名称与主文全名对应，不臆造标签", () => {
  const header = "原告 : 张 三 ， 男 ， 住 测试 市 测试 路 一 号 。\nwe : 测试 科技 有 限 公 司 ， 住 所 地 测试 市 工业 路 十 号 。\n法 定 代表 人 : 李 四 ， 身 份 证 号 码 990101198802020002。\n本 院 认 为 ， 应 根据 查 明 事实 确定 给 付 。\n判决 如 下 :\n一 、 测 试 科技 有 限 公司 向 张 三 支 付 货款 50000 元 。";
  const license = "营业执照字段识别测试\n统一社会信用代码：990000000000000001\n名称：测试科技有限公司\n类型：有限责任公司\n住所：测试市工业路十号\n法定代表人：李四\n身份证号码：990101198802020002";
  const recognized = recognizeDocuments([judgment(header), document("identity", license)]);
  const state = automaticFill(createInitialState(), recognized.candidates);
  assert.equal(state.caseData.respondentName, "测试科技有限公司"); assert.equal(state.caseData.respondentId, "990000000000000001"); assert.equal(state.caseData.respondentAddress, "测试市工业路十号");
  assert.equal(state.caseData.principal, "50000.00"); assert.equal(state.caseData.applicantName, "张三");
  assert.equal(state.caseData.applicantAddress, "测试市测试路一号", "无法识别的主体标签不能让下一主体的地址归到原告");
  assert.equal(state.caseData.applicantType, "自然人");
});
test("调解书给付条款可形成请求，利息计算基数不重复变成本金", () => {
  const state = fill([judgmentFirstPage.replace("民事判决书", "民事调解书"), "双方自愿达成如下调解协议：\n一、李四向张三偿还借款本金50000元。\n二、李四向张三支付利息（以本金100000元为基数，按年利率4%计算）。\n案件受理费200元。"]);
  assert.equal(state.caseData.basisType, "民事调解书"); assert.equal(state.caseData.principal, "50000.00");
  assert.match(state.caseData.requestSummary, /本金100000元为基数/);
});
test("同一条款列出多项本金类金额时不只取第一个，也不擅自汇总", () => {
  const state = fill([judgmentFirstPage, "判决如下：\n一、李四向张三偿还借款本金100000元及货款50000元。"]);
  assert.equal(state.caseData.principal, ""); assert.match(state.caseData.requestSummary, /100000元及货款50000元/);
});
test("不同条款的同额给付不能合并成一项，无项目名的多金额也留待核对", () => {
  const result = recognizeDocuments([judgment(judgmentFirstPage, "判决如下：\n一、李四向张三偿还借款本金50000元。\n二、李四向张三支付货款50000元。")]);
  const state = automaticFill(createInitialState(), result.candidates);
  assert.equal(state.caseData.principal, ""); assert.match(state.caseData.requestSummary, /借款本金50000元/); assert.match(result.notices.join(""), /多项本金类给付/);
  assert.equal(fill([judgmentFirstPage, "判决如下：\n一、李四向张三支付50000元并返还20000元。"]).caseData.principal, "");
});
test("身份证同名匹配与独立身份证指定归属，不默认上传者一定是申请人", () => {
  const unmatched = recognizeDocuments([document("identity", identityText)]);
  assert.equal(automaticFill(createInitialState(), unmatched.candidates).caseData.applicantName, ""); assert.match(unmatched.notices.join(""), /未与唯一执行角色匹配/);
  const explicit = recognizeDocuments([document("identity", identityText)], { identityTarget: "applicant" });
  const state = automaticFill(createInitialState(), explicit.candidates);
  assert.equal(state.caseData.applicantName, "张三"); assert.equal(state.caseData.applicantId, "990101199001010001");
  assert.equal(state.caseData.respondentName, "");
});
test("身份不匹配、重名归属不明、多个主体与证件冲突不会强行归并", () => {
  const base = judgment(judgmentFirstPage, judgmentSecondPage);
  const wrong = recognizeDocuments([base, document("identity", identityText.replace("张三", "赵六"))]);
  assert.equal(automaticFill(createInitialState(), wrong.candidates).caseData.applicantId, ""); assert.match(wrong.notices.join(""), /赵六/);
  const prior = createInitialState(); prior.caseData.applicantName = prior.caseData.respondentName = "张三";
  assert.equal(automaticFill(prior, recognizeDocuments([document("identity", identityText)], { caseData: prior.caseData }).candidates).caseData.applicantId, "");
  const many = recognizeDocuments([document("identity", identityText, identityText.replaceAll("张三", "赵六").replace("990101199001010001", "990101199001010003"))], { identityTarget: "applicant" });
  assert.equal(automaticFill(createInitialState(), many.candidates).caseData.applicantName, "");
  const conflict = recognizeDocuments([base, document("identity", identityText, identityText.replace("990101199001010001", "990101199001010003"))]);
  assert.equal(automaticFill(createInitialState(), conflict.candidates).caseData.applicantId, "");
});
test("用户在OCR结束前更改姓名或主动清空，不将旧主体的证件、地址、请求填到新姓名下", () => {
  const recognized = recognizeDocuments([judgment(judgmentFirstPage, judgmentSecondPage), document("identity", identityText)]);
  let state = updateCase(createInitialState(), "applicantName", "用户新姓名");
  state = updateCase(state, "respondentAddress", "");
  const after = automaticFill(state, recognized.candidates);
  assert.equal(after.caseData.applicantName, "用户新姓名"); assert.equal(after.caseData.applicantId, ""); assert.equal(after.caseData.applicantAddress, "");
  assert.equal(after.caseData.principal, ""); assert.equal(after.caseData.requestSummary, ""); assert.equal(after.caseData.respondentAddress, "");
  const restored = parseDraft(JSON.stringify(makeDraft(after, emptyMaterials()))).state;
  assert.equal(automaticFill(restored, recognized.candidates).caseData.respondentAddress, "");
});
test("低分给付方向不能靠高分身份证绕过，低分姓名也不能挂高分号码", () => {
  const low = judgment(judgmentFirstPage, judgmentSecondPage); low.pages[1].confidence = 50;
  const data = automaticFill(createInitialState(), recognizeDocuments([low, document("identity", identityText)]).candidates).caseData;
  assert.equal(data.applicantName, ""); assert.equal(data.applicantId, ""); assert.equal(data.principal, "");
  const noConfidence = document("identity", identityText); noConfidence.pages[0].confidence = undefined;
  assert.equal(automaticFill(createInitialState(), recognizeDocuments([noConfidence], { identityTarget: "applicant" }).candidates).caseData.applicantId, "");
});
test("多人、双向给付、附条件担保和没有给付主文的案件不擅自生成单人执行请求", () => {
  for (const body of [
    "一、李四、赵六共同向张三支付100000元。",
    "一、李四向张三支付100000元。\n二、张三向李四返还借款20000元。",
    "一、李四向张三支付100000元。\n二、赵六对借款100000元承担连带清偿责任。",
    "一、李四向张三支付100000元。\n二、赵六对上述债务承担连带责任。",
    "一、若李四未履行，则赵六向张三支付100000元。",
    "一、驳回张三要求李四支付100000元的诉讼请求。",
  ]) {
    const recognized = recognizeDocuments([judgment(`${judgmentFirstPage.split("原告张三与")[0]}第三人：赵六，男。`, `判决如下：\n${body}`)]);
    const state = automaticFill(createInitialState(), recognized.candidates);
    assert.equal(state.caseData.applicantName, "", body); assert.equal(state.caseData.principal, "", body); assert.equal(state.caseData.requestSummary, "", body);
    assert.ok(recognized.notices.length);
  }
});
test("事实中的协议及被引用的旧判决不能当作当前裁判主文", () => {
  for (const body of ["双方未能达成调解协议。\n李四向张三支付100000元。", "双方达成如下还款协议：\n李四向张三支付100000元。", "一审判决如下：\n李四向张三支付100000元。\n本院认为，仍需查明事实。"] ) {
    const recognized = recognizeDocuments([judgment(judgmentFirstPage, body)]);
    assert.equal(automaticFill(createInitialState(), recognized.candidates).caseData.applicantName, "");
    assert.equal(automaticFill(createInitialState(), recognized.candidates).caseData.requestSummary, "");
  }
});
test("同名但证件号码不同的材料不能补入对方的新地址", () => {
  const before = createInitialState(); before.caseData.applicantName = "张三"; before.caseData.applicantId = "990101199001010099";
  const result = recognizeDocuments([document("identity", identityText.replace("测试市测试路一号", "另一主体的地址"))], { caseData: before.caseData });
  const after = automaticFill(before, result.candidates);
  assert.equal(after.caseData.applicantAddress, ""); assert.match(result.notices.join(""), /证件号码不一致/);
});
test("二审维持原判须案号与当事人共同对应，使用一审给付及二审执行依据信息", () => {
  const second = document("secondInstance", "测试市中级人民法院\n民事判决书\n（2026）测01民终200号\n上诉人（原审被告）：李四，男。\n被上诉人（原审原告）：张三，男。\n本院认为，一审（2026）测0101民初100号判决应当维持。\n判决如下：\n驳回上诉，维持原判。\n本判决为终审判决。");
  const recognized = recognizeDocuments([judgment(judgmentFirstPage, judgmentSecondPage), second]);
  const state = automaticFill(createInitialState(), recognized.candidates);
  assert.equal(state.caseData.caseNumber, "（2026）测01民终200号"); assert.equal(state.caseData.court, "测试市中级人民法院"); assert.equal(state.caseData.principal, "100000.00");
  assert.equal(state.caseData.effectiveDate, "", "二审作为执行依据时不能机械沿用一审生效日期");
  assert.equal(state.caseData.applicantName, "张三"); assert.match(recognized.notices.join(""), /维持原判/);
  assert.equal(automaticFill(createInitialState(), recognizeDocuments([second]).candidates).caseData.applicantName, "");
});
test("二审改判、案号不匹配或二审读取失败时不自动混用旧给付", () => {
  const first = judgment(judgmentFirstPage, judgmentSecondPage);
  const second = document("secondInstance", "上诉人（原审被告）：李四，男。\n被上诉人（原审原告）：张三，男。\n判决如下：\n一、撤销原审判决。\n二、李四向张三偿还借款80000元。");
  const changed = recognizeDocuments([first, second]);
  assert.equal(automaticFill(createInitialState(), changed.candidates).caseData.principal, ""); assert.match(changed.notices.join(""), /改判/);
  const failed = recognizeDocuments([first], { unreadSecondInstance: true });
  assert.equal(automaticFill(createInitialState(), failed.candidates).caseData.applicantName, ""); assert.match(failed.notices.join(""), /未读取成功/);
  const labeled = recognizeDocuments([judgment("申请执行人：张三\n被执行人：李四\n请求本金：100000元")], { unreadSecondInstance: true });
  assert.equal(automaticFill(createInitialState(), labeled.candidates).caseData.principal, "");
  assert.equal(automaticFill(createInitialState(), labeled.candidates).caseData.applicantName, "");
});
