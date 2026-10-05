import { TILE, type Grid } from '../core/grid';
import type { SearchResult } from '../core/search';
import { COLORS, VIEW_RADIUS } from './config';
import type { DebugState, FocusedSearch } from './debug';
import type { Effects } from './effects';
import type { Entity, Game, Level, Monster } from './game';
import { SPRITES, variant, type SpriteSheet } from './sprites';

/**
 * Desenha o jogo em um <canvas> 2D em dois estilos visuais:
 *   - "pixel": sprites e texturas em pixel art (Kenney, CC0);
 *   - "neon":  glifos ASCII com brilho, o visual clássico de roguelike.
 *
 * Camadas, de baixo para cima:
 *   terreno (cacheado em um canvas fora da tela) → escada → camadas de debug
 *   → névoa de guerra → entidades → efeitos → destaque do cursor.
 *
 * A névoa é uma imagem de 1 pixel por tile ampliada com suavização bilinear:
 * barata e com bordas naturalmente suaves.
 */

export type VisualTheme = 'pixel' | 'neon';

/** Pixel art em 2× (16 → 32 px) para os pixels ficarem nítidos. */
const TILE_SIZES: Readonly<Record<VisualTheme, number>> = { pixel: 32, neon: 24 };
const FONT = '"JetBrains Mono", ui-monospace, Consolas, monospace';
const BG = '#06050b';

interface Visual {
  rx: number;
  ry: number;
  flash: number;
  alpha: number;
}

