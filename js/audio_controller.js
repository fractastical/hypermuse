
function getAverageVolume(array) {
    var values = 0;
    var average;
    var length = array.length;
    for (var i = 0; i < length; i++) {
        values += array[i];
    }
    average = values / length;
    return average;
}


function playSound(audioBuffer) {
    if (audioSource) {
        audioSource.stop();
    }

    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(analyser);
    analyser.connect(audioContext.destination);
    audioSource.onended = playNext;  // Play the next file when the current one finishes
    audioSource.start();
}

// Your playSound and animate functions would be defined elsewhere

async function playMidi(midiData) {
    const synth = new Tone.Synth().toDestination();
    synth.connect(analyser);
    synth.toDestination();

    // Schedule the events to play
    midiData.tracks[0].notes.forEach(note => {
        synth.triggerAttackRelease(note.name, note.duration, note.time, note.velocity);
    });

    // Start the playback
    await Tone.start();
    Tone.Transport.start();
}

// Define a function to highlight a vertex by its index
function highlightVertex(vertexIndex) {
    // Change the appearance of the specified vertex (e.g., color or size)
}

// Define a function to reset the appearance of all vertices
function resetVertices() {
    // Reset the appearance of all vertices to the default state
}

// Define a function to draw a line between two vertices
function drawLineBetweenVertices(vertexIndex1, vertexIndex2) {
    // Use three.js to draw a line between the specified vertices
}

// Play MIDI with vertex highlighting
async function playMidiWithVisuals(midiData) {
    for (const note of midiData.tracks[0].notes) {
        // Determine the corresponding vertex index for the note
        const vertexIndex = mapNoteToVertexIndex(note);

        // Reset the appearance of all vertices
        resetVertices();

        // Highlight the current vertex
        highlightVertex(vertexIndex);

        // Play the note

        // If there is a previously highlighted vertex, draw a line between them
        if (previousVertexIndex !== undefined) {
            drawLineBetweenVertices(previousVertexIndex, vertexIndex);
        }

        // Store the current vertex index as the previous one
        previousVertexIndex = vertexIndex;

        // Wait for the note duration
        await new Promise(resolve => setTimeout(resolve, note.duration));
    }
}

function populateQueueAgain() {
    const inputFiles = document.getElementById('audioInput').files;

    for (let file of inputFiles) {
        const url = URL.createObjectURL(file);
        console.log(url);
        audioQueue.push(url);
    }
}

function playNext() {
    if (audioQueue.length === 0) {
        // If the queue is empty, repopulate it
        for (let file of event.target.files) {
            audioQueue.push(file);
        }
    }

    const file = audioQueue.shift();  // Get the next file from the queue
    const reader = new FileReader();

    reader.addEventListener('load', async function() {
        if (file.name.endsWith('.midi') || file.name.endsWith('.mid')) {
            const midiData = new Midi(reader.result);
            midiData.tracks[0].notes.sort((a, b) => a.time - b.time);
            await playMidi(midiData);
            // playNext();  // Play the next file when done
        } else if (file.type.startsWith('audio/')) {
            try {
                let audioBuffer = await audioContext.decodeAudioData(reader.result);
                playSound(audioBuffer);
                animate();
            } catch(e) {
                console.error("There was an error decoding the file", e);
            }
        }
    });

    reader.readAsArrayBuffer(file);
}
