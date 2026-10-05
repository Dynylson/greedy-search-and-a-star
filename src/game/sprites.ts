import tilesetUrl from '../assets/kenney-tiny-dungeon.png';

/**
 * Sprites em pixel art do pacote "Tiny Dungeon" de Kenney (www.kenney.nl), licença CC0.
 * A folha tem 12 colunas × 11 linhas de tiles 16×16; cada sprite é identificado pelo índice.
 */

const SOURCE = 16;
const COLUMNS = 12;

export const SPRITES = {
  hero: 97,
  zombie: 108,
  hunter: 111,
  wall: 40,
  stairs: 37,
  /** Variações de piso e lama, sorteadas por posição para o chão não ficar repetitivo. */
  floor: [48, 48, 48, 48, 48, 49, 48, 48, 48, 49, 48, 42, 48, 48, 48, 48],
  mud: [0, 0, 0, 0, 24],
} as const;

export type SpriteName = 'hero' | 'zombie' | 'hunter';

export class SpriteSheet {
  /** Mesma folha, com tudo pintado de branco: usada no "flash" quando a entidade leva dano. */
  private readonly silhouette: HTMLCanvasElement;

  constructor(private readonly image: HTMLImageElement) {
    this.silhouette = document.createElement('canvas');
    this.silhouette.width = image.width;
    this.silhouette.height = image.height;
    const g = this.silhouette.getContext('2d')!;
    g.drawImage(image, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, image.width, image.height);
  }

  draw(ctx: CanvasRenderingContext2D, index: number, x: number, y: number, size: number, white = false): void {
    const sx = (index % COLUMNS) * SOURCE;
    const sy = Math.floor(index / COLUMNS) * SOURCE;
    ctx.drawImage(white ? this.silhouette : this.image, sx, sy, SOURCE, SOURCE, x, y, size, size);
  }

  /** Ícone em PNG (data URL) para usar no painel HTML. */
  icon(index: number, scale = 2): string {
    const canvas = document.createElement('canvas');
    canvas.width = SOURCE * scale;
    canvas.height = SOURCE * scale;
    const g = canvas.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    this.draw(g, index, 0, 0, SOURCE * scale);
    return canvas.toDataURL('image/png');
  }
}

export function loadSpriteSheet(): Promise<SpriteSheet> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(new SpriteSheet(image));
    image.onerror = () => reject(new Error('Não foi possível carregar o tileset.'));
    image.src = tilesetUrl;
  });
}

/** Hash simples de posição → escolhe uma variação de textura de forma estável. */
export function variant<T>(options: readonly T[], x: number, y: number): T {
  const h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0;
  return options[(h >>> 7) % options.length];
}