export interface Frame {
  game: Game;
  debug: DebugState;
  effects: Effects;
  hover: { x: number; y: number } | null;
  walkPreview: number[] | null;
  time: number;
  dt: number;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private viewW = 0;
  private viewH = 0;
  private terrain: HTMLCanvasElement | null = null;
  private terrainLevel: Level | null = null;
  private readonly fog = document.createElement('canvas');
  private readonly fogCtx: CanvasRenderingContext2D;
  private fogImage: ImageData | null = null;
  private camX = 0;
  private camY = 0;
  private camReady = false;
  private readonly visuals = new Map<number, Visual>();
  private theme: VisualTheme = 'neon';
  private sprites: SpriteSheet | null = null;
  private tile = TILE_SIZES.neon;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.fogCtx = this.fog.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.viewW = rect.width;
    this.viewH = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.terrainLevel = null; // refaz o cache na nova densidade de pixels
  }

  get visualTheme(): VisualTheme {
    return this.theme;
  }

  /** Troca o estilo visual. "pixel" só é aceito se o tileset tiver carregado. */
  setTheme(theme: VisualTheme, sprites: SpriteSheet | null): void {
    this.theme = theme === 'pixel' && sprites ? 'pixel' : 'neon';
    this.sprites = sprites;
    this.tile = TILE_SIZES[this.theme];
    this.terrainLevel = null;
    this.camReady = false;
  }

  private fitTile(grid: Grid): number {
    const fit = Math.floor(Math.min(this.viewW / grid.width, this.viewH / grid.height));
    return Math.max(16, Math.min(TILE_SIZES[this.theme], fit));
  }

  screenToTile(sx: number, sy: number): { x: number; y: number } {
    return { x: Math.floor((sx + this.camX) / this.tile), y: Math.floor((sy + this.camY) / this.tile) };
  }

  tileToScreen(x: number, y: number): { x: number; y: number } {
    return { x: x * this.tile - this.camX, y: y * this.tile - this.camY };
  }

  flash(entityId: number): void {
    const v = this.visuals.get(entityId);
    if (v) v.flash = 1;
  }

  /** Posição suavizada (em tiles) de uma entidade — usada para posicionar efeitos. */
  visualOf(entity: Entity): { x: number; y: number } {
    const v = this.visuals.get(entity.id);
    return v ? { x: v.rx, y: v.ry } : { x: entity.x, y: entity.y };
  }

  resetLevel(): void {
    this.terrainLevel = null;
    this.camReady = false;
    this.visuals.clear();
  }

  render(frame: Frame): void {
    const { game, debug, effects } = frame;
    const level = game.level;
    // O mapa de demonstração sempre cabe inteiro na tela (importante no projetor).
    const desiredTile = game.mode === 'demo' ? this.fitTile(level.grid) : TILE_SIZES[this.theme];
    if (desiredTile !== this.tile) {
      this.tile = desiredTile;
      this.terrainLevel = null;
      this.camReady = false;
    }
    if (this.terrainLevel !== level) this.buildTerrain(level);
    this.syncVisuals(frame);
    this.updateCamera(game, frame.dt);

    const ctx = this.ctx;
    const T = this.tile;
    const { grid } = level;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.viewW, this.viewH);

    const shake = effects.shakeOffset();
    ctx.translate(Math.round(-this.camX + shake.x), Math.round(-this.camY + shake.y));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.terrain!, 0, 0, grid.width * T, grid.height * T);

    this.drawStairs(level, frame.time);
    if (debug.enabled) this.drawDebugLayers(frame);
    else if (frame.walkPreview) this.drawWalkPreview(grid, frame.walkPreview);

    this.drawFog(frame);
    this.drawMonsters(frame);
    this.drawPlayer(frame);
    this.drawEffects(effects);
    if (frame.hover && grid.inBounds(frame.hover.x, frame.hover.y)) this.drawHover(frame.hover.x, frame.hover.y);
  }

  // ── Terreno ───────────────────────────────────────────────────────

  private buildTerrain(level: Level): void {
    const { grid } = level;
    const T = this.tile;
    const canvas = document.createElement('canvas');
    canvas.width = grid.width * T * this.dpr;
    canvas.height = grid.height * T * this.dpr;
    const g = canvas.getContext('2d')!;
    g.scale(this.dpr, this.dpr);
    g.fillStyle = BG;
    g.fillRect(0, 0, grid.width * T, grid.height * T);
    if (this.theme === 'pixel') this.paintPixelTerrain(grid, g);
    else this.paintNeonTerrain(grid, g);
    this.terrain = canvas;
    this.terrainLevel = level;
    this.camReady = false;
  }

  private paintPixelTerrain(grid: Grid, g: CanvasRenderingContext2D): void {
    const sprites = this.sprites!;
    const T = this.tile;
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const px = x * T;
        const py = y * T;
        const tile = grid.get(x, y);
        if (tile === TILE.FLOOR) {
          sprites.draw(g, variant(SPRITES.floor, x, y), px, py, T);
        } else if (tile === TILE.MUD) {
          sprites.draw(g, variant(SPRITES.mud, x, y), px, py, T);
          // Tom mais escuro + ondulações: a terra passa a ler como lama.
          g.fillStyle = 'rgba(40, 22, 6, 0.35)';
          g.fillRect(px, py, T, T);
          g.strokeStyle = 'rgba(255, 196, 120, 0.35)';
          g.lineWidth = 2;
          const wave = (wx: number, wy: number) => {
            g.beginPath();
            g.moveTo(wx, wy);
            g.quadraticCurveTo(wx + T * 0.12, wy - T * 0.1, wx + T * 0.24, wy);
            g.quadraticCurveTo(wx + T * 0.36, wy + T * 0.1, wx + T * 0.48, wy);
            g.stroke();
          };
          const shift = variant([0, 0.12, 0.24], x, y + 7) * T;
          wave(px + T * 0.08 + shift * 0.5, py + T * 0.32);
          wave(px + T * 0.4 - shift * 0.5, py + T * 0.7);
        } else if (touchesFloor(grid, x, y)) {
          sprites.draw(g, SPRITES.wall, px, py, T);
          // Parede sem chão logo abaixo é "topo": fica mais escura e dá profundidade.
          const faceVisible = y + 1 < grid.height && grid.get(x, y + 1) !== TILE.WALL;
          if (!faceVisible) {
            g.fillStyle = 'rgba(10, 8, 22, 0.6)';
            g.fillRect(px, py, T, T);
          }
        }
      }
    }
    // Leve escurecimento geral: clima de cripta e mais contraste para as camadas de debug.
    g.fillStyle = 'rgba(12, 8, 24, 0.22)';
    g.fillRect(0, 0, grid.width * T, grid.height * T);
  }

  private paintNeonTerrain(grid: Grid, g: CanvasRenderingContext2D): void {
    const T = this.tile;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const glyph =(ch: string, cx: number, cy: number, color: string, glow: number, size: number) => {
      g.font = `600 ${size}px ${FONT}`;
      g.fillStyle = color;
      g.shadowColor = color;
      g.shadowBlur = glow;
      g.fillText(ch, cx, cy);
      g.shadowBlur = 0;
    };

    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const px = x * T;
        const py = y * T;
        const cx = px + T / 2;
        const cy = py + T / 2 + 1;
        const tile = grid.get(x, y);
        if (tile === TILE.FLOOR) {
          g.fillStyle = '#0e0c1b';
          g.fillRect(px, py, T, T);
          glyph('·', cx, cy, '#463d74', 0, T * 0.7);
        } else if (tile === TILE.MUD) {
          g.fillStyle = '#181006';
          g.fillRect(px, py, T, T);
          glyph('~', cx, cy, COLORS.mud, 6, T * 0.75);
        } else if (touchesFloor(grid, x, y)) {
          g.fillStyle = '#120c26';
          g.fillRect(px, py, T, T);
          g.strokeStyle = '#251b52';
          g.strokeRect(px + 0.5, py + 0.5, T - 1, T - 1);
          glyph('#', cx, cy, '#6a50e6', 7, T * 0.7);
        }
      }
    }
  }

  private drawStairs(level: Level, time: number): void {
    const { stairs, explored, grid } = level;
    if (!stairs || !explored[grid.index(stairs.x, stairs.y)]) return;
    const ctx = this.ctx;
    const T = this.tile;
    ctx.save();
    if (this.theme === 'pixel') {
      ctx.shadowColor = COLORS.stairs;
      ctx.shadowBlur = 12 + 6 * Math.sin(time * 3);
      this.sprites!.draw(ctx, SPRITES.stairs, stairs.x * T, stairs.y * T, T);
      ctx.restore();
      return;
    }
    ctx.font = `800 ${T * 0.9}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.stairs;
    ctx.shadowColor = COLORS.stairs;
    ctx.shadowBlur = 10 + 6 * Math.sin(time * 3);
    ctx.fillText('>', stairs.x * T + T / 2, stairs.y * T + T / 2 + 1);
    ctx.restore();
  }

  // ── Névoa de guerra + luz da tocha ────────────────────────────────

  private drawFog(frame: Frame): void {
    const { grid, visible, explored } = frame.game.level;
    if (this.fog.width !== grid.width || this.fog.height !== grid.height || !this.fogImage) {
      this.fog.width = grid.width;
      this.fog.height = grid.height;
      this.fogImage = this.fogCtx.createImageData(grid.width, grid.height);
    }
    const data = this.fogImage.data;
    const flicker = 1 + 0.035 * Math.sin(frame.time * 7.3) + 0.02 * Math.sin(frame.time * 13.1);
    const radius = VIEW_RADIUS * flicker;
    const hero = this.visualOf(frame.game.player);
    const debugScale = frame.debug.enabled ? 0.45 : 1;

    for (let i = 0; i < grid.size; i++) {
      let alpha: number;
      if (visible[i]) {
        const d = Math.hypot(grid.xOf(i) - hero.x, grid.yOf(i) - hero.y) / radius;
        alpha = Math.min(0.55, d * d * 0.6);
      } else if (explored[i]) {
        alpha = 0.66;
      } else {
        alpha = 1;
      }
      const o = i * 4;
      data[o] = 6;
      data[o + 1] = 5;
      data[o + 2] = 11;
      data[o + 3] = Math.round(alpha * debugScale * 255);
    }
    this.fogCtx.putImageData(this.fogImage, 0, 0);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fog, 0, 0, grid.width * this.tile, grid.height * this.tile);
    ctx.imageSmoothingEnabled = false;
  }

  // ── Entidades ─────────────────────────────────────────────────────

  private syncVisuals(frame: Frame): void {
    const { game, debug, dt } = frame;
    const follow = 1 - Math.exp(-dt * 18);
    const fade = 1 - Math.exp(-dt * 10);
    const alive = new Set<number>();
    for (const e of [game.player, ...game.level.monsters]) {
      alive.add(e.id);
      let v = this.visuals.get(e.id);
      if (!v || Math.abs(v.rx - e.x) + Math.abs(v.ry - e.y) > 4) {
        v = { rx: e.x, ry: e.y, flash: v?.flash ?? 0, alpha: v?.alpha ?? 0 };
        this.visuals.set(e.id, v);
      }
      v.rx += (e.x - v.rx) * follow;
      v.ry += (e.y - v.ry) * follow;
      v.flash = Math.max(0, v.flash - dt * 5);
      const shown = e === game.player || debug.enabled || game.isVisible(e.x, e.y);
      v.alpha += ((shown ? 1 : 0) - v.alpha) * fade;
    }
    for (const id of this.visuals.keys()) if (!alive.has(id)) this.visuals.delete(id);
  }

  private drawPlayer(frame: Frame): void {
    const { player } = frame.game;
    const v = this.visuals.get(player.id);
    if (!v || frame.game.status === 'dead') return;
    const ctx = this.ctx;
    const T = this.tile;
    const cx = v.rx * T + T / 2;
    const cy = v.ry * T + T / 2;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, T * 1.6);
    halo.addColorStop(0, 'rgba(98, 243, 255, 0.22)');
    halo.addColorStop(1, 'rgba(98, 243, 255, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(cx - T * 2, cy - T * 2, T * 4, T * 4);
    this.drawGlyph(player, v, 18);
  }

  private drawMonsters(frame: Frame): void {
    const { game, debug, time } = frame;
    const ctx = this.ctx;
    const T = this.tile;
    for (const m of game.level.monsters) {
      const v = this.visuals.get(m.id);
      if (!v || v.alpha < 0.02) continue;
      const cx = v.rx * T + T / 2;
      const cy = v.ry * T + T / 2;

      if (debug.enabled && debug.selectedMonsterId === m.id) {
        ctx.save();
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.lineDashOffset = -time * 20;
        ctx.globalAlpha = v.alpha;
        ctx.beginPath();
        ctx.arc(cx, cy, T * 0.75, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      this.drawGlyph(m, v, m.awake ? 14 : 0, m.awake ? 1 : 0.5);

      ctx.save();
      ctx.globalAlpha = v.alpha;
      if (m.hp < m.maxHp) {
        const w = T * 0.8;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(cx - w / 2, cy + T * 0.42, w, 3);
        ctx.fillStyle = m.color;
        ctx.fillRect(cx - w / 2, cy + T * 0.42, (w * Math.max(0, m.hp)) / m.maxHp, 3);
      }
      if (m.stuck > 0) {
        // Bolhas de lama: um ponto por turno que ainda vai ficar preso.
        ctx.fillStyle = COLORS.mud;
        for (let k = 0; k < m.stuck; k++) {
          ctx.beginPath();
          ctx.arc(cx - 4 + k * 8, cy - T * 0.55 + Math.sin(time * 6 + k) * 1.5, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!m.awake) {
        ctx.font = `600 ${T * 0.42}px ${FONT}`;
        ctx.fillStyle = '#8a84b0';
        ctx.textAlign = 'center';
        ctx.fillText('…', cx + T * 0.4, cy - T * 0.45 + Math.sin(time * 2 + m.id) * 2);
      }
      ctx.restore();
    }
  }

  private drawGlyph(e: Entity, v: Visual, glow: number, dim = 1): void {
    if (this.theme === 'pixel') {
      this.drawSprite(e, v, dim);
      return;
    }
    const ctx = this.ctx;
    const T = this.tile;
    ctx.save();
    ctx.globalAlpha = v.alpha * dim;
    ctx.font = `800 ${T * 0.92}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = v.flash > 0.05 ? '#ffffff' : e.color;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = glow + v.flash * 20;
    ctx.fillText(e.glyph, v.rx * T + T / 2, v.ry * T + T / 2 + 1);
    ctx.restore();
  }

  /** Sprite em pixel art com sombra no chão e um anel na cor da entidade (identifica o algoritmo). */
  private drawSprite(e: Entity, v: Visual, dim: number): void {
    const ctx = this.ctx;
    const T = this.tile;
    const index = 'kind' in e ? SPRITES[(e as Monster).kind] : SPRITES.hero;
    const x = v.rx * T;
    const y = v.ry * T;
    ctx.save();
    ctx.globalAlpha = v.alpha * dim;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(x + T / 2, y + T * 0.88, T * 0.32, T * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 2;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.ellipse(x + T / 2, y + T * 0.88, T * 0.38, T * 0.14, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.imageSmoothingEnabled = false;
    this.sprites!.draw(ctx, index, x, y, T);
    if (v.flash > 0.05) {
      ctx.globalAlpha = v.alpha * dim * Math.min(1, v.flash * 1.5);
      this.sprites!.draw(ctx, index, x, y, T, true);
    }
    ctx.restore();
  }

  private drawEffects(effects: Effects): void {
    const ctx = this.ctx;
    const T = this.tile;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of effects.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x * T + T / 2 - p.size / 2, p.y * T + T / 2 - p.size / 2, p.size, p.size);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.font = `800 ${T * 0.62}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of effects.texts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (t.life / t.maxLife) * 1.6));
      ctx.fillStyle = t.color;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 8;
      ctx.fillText(t.text, t.x * T + T / 2, t.y * T + T / 2 - T * 0.5);
    }
    ctx.restore();
  }

  private drawHover(x: number, y: number): void {
    const ctx = this.ctx;
    const T = this.tile;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x * T + 1.5, y * T + 1.5, T - 3, T - 3);
    ctx.restore();
  }

  private drawWalkPreview(grid: Grid, path: number[]): void {
    const ctx = this.ctx;
    const T = this.tile;
    ctx.save();
    ctx.fillStyle = 'rgba(98, 243, 255, 0.45)';
    for (const node of path.slice(1)) {
      ctx.beginPath();
      ctx.arc(grid.xOf(node) * T + T / 2, grid.yOf(node) * T + T / 2, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── Camadas de debug ──────────────────────────────────────────────

  private drawDebugLayers(frame: Frame): void {
    const { game, debug, time } = frame;
    const { grid } = game.level;
    const focus = debug.focus(game);
    if (focus) this.drawHeatmap(grid, focus);

    for (const m of game.level.monsters) {
      if (!m.awake || !m.lastSearch || m.lastSearch.result.path.length < 2) continue;
      if (focus && debug.selectedMonsterId === m.id && !debug.replay) continue; // já desenhado no heatmap
      this.drawPath(grid, m.lastSearch.result.path, m.color, { width: 2, dash: [5, 5], dashOffset: -time * 18, alpha: 0.85 });
    }

    const cmp = debug.comparison;
    if (cmp) {
      this.drawExpandedDots(grid, cmp.greedy.result, COLORS.greedy, -1);
      this.drawExpandedDots(grid, cmp.astar.result, COLORS.astar, 1);
      this.drawPath(grid, cmp.greedy.result.path, COLORS.greedy, { width: 2.5, offset: -3, alpha: 1, glow: 8 });
      this.drawPath(grid, cmp.astar.result.path, COLORS.astar, { width: 2.5, offset: 3, alpha: 1, glow: 8 });
    }
  }

  private drawHeatmap(grid: Grid, focus: FocusedSearch): void {
    const { result } = focus.snapshot;
    const trace = result.trace;
    if (!trace) return;
    const ctx = this.ctx;
    const T = this.tile;
    const limit = Math.min(focus.step, result.expanded);
    const total = Math.max(1, result.expanded);

    ctx.save();
    // Nós expandidos (lista fechada), coloridos pela ordem de expansão: azul → magenta.
    for (let k = 0; k < limit; k++) {
      const node = trace.order[k];
      const hue = 195 + 125 * (k / total);
      ctx.fillStyle = `hsla(${hue}, 95%, 58%, ${this.theme === 'pixel' ? 0.5 : 0.32})`;
      ctx.fillRect(grid.xOf(node) * T + 1, grid.yOf(node) * T + 1, T - 2, T - 2);
    }
    // Fronteira (lista aberta) naquele instante.
    ctx.strokeStyle = 'rgba(255, 179, 71, 0.9)';
    ctx.lineWidth = 1.5;
    for (let i = 0; i < grid.size; i++) {
      if (trace.discoveredAt[i] < limit && !(trace.expandedAt[i] < limit)) {
        ctx.strokeRect(grid.xOf(i) * T + 3.5, grid.yOf(i) * T + 3.5, T - 7, T - 7);
      }
    }
    // Nó sendo expandido agora (durante o replay).
    if (limit > 0 && limit < result.expanded) {
      const node = trace.order[limit - 1];
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.shadowColor = '#fff';
      ctx.shadowBlur = 12;
      ctx.fillRect(grid.xOf(node) * T + 5, grid.yOf(node) * T + 5, T - 10, T - 10);
    }
    ctx.restore();

    if (limit >= result.expanded && result.found) {
      this.drawPath(grid, result.path, focus.color, { width: 3, alpha: 1, glow: 12 });
    }
  }

  private drawExpandedDots(grid: Grid, result: SearchResult, color: string, side: -1 | 1): void {
    const trace = result.trace;
    if (!trace) return;
    const ctx = this.ctx;
    const T = this.tile;
    ctx.save();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.55;
    for (const node of trace.order) {
      ctx.fillRect(grid.xOf(node) * T + T / 2 + side * 5 - 1.5, grid.yOf(node) * T + T / 2 + side * 5 - 1.5, 3, 3);
    }
    ctx.restore();
  }

  private drawPath(
    grid: Grid,
    path: number[],
    color: string,
    opts: { width: number; alpha: number; dash?: number[]; dashOffset?: number; offset?: number; glow?: number },
  ): void {
    if (path.length < 2) return;
    const ctx = this.ctx;
    const T = this.tile;
    const off = opts.offset ?? 0;
    ctx.save();
    ctx.globalAlpha = opts.alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = opts.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (opts.dash) ctx.setLineDash(opts.dash);
    ctx.lineDashOffset = opts.dashOffset ?? 0;
    if (opts.glow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = opts.glow;
    }
    ctx.beginPath();
    path.forEach((node, k) => {
      const x = grid.xOf(node) * T + T / 2 + off;
      const y = grid.yOf(node) * T + T / 2 + off;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (this.theme === 'pixel') {
      // Contorno escuro por baixo: a linha continua legível sobre as texturas claras.
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.lineWidth = opts.width + 3;
      ctx.stroke();
      ctx.restore();
    }
    ctx.stroke();
    const end = path[path.length - 1];
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(grid.xOf(end) * T + T / 2 + off, grid.yOf(end) * T + T / 2 + off, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ── Câmera ────────────────────────────────────────────────────────

  private updateCamera(game: Game, dt: number): void {
    const { grid } = game.level;
    const T = this.tile;
    const hero = this.visualOf(game.player);
    const worldW = grid.width * T;
    const worldH = grid.height * T;
    const target = (heroPos: number, world: number, view: number) =>
      world <= view ? (world - view) / 2 : Math.max(0, Math.min(world - view, heroPos * T + T / 2 - view / 2));
    const tx = target(hero.x, worldW, this.viewW);
    const ty = target(hero.y, worldH, this.viewH);
    if (!this.camReady) {
      this.camX = tx;
      this.camY = ty;
      this.camReady = true;
      return;
    }
    const k = 1 - Math.exp(-dt * 7);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
  }
}

function touchesFloor(grid: Grid, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (grid.inBounds(nx, ny) && grid.get(nx, ny) !== TILE.WALL) return true;
    }
  }
  return false;
}
