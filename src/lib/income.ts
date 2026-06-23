import type { IncomeBand } from "@/lib/types";

// 기준 중위소득 100% (월, 원) — 2026 근사치 [가정]
// ⚠️ 실제 운영 시 보건복지부 고시값으로 대체 필요
const MEDIAN_INCOME: Record<number, number> = {
  1: 2_400_000,
  2: 3_930_000,
  3: 5_020_000,
  4: 6_090_000,
  5: 7_110_000,
  6: 8_100_000,
};

// 소득 구간 대표값 (월, 원)
const BAND_REPRESENTATIVE: Record<IncomeBand, number> = {
  none: 0,
  under100: 500_000,
  "100to200": 1_500_000,
  "200to300": 2_500_000,
  over300: 3_500_000,
};

export const INCOME_BAND_LABEL: Record<IncomeBand, string> = {
  none: "소득이 거의 없음",
  under100: "월 100만원 이하",
  "100to200": "월 100~200만원",
  "200to300": "월 200~300만원",
  over300: "월 300만원 이상",
};

/** 가구 소득을 기준 중위소득 대비 %로 추정 (근사) */
export function estimateIncomePct(band: IncomeBand, householdSize: number): number {
  const size = Math.min(Math.max(householdSize, 1), 6);
  const median = MEDIAN_INCOME[size];
  const income = BAND_REPRESENTATIVE[band];
  return Math.round((income / median) * 100);
}
