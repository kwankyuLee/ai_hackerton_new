// 서버 전용: 공공데이터포털 중앙부처복지서비스(15090532) 실시간 클라이언트
// in-memory 캐시로 트래픽(100건/일) 보호
const KEY = process.env.DATA_GO_KR_KEY?.trim();
const BASE = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001";

export interface Candidate {
  servId: string;
  servNm: string;
  summary: string;
}
export interface Detail extends Candidate {
  jurMnofNm: string;
  target: string;
  criteria: string;
  benefit: string;
  applyMethod: string;
  contact: string;
}

const listCache = new Map<string, Candidate[]>();
const detailCache = new Map<string, Detail>();

const clean = (s?: string) =>
  (s || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();
const pick = (xml: string, tag: string) =>
  clean((xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1]);

export function hasDataKey() {
  return !!KEY;
}

// 인증키를 항상 올바른 URL 인코딩 1회만 적용 (디코딩/인코딩 키 둘 다 허용)
function svcKey(k: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(k));
  } catch {
    return encodeURIComponent(k);
  }
}

/** 실시간 목록조회 (키워드 검색) */
export async function searchWelfareLive(keyword: string): Promise<Candidate[]> {
  if (!KEY) throw new Error("no_data_key");
  if (listCache.has(keyword)) return listCache.get(keyword)!;

  const url = `${BASE}/NationalWelfarelistV001?serviceKey=${svcKey(KEY)}&callTp=L&srchKeyCode=001&pageNo=1&numOfRows=8&searchWrd=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const xml = await res.text();
  if (res.status === 429 || /quota|LIMITED_NUMBER|EXCEEDS/i.test(xml)) throw new Error("한도초과(429)");
  if (res.status === 403 || /Forbidden/i.test(xml)) throw new Error("권한거부(403·키확인)");
  if (res.status === 401 || /Unauthorized/i.test(xml)) throw new Error("인증실패(401·키확인)");
  if (res.status !== 200) throw new Error("HTTP " + res.status);
  const items: Candidate[] = [...xml.matchAll(/<servList>([\s\S]*?)<\/servList>/g)].map((m) => ({
    servId: (m[1].match(/<servId>(.*?)<\/servId>/) || [])[1] || "",
    servNm: clean((m[1].match(/<servNm>(.*?)<\/servNm>/) || [])[1]),
    summary: clean((m[1].match(/<servDgst>([\s\S]*?)<\/servDgst>/) || [])[1]),
  }));
  listCache.set(keyword, items);
  return items;
}

/** 실시간 상세조회 (자격조건) */
export async function getDetailLive(servId: string): Promise<Detail> {
  if (!KEY) throw new Error("no_data_key");
  if (detailCache.has(servId)) return detailCache.get(servId)!;

  const url = `${BASE}/NationalWelfaredetailedV001?serviceKey=${svcKey(KEY)}&callTp=D&servId=${servId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  const xml = await res.text();
  const applyMethods = [...xml.matchAll(/<servSeDetailLink>([\s\S]*?)<\/servSeDetailLink>/g)].map(
    (m) => clean(m[1])
  );
  const d: Detail = {
    servId,
    servNm: pick(xml, "servNm"),
    jurMnofNm: pick(xml, "jurMnofNm"),
    summary: pick(xml, "wlfareInfoOutlCn"),
    target: pick(xml, "tgtrDtlCn"),
    criteria: pick(xml, "slctCritCn"),
    benefit: pick(xml, "alwServCn"),
    applyMethod: [...new Set(applyMethods)].join(" / "),
    contact: pick(xml, "rprsCtadr"),
  };
  detailCache.set(servId, d);
  return d;
}
