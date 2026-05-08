// Gray-Scott reaction-diffusion simulation plugin with audio modulation.
(function () {
  class HypermuseGrayScottSimulationPlugin {
    constructor(id = "gray-scott") {
      this.id = id;
      this.width = 0;
      this.height = 0;
      this.count = 0;
      this.u = null;
      this.v = null;
      this.nextU = null;
      this.nextV = null;
      this.state = null;
      this.stepAccumulator = 0;
      this.stepInterval = 0.02;
      this.diffusionU = 0.16;
      this.diffusionV = 0.08;
      this.feedBase = 0.034;
      this.killBase = 0.062;
      this.vThreshold = 0.24;
      this.presetName = "nexus";
    }

    applyPreset(name) {
      const preset = HypermuseGrayScottSimulationPlugin.PRESETS[String(name || "").trim().toLowerCase()];
      if (!preset) {
        return false;
      }
      this.presetName = String(name || "").trim().toLowerCase();
      this.diffusionU = preset.diffusionU;
      this.diffusionV = preset.diffusionV;
      this.feedBase = preset.feedBase;
      this.killBase = preset.killBase;
      this.vThreshold = preset.vThreshold;
      return true;
    }

    configure(params = {}) {
      if (Number.isFinite(params.diffusionU)) this.diffusionU = params.diffusionU;
      if (Number.isFinite(params.diffusionV)) this.diffusionV = params.diffusionV;
      if (Number.isFinite(params.feedBase)) this.feedBase = params.feedBase;
      if (Number.isFinite(params.killBase)) this.killBase = params.killBase;
      if (Number.isFinite(params.vThreshold)) this.vThreshold = params.vThreshold;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.count = width * height;
      this.u = new Float32Array(this.count);
      this.v = new Float32Array(this.count);
      this.nextU = new Float32Array(this.count);
      this.nextV = new Float32Array(this.count);
      this.state = new Uint8Array(this.count);
      this.seed();
    }

    seed() {
      if (!this.u || !this.v) {
        return;
      }
      for (let i = 0; i < this.count; i++) {
        this.u[i] = 1;
        this.v[i] = 0;
      }
      const cx = Math.floor(this.width / 2);
      const cy = Math.floor(this.height / 2);
      for (let y = -6; y <= 6; y++) {
        for (let x = -6; x <= 6; x++) {
          const ix = (cx + x + this.width) % this.width;
          const iy = (cy + y + this.height) % this.height;
          const idx = this.index(ix, iy);
          this.v[idx] = 0.75 + (Math.random() * 0.2);
          this.u[idx] = 1 - (this.v[idx] * 0.55);
        }
      }
    }

    update(dt, audioFrame) {
      if (!this.u || !this.v) {
        return;
      }
      const low = audioFrame ? audioFrame.low || 0 : 0;
      const mid = audioFrame ? audioFrame.mid || 0 : 0;
      const high = audioFrame ? audioFrame.high || 0 : 0;
      const beat = audioFrame ? !!audioFrame.beat : false;

      const speed = 0.8 + (low * 2.2);
      this.stepAccumulator += dt * speed;

      if (beat) {
        this.inject(Math.floor(2 + (high * 8)), 4 + Math.floor(mid * 6));
      }

      while (this.stepAccumulator >= this.stepInterval) {
        this.stepAccumulator -= this.stepInterval;
        this.step(low, mid, high);
      }
      this.renderState(high);
    }

    step(low, mid, high) {
      const feed = this.feedBase + (mid * 0.018);
      const kill = this.killBase + (high * 0.014);
      const du = this.diffusionU + (low * 0.015);
      const dv = this.diffusionV + (mid * 0.012);

      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = this.index(x, y);
          const u = this.u[idx];
          const v = this.v[idx];
          const uvv = u * v * v;
          const lapU = this.laplacian(this.u, x, y);
          const lapV = this.laplacian(this.v, x, y);

          let nextU = u + ((du * lapU) - uvv + (feed * (1 - u)));
          let nextV = v + ((dv * lapV) + uvv - ((kill + feed) * v));
          nextU = Math.max(0, Math.min(1.35, nextU));
          nextV = Math.max(0, Math.min(1.35, nextV));
          this.nextU[idx] = nextU;
          this.nextV[idx] = nextV;
        }
      }

      const tmpU = this.u;
      this.u = this.nextU;
      this.nextU = tmpU;
      const tmpV = this.v;
      this.v = this.nextV;
      this.nextV = tmpV;
    }

    inject(blobs, radius) {
      for (let i = 0; i < blobs; i++) {
        const cx = Math.floor(Math.random() * this.width);
        const cy = Math.floor(Math.random() * this.height);
        for (let y = -radius; y <= radius; y++) {
          for (let x = -radius; x <= radius; x++) {
            if ((x * x) + (y * y) > radius * radius) {
              continue;
            }
            const ix = (cx + x + this.width) % this.width;
            const iy = (cy + y + this.height) % this.height;
            const idx = this.index(ix, iy);
            this.v[idx] = Math.max(this.v[idx], 0.85);
            this.u[idx] = Math.min(this.u[idx], 0.25);
          }
        }
      }
    }

    renderState(high) {
      const threshold = this.vThreshold - (high * 0.07);
      for (let i = 0; i < this.count; i++) {
        this.state[i] = this.v[i] > threshold ? 1 : 0;
      }
    }

    laplacian(field, x, y) {
      const xm1 = (x - 1 + this.width) % this.width;
      const xp1 = (x + 1) % this.width;
      const ym1 = (y - 1 + this.height) % this.height;
      const yp1 = (y + 1) % this.height;
      const c = field[this.index(x, y)] * -1;
      const ns = (
        field[this.index(xm1, y)] +
        field[this.index(xp1, y)] +
        field[this.index(x, ym1)] +
        field[this.index(x, yp1)]
      ) * 0.2;
      const diag = (
        field[this.index(xm1, ym1)] +
        field[this.index(xm1, yp1)] +
        field[this.index(xp1, ym1)] +
        field[this.index(xp1, yp1)]
      ) * 0.05;
      return c + ns + diag;
    }

    index(x, y) {
      return (y * this.width) + x;
    }

    getState() {
      return this.state;
    }

    dispose() {
      this.u = null;
      this.v = null;
      this.nextU = null;
      this.nextV = null;
      this.state = null;
    }
  }

  HypermuseGrayScottSimulationPlugin.PRESETS = {
    nexus: { diffusionU: 0.16, diffusionV: 0.08, feedBase: 0.034, killBase: 0.062, vThreshold: 0.24 },
    coral: { diffusionU: 0.162, diffusionV: 0.082, feedBase: 0.03, killBase: 0.058, vThreshold: 0.22 },
    mitosis: { diffusionU: 0.157, diffusionV: 0.079, feedBase: 0.038, killBase: 0.066, vThreshold: 0.25 },
    veins: { diffusionU: 0.148, diffusionV: 0.074, feedBase: 0.026, killBase: 0.054, vThreshold: 0.2 },
    turing: { diffusionU: 0.176, diffusionV: 0.086, feedBase: 0.026, killBase: 0.054, vThreshold: 0.21 }
  };

  window.HypermuseGrayScottSimulationPlugin = HypermuseGrayScottSimulationPlugin;
})();
