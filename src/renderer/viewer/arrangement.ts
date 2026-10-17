export interface GridCell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface Grid {
  columns: number;
  rows: number;
  cells: GridCell[];
}

const cell = (col: number, row: number, colSpan = 1, rowSpan = 1): GridCell => ({ col, row, colSpan, rowSpan });
const row = (n: number): Grid => ({ columns: n, rows: 1, cells: Array.from({ length: n }, (_, i) => cell(i, 0)) });
const column = (n: number): Grid => ({ columns: 1, rows: n, cells: Array.from({ length: n }, (_, i) => cell(0, i)) });
const bigLeft = (n: number): Grid => ({ columns: 2, rows: n - 1, cells: [cell(0, 0, 1, n - 1), ...Array.from({ length: n - 1 }, (_, i) => cell(1, i))] });

function evenGrid(count: number): Grid {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  return { columns, rows, cells: Array.from({ length: count }, (_, i) => cell(i % columns, Math.floor(i / columns))) };
}

function matrix(columns: number, rows: number): Grid {
  return { columns, rows, cells: Array.from({ length: columns * rows }, (_, i) => cell(i % columns, Math.floor(i / columns))) };
}

/** TradingView's multi-chart layout codes ("h" = charts side by side, "v" = stacked, "s" = one big chart plus small ones). */
const ARRANGEMENTS: Record<string, Grid> = {
  s: row(1),
  '2h': row(2),
  '2v': column(2),
  '2-1': { columns: 2, rows: 2, cells: [cell(0, 0), cell(1, 0), cell(0, 1, 2)] },
  '1-2': { columns: 2, rows: 2, cells: [cell(0, 0, 2), cell(0, 1), cell(1, 1)] },
  '3h': row(3),
  '3v': column(3),
  '3s': bigLeft(3),
  '3r': { columns: 2, rows: 2, cells: [cell(0, 0), cell(0, 1), cell(1, 0, 1, 2)] },
  '4': matrix(2, 2),
  '2-2': matrix(2, 2),
  '4h': row(4),
  '4v': column(4),
  '4s': bigLeft(4),
  '1-3': { columns: 3, rows: 2, cells: [cell(0, 0, 3), cell(0, 1), cell(1, 1), cell(2, 1)] },
  '5h': row(5),
  '5s': bigLeft(5),
  '6': matrix(3, 2),
  '6h': row(6),
  '7h': row(7),
  '8': matrix(4, 2),
  '8h': row(8),
};

/** Grid for a layout code. Unknown codes, or a chart count the code does not fit, get an even grid. */
export function arrangementGrid(code: string, count: number): Grid {
  const known = ARRANGEMENTS[code];
  if (known && known.cells.length === count) return known;
  return evenGrid(count);
}

export function applyGrid(container: HTMLElement, cells: HTMLElement[], grid: Grid): void {
  container.style.display = 'grid';
  container.style.gridTemplateColumns = `repeat(${grid.columns}, minmax(0, 1fr))`;
  container.style.gridTemplateRows = `repeat(${grid.rows}, minmax(0, 1fr))`;
  cells.forEach((el, i) => {
    const c = grid.cells[i];
    if (!c) return;
    el.style.gridColumn = `${c.col + 1} / span ${c.colSpan}`;
    el.style.gridRow = `${c.row + 1} / span ${c.rowSpan}`;
  });
}
