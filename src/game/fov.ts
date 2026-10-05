import { TILE, type Grid } from '../core/grid';

/**
 * Campo de visão: uma célula é visível se está dentro do raio e nenhuma parede
 * bloqueia a linha reta (Bresenham) entre ela e o herói. Paredes em si são visíveis.
 */
export function computeFov(
  grid: Grid,
  px: number,
  py: number,
  radius: number,
  visible: Uint8Array,
  explored: Uint8Array,
): void {
  visible.fill(0);
  const r2 = radius * radius;
  for (let y = py - radius; y <= py + radius; y++) {
    for (let x = px - radius; x <= px + radius; x++) {
      if (!grid.inBounds(x, y)) continue;
      const dx = x - px;
      const dy = y - py;
      if (dx * dx + dy * dy > r2) continue;
      if (!lineOfSight(grid, px, py, x, y)) continue;
      const i = grid.index(x, y);
      visible[i] = 1;
      explored[i] = 1;
    }
  }
}

function lineOfSight(grid: Grid, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    if (x === x1 && y === y1) return true;
    if ((x !== x0 || y !== y0) && grid.get(x, y) === TILE.WALL) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}
