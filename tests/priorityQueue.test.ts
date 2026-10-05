import { describe, expect, it } from 'vitest';
import { MinHeap } from '../src/core/priorityQueue';
import { mulberry32 } from '../src/core/rng';

describe('MinHeap', () => {
  it('retira sempre a menor prioridade, desempatando por h e depois por ordem de chegada', () => {
    const rng = mulberry32(42);
    const heap = new MinHeap();
    const items = Array.from({ length: 2000 }, (_, i) => ({
      node: i,
      p: Math.floor(rng() * 50),
      h: Math.floor(rng() * 10),
    }));
    for (const it of items) heap.push(it.node, it.p, it.h);

    const expected = [...items].sort((a, b) => a.p - b.p || a.h - b.h || a.node - b.node).map((it) => it.node);
    const popped: number[] = [];
    while (heap.size > 0) popped.push(heap.pop());
    expect(popped).toEqual(expected);
  });
});
