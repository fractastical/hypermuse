// Coupled-oscillator simulation plugin (Kuramoto-inspired).
// Treats each cell as a communicating oscillator with local coupling.
(function () {
  class HypermuseKuramotoSimulationPlugin {
    constructor(id = "kuramoto") {
      this.id = id;
      this.width = 0;
      this.height = 0;
      this.count = 0;
      this.phase = null;
      this.nextPhase = null;
      this.omega = null;
      this.state = null;
      this.neighborRadius = 1;
      this.baseCoupling = 1.4;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.count = width * height;
      this.phase = new Float32Array(this.count);
      this.nextPhase = new Float32Array(this.count);
      this.omega = new Float32Array(this.count);
      this.state = new Uint8Array(this.count);

      for (let i = 0; i < this.count; i++) {
        this.phase[i] = Math.random() * Math.PI * 2;
        this.omega[i] = (Math.random() - 0.5) * 0.22;
      }
    }

    update(dt, audioFrame) {
      if (!this.phase || !audioFrame) {
        return;
      }

      const low = audioFrame.low || 0;
      const mid = audioFrame.mid || 0;
      const high = audioFrame.high || 0;
      const beat = Boolean(audioFrame.beat);

      const coupling = this.baseCoupling + (mid * 2.6);
      const drive = (low - 0.5) * 1.2;
      const activationThreshold = 0.15 + ((1 - high) * 0.35);

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = this.index(x, y);
          const localCoupling = this.couplingTerm(x, y, coupling);
          const beatKick = beat ? ((Math.random() - 0.5) * 1.4) : 0;

          let p = this.phase[idx] + (this.omega[idx] + drive + localCoupling + beatKick) * dt * 3.5;
          if (p < 0) {
            p += Math.PI * 2;
          } else if (p >= Math.PI * 2) {
            p -= Math.PI * 2;
          }
          this.nextPhase[idx] = p;
        }
      }

      const tmp = this.phase;
      this.phase = this.nextPhase;
      this.nextPhase = tmp;

      for (let i = 0; i < this.count; i++) {
        const signal = 0.5 + (0.5 * Math.sin(this.phase[i]));
        this.state[i] = signal > activationThreshold ? 1 : 0;
      }
    }

    couplingTerm(x, y, couplingStrength) {
      const idx = this.index(x, y);
      const ownPhase = this.phase[idx];
      let sum = 0;
      let n = 0;

      for (let oy = -this.neighborRadius; oy <= this.neighborRadius; oy++) {
        for (let ox = -this.neighborRadius; ox <= this.neighborRadius; ox++) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = (x + ox + this.width) % this.width;
          const ny = (y + oy + this.height) % this.height;
          const nIdx = this.index(nx, ny);
          sum += Math.sin(this.phase[nIdx] - ownPhase);
          n++;
        }
      }

      if (n === 0) {
        return 0;
      }
      return (couplingStrength / n) * sum;
    }

    index(x, y) {
      return (y * this.width) + x;
    }

    getState() {
      return this.state;
    }

    dispose() {
      this.phase = null;
      this.nextPhase = null;
      this.omega = null;
      this.state = null;
    }
  }

  window.HypermuseKuramotoSimulationPlugin = HypermuseKuramotoSimulationPlugin;
})();
