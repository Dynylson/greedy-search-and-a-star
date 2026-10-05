/**
 * Fila de prioridade (heap binário mínimo) usada como LISTA ABERTA.
 *
 * Ordem de desempate: menor prioridade → menor h → ordem de inserção (FIFO).
 * Desempatar pelo menor h faz o A* preferir nós mais próximos do objetivo
 * quando vários têm o mesmo f, o que reduz bastante as expansões em grids.
 * A ordem de inserção garante resultados 100% determinísticos.
 */
export class MinHeap {
  private nodes: number[] = [];
  private priorities: number[] = [];
  private tieBreaks: number[] = [];
  private seqs: number[] = [];
  private counter = 0;

  get size(): number {
    return this.nodes.length;
  }

  push(node: number, priority: number, tieBreak: number): void {
    this.nodes.push(node);
    this.priorities.push(priority);
    this.tieBreaks.push(tieBreak);
    this.seqs.push(this.counter++);
    this.siftUp(this.nodes.length - 1);
  }

  /** Remove e devolve o nó de menor prioridade. Chamar apenas com size > 0. */
  pop(): number {
    const top = this.nodes[0];
    const last = this.nodes.length - 1;
    if (last > 0) this.move(last, 0);
    this.nodes.pop();
    this.priorities.pop();
    this.tieBreaks.pop();
    this.seqs.pop();
    if (this.nodes.length > 1) this.siftDown(0);
    return top;
  }

  private less(a: number, b: number): boolean {
    const pa = this.priorities[a];
    const pb = this.priorities[b];
    if (pa !== pb) return pa < pb;
    const ta = this.tieBreaks[a];
    const tb = this.tieBreaks[b];
    if (ta !== tb) return ta < tb;
    return this.seqs[a] < this.seqs[b];
  }

  private move(from: number, to: number): void {
    this.nodes[to] = this.nodes[from];
    this.priorities[to] = this.priorities[from];
    this.tieBreaks[to] = this.tieBreaks[from];
    this.seqs[to] = this.seqs[from];
  }

  private swap(a: number, b: number): void {
    [this.nodes[a], this.nodes[b]] = [this.nodes[b], this.nodes[a]];
    [this.priorities[a], this.priorities[b]] = [this.priorities[b], this.priorities[a]];
    [this.tieBreaks[a], this.tieBreaks[b]] = [this.tieBreaks[b], this.tieBreaks[a]];
    [this.seqs[a], this.seqs[b]] = [this.seqs[b], this.seqs[a]];
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.nodes.length;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.less(left, smallest)) smallest = left;
      if (right < n && this.less(right, smallest)) smallest = right;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }
}
