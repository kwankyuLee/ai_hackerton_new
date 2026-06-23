// 공공데이터포털 중앙부처복지서비스 → 실데이터 프리페치 → welfare.generated.json
// 실행: node scripts/fetch-welfare.mjs  (프로젝트 루트에서)
import fs from "fs";

// .env.local 로드
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const KEY = env.DATA_GO_KR_KEY;
const ANTHROPIC = env.ANTHROPIC_API_KEY;
const MODEL = env.ANTHROPIC_MODEL || "claude-opus-4-8";
const BASE = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001";

// 우리가 큐레이션한 실직 관련 복지 + 판별 규칙(criteriaRules)·생애사건 태그
const TARGETS = [
  { servId: "WLF00003180", lifeEvents: ["실직", "위기"], category: ["생계", "위기"], criteriaRules: { incomePctMax: 75, crisisRequired: true } },
  { servId: "WLF00003245", lifeEvents: ["실직", "구직"], category: ["일자리"], criteriaRules: { incomePctMax: 60, jobSeeking: true } },
  { servId: "WLF00001132", lifeEvents: ["실직", "저소득"], category: ["생계"], criteriaRules: { incomePctMax: 32 } },
  { servId: "WLF00003201", lifeEvents: ["실직", "저소득"], category: ["주거"], criteriaRules: { incomePctMax: 48 } },
  { servId: "WLF00001089", lifeEvents: ["실직", "저소득"], category: ["교육"], criteriaRules: { incomePctMax: 50, needsChild: true } },
  { servId: "WLF00003179", lifeEvents: ["실직", "위기"], category: ["의료", "위기"], criteriaRules: { crisisRequired: true } },
];

const clean = (s) =>
  (s || "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
const pick = (xml, tag) => clean((xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1]);

async function fetchDetail(servId) {
  const url = `${BASE}/NationalWelfaredetailedV001?serviceKey=${encodeURIComponent(KEY)}&callTp=D&servId=${servId}`;
  const xml = await (await fetch(url)).text();
  const applyMethods = [...xml.matchAll(/<servSeDetailLink>([\s\S]*?)<\/servSeDetailLink>/g)].map((m) => clean(m[1]));
  return {
    servNm: pick(xml, "servNm"),
    jurMnofNm: pick(xml, "jurMnofNm"),
    target: pick(xml, "tgtrDtlCn"),
    criteria: pick(xml, "slctCritCn"),
    benefit: pick(xml, "alwServCn"),
    outline: pick(xml, "wlfareInfoOutlCn"),
    contact: pick(xml, "rprsCtadr"),
    applyMethod: [...new Set(applyMethods)].join(" / "),
  };
}

// Claude로 실제 공문 텍스트 → 쉬운말 + 할 일 + 필요서류 추정 (원시 REST, 실패 시 폴백)
async function makeEasy(d) {
  const fallback = {
    easy: d.outline || d.target.slice(0, 100),
    todo: ["가까운 주민센터나 해당 기관(129 등)에 문의하기"],
    documents: ["신분증"],
  };
  if (!ANTHROPIC) return fallback;
  try {
    const prompt = `아래는 정부 복지서비스 공식 안내야. 어르신도 이해할 쉬운말로 바꿔줘.
서비스명: ${d.servNm}
지원대상: ${d.target}
선정기준: ${d.criteria}
서비스내용: ${d.benefit}
신청방법: ${d.applyMethod}

아래 JSON만 출력(설명 금지):
{"easy":"무엇을 도와주는지 2~3문장 쉬운말","todo":["사용자가 지금 할 일 1~3개"],"documents":["신청 시 필요한 서류 추정 1~4개"]}`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error("anthropic HTTP " + res.status);
    const data = await res.json();
    const txt = data.content?.[0]?.text || "";
    const m = txt.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : fallback;
  } catch (e) {
    console.log(`(쉬운말 생성 실패: ${e.message} → 폴백) `);
    return fallback;
  }
}

const out = [];
for (const t of TARGETS) {
  process.stdout.write(`· ${t.servId} 받는 중... `);
  const d = await fetchDetail(t.servId);
  const e = await makeEasy(d);
  out.push({
    id: t.servId,
    name: d.servNm,
    category: t.category,
    lifeEvents: t.lifeEvents,
    summary: d.outline || e.easy,
    target: d.target,
    criteria: d.criteria,
    criteriaRules: t.criteriaRules,
    benefit: d.benefit,
    applyMethod: d.applyMethod,
    documents: e.documents || [],
    deadline: t.criteriaRules.crisisRequired ? "위기상황 발생 시 상시" : "상시",
    contact: d.contact || "보건복지상담센터 129",
    law: "",
    sourceUrl: `https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId=${t.servId}`,
    easyCache: { easy: e.easy, todo: e.todo || [] },
    jurMnofNm: d.jurMnofNm,
  });
  console.log(`OK (${d.servNm})`);
}

fs.writeFileSync("src/data/welfare.generated.json", JSON.stringify(out, null, 2));
console.log(`\n✅ welfare.generated.json 저장 완료: ${out.length}건`);
