
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
let videoElementActive = false;
let imageElementActive = false;
let mixedElementActive = false;

function captureFrame(videoElement) {
ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
return ctx.getImageData(0, 0, canvas.width, canvas.height);

}

function getVideoFrameTexture() {

// if(freezeFrameEffectActive)
//     videoElement.pause();


ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
let texture = new THREE.Texture(canvas);
texture.needsUpdate = true;

if (dodecahedronMaterial) {
    dodecahedronMaterial.map = texture;
    dodecahedronMaterial.needsUpdate = true;
}

videoElement.playbackRate = playbackRate;  // Ensure normal playback speed
videoElement.play();

if(freezeFrameEffectActive)
     return texture;
}


let activeVideoQueue = [];
const originalVideos = [];
const allVideoLoops = [];
window.__hypermuseLoadedSetCount = 0;
window.__hypermuseCurrentLoopLabel = "";

const videoElement = document.getElementById('videoElement');
const supportedVideoExtensions = new Set([
    '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'
]);
let currentSetEntries = [];
let currentSetIndex = -1;
let setAdvanceTimer = null;
let currentSetDirection = 1;
let currentSetPlaybackMode = 'pingpong';

function clearVideoList() {
const videoList = document.getElementById('videoListContents');
if (videoList) {
    videoList.innerHTML = '';
}
}

function clearSetAdvanceTimer() {
if (setAdvanceTimer !== null) {
    clearTimeout(setAdvanceTimer);
    setAdvanceTimer = null;
}
}

function normalizeSetEntries(urls, labels = [], transitions = [], defaults = {}) {
const entries = [];
for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    entries.push({
        url,
        label: labels[i] || url.split('/').pop(),
        transition: {
            type: (transitions[i] && transitions[i].type) || defaults.type || 'cut',
            durationMs: (transitions[i] && transitions[i].durationMs) || defaults.durationMs || 700,
            holdMs: (transitions[i] && transitions[i].holdMs) || defaults.holdMs || 8000
        }
    });
}
return entries;
}

function scheduleSetAdvance(entry) {
clearSetAdvanceTimer();
if (!entry || !entry.transition || !Number.isFinite(entry.transition.holdMs)) {
    return;
}
if (entry.transition.holdMs <= 0) {
    return;
}
setAdvanceTimer = setTimeout(function() {
    playNextSetEntry();
}, entry.transition.holdMs);
}

function setSetPlaybackTiming(holdMs, transitionMs) {
const nextHoldMs = Math.max(250, parseInt(holdMs, 10));
const nextTransitionMs = Math.max(0, parseInt(transitionMs, 10));
for (let i = 0; i < currentSetEntries.length; i++) {
    if (!currentSetEntries[i].transition) {
        currentSetEntries[i].transition = { type: 'fade', durationMs: nextTransitionMs, holdMs: nextHoldMs };
    }
    currentSetEntries[i].transition.holdMs = nextHoldMs;
    currentSetEntries[i].transition.durationMs = nextTransitionMs;
}
if (currentSetEntries.length > 0 && currentSetIndex >= 0) {
    scheduleSetAdvance(currentSetEntries[currentSetIndex]);
}
}

function applyTransitionAndPlay(entry) {
if (!entry) {
    return;
}
const transition = entry.transition || {};
const transitionType = transition.type || 'cut';
const durationMs = Math.max(0, parseInt(transition.durationMs || 0));

if (transitionType === 'fade' && durationMs > 0) {
    const half = Math.max(60, Math.floor(durationMs / 2));
    videoElement.style.transition = `opacity ${half}ms linear`;
    videoElement.style.opacity = '0';
    setTimeout(function() {
        videoElement.src = entry.url;
        videoElement.playbackRate = playbackRate;
        videoElement.play();
        videoElement.style.opacity = '1';
    }, half);
} else {
    videoElement.style.transition = '';
    videoElement.style.opacity = '1';
    videoElement.src = entry.url;
    videoElement.playbackRate = playbackRate;
    videoElement.play();
}
}

function playSetEntryAt(index) {
if (currentSetEntries.length === 0) {
    return;
}
currentSetIndex = ((index % currentSetEntries.length) + currentSetEntries.length) % currentSetEntries.length;
const entry = currentSetEntries[currentSetIndex];
window.__hypermuseCurrentLoopLabel = entry && entry.label ? entry.label : (entry && entry.url ? entry.url.split('/').pop() : "");
applyTransitionAndPlay(entry);
scheduleSetAdvance(entry);
videoElementActive = true;
}

