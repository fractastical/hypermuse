(function () {
  class HypermuseHexLifeSimulationPlugin {
    constructor(id = "hex-life") {
      this.id = id;
      this.width = 0;
      this.height = 0;
      this.grid = null;
      this.next = null;
      this.display = null;
      this.stepAccumulator = 0;
      this.stepInterval = 0.09;
      this.manualSpeed = 1;
      this.syncToAudio = true;
      this.rule = "B2/S34";
      this.bornCounts = new Set([2]);
      this.surviveCounts = new Set([3, 4]);
      this.aperiodicMix = 0;
      this.generation = 0;
      this.revealRow = 0;
      this.baseRevealRows = 2;
      this.evenOffsets = [
        [-1, -1], [0, -1],
        [-1, 0], [1, 0],
        [-1, 1], [0, 1]
      ];
      this.oddOffsets = [
        [0, -1], [1, -1],
        [-1, 0], [1, 0],
        [0, 1], [1, 1]
      ];
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.grid = new Uint8Array(width * height);
      this.next = new Uint8Array(width * height);
      this.display = new Uint8Array(width * height);
      this.seed(0.27);
      this.display.set(this.grid);
      this.revealRow = 0;
      this.stepAccumulator = 0;
    }

    seed(fillProbability) {
      if (!this.grid) return;
      for (let i = 0; i < this.grid.length; i++) {
        this.grid[i] = Math.random() < fillProbability ? 1 : 0;
      }
    }

    index(x, y) {
      return (y * this.width) + x;
    }

    countHexNeighbors(grid, x, y) {
      const offsets = (y & 1) === 0 ? this.evenOffsets : this.oddOffsets;
      let count = 0;
      for (let i = 0; i < offsets.length; i++) {
        const ox = offsets[i][0];
        const oy = offsets[i][1];
        const nx = (x + ox + this.width) % this.width;
        const ny = (y + oy + this.height) % this.height;
        count += grid[this.index(nx, ny)];
      }
      return count;
    }

    computeNextGeneration() {
      let aliveCount = 0;
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = this.index(x, y);
          const alive = this.grid[idx] === 1;
          const neighbors = this.countHexNeighbors(this.grid, x, y);
          let nextAlive = alive
            ? this.surviveCounts.has(neighbors)
            : this.bornCounts.has(neighbors);
          if (this.aperiodicMix > 0) {
            const quasi = this.aperiodicField(x, y, this.generation);
            if (nextAlive && quasi < (this.aperiodicMix * 0.2)) {
              nextAlive = false;
            } else if (!nextAlive && neighbors >= 2 && quasi > (1 - (this.aperiodicMix * 0.12))) {
              nextAlive = true;
            }
          }
          const value = nextAlive ? 1 : 0;
          this.next[idx] = value;
          aliveCount += value;
        }
      }
      if (aliveCount < Math.floor(this.grid.length * 0.008)) {
        this.injectPulse(Math.floor(12 + (Math.random() * 18)));
      }
    }

    revealNextRows(rowsPerStep) {
      const start = this.revealRow;
      const end = Math.min(this.height, start + rowsPerStep);
      for (let y = start; y < end; y++) {
        const rowOffset = y * this.width;
        for (let x = 0; x < this.width; x++) {
          const idx = rowOffset + x;
          this.display[idx] = this.next[idx];
        }
      }
      this.revealRow = end;
      if (this.revealRow >= this.height) {
        const tmp = this.grid;
        this.grid = this.next;
        this.next = tmp;
        this.display.set(this.grid);
        this.generation += 1;
        this.revealRow = 0;
      }
    }

    injectPulse(points) {
      if (!this.grid) return;
      for (let i = 0; i < points; i++) {
        const x = Math.floor(Math.random() * this.width);
        const y = Math.floor(Math.random() * this.height);
        this.grid[this.index(x, y)] = 1;
      }
      this.display.set(this.grid);
    }

    update(dt, audioFrame) {
      if (!this.grid || !this.display) return;

      const low = audioFrame ? (audioFrame.low || 0) : 0;
      const mid = audioFrame ? (audioFrame.mid || 0) : 0;
      const high = audioFrame ? (audioFrame.high || 0) : 0;
      const beat = !!(audioFrame && audioFrame.beat);

      const audioSpeedFactor = this.syncToAudio ? (0.55 + (low * 2.2)) : 1;
      const speedFactor = this.manualSpeed * audioSpeedFactor;
      this.stepAccumulator += dt * speedFactor;

      if (beat) {
        this.injectPulse(Math.floor(4 + (mid * 20)));
      }

      while (this.stepAccumulator >= this.stepInterval) {
        this.stepAccumulator -= this.stepInterval;
        if (this.revealRow === 0) {
          this.computeNextGeneration();
        }
        const audioRows = this.syncToAudio ? ((mid + high) * 3) : 0;
        const rowsPerStep = Math.max(1, Math.floor(this.baseRevealRows + audioRows));
        this.revealNextRows(rowsPerStep);
      }
    }

    configure(options = {}) {
      if (options && Number.isFinite(options.speed)) {
        this.manualSpeed = Math.max(0.1, Math.min(6, Number(options.speed)));
      }
      if (options && typeof options.syncToAudio === "boolean") {
        this.syncToAudio = !!options.syncToAudio;
      }
      if (options && Number.isFinite(options.sweepRows)) {
        this.baseRevealRows = Math.max(1, Math.min(16, Math.floor(Number(options.sweepRows))));
      }
      if (options && typeof options.rule === "string") {
        this.setRule(options.rule);
      }
      if (options && Number.isFinite(options.aperiodicMix)) {
        this.aperiodicMix = Math.max(0, Math.min(1, Number(options.aperiodicMix)));
      }
    }

    aperiodicField(x, y, generation) {
      const v =
        (x * 0.7548776662466927)
        + (y * 0.5698402909980532)
        + (generation * 0.6180339887498948);
      return v - Math.floor(v);
    }

    setRule(ruleText) {
      const parsed = this.parseRule(ruleText);
      if (!parsed) return false;
      this.rule = parsed.rule;
      this.bornCounts = parsed.born;
      this.surviveCounts = parsed.survive;
      return true;
    }

    parseRule(ruleText) {
      const normalized = String(ruleText || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
      const match = normalized.match(/^B([0-6]*)\/S([0-6]*)$/);
      if (!match) return null;
      const born = new Set();
      const survive = new Set();
      for (let i = 0; i < match[1].length; i++) {
        born.add(Number(match[1][i]));
      }
      for (let i = 0; i < match[2].length; i++) {
        survive.add(Number(match[2][i]));
      }
      return { rule: normalized, born, survive };
    }

    getState() {
      return this.display;
    }

    dispose() {
      this.grid = null;
      this.next = null;
      this.display = null;
    }
  }

  window.HypermuseHexLifeSimulationPlugin = HypermuseHexLifeSimulationPlugin;
})();
