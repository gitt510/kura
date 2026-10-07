// detect.ts — redpen の入力選別 (pure)。card 化する prompt を選ぶ。
// 言語判定は持たない — ja / en / 混合の区別は LLM が断片ごとに付ける。

// card 化しない入力:
//   - 3 文字未満 (y / ok などの相槌)
//   - "<" 始まり (system-reminder / command 展開などの合成 message)
//   - "/" "!" 始まり (ingest 側でも落ちるが、旧 data に対する防御で二重に持つ)
export function shouldSkip(text: string): boolean {
  const head = text.trim();
  if (head.length < 3) return true;
  return head.startsWith("<") || head.startsWith("/") || head.startsWith("!");
}

// 長大な貼り付けは先頭だけを feedback 対象にする。
const CLIP_THRESHOLD = 3000;
const CLIP_LENGTH = 1500;

export function clipInput(text: string): { text: string; truncated: boolean } {
  if (text.length <= CLIP_THRESHOLD) return { text, truncated: false };
  return { text: text.slice(0, CLIP_LENGTH), truncated: true };
}
