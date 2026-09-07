import { centsText, moneyCents } from "./domain";
import { documentLines, evidenceCandidate, normalizeRecognitionText, type Evidence, type RecognitionDocument } from "./recognition-shared";
import type { Candidate, CaseData, IdentityTarget } from "./types";

type Role = "applicant" | "respondent";
type Detail = "Type" | "Id" | "Phone" | "Address";
type Value = { value: string; evidence: Evidence[] };
type Party = { name: string; evidence: Evidence[]; aliases: string[]; details: Partial<Record<Detail, Value[]>> };
type Clause = { text: string; evidence: Evidence[] };
type Obligation = Clause & { applicant: Party; respondent: Party; principal?: Value };
type Judgment = { document: RecognitionDocument; lines: Evidence[]; parties: Party[]; clauses: Clause[]; metadata: Candidate[]; hasDisposition: boolean };
export type RecognitionOptions = { caseData?: CaseData; identityTarget?: IdentityTarget; unreadSecondInstance?: boolean };

const LABEL = "申请执行人|被执行人|被上诉人|上诉人|再审申请人|被申请人|申请人|原告|被告|第三人";
const PARTY_HEADER = new RegExp(`^(${LABEL})\\s*(?:\\(\\s*([^)]{1,40})\\s*\\))?\\s*[:：]?\\s*([^,，;；。:：\\n]{1,80})`);
const DISPOSITION = /(?:判决|裁定)如下\s*[:：]?|达成(?:了)?如下(?:调解)?协议\s*[:：]?|(?:调解)?协议如下\s*[:：]?/;
const NUMBERED = /^(?:[一二三四五六七八九十百]+\s*[、.．]|\d+\s*、|\d+\s*[.．](?!\d)|\([一二三四五六七八九十\d]+\))\s*/;
const PROCEEDINGS = /诉讼请求|诉称|辩称|事实与理由|本院认为|本院查明|经审理查明|本案现已|本院于|向本院提出|一案[，,]/;
const AGENT = /^(?:委托(?:诉讼)?代理人|法定(?:代表人|代理人)|负责人|经营者|诉讼代表人|共同委托|指定代理人)/;
const FOOTER = /(?:如果|如|若)未按|未按本(?:判决|调解书)|案件受理费|诉讼费(?:共计|由|计|人民币)|如不服本|本(?:判决|裁定)为终审|审判长|审判员|人民陪审员|书记员|生效日期|附[:：]|附相关法律/;
const VERB = /支付|偿还|归还|返还|退还|给付|清偿|赔偿/;
const MONEY = /(?:人民币\s*)?([\d,，]+(?:\.\d{1,2})?)\s*(万)?[元圆]/;
const UNSUPPORTED = /连带|共同|分别|各自|相互|分期|抵销|抵扣|扣除|已偿还|已支付|已付|保证责任|担保责任|如果|若|(?:如|在).{0,20}(?:未能|不履行)|以.{0,30}为限/;

