/**
 * Efeitos puramente visuais: partículas, números de dano flutuantes e tremida de câmera.
 * Coordenadas em tiles (o renderer converte para pixels).
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
}

export class Effects {
  readonly particles: Particle[] = [];
  readonly texts: FloatingText[] = [];
  private shake = 0;

  burst(x: number, y: number, color: string, count: number, speed = 4): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      const life = 0.35 + Math.random() * 0.45;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * v,
        vy: Math.sin(angle) * v,
        life,
        maxLife: life,
        color,
        size: 1.5 + Math.random() * 2.5,
      });
    }
  }

  floatText(x: number, y: number, text: string, color: string): void {
    this.texts.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  addShake(amount: number): void {
    this.shake = Math.min(14, this.shake + amount);
  }

  update(dt: number): void {
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 4 * dt;
      p.vy *= 1 - 4 * dt;
      p.life -= dt;
    }
    for (const t of this.texts) {
      t.y -= 1.1 * dt;
      t.life -= dt;
    }
    removeDead(this.particles);
    removeDead(this.texts);
    this.shake = Math.max(0, this.shake - 40 * dt);
  }

  shakeOffset(): { x: number; y: number } {
    if (this.shake <= 0) return { x: 0, y: 0 };
    return { x: (Math.random() - 0.5) * this.shake, y: (Math.random() - 0.5) * this.shake };
  }

  clear(): void {
    this.particles.length = 0;
    this.texts.length = 0;
    this.shake = 0;
  }
}

function removeDead(items: { life: number }[]): void {
  let w = 0;
  for (const item of items) if (item.life > 0) items[w++] = item;
  items.length = w;
}
