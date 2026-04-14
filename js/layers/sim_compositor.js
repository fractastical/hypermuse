// Simulation composition layer.
// Combines plugin outputs into a single canvas/texture for Three.js materials.
(function () {
  class HypermuseSimulationCompositor {
    constructor(options = {}) {
      this.width = options.width || 128;
      this.height = options.height || 128;
      this.plugins = [];

      this.canvas = document.createElement("canvas");
      this.canvas.width = this.width;
      this.canvas.height = this.height;
      this.ctx = this.canvas.getContext("2d");
      this.imageData = this.ctx.createImageData(this.width, this.height);
      this.texture = new THREE.CanvasTexture(this.canvas);
      this.texture.needsUpdate = true;
    }

    registerPlugin(plugin, options = {}) {
      if (!plugin || typeof plugin.init !== "function" || typeof plugin.update !== "function") {
        return;
      }
      plugin.init(this.width, this.height);
      this.plugins.push({
        plugin,
        opacity: Number.isFinite(options.opacity) ? options.opacity : 1,
        color: options.color || [80, 200, 255]
      });
    }

    setPluginOpacity(pluginId, opacity) {
      if (!pluginId || !Number.isFinite(opacity)) {
        return;
      }
      const nextOpacity = Math.max(0, Math.min(1.5, opacity));
      for (let i = 0; i < this.plugins.length; i++) {
        const entry = this.plugins[i];
        if (entry.plugin && entry.plugin.id === pluginId) {
          entry.opacity = nextOpacity;
        }
      }
    }

    update(dt, audioFrame) {
      if (this.plugins.length === 0) {
        return;
      }

      const pixels = this.imageData.data;
      for (let i = 0; i < pixels.length; i += 4) {
        // Soft persistence trail instead of full clear each frame.
        pixels[i] = Math.floor(pixels[i] * 0.88);
        pixels[i + 1] = Math.floor(pixels[i + 1] * 0.88);
        pixels[i + 2] = Math.floor(pixels[i + 2] * 0.9);
        pixels[i + 3] = Math.floor(pixels[i + 3] * 0.92);
      }

      for (let p = 0; p < this.plugins.length; p++) {
        const entry = this.plugins[p];
        entry.plugin.update(dt, audioFrame);
        const state = entry.plugin.getState ? entry.plugin.getState() : null;
        if (!state) {
          continue;
        }
        this._blendState(state, entry, pixels, audioFrame);
      }

      this.ctx.putImageData(this.imageData, 0, 0);
      this.texture.needsUpdate = true;
    }

    _blendState(state, entry, pixels, audioFrame) {
      const low = audioFrame ? audioFrame.low : 0;
      const mid = audioFrame ? audioFrame.mid : 0;
      const high = audioFrame ? audioFrame.high : 0;
      const beatBoost = audioFrame && audioFrame.beat ? 0.35 : 0;

      const colorR = Math.min(255, Math.floor(entry.color[0] + (high * 120)));
      const colorG = Math.min(255, Math.floor(entry.color[1] + (mid * 90)));
      const colorB = Math.min(255, Math.floor(entry.color[2] + (low * 80)));
      const alpha = Math.min(255, Math.floor((150 + (beatBoost * 255)) * entry.opacity));

      for (let i = 0; i < state.length; i++) {
        if (state[i] !== 1) {
          continue;
        }
        const px = i * 4;
        pixels[px] = Math.min(255, pixels[px] + colorR);
        pixels[px + 1] = Math.min(255, pixels[px + 1] + colorG);
        pixels[px + 2] = Math.min(255, pixels[px + 2] + colorB);
        pixels[px + 3] = Math.max(pixels[px + 3], alpha);
      }
    }

    dispose() {
      for (let i = 0; i < this.plugins.length; i++) {
        const plugin = this.plugins[i].plugin;
        if (plugin && typeof plugin.dispose === "function") {
          plugin.dispose();
        }
      }
      this.plugins = [];
      if (this.texture) {
        this.texture.dispose();
      }
    }
  }

  window.HypermuseSimulationCompositor = HypermuseSimulationCompositor;
})();