function spans(points: Evidence[], start: number, end: number) {
  let position = 0;
  return points.filter(point => { const from = position; position += point.text.length; return from < end && position > start; });
}
function values(points: Evidence[], pattern: RegExp, transform: (value: string) => string = value => value.trim()): Value[] {
  const text = points.map(point => point.text).join("");
  return [...text.matchAll(new RegExp(pattern.source, "g"))].slice(0, 10).map(match => ({ value: transform(match[1]), evidence: spans(points, match.index!, match.index! + match[0].length) })).filter(value => value.value);
}
function details(points: Evidence[]): Party["details"] {
  const text = points.map(point => point.text).join("");
  const ids = values(points, /(?:公民身份号码|居民身份证号码|身份证(?:件)?(?:号码|号)|证件号码|统一社会信用代码|注册号)\s*[:：]?\s*([\dA-Za-z*×][\dA-Za-z*× \t]{2,35})/, value => value.replace(/\s/g, "").toUpperCase());
  const addresses = values(points, /(?:^|[,，;；。])\s*(?:送达地址|住所地|住址|住所|地址|住)\s*[:：]?\s*(.+?)(?=[,，;；。]|(?:公民身份号码|身份证|统一社会信用代码|联系电话|手机号码|电话)\s*[:：]?|$)/);
  // A line wrap has no punctuation. This also handles standalone labels on an ID card.
  if (!addresses.length) addresses.push(...values(points, /(?:送达地址|住所地|住址|住所|地址)\s*[:：]?\s*(.+?)(?=[,，;；。]|公民身份号码|身份证|统一社会信用代码|联系电话|手机号码|电话|签发机关|有效期限|$)/));
  const phones = values(points, /(?:联系电话|联系方式|手机号码|手机号|电话)\s*[:：]?\s*([+\d()（）\- \t]{5,30})/);
  const types: Value[] = [];
  const explicit = values(points, /(?:主体类型|申请人类型|被执行人类型)\s*[:：]?\s*(自然人|法人或其他组织)/);
  types.push(...explicit);
  if (!types.length) {
    const company = /(?:有限责任公司|股份有限公司|有限公司|统一社会信用代码|企业法人|社会团体法人|事业单位法人)/.exec(text);
    const person = /(?:[,，;；]\s*[男女]\s*(?:[,，;；]|汉族|\d)|性别\s*[:：]?\s*[男女]|\d{4}\s*年.{1,8}出生|公民身份号码|居民身份证|身份证(?:件)?(?:号|号码))/.exec(text);
    const match = company ?? person;
    if (match) types.push({ value: company ? "法人或其他组织" : "自然人", evidence: spans(points, match.index, match.index + match[0].length) });
  }
  return { Id: ids, Address: addresses, Phone: phones, Type: types };
}
function partiesFromLines(lines: Evidence[]): Party[] {
  const parties: Party[] = [];
  let current: { name: string; aliases: string[]; points: Evidence[] } | undefined;
  const finish = () => { if (current) parties.push({ name: current.name, evidence: [current.points[0]], aliases: current.aliases, details: details(current.points) }); current = undefined; };
  for (const point of lines) {
    if (PROCEEDINGS.test(point.text) || DISPOSITION.test(point.text)) { finish(); break; }
    if (AGENT.test(point.text)) { finish(); continue; }
    const match = point.text.match(PARTY_HEADER);
    if (match && !/诉称|辩称|认为|主张|请求|诉讼|向本院|与被告|与原告|于.{0,20}起诉/.test(match[3])) {
      finish();
      const name = match[3].trim();
      if (name.length < 2 || /[、及与]|(?:姓名|名称|类型|地址|号码|电话)$/.test(name)) continue;
      // Colonless captions need a delimiter after the name, not a narrative sentence beginning with 原告.
      if (!/[:：]/.test(match[0]) && !/[,，;；。]/.test(point.text.slice(match[0].length, match[0].length + 1))) continue;
      current = { name, aliases: [...new Set([match[1], ...((match[2] ?? "").match(new RegExp(LABEL, "g")) ?? [])])], points: [point] };
    } else if (current && /^[^:：]{1,40}[:：]/.test(point.text) && !/^(?:主体类型|类型|性别|民族|出生|公民身份|证件|身份证|统一社会信用|送达地址|住所地|住址|住所|地址|联系|手机|电话)/.test(point.text)) {
      finish();
    } else if (current && current.points.length < 30) current.points.push(point);
  }
  finish();
  return parties.slice(0, 50);
}
function disposition(lines: Evidence[]): { clauses: Clause[]; found: boolean } {
  let beginning = -1, offset = 0;
  const mediation = lines.some(point => point.text === "民事调解书");
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].text.match(DISPOSITION);
    if (match && (mediation || /^(?:判决|裁定)/.test(match[0]))) { beginning = i; offset = match.index! + match[0].length; }
  }
  if (beginning < 0) return { clauses: [], found: false };
  const clauses: Clause[] = [];
  for (let i = beginning; i < lines.length && clauses.length < 60; i++) {
    const point = lines[i];
    let text = i === beginning ? point.text.slice(offset) : point.text;
    // A quoted prior decision followed by reasoning is not this document's final disposition.
    if (i > beginning && /本院认为|本院查明|经审理查明/.test(text)) return { clauses: [], found: false };
    const footer = text.search(FOOTER);
    if (footer >= 0) text = text.slice(0, footer);
    for (const fragment of text.split(/(?<=[;；。])(?=[一二三四五六七八九十\d]+[、.．])/)) {
      if (!fragment.trim()) continue;
      if (!clauses.length || NUMBERED.test(fragment) || /^驳回/.test(fragment) || /[。;；]$/.test(clauses[clauses.length - 1].text)) clauses.push({ text: fragment, evidence: [point] });
      else { const last = clauses[clauses.length - 1]; last.text += fragment; last.evidence.push(point); }
    }
    if (footer >= 0 || clauses.reduce((count, clause) => count + clause.text.length, 0) > 20000) break;
  }
  return { clauses, found: true };
}
function judgment(document: RecognitionDocument): Judgment {
  const lines = documentLines(document);
  const parties = partiesFromLines(lines);
  const parsed = disposition(lines);
  const metadata: Candidate[] = [];
  for (const point of lines.slice(0, 24)) {
    if (PARTY_HEADER.test(point.text) || PROCEEDINGS.test(point.text) || DISPOSITION.test(point.text)) break;
    const court = point.text.match(/^(?:(?:文书作出法院|作出法院|法院)[:：])?([\u3400-\u9fff]{2,35}人民法院)$/);
    const kind = point.text.match(/^民事(?:判决|裁定|调解)书$/);
    const number = point.text.match(/^[（(]\s*\d{4}\s*[）)]\s*[\u3400-\u9fff\d\s]{1,25}(?:民初|民终|民特|民再|执)\s*\d+\s*号$/);
    if (court && !metadata.some(candidate => candidate.field === "court")) metadata.push(evidenceCandidate("court", court[1], [point]));
    if (kind && !metadata.some(candidate => candidate.field === "basisType")) metadata.push(evidenceCandidate("basisType", kind[0], [point]));
    if (number && !metadata.some(candidate => candidate.field === "caseNumber")) metadata.push(evidenceCandidate("caseNumber", number[0].replace(/\s/g, "").replace("(", "（").replace(")", "）"), [point]));
  }
  return { document, lines, parties, clauses: parsed.clauses, hasDisposition: parsed.found, metadata };
}
function mentions(text: string, parties: Party[]) {
  const found: { party: Party; index: number }[] = [];
  const occupied: [number, number][] = [];
  const names = [...new Set(parties.map(party => party.name))].sort((a, b) => b.length - a.length);
  for (const name of names) {
    let start = 0, index: number;
    while ((index = text.indexOf(name, start)) >= 0) {
      start = index + name.length;
      if (occupied.some(([a, b]) => index < b && start > a)) continue;
      occupied.push([index, start]); found.push({ party: parties.find(party => party.name === name)!, index });
    }
  }
  if (!found.length) {
    for (const label of LABEL.split("|")) {
      const index = text.indexOf(label);
      const matching = parties.filter(party => party.aliases.includes(label));
      if (index >= 0 && new Set(matching.map(party => party.name)).size === 1 && !occupied.some(([a, b]) => index < b && index + label.length > a)) {
        found.push({ party: matching[0], index }); occupied.push([index, index + label.length]);
      }
    }
  }
  return found.filter((item, index) => found.findIndex(other => other.party.name === item.party.name) === index).sort((a, b) => a.index - b.index);
}
function principal(clause: Clause, afterVerb: string): Value | undefined {
  // Interest calculation bases, costs and totals are not a principal award.
  const pattern = /(?:借款本金|本金|货款|工程款|租金|欠款|借款|劳务费|服务费|赔偿款|赔偿金|补偿款|转让款|购房款)\s*[:：]?\s*(?:人民币\s*)?([\d,，]+(?:\.\d{1,2})?)\s*(万)?[元圆]/;
  const awards = [...afterVerb.matchAll(new RegExp(pattern.source, "g"))].filter(match => !/利息|违约金|诉讼费|受理费|律师费|以/.test(afterVerb.slice(0, match.index)));
  if (awards.length > 1) return undefined;
  let match = afterVerb.match(pattern);
  if (match && /利息|违约金|诉讼费|受理费|律师费|以/.test(afterVerb.slice(0, match.index))) return undefined;
  if (!match && !/利息|违约金|受理费|诉讼费|律师费|合计|总计|共计|为基数/.test(afterVerb)) {
    const amounts = [...afterVerb.matchAll(new RegExp(MONEY.source, "g"))];
    if (amounts.length === 1) match = amounts[0];
  }
  if (!match) return undefined;
  try {
    const cents = moneyCents(match[1].replace(/[,，]/g, "")) * (match[2] ? 10000n : 1n);
    if (cents <= 0n) return undefined;
    return { value: centsText(cents), evidence: clause.evidence };
  } catch { return undefined; }
}
function obligation(clause: Clause, parties: Party[]): Obligation | undefined {
  const text = clause.text.replace(NUMBERED, "");
  if (/驳回|不予支持|无需|无须|不支付|不承担|请求判令|诉讼请求/.test(text) || UNSUPPORTED.test(text)) return undefined;
  const verb = text.match(VERB);
  if (!verb || !MONEY.test(text)) return undefined;
  const before = text.slice(0, verb.index), after = text.slice(verb.index! + verb[0].length);
  const to = before.lastIndexOf("向");
  const debtors = mentions(to >= 0 ? before.slice(0, to) : before, parties);
  const recipients = mentions(to >= 0 ? before.slice(to + 1) : after, parties);
  if (debtors.length !== 1 || recipients.length !== 1 || debtors[0].index > 8 || debtors[0].party.name === recipients[0].party.name) return undefined;
  return { ...clause, applicant: recipients[0].party, respondent: debtors[0].party, principal: principal(clause, after) };
}
function identityParties(document: RecognitionDocument) {
  const lines = documentLines(document);
  const records: Party[] = [];
  let current: { name: string; point: Evidence; points: Evidence[] } | undefined;
  let prefix: Evidence[] = [];
  const finish = () => {
    if (!current) return;
    records.push({ name: current.name, aliases: [], evidence: [current.point], details: details(current.points) }); current = undefined;
  };
  for (const point of lines) {
    const named = point.text.match(/^(?:姓名|企业名称|单位名称|名称)\s*[:：]?\s*(.+?)(?=性别|民族|出生|住址|住所|统一社会信用代码|公民身份号码|[,，;；。]|$)/);
    if (named && named[1].trim().length >= 2 && named[1].length <= 80) {
      finish(); current = { name: named[1].trim(), point, points: [...prefix.filter(item => item.page === point.page), point] }; prefix = [];
    } else if (AGENT.test(point.text)) {
      // A representative's name/phone/ID must not become the company's or litigant's details.
      finish(); prefix = [];
    } else if (current && current.points.length < 40) current.points.push(point);
    else if (prefix.length < 15) prefix.push(point);
  }
  finish();
  return records.slice(0, 30);
}
function partyCandidates(party: Party, role: Role, proof: Evidence[], explanation: string): Candidate[] {
  const requires = { [`${role}Name`]: party.name };
  const result = [evidenceCandidate(`${role}Name`, party.name, [...party.evidence, ...proof], true, explanation)];
  for (const field of ["Type", "Id", "Phone", "Address"] as const) {
    if (field === "Phone" && role === "respondent") continue;
    for (const value of party.details[field] ?? []) result.push(evidenceCandidate(`${role}${field}` as keyof CaseData, value.value, [...value.evidence, ...party.evidence, ...proof], true, explanation, requires));
  }
  return result;
}
function roleValue(candidates: Candidate[], options: RecognitionOptions, role: Role) {
  const existing = options.caseData?.[`${role}Name`]?.trim();
  if (existing) return { name: existing, proof: [] as Evidence[] };
  const names = candidates.filter(candidate => candidate.field === `${role}Name`);
  if (new Set(names.map(candidate => candidate.value)).size !== 1 || !names.some(candidate => candidate.autoFill !== false)) return undefined;
  return { name: names[0].value, proof: [] as Evidence[] };
}

