// terminal.ts — dependency-free ANSI paint と box table renderer。

type Paint = {
  bold(text: string): string;
  dim(text: string): string;
  red(text: string): string;
  green(text: string): string;
  yellow(text: string): string;
  cyan(text: string): string;
};

export type Row = readonly string[];
export type CellFormatter = (
  paddedCell: string,
  rawCell: string,
  rowIndex: number,
  columnIndex: number,
) => string;

export function createPaint(enabled: boolean): Paint {
  const wrap = (open: number, close: number) => (text: string): string =>
    enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  };
}

const colorEnabled = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
export const paint = createPaint(colorEnabled);

export function renderTable(
  headers: Row,
  rows: readonly Row[],
  formatCell?: CellFormatter,
): string {
  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => row[columnIndex]?.length ?? 0)),
  );
  const horizontal = (left: string, middle: string, right: string): string =>
    left + widths.map((width) => "─".repeat(width + 2)).join(middle) + right;
  const output = [horizontal("┌", "┬", "┐")];

  const renderRow = (row: Row, rowIndex: number, header = false): void => {
    const cells = row.map((rawCell, columnIndex) => {
      const padded = ` ${rawCell.padEnd(widths[columnIndex]!)} `;
      if (header) return paint.bold(padded);
      return formatCell?.(padded, rawCell, rowIndex, columnIndex) ?? padded;
    });
    output.push(`│${cells.join("│")}│`);
  };

  renderRow(headers, -1, true);
  output.push(horizontal("├", "┼", "┤"));
  rows.forEach((row, rowIndex) => {
    renderRow(row, rowIndex);
    if (rowIndex < rows.length - 1) output.push(horizontal("├", "┼", "┤"));
  });
  output.push(horizontal("└", "┴", "┘"));
  return output.join("\n");
}

export function stateColor(raw: string, text: string): string {
  if (raw === "READY" || raw === "PRESENT" || raw === "ENABLED") {
    return paint.green(text);
  }
  if (raw === "MISSING" || raw === "NOT CREATED") return paint.yellow(text);
  if (raw === "UNEXPECTED" || raw === "ERROR") return paint.red(text);
  if (raw === "DISABLED" || raw === "-") return paint.dim(text);
  return text;
}
