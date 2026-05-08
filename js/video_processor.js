
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
window.__hypermuseSetUrls = [];

const videoElement = document.getElementById('videoElement');
const supportedVideoExtensions = new Set([
    '.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'
]);
let currentSetEntries = [];
let currentSetIndex = -1;
let setAdvanceTimer = null;
let transitionSwapTimer = null;
let suppressEndedUntilMs = 0;
let currentPlaybackEpoch = 0;
let currentSetDirection = 1;
let currentSetPlaybackMode = 'pingpong';
let activeClipWindowHandler = null;
let setAutoAdvanceEnabled = true;
let progressiveClipDriftEnabled = false;
let progressiveClipOffsetStepSec = 1;
let progressiveClipHoldStepMs = 350;
let progressiveClipHoldMaxExtraMs = 5000;
const clipVisitByUrl = new Map();
const loopPreferenceByUrl = new Map();
const recentLoopHistory = [];
const RECENT_LOOP_HISTORY_MAX = 48;
const sampleSetPresets = [
    { id: 'bio1', label: 'Bio 1 (default)', manifest: 'sets/bio1.json' },
    { id: 'tonight1', label: 'Sample 1h — Betse + cells', manifest: 'sets/tonight-set-1-betse-cells.json' },
    { id: 'tonight2', label: 'Sample 1h — Morphogenesis', manifest: 'sets/tonight-set-2-morphogenesis.json' },
    { id: 'tonight3', label: 'Sample 1h — High energy mix', manifest: 'sets/tonight-set-3-high-energy-mix.json' },
    { id: 'sample4', label: 'Sample 1h — Reaction / microscopy', manifest: 'sets/sample-set-4-reaction-microscopy.json' },
    { id: 'sample5', label: 'Sample 1h — Cells + morpho', manifest: 'sets/sample-set-5-cells-morpho.json' },
    { id: 'creativeStream', label: 'Infinitestreams journey (backdrop tour)', manifest: 'sets/set-infinitestreams-journey.json' },
    { id: 'creativeRedRoundtrip', label: 'Color arc — red → diffusion → back', manifest: 'sets/set-color-red-diffusion-roundtrip.json' },
    { id: 'creativePurpleTeal', label: 'Color arc — purple / magenta / teal-cyan', manifest: 'sets/set-color-purple-teal-arc.json' },
];
const ALL_VIDEO_SET_MANIFEST = 'sets/set-live-default-all-loops.json';

function populateSetPresets() {
const presetSelect = document.getElementById('videoSetPreset');
if (!presetSelect) {
    return;
}
presetSelect.innerHTML = '';
for (const preset of sampleSetPresets) {
    const option = document.createElement('option');
    option.value = preset.manifest;
    option.textContent = preset.label;
    presetSelect.appendChild(option);
}
const manifestInput = document.getElementById('videoSetManifest');
const currentManifest = manifestInput && manifestInput.value ? String(manifestInput.value).trim() : '';
const match = sampleSetPresets.find((preset) => preset.manifest === currentManifest);
presetSelect.value = match ? match.manifest : sampleSetPresets[0].manifest;
}

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

function clearTransitionSwapTimer() {
if (transitionSwapTimer !== null) {
    clearTimeout(transitionSwapTimer);
    transitionSwapTimer = null;
}
}

function clearClipWindowHandler() {
if (activeClipWindowHandler) {
    videoElement.removeEventListener('timeupdate', activeClipWindowHandler);
    activeClipWindowHandler = null;
}
}

function setProgressiveClipWindowConfig(config = {}) {
if (typeof config.enabled === 'boolean') {
    progressiveClipDriftEnabled = !!config.enabled;
}
if (Number.isFinite(config.offsetStepSec)) {
    progressiveClipOffsetStepSec = Math.max(0, Number(config.offsetStepSec));
}
if (Number.isFinite(config.holdStepMs)) {
    progressiveClipHoldStepMs = Math.max(0, Number(config.holdStepMs));
}
if (Number.isFinite(config.holdMaxExtraMs)) {
    progressiveClipHoldMaxExtraMs = Math.max(0, Number(config.holdMaxExtraMs));
}
}

