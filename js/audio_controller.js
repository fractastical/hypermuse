
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
    // if()
    audioSource.connect(analyser);
    analyser.connect(audioContext.destination);
    audioSource.onended = playNext;  // Play the next file when the current one finishes
    audioSource.start();
}

// TODO: This function fails with an unknown error 


async function playMidi(midiData) {
    try {
        const synth = new Tone.Synth().toDestination();
        const analyser = new Tone.Analyser();
        synth.connect(analyser);

        console.log('MIDI data:', midiData);
        console.log('Synth:', synth);

        // Collect all notes from all tracks
        const allNotes = [];
        midiData.tracks.forEach(track => {
            allNotes.push(...track.notes);
        });

        // Sort all notes based on their start time
        allNotes.sort((a, b) => a.time - b.time);

        // Schedule the events to play
        allNotes.forEach(note => {
            Tone.Transport.schedule(() => {
                console.log('Triggering note:', note);
                synth.triggerAttackRelease(note.name, note.duration, note.time, note.velocity);
            }, note.time);
        });

        // Resume the audio context
        await Tone.context.resume();

        // Start the playback
        Tone.Transport.start();

        console.log('Playback started');
    } catch (error) {
        console.error('Error during MIDI playback:', error);
    }
}



function highlightVertex(vertexIndex) {
    if (highlightedVertex !== null) {
        // Reset the previously highlighted vertex
        vertexPositions[highlightedVertex].material.color.set(0xffffff);
    }

    // Highlight the current vertex
    vertexPositions[vertexIndex].material.color.set(0xff0000);
    highlightedVertex = vertexIndex;
}

// Create a function to reset the appearance of all vertices
function resetVertices() {
    if (highlightedVertex !== null) {
        // Reset the previously highlighted vertex
        vertexPositions[highlightedVertex].material.color.set(0xffffff);
        highlightedVertex = null;
    }
}

// Create a function to draw a line between two vertices
function drawLineBetweenVertices(vertexIndex1, vertexIndex2) {
    const geometry = new THREE.Geometry();
    geometry.vertices.push(vertexPositions[vertexIndex1].position, vertexPositions[vertexIndex2].position);
    const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x00ff00 }));
    scene.add(line);
    lines.push(line);
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

async function playNext() {
    if (audioQueue.length === 0 && !midiData) {
        // If the queue is empty, repopulate it
        for (let file of event.target.files) {
            audioQueue.push(file);
        }
    }

    const file = audioQueue.shift(); // Get the next file from the queue
    if (!file) {
        console.log('No more files in the queue');
        return;
      }
    
    const reader = new FileReader();

    reader.addEventListener('load', async function() {
        if (file.name.endsWith('.midi') || file.name.endsWith('.mid')) {
            try {
            midiData = new Midi(reader.result);
            console.log('MIDI data:', midiData); // Log the parsed MIDI data
            // midiData.tracks[0].notes.sort((a, b) => a.time - b.time);
            // play only if there is no other sound, otherwise re-start that other sound 
                if(audioSource)
                    playNext(); 
                else
                    await playMidi(midiData);
            //  playNext(); // Play the next file when done
            } catch (e) {
                console.error('Error processing MIDI file', e);
            }
    } else if (file.type.startsWith('audio/')) {
            try {
                let audioBuffer = await audioContext.decodeAudioData(reader.result);
                playSound(audioBuffer);
                
                // if there is a midi file already playing restart it and mute it
                if(midiData)
                    Tone.stop;
                
                animate();
                audioQueue.push(file); // Push the audio file back into the queue
            } catch (e) {
                console.error('There was an error decoding the file', e);
            }
        }
    });

    reader.readAsArrayBuffer(file);
}