export function enrichRecognition(documents: RecognitionDocument[], labeled: Candidate[], options: RecognitionOptions = {}) {
  let candidates = [...labeled];
  const notices: string[] = [];
  const identitiesByDocument = new Map(documents.filter(document => document.material === "identity").map(document => [document, identityParties(document)]));
  const judgments = documents.filter(document => document.material !== "identity").map(judgment);
  const judicialFields = (field: keyof CaseData) => /^(?:applicant|respondent)/.test(field) || field === "principal" || field === "requestSummary";
  for (const item of judgments) {
    // Once actual party captions exist, use the operative section; factual allegations cannot compete with an award.
    if (item.parties.some(party => party.aliases.some(alias => ["原告", "被告", "上诉人", "被上诉人"].includes(alias)))) {
      candidates = candidates.filter(candidate => candidate.source.material !== item.document.material || !judicialFields(candidate.field) || candidate.field === "principal" && !item.hasDisposition)
        .map(candidate => candidate.source.material === item.document.material && candidate.field === "principal" ? { ...candidate, autoFill: false, reason: "尚未定位裁判主文，请核对本金是否属于判决支持的金额。" } : candidate);
    }
    if (item.metadata.length) {
      const metadataFields = new Set(item.metadata.map(candidate => candidate.field));
      candidates = candidates.filter(candidate => candidate.source.material !== item.document.material || !metadataFields.has(candidate.field));
      candidates.push(...item.metadata);
    }
  }
  const first = judgments.find(item => item.document.material === "firstInstance");
  const second = judgments.find(item => item.document.material === "secondInstance");
  let active = second ?? first;
  let permitted = !options.unreadSecondInstance;
  let appealProof: Evidence[] = [];
  if (options.unreadSecondInstance) notices.push("二审材料尚未读取成功，未自动采用一审的执行角色、金额或请求；请先补齐二审材料。");
  if (second) {
    const text = second.clauses.map(clause => clause.text).join("");
    if (/撤销|变更|改判|发回|再审|部分维持/.test(text)) {
      permitted = false; notices.push("二审主文涉及撤销、改判或发回等变化，需人工核对最终给付内容；未自动混用一、二审请求。");
    } else if (/驳回上诉[，,。;；\s]*维持原判/.test(text)) {
      const firstNumber = first?.metadata.find(candidate => candidate.field === "caseNumber")?.value;
      const referenced = firstNumber && normalizeRecognitionText(second.lines.map(point => point.text).join("")).replace(/\s/g, "").replaceAll("(", "（").replaceAll(")", "）").includes(firstNumber);
      const sameParties = first && new Set(first.parties.map(party => party.name)).size >= 2 && first.parties.every(party => second.parties.some(other => other.name === party.name));
      if (referenced && sameParties && first) {
        active = first; appealProof = second.clauses.flatMap(clause => clause.evidence);
        const secondFields = new Set(second.metadata.map(candidate => candidate.field));
        candidates = candidates.filter(candidate => candidate.source.material !== "firstInstance" || !secondFields.has(candidate.field));
        candidates = candidates.filter(candidate => candidate.source.material !== "firstInstance" || candidate.field !== "effectiveDate");
        notices.push("已将二审“维持原判”与一审案号及当事人对应，给付条款来自一审；不沿用一审标注的生效日期，生效、履行情况仍需您核对。");
      } else { permitted = false; notices.push("二审仅写明维持原判，但尚未与一审案号和双方姓名匹配；请补齐对应一审材料后核对。"); }
    } else if (first) { permitted = false; notices.push("同时存在一、二审材料，尚不能确定两份给付条款的对应关系；请人工核对最终执行请求。"); }
  }
  if (!permitted) candidates = candidates.map(candidate => candidate.source.material !== "identity" && judicialFields(candidate.field)
    ? { ...candidate, autoFill: false, reason: "二审材料或最终给付关系尚未核对，不自动采用该值。" } : candidate);
  let mapped: { applicant: string; respondent: string; proof: Evidence[] } | undefined;
  const roleParties = [...(active?.parties ?? [])];
  // OCR may lose a procedural caption while preserving the name in the operative text.
  // An independently labeled identity name can still be matched literally to that text; never repair the lost role by guessing.
  for (const identity of [...identitiesByDocument.values()].flat()) if (!roleParties.some(party => party.name === identity.name)) roleParties.push(identity);
  if (active && roleParties.length) {
    const payable = active.clauses.filter(clause => VERB.test(clause.text) && MONEY.test(clause.text) && !/^.*?驳回/.test(clause.text));
    const obligations = payable.map(clause => obligation(clause, roleParties));
    const valid = obligations.filter((item): item is Obligation => Boolean(item));
    const pairs = new Set(valid.map(item => `${item.applicant.name}\u0000${item.respondent.name}`));
    const complexClause = active.clauses.some(clause => !/驳回/.test(clause.text) && UNSUPPORTED.test(clause.text));
    const ambiguous = !permitted || complexClause || obligations.some(item => !item) || pairs.size !== 1 || !valid.length;
    if (!ambiguous) {
      const pair = valid[0];
      const proof = [...pair.evidence, ...appealProof];
      mapped = { applicant: pair.applicant.name, respondent: pair.respondent.name, proof };
      const explanation = "按裁判主文明确的收款人／付款人对应，待您核对未履行范围。";
      for (const role of ["applicant", "respondent"] as const) {
        for (const party of roleParties.filter(party => party.name === pair[role].name)) candidates.push(...partyCandidates(party, role, proof, explanation));
      }
      const requires = { applicantName: pair.applicant.name, respondentName: pair.respondent.name };
      const principalItems = valid.filter(item => item.principal);
      if (principalItems.length === 1) {
        const item = principalItems[0];
        candidates.push(evidenceCandidate("principal", item.principal!.value, [...item.principal!.evidence, ...pair.applicant.evidence, ...pair.respondent.evidence, ...appealProof], true, "取自裁判主文给付金额，不采用诉讼请求金额，不计算利息。", requires));
      } else if (principalItems.length > 1) notices.push("主文存在多项本金类给付，未只取其中一项或自动相加；请核对未履行范围后填写本金。");
      const summary = `请求依法执行下列裁判主文确定的给付义务（请核对未履行范围）：\n${valid.map(item => item.text).join("\n")}`;
      if (summary.length <= 4000) candidates.push(evidenceCandidate("requestSummary", summary, [...valid.flatMap(item => item.evidence), ...pair.applicant.evidence, ...pair.respondent.evidence, ...appealProof], true, "由原主文整理的可编辑请求草稿，未另加金额或计息规则。", requires));
      else notices.push("给付主文超过请求简述长度上限，请人工整理，系统未截断后自动填入。");
      if (!valid.some(item => item.principal)) notices.push("已识别收付款双方及给付条款，但未找到可直接作为本金的确定金额，请补充核对。");
    } else if (permitted) {
      notices.push(!active.hasDisposition ? "已识别当事人段落，但尚未定位明确的裁判主文；不会仅按原告、被告名称决定执行角色。" : "给付关系涉及多人、多方向、附条件或尚未识别清楚，未自动指定单一申请人、被执行人及请求，请对照主文核对。");
    }
  } else if (active?.hasDisposition) {
    notices.push("已定位裁判主文，但尚未识别出可对应的当事人姓名段落；请查看OCR原文或换用更清晰的材料，仍可直接手工填写。");
  }
  for (const document of documents.filter(item => item.material === "identity")) {
    const identities = identitiesByDocument.get(document)!;
    if (!identities.length) { notices.push("身份证明中尚未识别出姓名／名称；请查看原文、换清晰图片或手工填写。"); continue; }
    for (const identity of identities) {
      const target = options.identityTarget ?? "auto";
      const matches = (["applicant", "respondent"] as const).filter(role => roleValue(candidates, options, role)?.name === identity.name);
      const role = target === "auto" ? matches.length === 1 ? matches[0] : undefined : new Set(identities.map(item => item.name)).size === 1 ? target : undefined;
      if (!role) { notices.push(`身份证明“${identity.name}”未与唯一执行角色匹配。可在材料卡选择归属后重新识别；含多个主体时请分别核对。`); continue; }
      const expected = roleValue(candidates, options, role)?.name;
      if (expected && expected !== identity.name) { notices.push(`身份证明姓名“${identity.name}”与已填写的${role === "applicant" ? "申请人" : "被执行人"}“${expected}”不同，未自动串填。`); continue; }
      const existingId = options.caseData?.[`${role}Id`]?.trim();
      const knownIds = existingId ? [existingId] : candidates.filter(candidate => candidate.field === `${role}Id` && candidate.autoFill !== false).map(candidate => candidate.value);
      const identityIds = identity.details.Id?.map(value => value.value) ?? [];
      if (knownIds.length && identityIds.some(id => knownIds.some(known => known !== id))) {
        notices.push(`身份证明“${identity.name}”与文书或已填信息的证件号码不一致；即使同名也未自动串填，请核对是否为同一主体。`);
        candidates.push(...partyCandidates(identity, role, [], "证件号码存在冲突，需人工确认是否同一主体。").map(candidate => ({ ...candidate, autoFill: false })));
        continue;
      }
      const proof = mapped?.[role] === identity.name ? mapped.proof : [];
      candidates.push(...partyCandidates(identity, role, proof, target === "auto" ? "身份证明姓名／名称与执行角色一致，证件号码和地址仍需对照原件。" : "按您选择的身份证明归属填入，待对照裁判文书核对。"));
    }
  }
  // Keep a bounded review surface without letting repeated pages push useful identity fields out of the list.
  const seen = new Set<string>();
  candidates = candidates.filter(candidate => {
    const key = `${candidate.field}\u0000${candidate.value}\u0000${candidate.source.material}\u0000${candidate.source.location}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  }).slice(0, 360);
  return { candidates, notices: [...new Set(notices)] };
}