function normalizeSetEntries(urls, labels = [], transitions = [], defaults = {}) {
const entries = [];
for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    const sourceTransition = transitions[i] || {};
    const clipStartSec = Number.isFinite(sourceTransition.clipStartSec) ? Math.max(0, sourceTransition.clipStartSec) : null;
    const clipEndSec = Number.isFinite(sourceTransition.clipEndSec) ? Math.max(0, sourceTransition.clipEndSec) : null;
    entries.push({
        url,
        label: labels[i] || url.split('/').pop(),
        transition: {
            type: sourceTransition.type || defaults.type || 'cut',
            durationMs: sourceTransition.durationMs || defaults.durationMs || 700,
            holdMs: sourceTransition.holdMs || defaults.holdMs || 8000,
            clipStartSec,
            clipEndSec,
            crop: sourceTransition.crop || null,
            holdLastFrameOnClipEnd: sourceTransition.holdLastFrameOnClipEnd !== false
        }
    });
}
return entries;
}

function scheduleSetAdvance(entry, epoch) {
clearSetAdvanceTimer();
if (!setAutoAdvanceEnabled) {
    return;
}
if (!entry || !entry.transition || !Number.isFinite(entry.transition.holdMs)) {
    return;
}
let effectiveHoldMs = entry.transition.holdMs;
if (progressiveClipDriftEnabled) {
    const visit = Number.isFinite(entry.__runtimeVisit) ? Math.max(0, entry.__runtimeVisit) : 0;
    const extra = Math.min(progressiveClipHoldMaxExtraMs, visit * progressiveClipHoldStepMs);
    effectiveHoldMs += extra;
}
if (Number.isFinite(entry.transition.clipStartSec) && Number.isFinite(entry.transition.clipEndSec)) {
    const clipSpanMs = Math.max(250, (entry.transition.clipEndSec - entry.transition.clipStartSec) * 1000);
    if (!entry.transition.holdLastFrameOnClipEnd) {
        effectiveHoldMs = Math.min(effectiveHoldMs, clipSpanMs);
    }
}
if (effectiveHoldMs <= 0) {
    return;
}
setAdvanceTimer = setTimeout(function() {
    if (epoch !== currentPlaybackEpoch) return;
    playNextSetEntry();
}, effectiveHoldMs);
}

function applyClipWindow(entry, epoch) {
clearClipWindowHandler();
if (!entry || !entry.transition) {
    return;
}
const explicitStartSec = Number.isFinite(entry.transition.clipStartSec) ? Math.max(0, entry.transition.clipStartSec) : null;
const endSec = Number.isFinite(entry.transition.clipEndSec) ? Math.max(0, entry.transition.clipEndSec) : null;
const visit = Number.isFinite(entry.__runtimeVisit) ? Math.max(0, entry.__runtimeVisit) : 0;
const driftStartSecRaw = progressiveClipDriftEnabled ? (visit * progressiveClipOffsetStepSec) : 0;
if (explicitStartSec === null && endSec === null && driftStartSecRaw <= 0) {
    return;
}
const setStart = function() {
    if (!Number.isFinite(videoElement.duration) || videoElement.duration <= 0) {
        return;
    }
    let startSec = explicitStartSec;
    if (startSec === null && driftStartSecRaw > 0) {
        const maxSeekSpan = Math.max(0.35, videoElement.duration - 0.35);
        startSec = maxSeekSpan > 0 ? (driftStartSecRaw % maxSeekSpan) : 0;
    }
    if (startSec === null) {
        return;
    }
    const maxStart = Math.max(0, Math.min(startSec, Math.max(0, videoElement.duration - 0.05)));
    try {
        videoElement.currentTime = maxStart;
    } catch (error) {
        console.warn(error);
    }
};
if (explicitStartSec !== null || driftStartSecRaw > 0) {
    if (videoElement.readyState >= 1) {
        setStart();
    } else {
        videoElement.addEventListener('loadedmetadata', setStart, { once: true });
    }
}
if (endSec !== null) {
    activeClipWindowHandler = function() {
        if (epoch !== currentPlaybackEpoch) return;
        if (videoElement.currentTime >= (endSec - 0.04)) {
            clearClipWindowHandler();
            clearSetAdvanceTimer();
            const shouldHoldLastFrame = !!entry.transition.holdLastFrameOnClipEnd;
            if (!shouldHoldLastFrame) {
                playNextSetEntry();
                return;
            }
            const startRef = explicitStartSec !== null ? explicitStartSec : 0;
            const elapsedClipMs = Math.max(0, (Math.max(startRef, endSec) - startRef) * 1000);
            const targetHoldMs = Number.isFinite(entry.transition.holdMs) ? Math.max(0, entry.transition.holdMs) : 0;
            const remainingHoldMs = Math.max(0, targetHoldMs - elapsedClipMs);
            try {
                videoElement.pause();
            } catch (error) {
                console.warn(error);
            }
            if (remainingHoldMs > 0) {
                setAdvanceTimer = setTimeout(function() {
                    if (epoch !== currentPlaybackEpoch) return;
                    playNextSetEntry();
                }, remainingHoldMs);
            } else {
                playNextSetEntry();
            }
        }
    };
    videoElement.addEventListener('timeupdate', activeClipWindowHandler);
}
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
    scheduleSetAdvance(currentSetEntries[currentSetIndex], currentPlaybackEpoch);
}
}

