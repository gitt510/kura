// glance.ts — glance widget が git の出力を読む純粋関数。git を呼ぶのは register.tsx。

import type { FileKind, FileRow } from "../types";

export type Numstat = { added: number; removed: number };

// `git diff --numstat HEAD` の行を path ごとの数に。binary は 0 / 0。
export function parseNumstat(text: string): Map<string, Numstat> {
  const out = new Map<string, Numstat>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const [added, removed, ...rest] = line.split("\t");
    let path = rest.join("\t");
    // rename は "old => new" か "dir/{old => new}/file"
    const brace = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/);
    if (brace) path = `${brace[1]}${brace[3]}${brace[4]}`;
    else if (path.includes(" => ")) path = path.split(" => ")[1] ?? path;
    out.set(path, {
      added: added === "-" ? 0 : Number(added),
      removed: removed === "-" ? 0 : Number(removed),
    });
  }
  return out;
}

// `git status --porcelain` の行を { path, kind } に。rename は新しい path を残す。
export function parseStatus(text: string): { path: string; kind: FileKind }[] {
  const out: { path: string; kind: FileKind }[] = [];
  for (const line of text.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    let path = line.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ")[1] ?? path;
    let kind: FileKind = "changed";
    if (x === "?" || x === "A") kind = "added";
    else if (x === "D" || y === "D") kind = "deleted";
    out.push({ path, kind });
  }
  return out;
}

// status と numstat を row にまとめる。preview は読み直すまで前の row のものを残す。
export function joinRows(
  status: { path: string; kind: FileKind }[],
  numstat: Map<string, Numstat>,
  untrackedLines: Map<string, number>,
  previous: FileRow[],
): FileRow[] {
  const before = new Map(previous.map((row) => [row.path, row]));
  return status.map(({ path, kind }) => {
    const counts = numstat.get(path);
    const old = before.get(path);
    return {
      path,
      kind,
      added: counts?.added ?? untrackedLines.get(path) ?? 0,
      removed: counts?.removed ?? 0,
      preview: old?.preview ?? "",
      more: old?.more ?? 0,
    };
  });
}

export const PREVIEW_LINES = 7;

const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

// unified diff の最初の hunk を max 行 (context 込み) に切り、@@ header を数え直したものと、
// diff 全体のうち入らなかった変更行の数。
export function previewOf(diff: string, max = PREVIEW_LINES): { preview: string; more: number } {
  const lines = diff.split("\n");
  const isChange = (line: string) =>
    (line.startsWith("+") || line.startsWith("-")) &&
    !line.startsWith("+++") &&
    !line.startsWith("---");
  const total = lines.filter(isChange).length;
  const at = lines.findIndex((line) => line.startsWith("@@"));
  const head = at < 0 ? null : (lines[at] ?? "").match(HUNK);
  if (!head) return { preview: "", more: total };
  const body: string[] = [];
  for (const line of lines.slice(at + 1)) {
    if (line.startsWith("@@") || body.length >= max) break;
    if (line.startsWith("\\")) continue;
    if (line.startsWith(" ") || line.startsWith("+") || line.startsWith("-")) {
      body.push(line.replace(/\t/g, "  "));
    } else break;
  }
  // 切った hunk の後ろの context は何も言わない: 落とす。
  while (body.at(-1)?.startsWith(" ")) body.pop();
  if (body.length === 0) return { preview: "", more: total };
  const before = body.filter((line) => !line.startsWith("+")).length;
  const after = body.filter((line) => !line.startsWith("-")).length;
  const kept = body.filter(isChange).length;
  return {
    preview: [`@@ -${head[1]},${before} +${head[2]},${after} @@`, ...body].join("\n"),
    more: total - kept,
  };
}

export type PreviewLine = { number: number; mark: " " | "+" | "-"; text: string };

// previewOf が作った hunk を 1 行ずつ、その行の番号付きで (- は旧い側、それ以外は新しい側)。
export function previewLines(preview: string): PreviewLine[] {
  const [head, ...body] = preview.split("\n");
  const match = head?.match(HUNK);
  if (!match) return [];
  let old = Number(match[1]);
  let now = Number(match[2]);
  const out: PreviewLine[] = [];
  for (const line of body) {
    const mark = line[0] as " " | "+" | "-";
    const text = line.slice(1);
    if (mark === "-") out.push({ number: old++, mark, text });
    else if (mark === "+") out.push({ number: now++, mark, text });
    else {
      out.push({ number: now, mark: " ", text });
      old++;
      now++;
    }
  }
  return out;
}