function playNextSetEntry() {
if (currentSetEntries.length === 0) {
    return false;
}
if (currentSetPlaybackMode === 'pingpong') {
    if (currentSetEntries.length === 1) {
        playSetEntryAt(0);
        return true;
    }
    if (currentSetIndex >= currentSetEntries.length - 1) {
        currentSetDirection = -1;
    } else if (currentSetIndex <= 0) {
        currentSetDirection = 1;
    }
    playSetEntryAt(currentSetIndex + currentSetDirection);
} else {
    playSetEntryAt(currentSetIndex + 1);
}
return true;
}

function queueVideoSet(urls, labels = [], transitions = [], defaults = {}) {
activeVideoQueue.length = 0;
originalVideos.length = 0;
clearVideoList();
clearSetAdvanceTimer();
currentSetDirection = 1;
currentSetPlaybackMode = defaults.playbackMode || 'pingpong';

for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    activeVideoQueue.push(url);
    originalVideos.push(url);
    const label = labels[i] || url.split('/').pop();
    appendFilenameToList(label);
}

allVideoLoops.push([...originalVideos]);

currentSetEntries = normalizeSetEntries(urls, labels, transitions, defaults);
window.__hypermuseLoadedSetCount = currentSetEntries.length;
window.__hypermuseCurrentLoopLabel = "";
if (currentSetEntries.length > 0) {
    playSetEntryAt(0);
}
}

async function loadVideoSetManifest(manifestPath) {
const response = await fetch(manifestPath, { cache: 'no-store' });
if (!response.ok) {
    throw new Error(`Could not load video set manifest: ${manifestPath}`);
}
const manifest = await response.json();

let urls = [];
let labels = [];
let transitions = [];
let defaultTransition = {};
if (Array.isArray(manifest)) {
    urls = manifest.slice();
} else if (Array.isArray(manifest.loops)) {
    defaultTransition = manifest.defaultTransition || {};
    defaultTransition.playbackMode = manifest.playbackMode || 'pingpong';
    urls = manifest.loops.map(loop => typeof loop === 'string' ? loop : loop.url);
    labels = manifest.loops.map(loop => typeof loop === 'string' ? loop : (loop.label || loop.url));
    transitions = manifest.loops.map(loop => typeof loop === 'string' ? {} : (loop.transition || {}));
} else {
    throw new Error('Invalid manifest format. Expected array or { loops: [] }.');
}

urls = urls
    .filter(Boolean)
    .filter(url => {
        const lowered = url.toLowerCase();
        for (const ext of supportedVideoExtensions) {
            if (lowered.endsWith(ext)) return true;
        }
        return false;
    });

queueVideoSet(urls, labels, transitions, defaultTransition);
if (manifest && manifest.effectTimeline && window.setEffectTimelineConfig) {
    window.setEffectTimelineConfig(manifest.effectTimeline, true);
}
if (manifest && manifest.moleculeGraph) {
    if (manifest.moleculeGraph.renderMode && window.setMoleculeRenderMode) {
        window.setMoleculeRenderMode(manifest.moleculeGraph.renderMode);
    }
    if (Array.isArray(manifest.moleculeGraph.names) && manifest.moleculeGraph.names.length > 0 && window.setMoleculeGraphSequence) {
        window.setMoleculeGraphSequence(manifest.moleculeGraph.names, {
            cycleOnPhaseChange: !!manifest.moleculeGraph.cycleOnPhaseChange
        });
    } else if (manifest.moleculeGraph.name && window.loadMoleculeGraphByName) {
        window.loadMoleculeGraphByName(manifest.moleculeGraph.name);
    }
}
if (manifest && manifest.simulationPresets) {
    if (manifest.simulationPresets.grayScott && window.setGrayScottPreset) {
        window.setGrayScottPreset(manifest.simulationPresets.grayScott);
    }
}
if (manifest && manifest.backgrounds && window.setBackdropConfig) {
    window.setBackdropConfig({
        script: manifest.backgrounds.script,
        scripts: manifest.backgrounds.scripts,
        opacity: manifest.backgrounds.opacity,
        blendMode: manifest.backgrounds.blendMode,
        scrollSpeed: manifest.backgrounds.scrollSpeed,
        cycleOnPhaseChange: manifest.backgrounds.cycleOnPhaseChange
    });
    if (Array.isArray(manifest.backgrounds.scripts) && manifest.backgrounds.scripts.length > 0 && window.setBackgroundScriptSequence) {
        window.setBackgroundScriptSequence(manifest.backgrounds.scripts, {
            cycleOnPhaseChange: !!manifest.backgrounds.cycleOnPhaseChange,
            startScript: manifest.backgrounds.script
        });
    }
}
if (manifest && manifest.videoBackground && window.setVideoBackgroundConfig) {
    window.setVideoBackgroundConfig({
        enabled: !!manifest.videoBackground.enabled,
        opacity: manifest.videoBackground.opacity
    });
}
return urls.length;
}