function setSetAutoAdvanceEnabled(enabled) {
setAutoAdvanceEnabled = !!enabled;
if (!setAutoAdvanceEnabled) {
    clearSetAdvanceTimer();
    return;
}
if (currentSetEntries.length > 0 && currentSetIndex >= 0) {
    scheduleSetAdvance(currentSetEntries[currentSetIndex], currentPlaybackEpoch);
}
}

function applyTransitionAndPlay(entry, epoch) {
if (!entry) {
    return;
}
clearTransitionSwapTimer();
clearClipWindowHandler();
clearSetAdvanceTimer();
const transition = entry.transition || {};
if (window.setVideoBackdropCrop) {
    window.setVideoBackdropCrop(transition.crop || null);
}
const transitionType = transition.type || 'cut';
const durationMs = Math.max(0, parseInt(transition.durationMs || 0));
// Ignore stale ended events during clip swaps (common cause of instant "switch back").
suppressEndedUntilMs = Date.now() + Math.max(350, durationMs + 250);

if (transitionType === 'fade' && durationMs > 0) {
    const half = Math.max(60, Math.floor(durationMs / 2));
    videoElement.style.transition = `opacity ${half}ms linear`;
    videoElement.style.opacity = '0';
    transitionSwapTimer = setTimeout(function() {
        if (epoch !== currentPlaybackEpoch) return;
        transitionSwapTimer = null;
        videoElement.src = entry.url;
        applyClipWindow(entry, epoch);
        videoElement.playbackRate = playbackRate;
        videoElement.play();
        videoElement.style.opacity = '1';
    }, half);
} else {
    videoElement.style.transition = '';
    videoElement.style.opacity = '1';
    videoElement.src = entry.url;
    applyClipWindow(entry, epoch);
    videoElement.playbackRate = playbackRate;
    videoElement.play();
}
}

function playSetEntryAt(index) {
if (currentSetEntries.length === 0) {
    return;
}
currentSetIndex = ((index % currentSetEntries.length) + currentSetEntries.length) % currentSetEntries.length;
const epoch = ++currentPlaybackEpoch;
const entry = currentSetEntries[currentSetIndex];
if (entry && entry.url) {
    recentLoopHistory.push({
        url: entry.url,
        label: entry.label || entry.url.split('/').pop(),
        at: Date.now()
    });
    if (recentLoopHistory.length > RECENT_LOOP_HISTORY_MAX) {
        recentLoopHistory.splice(0, recentLoopHistory.length - RECENT_LOOP_HISTORY_MAX);
    }
}
const key = entry && entry.url ? entry.url : `idx:${currentSetIndex}`;
const seenCount = clipVisitByUrl.get(key) || 0;
clipVisitByUrl.set(key, seenCount + 1);
entry.__runtimeVisit = seenCount;
window.__hypermuseCurrentLoopLabel = entry && entry.label ? entry.label : (entry && entry.url ? entry.url.split('/').pop() : "");
applyTransitionAndPlay(entry, epoch);
scheduleSetAdvance(entry, epoch);
videoElementActive = true;
}

