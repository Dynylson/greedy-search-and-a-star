/**
 * Espaço de estados do problema.
 *
 * Estado: uma célula (x, y) transitável do grid.
 * Ações:  mover para cima, direita, baixo ou esquerda (4-vizinhança).
 * Custo:  custo de ENTRAR na célula de destino — chão = 1, lama = 3, parede = ∞.
 *
 * As células são endereçadas por um índice linear i = y * largura + x,
 * o que permite usar arrays tipados (rápidos) nos algoritmos de busca.
 */
export const TILE = {
  WALL: 0,
  FLOOR: 1,
  MUD: 2,
} as const;

export type Tile = (typeof TILE)[keyof typeof TILE];

export const TILE_COST: Readonly<Record<Tile, number>> = {
  [TILE.WALL]: Infinity,
  [TILE.FLOOR]: 1,
  [TILE.MUD]: 3,
};

export interface Point {
  x: number;
  y: number;
}

/** Deslocamentos das 4 ações, em ordem fixa (N, L, S, O) para a busca ser determinística. */
const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export class Grid {
  readonly tiles: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    tiles?: Uint8Array,
  ) {
    this.tiles = tiles ?? new Uint8Array(width * height); // tudo parede
  }

  get size(): number {
    return this.width * this.height;
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  xOf(i: number): number {
    return i % this.width;
  }

  yOf(i: number): number {
    return (i / this.width) | 0;
  }

  pointOf(i: number): Point {
    return { x: this.xOf(i), y: this.yOf(i) };
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  get(x: number, y: number): Tile {
    return this.tiles[this.index(x, y)] as Tile;
  }

  set(x: number, y: number, tile: Tile): void {
    this.tiles[this.index(x, y)] = tile;
  }

  isPassable(i: number): boolean {
    return this.tiles[i] !== TILE.WALL;
  }

  /** Custo da ação de entrar na célula i. */
  costOf(i: number): number {
    return TILE_COST[this.tiles[i] as Tile];
  }

  /**
   * Escreve em `out` os vizinhos transitáveis de i e devolve quantos são.
   * Reaproveitar o array evita alocação dentro do laço da busca.
   */
  neighbors(i: number, out: number[]): number {
    const x = i % this.width;
    const y = (i / this.width) | 0;
    let count = 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d];
      const ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
      const n = ny * this.width + nx;
      if (this.tiles[n] !== TILE.WALL) out[count++] = n;
    }
    return count;
  }

  clone(): Grid {
    return new Grid(this.width, this.height, this.tiles.slice());
  }

  /**
   * Monta um grid a partir de texto: '#' parede, '~' lama, qualquer outro caractere é chão.
   * Útil para mapas desenhados à mão e testes.
   */
  static fromRows(rows: readonly string[]): Grid {
    const height = rows.length;
    const width = Math.max(...rows.map((r) => r.length));
    const grid = new Grid(width, height);
    rows.forEach((row, y) => {
      for (let x = 0; x < width; x++) {
        const ch = row[x] ?? '#';
        grid.set(x, y, ch === '#' ? TILE.WALL : ch === '~' ? TILE.MUD : TILE.FLOOR);
      }
    });
    return grid;
  }
}
