// provenance.ts — 生成物に stamp する生成元 (model / effort)。
//
// orchestrator が agent の公開出力または invocation の明示指定値から作る。
// 取れない値は null に倒す (表示側で省略/"-" にする)。

export interface Provenance {
  model: string | null;
  effort: string | null;
}

// 自動経路用の provenance。agent の公開出力または invocation の明示指定値を包む。
// effort は自動判定値を取らず、呼び手が明示指定値を取得できた場合だけ保持する。
export function runProvenance(model: string | null, effort: string | null = null): Provenance {
  return { model, effort };
}
