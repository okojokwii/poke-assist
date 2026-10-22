// 同時手番の損得の表（自分の手 × 相手の手、値は自分から見た点数）からナッシュ均衡を解く（DESIGN.md §5-3）。
// 零和として扱い、regret matching で近似する。10×10 程度なら数千回の反復で十分に収束する。

export interface NashResult {
  /** 自分の手ごとの確率 */
  row: number[];
  /** 相手の手ごとの確率 */
  col: number[];
  /** 均衡での自分の期待値 */
  value: number;
}

export function solveNash(matrix: number[][], iterations = 3000): NashResult {
  const R = matrix.length;
  const C = matrix[0]?.length ?? 0;
  if (R === 0 || C === 0) return { row: [], col: [], value: 0 };
  if (R === 1 || C === 1) return solveTrivial(matrix);
  const rowRegret = new Array<number>(R).fill(0);
  const colRegret = new Array<number>(C).fill(0);
  const rowSum = new Array<number>(R).fill(0);
  const colSum = new Array<number>(C).fill(0);
  const strategy = (regret: number[]) => {
    const pos = regret.map((r) => Math.max(0, r));
    const total = pos.reduce((a, b) => a + b, 0);
    return total > 0 ? pos.map((p) => p / total) : regret.map(() => 1 / regret.length);
  };
  for (let t = 0; t < iterations; t++) {
    const rs = strategy(rowRegret);
    const cs = strategy(colRegret);
    // 各手の期待値
    const rowU = matrix.map((r) => r.reduce((a, v, j) => a + v * cs[j]!, 0));
    const colU = Array.from({ length: C }, (_, j) => -matrix.reduce((a, r, i) => a + r[j]! * rs[i]!, 0));
    const rowV = rowU.reduce((a, u, i) => a + u * rs[i]!, 0);
    const colV = colU.reduce((a, u, j) => a + u * cs[j]!, 0);
    // regret matching+（負の後悔は 0 で切る）。後半ほど重く平均する
    for (let i = 0; i < R; i++) rowRegret[i] = Math.max(0, rowRegret[i]! + rowU[i]! - rowV);
    for (let j = 0; j < C; j++) colRegret[j] = Math.max(0, colRegret[j]! + colU[j]! - colV);
    for (let i = 0; i < R; i++) rowSum[i] = rowSum[i]! + rs[i]! * (t + 1);
    for (let j = 0; j < C; j++) colSum[j] = colSum[j]! + cs[j]! * (t + 1);
  }
  const norm = (v: number[]) => {
    const s = v.reduce((a, b) => a + b, 0);
    return v.map((x) => x / s);
  };
  const row = norm(rowSum);
  const col = norm(colSum);
  const value = matrix.reduce((a, r, i) => a + r.reduce((b, v, j) => b + v * row[i]! * col[j]!, 0), 0);
  return { row, col, value };
}

function solveTrivial(m: number[][]): NashResult {
  if (m.length === 1) {
    const r = m[0]!;
    const j = r.indexOf(Math.min(...r));
    return { row: [1], col: r.map((_, k) => (k === j ? 1 : 0)), value: r[j]! };
  }
  const colVals = m.map((r) => r[0]!);
  const i = colVals.indexOf(Math.max(...colVals));
  return { row: colVals.map((_, k) => (k === i ? 1 : 0)), col: [1], value: colVals[i]! };
}
