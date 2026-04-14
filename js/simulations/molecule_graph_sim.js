// Molecule graph communication plugin inspired by metajargon's SDF molecule flow.
// Uses atom/bond topology as a diffusion graph and maps activity to a texture field.
(function () {
  class HypermuseMoleculeGraphSimulationPlugin {
    constructor(id = "molecule-graph") {
      this.id = id;
      this.width = 0;
      this.height = 0;
      this.state = null;
      this.molecule = null;
      this.adjacency = [];
      this.atomSignals = null;
      this.nextSignals = null;
      this.atomUV = [];
      this.decay = 0.08;
      this.diffusion = 0.42;
      this.threshold = 0.2;
    }

    init(width, height) {
      this.width = width;
      this.height = height;
      this.state = new Uint8Array(width * height);
      this.loadFromSDF(this.defaultWaterSDF());
    }

    loadFromSDF(sdfData) {
      const molecule = this.parseSDF(sdfData);
      if (!molecule || !Array.isArray(molecule.atoms) || molecule.atoms.length === 0) {
        return;
      }
      this.molecule = molecule;
      this.buildGraph();
      this.atomSignals = new Float32Array(this.molecule.atoms.length);
      this.nextSignals = new Float32Array(this.molecule.atoms.length);
      this.atomUV = this.projectAtomsToUV(this.molecule.atoms);
    }

    update(dt, audioFrame) {
      if (!this.molecule || !this.atomSignals) {
        return;
      }
      const low = audioFrame ? audioFrame.low || 0 : 0;
      const mid = audioFrame ? audioFrame.mid || 0 : 0;
      const high = audioFrame ? audioFrame.high || 0 : 0;
      const beat = audioFrame ? !!audioFrame.beat : false;

      const dynamicDiffusion = this.diffusion + (mid * 0.25);
      const dynamicDecay = this.decay + (high * 0.08);

      for (let i = 0; i < this.atomSignals.length; i++) {
        const neighbors = this.adjacency[i];
        const own = this.atomSignals[i];
        let neighborAvg = 0;
        if (neighbors && neighbors.length > 0) {
          let sum = 0;
          for (let n = 0; n < neighbors.length; n++) {
            sum += this.atomSignals[neighbors[n]];
          }
          neighborAvg = sum / neighbors.length;
        }
        let next = own * (1 - dynamicDecay) + neighborAvg * dynamicDiffusion * dt * 8;
        this.nextSignals[i] = Math.max(0, Math.min(1.6, next));
      }

      if (beat && this.nextSignals.length > 0) {
        const randomAtom = Math.floor(Math.random() * this.nextSignals.length);
        this.nextSignals[randomAtom] = 1.2;
      }

      if (this.nextSignals.length > 0) {
        const centerAtom = Math.floor(this.nextSignals.length / 2);
        this.nextSignals[centerAtom] = Math.max(this.nextSignals[centerAtom], low * 1.1);
      }

      const tmp = this.atomSignals;
      this.atomSignals = this.nextSignals;
      this.nextSignals = tmp;

      this.renderState();
    }

    renderState() {
      this.state.fill(0);
      if (!this.atomUV || this.atomUV.length === 0) {
        return;
      }

      for (let i = 0; i < this.atomUV.length; i++) {
        const signal = this.atomSignals[i];
        if (signal < this.threshold) {
          continue;
        }
        const u = this.atomUV[i].u;
        const v = this.atomUV[i].v;
        const x = Math.max(0, Math.min(this.width - 1, Math.floor(u * (this.width - 1))));
        const y = Math.max(0, Math.min(this.height - 1, Math.floor(v * (this.height - 1))));
        this.state[(y * this.width) + x] = 1;

        // Draw neighboring communication links as a stronger field.
        const neighbors = this.adjacency[i];
        if (!neighbors) {
          continue;
        }
        for (let n = 0; n < neighbors.length; n++) {
          const j = neighbors[n];
          const other = this.atomUV[j];
          this.rasterizeLine(
            x,
            y,
            Math.max(0, Math.min(this.width - 1, Math.floor(other.u * (this.width - 1)))),
            Math.max(0, Math.min(this.height - 1, Math.floor(other.v * (this.height - 1))))
          );
        }
      }
    }

    rasterizeLine(x0, y0, x1, y1) {
      const dx = Math.abs(x1 - x0);
      const sx = x0 < x1 ? 1 : -1;
      const dy = -Math.abs(y1 - y0);
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      let x = x0;
      let y = y0;
      while (true) {
        this.state[(y * this.width) + x] = 1;
        if (x === x1 && y === y1) {
          break;
        }
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y += sy;
        }
      }
    }

    buildGraph() {
      const atomCount = this.molecule.atoms.length;
      this.adjacency = Array.from({ length: atomCount }, () => []);
      for (let i = 0; i < this.molecule.bonds.length; i++) {
        const bond = this.molecule.bonds[i];
        const a = bond.atom1 - 1;
        const b = bond.atom2 - 1;
        if (a < 0 || b < 0 || a >= atomCount || b >= atomCount) {
          continue;
        }
        this.adjacency[a].push(b);
        this.adjacency[b].push(a);
      }
    }

    projectAtomsToUV(atoms) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < atoms.length; i++) {
        const atom = atoms[i];
        minX = Math.min(minX, atom.x);
        minY = Math.min(minY, atom.y);
        maxX = Math.max(maxX, atom.x);
        maxY = Math.max(maxY, atom.y);
      }
      const spanX = Math.max(1e-6, maxX - minX);
      const spanY = Math.max(1e-6, maxY - minY);
      return atoms.map((atom) => ({
        u: (atom.x - minX) / spanX,
        v: (atom.y - minY) / spanY
      }));
    }

    // Adapted from metajargon/server/public/index.html parseSDF logic.
    parseSDF(sdfData) {
      const lines = sdfData.split("\n");
      if (lines.length < 5) {
        return null;
      }
      const atomCount = parseInt(lines[3].slice(0, 3).trim(), 10);
      const bondCount = parseInt(lines[3].slice(3, 6).trim(), 10);
      const atoms = [];
      for (let i = 4; i < 4 + atomCount; i++) {
        const line = lines[i] || "";
        const x = parseFloat(line.slice(0, 10).trim());
        const y = parseFloat(line.slice(10, 20).trim());
        const z = parseFloat(line.slice(20, 30).trim());
        const symbol = line.slice(31, 34).trim();
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
          continue;
        }
        atoms.push({ symbol, x, y, z });
      }
      const bonds = [];
      for (let i = 4 + atomCount; i < 4 + atomCount + bondCount; i++) {
        const line = lines[i] || "";
        const atom1 = parseInt(line.slice(0, 3).trim(), 10);
        const atom2 = parseInt(line.slice(3, 6).trim(), 10);
        const bondType = parseInt(line.slice(6, 9).trim(), 10);
        if (!Number.isFinite(atom1) || !Number.isFinite(atom2)) {
          continue;
        }
        bonds.push({ atom1, atom2, bondType });
      }
      return { atoms, bonds };
    }

    defaultWaterSDF() {
      return `water
  Generated by Hypermuse

  3  2  0  0  0  0            999 V2000
    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
    0.9572    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
   -0.2390    0.9266    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
  1  3  1  0  0  0  0
M  END`;
    }

    getState() {
      return this.state;
    }

    dispose() {
      this.state = null;
      this.molecule = null;
      this.adjacency = [];
      this.atomSignals = null;
      this.nextSignals = null;
      this.atomUV = [];
    }
  }

  window.HypermuseMoleculeGraphSimulationPlugin = HypermuseMoleculeGraphSimulationPlugin;
})();
