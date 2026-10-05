import { Grid, TILE, type Point } from './grid';
import { mulberry32, randInt, shuffle, type Rng } from './rng';

/**
 * Gerador procedural de dungeons: salas retangulares + corredores em "L".
 *
 * 1. Sorteia salas sem sobreposição.
 * 2. Liga todas as salas com uma árvore geradora mínima (garante conectividade).
 * 3. Adiciona corredores EXTRAS entre salas vizinhas, criando ciclos.
 *    Sem ciclos existiria uma única rota entre dois pontos e A* e Gulosa
 *    achariam sempre o mesmo caminho — os ciclos é que tornam a otimalidade relevante.
 * 4. Espalha manchas de lama (custo 3) sobre o piso.
 */

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DungeonOptions {
  width: number;
  height: number;
  seed: number;
  /** Fração do piso convertida em lama (0 a 1). */
  mudDensity?: number;
  /** Corredores extras por sala (0 = árvore, sem ciclos). */
  loopFactor?: number;
}

export interface Dungeon {
  grid: Grid;
  rooms: Room[];
}

export function roomCenter(room: Room): Point {
  return { x: room.x + (room.w >> 1), y: room.y + (room.h >> 1) };
}

export function generateDungeon(options: DungeonOptions): Dungeon {
  const { width, height, seed } = options;
  const rng = mulberry32(seed);
  const grid = new Grid(width, height);

  const rooms = placeRooms(grid, rng);
  for (const [a, b] of connectRooms(rooms, options.loopFactor ?? 0.4, rng)) {
    carveCorridor(grid, roomCenter(rooms[a]), roomCenter(rooms[b]), rng);
  }
  sprinkleMud(grid, options.mudDensity ?? 0.15, rng);

  return { grid, rooms };
}

function placeRooms(grid: Grid, rng: Rng): Room[] {
  const { width, height } = grid;
  const area = (width - 2) * (height - 2);
  const target = Math.max(2, Math.round(area / 70));
  const maxW = clamp(Math.round(width / 4), 4, 11);
  const maxH = clamp(Math.round(height / 4), 3, 8);
  const rooms: Room[] = [];

  for (let attempt = 0; attempt < target * 10 && rooms.length < target; attempt++) {
    const w = randInt(rng, 3, maxW);
    const h = randInt(rng, 3, maxH);
    if (w > width - 2 || h > height - 2) continue;
    const room: Room = {
      x: randInt(rng, 1, width - w - 1),
      y: randInt(rng, 1, height - h - 1),
      w,
      h,
    };
    if (rooms.some((other) => overlaps(room, other, 1))) continue;
    rooms.push(room);
  }

  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) grid.set(x, y, TILE.FLOOR);
    }
  }
  return rooms;
}

/** Arestas (pares de salas) a escavar: árvore geradora mínima (Prim) + ciclos extras. */
function connectRooms(rooms: Room[], loopFactor: number, rng: Rng): [number, number][] {
  const n = rooms.length;
  if (n < 2) return [];
  const centers = rooms.map(roomCenter);
  const dist = (a: number, b: number) =>
    Math.abs(centers[a].x - centers[b].x) + Math.abs(centers[a].y - centers[b].y);

  const edges: [number, number][] = [];
  const used = new Set<string>();
  const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

  // Prim: a cada passo liga a sala fora da árvore mais próxima de alguma sala dentro.
  const inTree = new Uint8Array(n);
  const best = new Float64Array(n).fill(Infinity);
  const bestFrom = new Int32Array(n).fill(-1);
  inTree[0] = 1;
  for (let i = 1; i < n; i++) {
    best[i] = dist(0, i);
    bestFrom[i] = 0;
  }
  for (let added = 1; added < n; added++) {
    let next = -1;
    for (let i = 0; i < n; i++) if (!inTree[i] && (next === -1 || best[i] < best[next])) next = i;
    inTree[next] = 1;
    edges.push([bestFrom[next], next]);
    used.add(key(bestFrom[next], next));
    for (let i = 0; i < n; i++) {
      if (!inTree[i] && dist(next, i) < best[i]) {
        best[i] = dist(next, i);
        bestFrom[i] = next;
      }
    }
  }

  // Ciclos: liga cada sala a uma das suas 4 vizinhas mais próximas que ainda não esteja ligada.
  const candidates: [number, number][] = [];
  for (let a = 0; a < n; a++) {
    const nearest = [...Array(n).keys()]
      .filter((b) => b !== a)
      .sort((p, q) => dist(a, p) - dist(a, q))
      .slice(0, 4);
    for (const b of nearest) {
      const k = key(a, b);
      if (!used.has(k)) {
        used.add(k);
        candidates.push([a, b]);
      }
    }
  }
  const extra = Math.round(n * loopFactor);
  return edges.concat(shuffle(rng, candidates).slice(0, extra));
}

function carveCorridor(grid: Grid, from: Point, to: Point, rng: Rng): void {
  const carve = (x: number, y: number) => {
    if (grid.get(x, y) === TILE.WALL) grid.set(x, y, TILE.FLOOR);
  };
  const horizontal = (y: number, x0: number, x1: number) => {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) carve(x, y);
  };
  const vertical = (x: number, y0: number, y1: number) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) carve(x, y);
  };

  if (rng() < 0.5) {
    horizontal(from.y, from.x, to.x);
    vertical(to.x, from.y, to.y);
  } else {
    vertical(from.x, from.y, to.y);
    horizontal(to.y, from.x, to.x);
  }
}

/** Converte manchas circulares do piso em lama até atingir a densidade pedida. */
function sprinkleMud(grid: Grid, density: number, rng: Rng): void {
  if (density <= 0) return;
  const floor: number[] = [];
  for (let i = 0; i < grid.size; i++) if (grid.tiles[i] === TILE.FLOOR) floor.push(i);
  const target = Math.round(floor.length * density);

  let mud = 0;
  for (let guard = 0; mud < target && guard < target * 20 + 100; guard++) {
    const center = floor[Math.floor(rng() * floor.length)];
    const cx = grid.xOf(center);
    const cy = grid.yOf(center);
    const r = randInt(rng, 1, 3);
    for (let dy = -r; dy <= r && mud < target; dy++) {
      for (let dx = -r; dx <= r && mud < target; dx++) {
        if (dx * dx + dy * dy > r * r + 1 || rng() < 0.2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (grid.inBounds(x, y) && grid.get(x, y) === TILE.FLOOR) {
          grid.set(x, y, TILE.MUD);
          mud++;
        }
      }
    }
  }
}

function overlaps(a: Room, b: Room, margin: number): boolean {
  return (
    a.x - margin < b.x + b.w &&
    b.x < a.x + a.w + margin &&
    a.y - margin < b.y + b.h &&
    b.y < a.y + a.h + margin
  );
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
