// Lightweight p5-style background engine for fullscreen generative backdrops.
(function () {
  class HypermuseP5BackgroundEngine {
    constructor(options = {}) {
      this.width = Math.max(64, options.width || 512);
      this.height = Math.max(64, options.height || 512);
      this.canvas = document.createElement("canvas");
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.ctx = this.canvas.getContext("2d");
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.wrapS = THREE.RepeatWrapping;
      this.texture.wrapT = THREE.RepeatWrapping;
      this.texture.needsUpdate = true;
      this.timeSec = 0;
      this.registry = {};
      this.currentId = "";
      this.state = {};
      this.registerBuiltins();
    }

    register(id, script) {
      if (!id || !script || typeof script.draw !== "function") {
        return;
      }
      this.registry[String(id).trim().toLowerCase()] = script;
    }

    setScript(id) {
      const key = String(id || "").trim().toLowerCase();
      if (!key || !this.registry[key]) {
        return false;
      }
      this.currentId = key;
      this.state = {};
      const script = this.registry[key];
      if (typeof script.init === "function") {
        script.init({
          ctx: this.ctx,
          width: this.width,
          height: this.height,
          state: this.state
        });
      } else {
        this.ctx.clearRect(0, 0, this.width, this.height);
      }
      this.texture.needsUpdate = true;
      return true;
    }

    update(dt, audioFrame) {
      if (!this.currentId) {
        return;
      }
      const script = this.registry[this.currentId];
      if (!script) {
        return;
      }
      this.timeSec += Math.max(0.001, dt || 0.016);
      script.draw({
        ctx: this.ctx,
        width: this.width,
        height: this.height,
        timeSec: this.timeSec,
        dt: Math.max(0.001, dt || 0.016),
        audioFrame: audioFrame || {},
        state: this.state
      });
      this.texture.needsUpdate = true;
    }

    registerBuiltins() {
      this.register("infinitestreams-flow", {
        init: ({ ctx, width, height }) => {
          ctx.fillStyle = "#02070d";
          ctx.fillRect(0, 0, width, height);
        },
        draw: ({ ctx, width, height, timeSec, audioFrame }) => {
          const low = audioFrame.low || 0;
          const mid = audioFrame.mid || 0;
          const high = audioFrame.high || 0;
          const beat = audioFrame.beat ? 1 : 0;

          ctx.fillStyle = "rgba(2, 6, 12, 0.12)";
          ctx.fillRect(0, 0, width, height);

          const streams = 18;
          for (let i = 0; i < streams; i++) {
            const phase = timeSec * (0.22 + (mid * 0.8)) + (i * 0.34);
            const y = ((i + 0.5) / streams) * height;
            const amp = (10 + (low * 34) + (i % 3) * 4);
            const x0 = width * 0.08;
            const x3 = width * 0.92;
            const x1 = width * 0.34 + (Math.sin(phase * 1.2) * amp);
            const x2 = width * 0.66 + (Math.cos((phase * 1.1) + 1.1) * amp);
            const y1 = y + (Math.sin(phase) * amp * 0.45);
            const y2 = y + (Math.cos((phase * 0.9) + 1.7) * amp * 0.45);

            const hue = 150 + (Math.sin(phase * 0.5) * 35) + (high * 45);
            const light = 42 + (high * 25) + (beat * 12);
            ctx.strokeStyle = `hsla(${hue}, 92%, ${light}%, ${0.12 + (mid * 0.22)})`;
            ctx.lineWidth = 0.9 + (high * 1.4);
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.bezierCurveTo(x1, y1, x2, y2, x3, y);
            ctx.stroke();
          }
        }
      });

      this.register("infinitestreams-plasma", {
        init: ({ ctx, width, height }) => {
          ctx.fillStyle = "#02070d";
          ctx.fillRect(0, 0, width, height);
        },
        draw: ({ ctx, width, height, timeSec, audioFrame }) => {
          const low = audioFrame.low || 0;
          const mid = audioFrame.mid || 0;
          const high = audioFrame.high || 0;
          const cell = 6;
          for (let y = 0; y < height; y += cell) {
            for (let x = 0; x < width; x += cell) {
              const nx = x / width;
              const ny = y / height;
              const wave = Math.sin((nx * 10) + (timeSec * (0.9 + (mid * 1.3))));
              const swirl = Math.cos((ny * 12) - (timeSec * (0.7 + (high * 1.4))));
              const pulse = Math.sin((nx + ny) * 18 + (timeSec * (1.1 + (low * 2.1))));
              const v = (wave + swirl + pulse) / 3;
              const hue = 170 + (v * 34) + (high * 55);
              const sat = 88;
              const light = 24 + ((v + 1) * 16) + (low * 10);
              ctx.fillStyle = `hsl(${hue}, ${sat}%, ${light}%)`;
              ctx.fillRect(x, y, cell, cell);
            }
          }
          ctx.fillStyle = "rgba(4, 10, 16, 0.08)";
          ctx.fillRect(0, 0, width, height);
        }
      });
    }
  }

  window.HypermuseP5BackgroundEngine = HypermuseP5BackgroundEngine;
})();
