import type { WelfareProgram } from "@/lib/types";
import generated from "./welfare.generated.json";

// 실데이터: 공공데이터포털 중앙부처복지서비스(15090532) API에서 프리페치
// → scripts/fetch-welfare.mjs 로 생성한 welfare.generated.json
// (지원대상·선정기준·급여 = API 원문 / 쉬운말·할일·서류 = Claude 가공 / 판별규칙 = 큐레이션)
export const WELFARE = generated as unknown as WelfareProgram[];
