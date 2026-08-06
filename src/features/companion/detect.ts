// detect.ts — companion の入力判定 (pure)。card 化する prompt の選別と ja/en 判定。

// ひらがな / カタカナが 1 文字でもあれば ja。漢字のみの短文は稀なので en に倒す
// (誤判定しても「より自然な en」が返るだけで壊れない)。
export function detectLang(text: string): "ja" | "en" {
  return /[぀-ヿ]/.test(text) ? "ja" : "en";
}

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
