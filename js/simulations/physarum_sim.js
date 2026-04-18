// Physarum-style agent trail simulation plugin with audio modulation.
(function () {
  class HypermusePhysarumSimulationPlugin {
    constructor(id = "physarum") {
      this.id = id;
      this.width = 0;
      this.height = 0;
      this.count = 0;
      this.state = null;
      this.trail = null;
      this.nextTrail = null;
      this.agentCount = 420;
      this.agentsX = null;
      this.agentsY = null;
      this.agentsHeading = null;
      this.sensorDistance = 6;
      this.sensorAngle = Math.PI * 0.28;
      this.turnAngle = Math.PI * 0.16;
      this.depositAmount = 0.95;
      this.decayRate = 0.09;
      this.diffusionRate = 0.16;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.count = width * height;
      this.state = new Uint8Array(this.count);
      this.trail = new Float32Array(this.count);
      this.nextTrail = new Float32Array(this.count);

      this.agentsX = new Float32Array(this.agentCount);
      this.agentsY = new Float32Array(this.agentCount);
      this.agentsHeading = new Float32Array(this.agentCount);
      this.seedAgents();
    }

    seedAgents() {
      const cx = this.width * 0.5;
      const cy = this.height * 0.5;
      const minR = Math.min(this.width, this.height) * 0.1;
      const maxR = Math.min(this.width, this.height) * 0.22;
      for (let i = 0; i < this.agentCount; i++) {
        const a = (i / this.agentCount) * Math.PI * 2;
        const r = minR + (Math.random() * (maxR - minR));
        this.agentsX[i] = cx + Math.cos(a) * r;
        this.agentsY[i] = cy + Math.sin(a) * r;
        this.agentsHeading[i] = a + Math.PI + ((Math.random() - 0.5) * 0.65);
      }
    }

    update(dt, audioFrame) {
      if (!this.trail || !this.agentsX) {
        return;
      }
      const low = audioFrame ? audioFrame.low || 0 : 0;
      const mid = audioFrame ? audioFrame.mid || 0 : 0;
      const high = audioFrame ? audioFrame.high || 0 : 0;
      const beat = audioFrame ? !!audioFrame.beat : false;

      const moveSpeed = 16 + (low * 30);
      const turnAngle = this.turnAngle + (mid * 0.55);
      const sensorDistance = this.sensorDistance + (high * 4.5);
      const sensorAngle = this.sensorAngle + (mid * 0.25);
      const decay = this.decayRate + (high * 0.06);
      const diffuse = this.diffusionRate + (mid * 0.08);
      const deposit = this.depositAmount + (low * 0.45);

      for (let i = 0; i < this.agentCount; i++) {
        const x = this.agentsX[i];
        const y = this.agentsY[i];
        const h = this.agentsHeading[i];

        const forward = this.sampleSensor(x, y, h, sensorDistance);
        const left = this.sampleSensor(x, y, h - sensorAngle, sensorDistance);
        const right = this.sampleSensor(x, y, h + sensorAngle, sensorDistance);

        let nextHeading = h;
        if (forward < left && forward < right) {
          nextHeading += (Math.random() < 0.5 ? -1 : 1) * turnAngle;
        } else if (left > right) {
          nextHeading -= turnAngle;
        } else if (right > left) {
          nextHeading += turnAngle;
        }
        if (beat && Math.random() < 0.1) {
          nextHeading += (Math.random() - 0.5) * 1.2;
        }

        let nx = x + Math.cos(nextHeading) * moveSpeed * dt;
        let ny = y + Math.sin(nextHeading) * moveSpeed * dt;

        if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
          nx = (nx + this.width) % this.width;
          ny = (ny + this.height) % this.height;
          nextHeading += Math.PI * (0.6 + (Math.random() * 0.8));
        }

        this.agentsX[i] = nx;
        this.agentsY[i] = ny;
        this.agentsHeading[i] = nextHeading;

        const idx = this.index(Math.floor(nx), Math.floor(ny));
        this.trail[idx] = Math.min(2.2, this.trail[idx] + deposit);
      }

      this.diffuseAndDecay(diffuse, decay);
      this.renderState();
    }

    sampleSensor(x, y, heading, distance) {
      const sx = Math.floor((x + Math.cos(heading) * distance + this.width) % this.width);
      const sy = Math.floor((y + Math.sin(heading) * distance + this.height) % this.height);
      return this.trail[this.index(sx, sy)];
    }

    diffuseAndDecay(diffuse, decay) {
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = this.index(x, y);
          const here = this.trail[idx];
          const lap = this.trailLaplacian(x, y);
          let next = here + (lap * diffuse);
          next *= (1 - decay);
          this.nextTrail[idx] = Math.max(0, Math.min(2.5, next));
        }
      }
      const tmp = this.trail;
      this.trail = this.nextTrail;
      this.nextTrail = tmp;
    }

    trailLaplacian(x, y) {
      const xm1 = (x - 1 + this.width) % this.width;
      const xp1 = (x + 1) % this.width;
      const ym1 = (y - 1 + this.height) % this.height;
      const yp1 = (y + 1) % this.height;
      const center = this.trail[this.index(x, y)] * -1;
      const direct = (
        this.trail[this.index(xm1, y)] +
        this.trail[this.index(xp1, y)] +
        this.trail[this.index(x, ym1)] +
        this.trail[this.index(x, yp1)]
      ) * 0.2;
      const diagonal = (
        this.trail[this.index(xm1, ym1)] +
        this.trail[this.index(xm1, yp1)] +
        this.trail[this.index(xp1, ym1)] +
        this.trail[this.index(xp1, yp1)]
      ) * 0.05;
      return center + direct + diagonal;
    }

    renderState() {
      for (let i = 0; i < this.count; i++) {
        this.state[i] = this.trail[i] > 0.16 ? 1 : 0;
      }
    }

    index(x, y) {
      return (y * this.width) + x;
    }

    getState() {
      return this.state;
    }

    dispose() {
      this.state = null;
      this.trail = null;
      this.nextTrail = null;
      this.agentsX = null;
      this.agentsY = null;
      this.agentsHeading = null;
    }
  }

  window.HypermusePhysarumSimulationPlugin = HypermusePhysarumSimulationPlugin;
})();
