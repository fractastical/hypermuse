
const NOTES_ARRAY = [
    {note: 'C0', frequency: 16.35},
    {note: 'C#0/Db0', frequency: 17.32},
    {note: 'D0', frequency: 18.35},
    {note: 'D#0/Eb0', frequency: 19.45},
    {note: 'E0', frequency: 20.60},
    {note: 'F0', frequency: 21.83},
    {note: 'F#0/Gb0', frequency: 23.12},
    {note: 'G0', frequency: 24.50},
    {note: 'G#0/Ab0', frequency: 25.96},
    {note: 'A0', frequency: 27.50},
    {note: 'A#0/Bb0', frequency: 29.14},
    {note: 'B0', frequency: 30.87},

    {note: 'C8', frequency: 4186.01},
    {note: 'C#8/Db8', frequency: 4434.92},
    {note: 'D8', frequency: 4698.63},
    {note: 'D#8/Eb8', frequency: 4978.03},
    {note: 'E8', frequency: 5274.04},
    {note: 'F8', frequency: 5587.65},
    {note: 'F#8/Gb8', frequency: 5919.91},
    {note: 'G8', frequency: 6271.93},
    {note: 'G#8/Ab8', frequency: 6644.88},
    {note: 'A8', frequency: 7040.00},
    {note: 'A#8/Bb8', frequency: 7458.62},
    {note: 'B8', frequency: 7902.13}
];

    const NOTES_NONARRAY = {
    A0: 27.50,
    Bb0: 29.14,
    B0: 30.87,
    C1: 32.70,
    Db1: 34.65,
    D1: 36.71,
    Eb1: 38.89,
    E1: 41.20,
    F1: 43.65,
    Gb1: 46.25,
    G1: 49.00,
    Ab1: 51.91,
    A1: 55.00,
    Bb1: 58.27,
    B1: 61.74,
    C2: 65.41,
    Db2: 69.30,
    D2: 73.42,
    Eb2: 77.78,
    E2: 82.41,
    F2: 87.31,
    Gb2: 92.50,
    G2: 98.00,
    Ab2: 103.83,
    A2: 110.00,
    Bb2: 116.54,
    B2: 123.47,
    C3: 130.81,
    Db3: 138.59,
    D3: 146.83,
    Eb3: 155.56,
    E3: 164.81,
    F3: 174.61,
    Gb3: 185.00,
    G3: 196.00,
    Ab3: 207.65,
    A3: 220.00,
    Bb3: 233.08,
    B3: 246.94,
    C4: 261.63,
    Db4: 277.18,
    D4: 293.66,
    Eb4: 311.13,
    E4: 329.63,
    F4: 349.23,
    Gb4: 369.99,
    G4: 392.00,
    Ab4: 415.30,
    A4: 440.00,  // Standard tuning reference pitch
    Bb4: 466.16,
    B4: 493.88,
    C5: 523.25,
    Db5: 554.37,
    D5: 587.33,
    Eb5: 622.25,
    E5: 659.26,
    F5: 698.46,
    Gb5: 739.99,
    G5: 783.99,
    Ab5: 830.61,
    A5: 880.00,
    Bb5: 932.33,
    B5: 987.77,
    C6: 1046.50,
    Db6: 1108.73,
    D6: 1174.66,
    Eb6: 1244.51,
    E6: 1318.51,
    F6: 1396.91,
    Gb6: 1479.98,
    G6: 1567.98,
    Ab6: 1661.22,
    A6: 1760.00,
    Bb6: 1864.66,
    B6: 1975.53,
    C7: 2093.00,
    Db7: 2217.46,
    D7: 2349.32,
    Eb7: 2489.02,
    E7: 2637.02,
    F7: 2793.83,
    Gb7: 2959.96,
    G7: 3135.96,
    Ab7: 3322.44,
    A7: 3520.00,
    Bb7: 3729.31,
    B7: 3951.07,
    C8: 4186.01
};


const NOTES = Object.entries(NOTES_NONARRAY).map(([note, frequency]) => ({note, frequency}));

    function frequencyToMIDINoteNumber(frequency) {
    const referenceFrequency = 440; // A4
    return Math.round(69 + 12 * Math.log2(frequency / referenceFrequency));
}

function midiNoteNumberToNoteName(midiNoteNumber) {
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const noteName = noteNames[midiNoteNumber % 12];
    const octave = Math.floor(midiNoteNumber / 12) - 1;
    return noteName + octave;
}

function getPeakFrequencies(dataArray, threshold) {
    let peaks = [];
    for (let i = 1; i < dataArray.length - 1; i++) {
        if (dataArray[i] > threshold && dataArray[i] > dataArray[i-1] && dataArray[i] > dataArray[i+1]) {
            peaks.push(i);
        }
    }
    return peaks;
}

