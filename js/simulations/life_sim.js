// Cellular simulation plugin (Conway-style life variant) with audio modulation.
(function () {
  class HypermuseLifeSimulationPlugin {
    constructor(id = "life") {
      this.id = id;
      this.width = 0;
      this.height = 0;
      this.grid = null;
      this.next = null;
      this.stepAccumulator = 0;
      this.stepInterval = 0.08; // seconds
      this.spawnOnBeat = true;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.grid = new Uint8Array(width * height);
      this.next = new Uint8Array(width * height);
      this.seed(0.18);
    }

    seed(fillProbability) {
      if (!this.grid) {
        return;
      }
      for (let i = 0; i < this.grid.length; i++) {
        this.grid[i] = Math.random() < fillProbability ? 1 : 0;
      }
    }

    update(dt, audioFrame) {
      if (!this.grid || !audioFrame) {
        return;
      }

      const low = audioFrame.low || 0;
      const mid = audioFrame.mid || 0;
      const high = audioFrame.high || 0;

      // Audio drives simulation speed and rule variation.
      const speedFactor = 0.5 + (low * 2.8);
      this.stepAccumulator += dt * speedFactor;

      if (this.spawnOnBeat && audioFrame.beat) {
        this.injectPulse(Math.floor(6 + (mid * 24)));
      }

      while (this.stepAccumulator >= this.stepInterval) {
        this.stepAccumulator -= this.stepInterval;
        this.step(mid, high);
      }
    }

    step(mid, high) {
      const surviveMin = 2;
      const surviveMax = 3 + (mid > 0.6 ? 1 : 0);
      const born = high > 0.5 ? 4 : 3;

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = this.index(x, y);
          const alive = this.grid[idx] === 1;
          const n = this.countNeighbors(x, y);

          let nextAlive = 0;
          if (alive) {
            nextAlive = (n >= surviveMin && n <= surviveMax) ? 1 : 0;
          } else {
            nextAlive = (n === born) ? 1 : 0;
          }
          this.next[idx] = nextAlive;
        }
      }

      const tmp = this.grid;
      this.grid = this.next;
      this.next = tmp;
    }

    injectPulse(points) {
      if (!this.grid) {
        return;
      }
      for (let i = 0; i < points; i++) {
        const x = Math.floor(Math.random() * this.width);
        const y = Math.floor(Math.random() * this.height);
        this.grid[this.index(x, y)] = 1;
      }
    }

    countNeighbors(x, y) {
      let count = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = (x + ox + this.width) % this.width;
          const ny = (y + oy + this.height) % this.height;
          count += this.grid[this.index(nx, ny)];
        }
      }
      return count;
    }

    index(x, y) {
      return (y * this.width) + x;
    }

    getState() {
      return this.grid;
    }

    dispose() {
      this.grid = null;
      this.next = null;
    }
  }

  window.HypermuseLifeSimulationPlugin = HypermuseLifeSimulationPlugin;
})();