window.loadVideoSetManifest = loadVideoSetManifest;
window.setSetPlaybackTiming = setSetPlaybackTiming;

document.getElementById('videoInput').addEventListener('change', function(event) {

// if(activeVideoQueue.length > 0)
//      allVideoQueues.push("video1", )

const urls = [];
const labels = [];
for (let file of event.target.files) {
    urls.push(URL.createObjectURL(file));
    labels.push(file.name);
}
queueVideoSet(urls, labels, [], { type: 'cut', durationMs: 0, holdMs: 0 });

if (activeVideoQueue.length > 0) {
    if (holographicFanMode) {
        const dodecahedronRadius = 0.15;
        const dodecahedronGeometry = new THREE.DodecahedronGeometry(dodecahedronRadius);

        // Get the video frame texture
        let texture = getVideoFrameTexture();

        // Create a material with that texture
        dodecahedronMaterial = new THREE.MeshBasicMaterial({ map: texture });

        // Create the mesh and add it to the scene
        const dodecahedron = new THREE.Mesh(dodecahedronGeometry, dodecahedronMaterial);
        scene.add(dodecahedron);
    }
}
else {
    console.error('Video format not supported');
}
});

const videoSetButton = document.getElementById('loadVideoSetButton');
if (videoSetButton) {
    videoSetButton.addEventListener('click', async function() {
        const manifestInput = document.getElementById('videoSetManifest');
        const manifestPath = manifestInput && manifestInput.value ? manifestInput.value : 'sets/bio1.json';
        try {
            const total = await loadVideoSetManifest(manifestPath);
            console.log(`Loaded video set ${manifestPath} (${total} loops)`);
        } catch (error) {
            console.error(error);
        }
    });
}

function appendFilenameToList(filename) {
const videoList = document.getElementById('videoListContents');
console.log(videoList);
const listItem = document.createElement('li');
listItem.textContent = filename;
videoList.appendChild(listItem);
}

document.addEventListener("keydown", function(event) {
if (event.key === "h") {
    const menu = document.getElementById("thresholds");
    
    // Toggle between displaying and hiding the video element
    if (menu.style.display === "none" || menu.style.display === "") {
        menu.style.display = "block";
    } else {
        menu.style.display = "none";
    }
    // Prevent default behavior (avoid scrolling, etc.)
    event.preventDefault();
}
if (event.key === "v") {
    const vlist = document.getElementById("videoList");
    
    // Toggle between displaying and hiding the video element
    if (vlist.style.display === "none" || vlist.style.display === "") {
        vlist.style.display = "block";
    } else {
        vlist.style.display = "none";
    }
    // Prevent default behavior (avoid scrolling, etc.)
    event.preventDefault();
}

});

videoElement.addEventListener('ended', function() {
if (currentSetEntries.length > 0) {
    playNextSetEntry();
    return;
}
if (activeVideoQueue.length === 0) {
    // Repopulate activeVideoQueue with original video URLs
    activeVideoQueue.push(...originalVideos);
}

console.log("nextvideo");
if (activeVideoQueue.length > 0) {
    videoElement.src = activeVideoQueue.shift();
    //TODO: this doesn't work, never updates playback rate
    videoElement.playbackRate = playbackRate;  // Ensure normal playback speed
    console.log(videoElement.playbackRate);
    console.log(playbackRate);

    videoElement.play();
} else {
    console.log("All videos have been played!");
}
});

let loadedImages = [];

var dodecahedron; 
if(holographicFanMode) {
    const dodecahedronRadius = 0.1;  // Adjust as needed
    const dodecahedronGeometry = new THREE.DodecahedronGeometry(dodecahedronRadius);
    const dodecahedronMaterial = new THREE.MeshBasicMaterial({ color: "blue" });  // White color
    dodecahedron = new THREE.Mesh(dodecahedronGeometry, dodecahedronMaterial);
    dodecahedron.position.set(0, 0, 0);
    scene.add(dodecahedron);

}