function isSetEntryEligible(entry) {
if (!entry || !entry.url) return false;
return loopPreferenceByUrl.get(entry.url) !== 'dislike';
}

function applyLoopPreferenceForUrl(url, preference) {
if (!url) return false;
const normalized = String(preference || '').trim().toLowerCase();
if (normalized === 'dislike') {
    loopPreferenceByUrl.set(url, 'dislike');
    return true;
}
if (normalized === 'like') {
    loopPreferenceByUrl.set(url, 'like');
    return true;
}
loopPreferenceByUrl.delete(url);
return true;
}

function getRecentLoopUrlByOffset(offsetBack = 1) {
const offset = Math.max(0, parseInt(offsetBack, 10) || 0);
if (recentLoopHistory.length === 0) return null;
const uniqueUrlsNewestFirst = [];
const seen = new Set();
for (let i = recentLoopHistory.length - 1; i >= 0; i--) {
    const item = recentLoopHistory[i];
    if (!item || !item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    uniqueUrlsNewestFirst.push(item.url);
}
return uniqueUrlsNewestFirst[offset] || null;
}

function getNextSetIndexCandidate() {
if (currentSetPlaybackMode === 'pingpong') {
    if (currentSetEntries.length <= 1) {
        return 0;
    }
    if (currentSetIndex >= currentSetEntries.length - 1) {
        currentSetDirection = -1;
    } else if (currentSetIndex <= 0) {
        currentSetDirection = 1;
    }
    return currentSetIndex + currentSetDirection;
}
return currentSetIndex + 1;
}

function playNextSetEntry() {
if (currentSetEntries.length === 0) {
    return false;
}
let candidate = getNextSetIndexCandidate();
const maxAttempts = Math.max(1, currentSetEntries.length * 2);
for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const normalized = ((candidate % currentSetEntries.length) + currentSetEntries.length) % currentSetEntries.length;
    const entry = currentSetEntries[normalized];
    if (isSetEntryEligible(entry)) {
        playSetEntryAt(normalized);
        return true;
    }
    currentSetIndex = normalized;
    candidate = getNextSetIndexCandidate();
}
return false;
}

function ensureCurrentSetPlayback() {
if (currentSetEntries.length > 0) {
    const idx = currentSetIndex >= 0 ? currentSetIndex : 0;
    const entry = currentSetEntries[idx];
    if (entry && entry.url) {
        if (videoElement.src !== entry.url) {
            videoElement.src = entry.url;
        }
        videoElement.playbackRate = playbackRate;
        try {
            const maybePromise = videoElement.play();
            if (maybePromise && typeof maybePromise.catch === 'function') {
                maybePromise.catch(() => {});
            }
        } catch (_) {}
        videoElementActive = true;
        return true;
    }
}
if (videoElement && (videoElement.currentSrc || videoElement.src)) {
    try {
        const maybePromise = videoElement.play();
        if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch(() => {});
        }
    } catch (_) {}
    return true;
}
return false;
}

function queueVideoSet(urls, labels = [], transitions = [], defaults = {}) {
activeVideoQueue.length = 0;
originalVideos.length = 0;
allVideoLoops.length = 0;
clearVideoList();
clearSetAdvanceTimer();
clearTransitionSwapTimer();
clearClipWindowHandler();
currentSetDirection = 1;
currentSetPlaybackMode = defaults.playbackMode || 'pingpong';
setAutoAdvanceEnabled = true;

for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    activeVideoQueue.push(url);
    originalVideos.push(url);
    const label = labels[i] || url.split('/').pop();
    appendFilenameToList(label);
}

allVideoLoops.push([...originalVideos]);