function labelDetectedTones(dataArray, threshold) {
    const peakIndices = getPeakFrequencies(dataArray, threshold);
    return peakIndices.map(index => {
        const frequency = index * (audioContext.sampleRate / 2) / dataArray.length; // Convert index to frequency
        const midiNoteNumber = frequencyToMIDINoteNumber(frequency);
        return midiNoteNumberToNoteName(midiNoteNumber);
    });
}

function generateNoteTexture(note) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');

    // Fill the canvas with a color (e.g., white)
    context.fillStyle = 'white';
    context.fillRect(0, 0, canvas.width, canvas.height);

    // Set the font and draw the note in the center
    context.font = '50px Arial';
    context.fillStyle = 'black';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    // console.log(note);
    context.fillText(note, canvas.width / 2, canvas.height / 2);

    // Return a Three.js texture
    const texture = new THREE.CanvasTexture(canvas);
    return texture;
}

function createNoteSphere(note) {
    const radius = 1;  // you can adjust this as needed

    // Create the sphere geometry
    const geometry = new THREE.SphereGeometry(radius, 32, 32);

    // Use the note texture for the material
    const material = new THREE.MeshBasicMaterial({ map: generateNoteTexture(note) });

    // Create and return the sphere mesh
    return new THREE.Mesh(geometry, material);
}

function clearNoteSpheres() {
    for (let i = scene.children.length - 1; i >= 0; i--) {
        let child = scene.children[i];
        if (child.userData && child.userData.type === 'noteSphere') {
            scene.remove(child);
        }
    }
}

function getPeakIndex(data) {
    const THRESHOLD = 40; // Adjust as needed.
    let peakIndex = null;
    let maxVal = -Infinity;

    for (let i = 1; i < data.length - 1; i++) {
        if (data[i] > THRESHOLD && data[i] > maxVal && data[i] > data[i-1] && data[i] > data[i+1]) {
            peakIndex = i;
            maxVal = data[i];
        }
    }

    return peakIndex;
}

function findPeaks(dataArray) {
    const threshold = 128; // Adjust this value based on your needs
    let peaks = [];

    for (let i = 1; i < dataArray.length - 1; i++) {
        if (dataArray[i] > threshold && dataArray[i] > dataArray[i-1] && dataArray[i] > dataArray[i+1]) {
            peaks.push({ index: i, value: dataArray[i] });
        }
    }

    // Sort peaks by value in descending order
    peaks.sort((a, b) => b.value - a.value);

    return peaks;
}


function detectNoteFromBand(band, bandWidth) {

    // let maxVolume = Math.max(...band);
    // let maxIndex = band.indexOf(maxVolume);

    // peakIndex = getPeakIndex(band);

    // if (peakIndex === null) return null;
    let peaks = findPeaks(band);
    let topNPeaks = peaks.slice(0, 5); // Taking top 5 peaks as an example
    peakIndex = topNPeaks[0];
    
    const freq = peakIndex * bandWidth;
    let closestNote = NOTES[0];
    let smallestDifference = Math.abs(NOTES[0].frequency - freq);

    for (let i = 1; i < NOTES.length; i++) {
        const difference = Math.abs(NOTES[i].frequency - freq);
        if (difference < smallestDifference) {
            closestNote = NOTES[i];
            smallestDifference = difference;
        }
    }
    // TODO: is off by a wide margin
    // console.log(freq);
    // console.log(audioContext.sampleRate);
    // console.log(analyser.fftSize);
    // console.log(analyser.frequencyBinCount); // Should be half of fftSize
    // // console.log(bandwidth);

    for (let peak of topNPeaks) {
        const frequency = peak.index * bandWidth;
        console.log("Peak at:", frequency, "Hz with amplitude:", peak.value);
        // if (peak.value < 150)
        //     detectBeat();
    }
    return closestNote;
}

function detectBeat() {
    analyser.getByteTimeDomainData(beatDataArray);
    // console.log(beatDataArray);
    console.log("finding beat!");
    console.log(beatDataArray.slice(0, 10)); // Log the first 10 values

    // Calculate the energy of the current buffer
    let energy = beatDataArray.reduce((acc, val) => acc + (val - 128) * (val - 128), 0);
    
    // Get average energy of the previous frames
    let avgEnergy = previousEnergies.length ? (previousEnergies.reduce((acc, val) => acc + val, 0) / previousEnergies.length) : energy;

    // Check if current energy is significantly higher than the recent average
    if (energy > BEAT_THRESHOLD * avgEnergy) {
        console.log("Beat detected!");
        // Handle the beat. Here you can adjust your fade & interval functions or whatever you wish to sync with the beat
    }
    console.log("Energy:", energy, "Avg Energy:", avgEnergy);

    
    // Keep track of past energies
    previousEnergies.push(energy);
    if (previousEnergies.length > ENERGY_HISTORY) {
        previousEnergies.shift(); // Remove the oldest energy value if we exceed the ENERGY_HISTORY limit
    }
    
    requestAnimationFrame(detectBeat);
}
