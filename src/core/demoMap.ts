/**
 * Mapa de demonstração, desenhado à mão para a apresentação.
 *
 * - Lago de lama (~) no meio do salão: a Gulosa atravessa (h diminui em linha reta),
 *   o A* contorna porque cada passo na lama custa 3.
 * - "Taça" de paredes aberta para a esquerda, na frente do herói: atrai a busca
 *   gulosa para dentro e mostra no mapa de calor os nós desperdiçados.
 *
 * Legenda: '#' parede, '.' chão, '~' lama, '@' herói, 'z' Zumbi (Gulosa), 'H' Caçador (A*).
 * Um teste automatizado garante que, deste mapa, a Gulosa sempre acha um caminho mais caro.
 */
export const DEMO_MAP: readonly string[] = [
  '################################################',
  '###########............................#########',
  '###########..................#.................#',
  '###########...#................................#',
  '###########....................######..........#',
  '#........##........~~~~~~~..........#..........#',
  '#........##........~~~~~~~..........#..........#',
  '#..H.....##........~~~~~~~..........#..#.......#',
  '#..................~~~~~~~..........#..#.......#',
  '#..................~~~~~~~..........#..#...@...#',
  '#..................~~~~~~~..........#..#.......#',
  '#..z.....##........~~~~~~~..........#..#.......#',
  '#........##........~~~~~~~..........#..........#',
  '#........##........~~~~~~~..........#..........#',
  '###########....................######..........#',
  '###########...#................................#',
  '###########..................#.................#',
  '###########............................#########',
  '################################################',
];

export interface MapMarker {
  char: string;
  x: number;
  y: number;
}

/** Posições dos marcadores ('@', 'z', 'H', ...) de um mapa em texto. */
export function findMarkers(rows: readonly string[], chars: string): MapMarker[] {
  const markers: MapMarker[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (chars.includes(row[x])) markers.push({ char: row[x], x, y });
  });
  return markers;
}