currentSetEntries = normalizeSetEntries(urls, labels, transitions, defaults);
clipVisitByUrl.clear();
loopPreferenceByUrl.clear();
recentLoopHistory.length = 0;
window.__hypermuseLoadedSetCount = currentSetEntries.length;
window.__hypermuseCurrentLoopLabel = "";
window.__hypermuseSetUrls = currentSetEntries.map((entry) => entry.url).filter(Boolean);
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
window.setSetAutoAdvanceEnabled = setSetAutoAdvanceEnabled;
window.playNextSetEntry = playNextSetEntry;
window.ensureCurrentSetPlayback = ensureCurrentSetPlayback;
window.setCurrentLoopPreference = function(preference, options = {}) {
    if (currentSetEntries.length === 0 || currentSetIndex < 0) {
        return false;
    }
    const entry = currentSetEntries[currentSetIndex];
    if (!entry || !entry.url) {
        return false;
    }
    const normalized = String(preference || '').trim().toLowerCase();
    const updated = applyLoopPreferenceForUrl(entry.url, normalized);
    if (!updated) return false;
    if (normalized === 'dislike' && options.advance !== false) {
        playNextSetEntry();
    }
    return true;
};
window.getCurrentLoopPreference = function() {
    if (currentSetEntries.length === 0 || currentSetIndex < 0) {
        return 'neutral';
    }
    const entry = currentSetEntries[currentSetIndex];
    if (!entry || !entry.url) {
        return 'neutral';
    }
    return loopPreferenceByUrl.get(entry.url) || 'neutral';
};
window.setRecentLoopPreference = function(offsetBack, preference, options = {}) {
    const url = getRecentLoopUrlByOffset(offsetBack);
    if (!url) return false;
    const normalized = String(preference || '').trim().toLowerCase();
    const updated = applyLoopPreferenceForUrl(url, normalized);
    if (!updated) return false;
    if (options.advanceIfCurrent !== false && currentSetEntries.length > 0 && currentSetIndex >= 0) {
        const currentEntry = currentSetEntries[currentSetIndex];
        if (currentEntry && currentEntry.url === url && normalized === 'dislike') {
            playNextSetEntry();
        }
    }
    return true;
};
window.getRecentLoopUrls = function() {
    const unique = [];
    const seen = new Set();
    for (let i = recentLoopHistory.length - 1; i >= 0; i--) {
        const item = recentLoopHistory[i];
        if (!item || !item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        unique.push(item.url);
    }
    return unique;
};
window.setProgressiveClipWindowConfig = setProgressiveClipWindowConfig;
window.getLoadedSetUrls = function() {
    return Array.isArray(window.__hypermuseSetUrls) ? window.__hypermuseSetUrls.slice() : [];
};

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

const loadVideoSetPresetButton = document.getElementById('loadVideoSetPresetButton');
if (loadVideoSetPresetButton) {
    loadVideoSetPresetButton.addEventListener('click', async function() {
        const presetSelect = document.getElementById('videoSetPreset');
        const manifestInput = document.getElementById('videoSetManifest');
        const manifestPath = presetSelect && presetSelect.value
            ? String(presetSelect.value)
            : 'sets/bio1.json';
        if (manifestInput) {
            manifestInput.value = manifestPath;
        }
        try {
            const total = await loadVideoSetManifest(manifestPath);
            console.log(`Loaded preset ${manifestPath} (${total} loops)`);
        } catch (error) {
            console.error(error);
        }
    });
}

const loadAllVideoSetsButton = document.getElementById('loadAllVideoSetsButton');
if (loadAllVideoSetsButton) {
    loadAllVideoSetsButton.addEventListener('click', async function() {
        const manifestInput = document.getElementById('videoSetManifest');
        if (manifestInput) {
            manifestInput.value = ALL_VIDEO_SET_MANIFEST;
        }
        try {
            const total = await loadVideoSetManifest(ALL_VIDEO_SET_MANIFEST);
            console.log(`Loaded all video set ${ALL_VIDEO_SET_MANIFEST} (${total} loops)`);
        } catch (error) {
            console.error(error);
        }
    });
}

const videoSetPresetSelect = document.getElementById('videoSetPreset');
if (videoSetPresetSelect) {
    videoSetPresetSelect.addEventListener('change', function() {
        const manifestInput = document.getElementById('videoSetManifest');
        if (manifestInput) {
            manifestInput.value = videoSetPresetSelect.value;
        }
    });
}

populateSetPresets();

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
if (Date.now() < suppressEndedUntilMs) {
    return;
}
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

