// Lightweight audio feature extraction layer.
// Produces normalized band and beat data for simulation plugins.
(function () {
  class HypermuseAudioEngine {
    constructor(options = {}) {
      this.numBands = options.numBands || 48;
      this.beatThreshold = options.beatThreshold || 1.28;
      this.energyHistorySize = options.energyHistorySize || 32;
      this.energyHistory = [];
      this.lastBeatAt = 0;
      this.minBeatIntervalMs = options.minBeatIntervalMs || 140;
      this.smoothedEnergy = 0;
      this.barPhase = 0;
      this.estimatedBpm = options.estimatedBpm || 120;
    }

    setNumBands(numBands) {
      if (!Number.isFinite(numBands) || numBands <= 0) {
        return;
      }
      this.numBands = Math.max(1, Math.floor(numBands));
    }

    update(frequencyData, audioContext) {
      if (!frequencyData || frequencyData.length === 0) {
        return this._emptyFrame();
      }

      const now = performance.now();
      const bands = this._extractBandEnergies(frequencyData, this.numBands);
      const low = this._avgRange(bands, 0, Math.floor(this.numBands / 3));
      const mid = this._avgRange(
        bands,
        Math.floor(this.numBands / 3),
        Math.floor((this.numBands * 2) / 3)
      );
      const high = this._avgRange(
        bands,
        Math.floor((this.numBands * 2) / 3),
        this.numBands
      );

      const frameEnergy = (low * 0.5) + (mid * 0.35) + (high * 0.15);
      this.smoothedEnergy = (this.smoothedEnergy * 0.85) + (frameEnergy * 0.15);

      this.energyHistory.push(frameEnergy);
      if (this.energyHistory.length > this.energyHistorySize) {
        this.energyHistory.shift();
      }
      const energyMean = this.energyHistory.length > 0
        ? this.energyHistory.reduce((sum, value) => sum + value, 0) / this.energyHistory.length
        : frameEnergy;

      let beat = false;
      const enoughTimeSinceBeat = (now - this.lastBeatAt) > this.minBeatIntervalMs;
      if (enoughTimeSinceBeat && frameEnergy > (energyMean * this.beatThreshold)) {
        beat = true;
        this.lastBeatAt = now;
        this._updateEstimatedBpm(now);
      }

      const seconds = audioContext && audioContext.currentTime ? audioContext.currentTime : (now / 1000);
      const bps = this.estimatedBpm / 60;
      this.barPhase = (seconds * bps / 4) % 1;

      return {
        t: seconds,
        bands,
        low,
        mid,
        high,
        energy: frameEnergy,
        beat,
        barPhase: this.barPhase,
        bpmEstimate: this.estimatedBpm
      };
    }

    _updateEstimatedBpm(nowMs) {
      if (!this.prevBeatAt) {
        this.prevBeatAt = nowMs;
        return;
      }
      const deltaMs = nowMs - this.prevBeatAt;
      this.prevBeatAt = nowMs;
      if (deltaMs <= 0) {
        return;
      }
      const bpm = 60000 / deltaMs;
      if (bpm >= 60 && bpm <= 200) {
        this.estimatedBpm = (this.estimatedBpm * 0.8) + (bpm * 0.2);
      }
    }

    _extractBandEnergies(frequencyData, numBands) {
      const bandEnergies = new Float32Array(numBands);
      const bandSize = Math.max(1, Math.floor(frequencyData.length / numBands));
      for (let i = 0; i < numBands; i++) {
        const start = i * bandSize;
        const end = Math.min(frequencyData.length, start + bandSize);
        let sum = 0;
        for (let j = start; j < end; j++) {
          sum += frequencyData[j];
        }
        const avg = end > start ? (sum / (end - start)) : 0;
        bandEnergies[i] = avg / 255;
      }
      return bandEnergies;
    }

    _avgRange(values, start, end) {
      const clampedStart = Math.max(0, Math.min(values.length, start));
      const clampedEnd = Math.max(clampedStart + 1, Math.min(values.length, end));
      let sum = 0;
      let count = 0;
      for (let i = clampedStart; i < clampedEnd; i++) {
        sum += values[i];
        count++;
      }
      return count > 0 ? (sum / count) : 0;
    }

    _emptyFrame() {
      return {
        t: performance.now() / 1000,
        bands: new Float32Array(this.numBands),
        low: 0,
        mid: 0,
        high: 0,
        energy: 0,
        beat: false,
        barPhase: this.barPhase,
        bpmEstimate: this.estimatedBpm
      };
    }
  }

  window.HypermuseAudioEngine = HypermuseAudioEngine;
})();
