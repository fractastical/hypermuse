// Hierarchical cellular automata plugin inspired by multi-layer Life.
// Three coupled layers (low/mid/high) evolve with parent/child influence.
(function () {
  class HypermuseHierarchicalLifeSimulationPlugin {
    constructor(id = "hierarchical-life") {
      this.id = id;
      this.width = 0;
      this.height = 0;
      this.layers = [];
      this.nextLayers = [];
      this.state = null;
      this.stepAccumulator = [0, 0, 0];
      this.baseStepIntervals = [0.18, 0.11, 0.07]; // low, mid, high
      this.rewritePhase = 0;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.state = new Uint8Array(width * height);
      this.layers = [
        new Uint8Array(width * height),
        new Uint8Array(width * height),
        new Uint8Array(width * height)
      ];
      this.nextLayers = [
        new Uint8Array(width * height),
        new Uint8Array(width * height),
        new Uint8Array(width * height)
      ];
      this.seedLayer(0, 0.09);
      this.seedLayer(1, 0.13);
      this.seedLayer(2, 0.18);
      this.composeState();
    }

    seedLayer(layerIndex, fillProbability) {
      const grid = this.layers[layerIndex];
      if (!grid) return;
      for (let i = 0; i < grid.length; i++) {
        grid[i] = Math.random() < fillProbability ? 1 : 0;
      }
    }

    index(x, y) {
      return (y * this.width) + x;
    }

    countNeighbors(grid, x, y) {
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) continue;
          const nx = (x + ox + this.width) % this.width;
          const ny = (y + oy + this.height) % this.height;
          count += grid[this.index(nx, ny)];
        }
      }
      return count;
    }

    update(dt, audioFrame) {
      if (!this.layers || this.layers.length !== 3 || !this.state) {
        return;
      }
      const low = audioFrame ? (audioFrame.low || 0) : 0;
      const mid = audioFrame ? (audioFrame.mid || 0) : 0;
      const high = audioFrame ? (audioFrame.high || 0) : 0;
      const beat = !!(audioFrame && audioFrame.beat);

      if (beat) {
        this.rewritePhase = (this.rewritePhase + 1) % 3;
        this.injectPulse(0, Math.floor(4 + (low * 16)));
        this.injectPulse(1, Math.floor(6 + (mid * 18)));
        this.injectPulse(2, Math.floor(8 + (high * 20)));
      }

      const audioRates = [
        0.55 + (low * 1.6),
        0.72 + (mid * 1.9),
        0.92 + (high * 2.2)
      ];

      for (let layer = 0; layer < 3; layer++) {
        this.stepAccumulator[layer] += dt * audioRates[layer];
        while (this.stepAccumulator[layer] >= this.baseStepIntervals[layer]) {
          this.stepAccumulator[layer] -= this.baseStepIntervals[layer];
          this.stepLayer(layer, low, mid, high);
        }
      }
      this.composeState();
    }

    stepLayer(layerIndex, low, mid, high) {
      const current = this.layers[layerIndex];
      const next = this.nextLayers[layerIndex];
      const parent = layerIndex > 0 ? this.layers[layerIndex - 1] : null;
      const child = layerIndex < 2 ? this.layers[layerIndex + 1] : null;

      const surviveMasks = [
        new Set([2, 3]),
        new Set([2, 3, 4]),
        new Set([1, 2, 3])
      ];
      const bornMasks = [
        new Set([3]),
        new Set([3, 4]),
        new Set([3, 5])
      ];
      const phase = this.rewritePhase;
      const survive = surviveMasks[(layerIndex + phase) % surviveMasks.length];
      const born = bornMasks[(layerIndex + phase) % bornMasks.length];

      const couplingParent = 0.7 + (low * 0.9);
      const couplingChild = 0.6 + (high * 1.0);
      const laneDrive = layerIndex === 0 ? low : (layerIndex === 1 ? mid : high);

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = this.index(x, y);
          const alive = current[idx] === 1;
          const sameLayer = this.countNeighbors(current, x, y);

          let parentInfluence = 0;
          if (parent) {
            const px = Math.floor(x / 2);
            const py = Math.floor(y / 2);
            parentInfluence = parent[this.index(px % this.width, py % this.height)] * couplingParent;
          }

          let childInfluence = 0;
          if (child) {
            const cx = (x * 2) % this.width;
            const cy = (y * 2) % this.height;
            const c1 = child[this.index(cx, cy)];
            const c2 = child[this.index((cx + 1) % this.width, cy)];
            const c3 = child[this.index(cx, (cy + 1) % this.height)];
            const c4 = child[this.index((cx + 1) % this.width, (cy + 1) % this.height)];
            childInfluence = ((c1 + c2 + c3 + c4) / 4) * couplingChild;
          }

          const total = Math.round(sameLayer + parentInfluence + childInfluence);
          let nextAlive = 0;
          if (alive) {
            nextAlive = survive.has(total) ? 1 : 0;
          } else {
            nextAlive = born.has(total) ? 1 : 0;
          }
          if (!nextAlive && Math.random() < (0.0009 + (laneDrive * 0.004))) {
            nextAlive = 1;
          }
          next[idx] = nextAlive;
        }
      }

      this.layers[layerIndex] = next;
      this.nextLayers[layerIndex] = current;
    }

    injectPulse(layerIndex, points) {
      const grid = this.layers[layerIndex];
      if (!grid) return;
      for (let i = 0; i < points; i++) {
        const x = Math.floor(Math.random() * this.width);
        const y = Math.floor(Math.random() * this.height);
        grid[this.index(x, y)] = 1;
      }
    }

    composeState() {
      this.state.fill(0);
      const lowLayer = this.layers[0];
      const midLayer = this.layers[1];
      const highLayer = this.layers[2];
      const third = Math.floor(this.width / 3);

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          let source = midLayer;
          let sx = x;
          if (x < third) {
            source = highLayer; // left lane = high
            sx = Math.floor((x / Math.max(1, third)) * this.width);
          } else if (x >= third * 2) {
            source = lowLayer; // right lane = low
            sx = Math.floor(((x - (third * 2)) / Math.max(1, this.width - (third * 2))) * this.width);
          }
          sx = Math.max(0, Math.min(this.width - 1, sx));
          const value = source[this.index(sx, y)];
          this.state[this.index(x, y)] = value ? 1 : 0;
        }
      }
    }

    getState() {
      return this.state;
    }

    dispose() {
      this.layers = [];
      this.nextLayers = [];
      this.state = null;
      this.stepAccumulator = [0, 0, 0];
    }
  }

  window.HypermuseHierarchicalLifeSimulationPlugin = HypermuseHierarchicalLifeSimulationPlugin;
})();
