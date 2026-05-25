
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d');
// Use `var` so these are properties of the global object and visible from
// the sonicsphere.html inline render loop (which runs before this external
// script finishes loading on a cold cache). Switching from `let` to `var`
// also avoids the SyntaxError "Identifier 'X' has already been declared"
// that fires when the inline script declares them too.
if (typeof window.videoElementActive === 'undefined') {
    window.videoElementActive = false;
}
if (typeof window.imageElementActive === 'undefined') {
    window.imageElementActive = false;
}
if (typeof window.mixedElementActive === 'undefined') {
    window.mixedElementActive = false;
}

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
/** First-level folder under {@code folderLoopRoot}: e.g. loops/cells1 (or loops/__root__ for files sitting directly under the root) */
const loopFolderGroupEnabledMap = new Map();
const loopFolderGroupLabelsMap = new Map();
const FOLDER_GROUP_ROOT_PLACEHOLDER = '__root__';

/** Hue-family tags from artifacts/color-dataset.json (build-color-dataset.mjs). */
const COLOR_FAMILY_ORDER = [
    'black', 'silver', 'gray', 'white',
    'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'magenta'
];
const COLOR_FAMILY_SWATCHES = {
    black: '#1c1c1e',
    silver: '#c0c0c8',
    gray: '#8e8e93',
    white: '#f5f5f7',
    red: '#ff3b30',
    orange: '#ff9500',
    yellow: '#ffd60a',
    green: '#34c759',
    cyan: '#32d3ff',
    blue: '#0a84ff',
    purple: '#bf5af2',
    magenta: '#ff2d92'
};
const colorGroupEnabledMap = new Map();
const colorDatasetByUrl = new Map();
let colorDatasetLoadPromise = null;

COLOR_FAMILY_ORDER.forEach((family) => {
    colorGroupEnabledMap.set(family, true);
});

function normalizeColorDatasetUrlKey(url) {
    return String(url || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
}

function rgbToHsv(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    let h = 0;
    if (delta !== 0) {
        if (max === rn) h = ((gn - bn) / delta) % 6;
        else if (max === gn) h = ((bn - rn) / delta) + 2;
        else h = ((rn - gn) / delta) + 4;
        h *= 60;
        if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : (delta / max);
    const v = max;
    return { h, s, v };
}

function classifyRgbColorFamily(r, g, b) {
    const hsv = rgbToHsv(r, g, b);
    if (hsv.v < 0.14) return 'black';
    if (hsv.s < 0.10 && hsv.v >= 0.42 && hsv.v <= 0.82) return 'silver';
    if (hsv.s < 0.16 && hsv.v > 0.78) return 'white';
    if (hsv.s < 0.16) return 'gray';
    if (hsv.h < 15 || hsv.h >= 345) return 'red';
    if (hsv.h < 40) return 'orange';
    if (hsv.h < 70) return 'yellow';
    if (hsv.h < 160) return 'green';
    if (hsv.h < 205) return 'cyan';
    if (hsv.h < 255) return 'blue';
    if (hsv.h < 300) return 'purple';
    if (hsv.h < 345) return 'magenta';
    return 'red';
}

function expandColorTagsToFamilies(tags) {
    const families = new Set();
    (Array.isArray(tags) ? tags : []).forEach((tagRaw) => {
        const tag = String(tagRaw || '').trim().toLowerCase();
        if (!tag) return;
        tag.split('-').forEach((part) => {
            if (COLOR_FAMILY_ORDER.includes(part)) {
                families.add(part);
            }
        });
    });
    return [...families];
}

function ingestColorDatasetItem(item) {
    if (!item || item.type !== 'video' || !item.path) {
        return;
    }
    const key = normalizeColorDatasetUrlKey(item.path);
    const families = expandColorTagsToFamilies(item.tags);
    if (Array.isArray(item.topFamilies)) {
        item.topFamilies.forEach((row) => {
            if (row && row.name && COLOR_FAMILY_ORDER.includes(row.name)) {
                families.push(row.name);
            }
        });
    }
    const uniqueFamilies = [...new Set(families)];
    colorDatasetByUrl.set(key, {
        tags: Array.isArray(item.tags) ? item.tags.slice() : [],
        families: uniqueFamilies,
        primary: uniqueFamilies[0] || null,
        avgRgb: Array.isArray(item.avgRgb) ? item.avgRgb.slice(0, 3) : null
    });
}

async function ensureColorDatasetLoaded(force = false) {
    if (colorDatasetLoadPromise && !force) {
        return colorDatasetLoadPromise;
    }
    colorDatasetLoadPromise = (async function() {
        try {
            const response = await fetch('artifacts/color-dataset.json', { cache: 'no-store' });
            if (!response.ok) {
                return false;
            }
            const payload = await response.json();
            colorDatasetByUrl.clear();
            if (Array.isArray(payload.items)) {
                payload.items.forEach(ingestColorDatasetItem);
            }
            return colorDatasetByUrl.size > 0;
        } catch (_) {
            return false;
        }
    })();
    return colorDatasetLoadPromise;
}

function getColorFamiliesForUrl(url) {
    const key = normalizeColorDatasetUrlKey(url);
    const row = colorDatasetByUrl.get(key);
    if (row && Array.isArray(row.families) && row.families.length > 0) {
        return row.families.slice();
    }
    return [];
}

function isColorGroupEntryEnabled(entry) {
    const families = entry && Array.isArray(entry.colorFamilies) ? entry.colorFamilies : [];
    if (families.length === 0) {
        return true;
    }
    return families.some((family) => colorGroupEnabledMap.get(family) !== false);
}

function skipPlaybackIfColorGroupBlocked() {
    if (currentSetEntries.length === 0 || currentSetIndex < 0) {
        return;
    }
    const entry = currentSetEntries[currentSetIndex];
    if (!entry || isSetEntryEligible(entry)) {
        return;
    }
    playNextSetEntry();
}

function broadcastColorGroupsSnapshot() {
    if (typeof window.getColorGroupsSnapshot !== 'function') {
        return;
    }
    const payload = {
        type: 'vjColorGroups',
        groups: window.getColorGroupsSnapshot(),
        revision: Date.now()
    };
    try {
        if (window.opener && !window.opener.closed && typeof window.opener.postMessage === 'function') {
            window.opener.postMessage(payload, '*');
        }
    } catch (_) {
        // ignore
    }
    try {
        if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage(payload, '*');
        }
    } catch (_) {
        // ignore
    }
    if (typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('hypermuse:colorGroupsChanged'));
    }
}

function normalizeUrlPathSegments(url) {
    let s = String(url || '').trim().replace(/\\/g, '/');
    if (!s) {
        return [];
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
        try {
            const u = new URL(s);
            s = u.pathname || '';
        } catch (_) {
            return [];
        }
    }
    const q = s.indexOf('?');
    if (q >= 0) {
        s = s.slice(0, q);
    }
    const h = s.indexOf('#');
    if (h >= 0) {
        s = s.slice(0, h);
    }
    while (s.startsWith('/')) {
        s = s.slice(1);
    }
    return s.split('/').filter(Boolean);
}

/**
 * Find root folder segment (e.g. loops) anywhere in the path; group id is root/firstSubfolder.
 * Files directly under root (e.g. loops/clip.mp4) use root/__root__.
 */
function deriveFolderLoopGroupId(url, rootToken) {
    const rootWant = String(rootToken || '').trim();
    if (!rootWant) {
        return null;
    }
    const segs = normalizeUrlPathSegments(url);
    if (segs.length < 2) {
        return null;
    }
    const rootLower = rootWant.toLowerCase();
    const idx = segs.findIndex((seg) => String(seg).toLowerCase() === rootLower);
    if (idx < 0) {
        return null;
    }
    const rootSeg = segs[idx];
    if (idx + 1 >= segs.length) {
        return null;
    }
    if (idx + 2 >= segs.length) {
        return `${rootSeg}/${FOLDER_GROUP_ROOT_PLACEHOLDER}`;
    }
    return `${rootSeg}/${segs[idx + 1]}`;
}

/**
 * When manifest omits folderLoopRoot, pick the most common first path segment (e.g. loops)
 * so folder toggles work for any tree without hand-editing JSON.
 */
function inferFolderLoopRootFromUrls(urls) {
    if (!Array.isArray(urls) || urls.length === 0) {
        return '';
    }
    const counts = new Map();
    for (let u = 0; u < urls.length; u++) {
        const segs = normalizeUrlPathSegments(urls[u]);
        if (segs.length < 2) {
            continue;
        }
        const head = segs[0];
        counts.set(head, (counts.get(head) || 0) + 1);
    }
    let best = '';
    let bestN = 0;
    const need = Math.max(2, Math.ceil(urls.length * 0.45));
    counts.forEach((n, seg) => {
        if (n > bestN && n >= need) {
            bestN = n;
            best = seg;
        }
    });
    return best;
}

function resetFolderLoopGroupsState() {
    loopFolderGroupEnabledMap.clear();
    loopFolderGroupLabelsMap.clear();
}

function registerFolderLoopGroup(groupId, labelHint) {
    const gid = String(groupId || '').trim();
    if (!gid) {
        return;
    }
    const basename = gid.split('/').filter(Boolean).pop() || gid;
    const label = String(labelHint || '').trim()
        || loopFolderGroupLabelsMap.get(gid)
        || basename;
    if (basename === FOLDER_GROUP_ROOT_PLACEHOLDER) {
        loopFolderGroupLabelsMap.set(gid, label || defaultLabelForSyntheticRootGroup(gid));
    } else {
        loopFolderGroupLabelsMap.set(gid, label);
    }
    if (!loopFolderGroupEnabledMap.has(gid)) {
        loopFolderGroupEnabledMap.set(gid, true);
    }
}

function broadcastLoopGroupsSnapshot() {
    if (typeof window.getLoopGroupsSnapshot !== 'function') {
        return;
    }
    const payload = {
        type: 'vjLoopGroups',
        groups: window.getLoopGroupsSnapshot(),
        revision: Date.now()
    };
    try {
        if (window.opener && !window.opener.closed && typeof window.opener.postMessage === 'function') {
            window.opener.postMessage(payload, '*');
        }
    } catch (_) {
        // ignore cross-origin opener failures
    }
    try {
        if (window.parent && window.parent !== window && typeof window.parent.postMessage === 'function') {
            window.parent.postMessage(payload, '*');
        }
    } catch (_) {
        // ignore cross-origin parent failures
    }
}

function syncFolderLoopGroupsFromEntries(entries, manifestExtras = {}) {
    resetFolderLoopGroupsState();
    const presetLabels = manifestExtras.loopGroupLabels && typeof manifestExtras.loopGroupLabels === 'object'
        ? manifestExtras.loopGroupLabels
        : {};

    Object.keys(presetLabels).forEach((idKey) => {
        if (!presetLabels[idKey]) {
            return;
        }
        const key = String(idKey).trim();
        if (!key) {
            return;
        }
        loopFolderGroupLabelsMap.set(key, String(presetLabels[idKey]));
        loopFolderGroupEnabledMap.set(key, true);
    });

    const registered = Array.isArray(manifestExtras.registeredLoopGroups)
        ? manifestExtras.registeredLoopGroups
        : [];
    registered.forEach((row) => {
        if (!row) {
            return;
        }
        registerFolderLoopGroup(row.id || row.groupId, row.label || row.loopGroupLabel);
    });

    entries.forEach((entry) => {
        const gid = entry && entry.loopGroupId ? String(entry.loopGroupId).trim() : '';
        if (!gid) {
            return;
        }
        const basename = gid.split('/').filter(Boolean).pop() || gid;
        const hinted = entry.loopGroupLabel && String(entry.loopGroupLabel).trim();
        const preset = presetLabels[gid] ? String(presetLabels[gid]) : '';
        let label = hinted || preset || loopFolderGroupLabelsMap.get(gid) || basename;
        if (basename === FOLDER_GROUP_ROOT_PLACEHOLDER) {
            label = hinted || preset || loopFolderGroupLabelsMap.get(gid) || defaultLabelForSyntheticRootGroup(gid);
        }

        loopFolderGroupLabelsMap.set(gid, label);
        if (!loopFolderGroupEnabledMap.has(gid)) {
            loopFolderGroupEnabledMap.set(gid, true);
        }
    });
}

function defaultLabelForSyntheticRootGroup(groupId) {
    const parts = String(groupId || '').split('/').filter(Boolean);
    const top = parts[0] || 'folder';
    return `${top} (root files)`;
}

function firstEligibleEntryIndex() {
if (currentSetEntries.length === 0) {
    return -1;
}
for (let i = 0; i < currentSetEntries.length; i++) {
    if (isSetEntryEligible(currentSetEntries[i])) {
        return i;
    }
}
return -1;
}

function isLoopFolderGroupEntryEnabled(entry) {
if (!entry || !entry.loopGroupId) {
    return true;
}
const gid = String(entry.loopGroupId).trim();
if (!gid) {
    return true;
}
const flag = loopFolderGroupEnabledMap.get(gid);
if (flag === undefined) {
    return true;
}
return !!flag;
}

function skipPlaybackIfDisabledGroupBlocked() {
if (currentSetEntries.length === 0 || currentSetIndex < 0) {
    return;
}
const entry = currentSetEntries[currentSetIndex];
if (!entry || isSetEntryEligible(entry)) {
    return;
}
playNextSetEntry();
}

window.setLoopGroupEnabled = function(groupId, enabled) {
const key = String(groupId || '').trim();
if (!key || !loopFolderGroupEnabledMap.has(key)) {
    return false;
}
loopFolderGroupEnabledMap.set(key, !!enabled);
skipPlaybackIfDisabledGroupBlocked();
broadcastLoopGroupsSnapshot();
return true;
};

window.applyLoopGroupToggleMap = function(map) {
if (!map || typeof map !== 'object') {
    return 0;
}
let changed = 0;
Object.keys(map).forEach((idRaw) => {
    const key = String(idRaw).trim();
    if (!key || !loopFolderGroupEnabledMap.has(key)) {
        return;
    }
    const val = !!map[idRaw];
    loopFolderGroupEnabledMap.set(key, val);
    changed += 1;
});
skipPlaybackIfDisabledGroupBlocked();
if (changed > 0) {
    broadcastLoopGroupsSnapshot();
}
return changed;
};

window.getLoopGroupsSnapshot = function() {
const counts = {};
currentSetEntries.forEach((entry) => {
    if (!entry || !entry.loopGroupId) {
        return;
    }
    const gid = String(entry.loopGroupId).trim();
    counts[gid] = (counts[gid] || 0) + 1;
});

const ids = [];
loopFolderGroupEnabledMap.forEach((_flag, gid) => {
    ids.push(gid);
});

ids.sort((a, b) => String(loopFolderGroupLabelsMap.get(a) || a).localeCompare(
    String(loopFolderGroupLabelsMap.get(b) || b),
    undefined,
    { sensitivity: 'base' }
));

const currentIdx = typeof currentSetIndex === 'number' ? currentSetIndex : -1;
let currentGroupId = null;
if (currentIdx >= 0 && currentIdx < currentSetEntries.length) {
    const cur = currentSetEntries[currentIdx];
    currentGroupId = cur && cur.loopGroupId ? String(cur.loopGroupId).trim() : null;
}

return ids.map((id) => ({
    id,
    label: loopFolderGroupLabelsMap.get(id) || id.split('/').filter(Boolean).pop() || id,
    enabled: loopFolderGroupEnabledMap.get(id) !== false,
    clipCount: counts[id] || 0,
    isCurrent: !!(currentGroupId && currentGroupId === id)
}));
};

window.setColorGroupEnabled = function(groupId, enabled) {
    const key = String(groupId || '').trim().toLowerCase();
    if (!key || !COLOR_FAMILY_ORDER.includes(key)) {
        return false;
    }
    colorGroupEnabledMap.set(key, !!enabled);
    skipPlaybackIfColorGroupBlocked();
    broadcastColorGroupsSnapshot();
    return true;
};

window.applyColorGroupToggleMap = function(map) {
    if (!map || typeof map !== 'object') {
        return 0;
    }
    let changed = 0;
    Object.keys(map).forEach((idRaw) => {
        const key = String(idRaw || '').trim().toLowerCase();
        if (!key || !COLOR_FAMILY_ORDER.includes(key)) {
            return;
        }
        colorGroupEnabledMap.set(key, !!map[idRaw]);
        changed += 1;
    });
    skipPlaybackIfColorGroupBlocked();
    if (changed > 0) {
        broadcastColorGroupsSnapshot();
    }
    return changed;
};

window.getColorGroupsSnapshot = function() {
    const counts = {};
    currentSetEntries.forEach((entry) => {
        if (!entry || !Array.isArray(entry.colorFamilies)) {
            return;
        }
        entry.colorFamilies.forEach((family) => {
            counts[family] = (counts[family] || 0) + 1;
        });
    });

    let currentFamilies = [];
    if (currentSetIndex >= 0 && currentSetIndex < currentSetEntries.length) {
        const cur = currentSetEntries[currentSetIndex];
        currentFamilies = cur && Array.isArray(cur.colorFamilies) ? cur.colorFamilies : [];
    }

    return COLOR_FAMILY_ORDER.map((id) => ({
        id,
        label: id,
        swatch: COLOR_FAMILY_SWATCHES[id] || '#888',
        enabled: colorGroupEnabledMap.get(id) !== false,
        clipCount: counts[id] || 0,
        isCurrent: currentFamilies.includes(id)
    }));
};

window.isColorFamilyEnabled = function(family) {
    const key = String(family || '').trim().toLowerCase();
    if (!key || !COLOR_FAMILY_ORDER.includes(key)) {
        return true;
    }
    return colorGroupEnabledMap.get(key) !== false;
};

window.classifyRgbColorFamily = classifyRgbColorFamily;
window.ensureColorDatasetLoaded = ensureColorDatasetLoaded;

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

function normalizeSetEntries(urls, labels = [], transitions = [], defaults = {}, manifestMeta = {}) {
const overlayById = manifestMeta.loopGroupLabels && typeof manifestMeta.loopGroupLabels === 'object'
    ? manifestMeta.loopGroupLabels
    : null;
const groupIds = Array.isArray(manifestMeta.groupIds) ? manifestMeta.groupIds : [];
const rowGroupLabels = Array.isArray(manifestMeta.loopGroupRowLabels)
    ? manifestMeta.loopGroupRowLabels
    : [];
const colorTagsByUrl = manifestMeta.colorTagsByUrl && typeof manifestMeta.colorTagsByUrl === 'object'
    ? manifestMeta.colorTagsByUrl
    : null;
const entries = [];
for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    if (!url) continue;
    const sourceTransition = transitions[i] || {};
    const clipStartSec = Number.isFinite(sourceTransition.clipStartSec) ? Math.max(0, sourceTransition.clipStartSec) : null;
    const clipEndSec = Number.isFinite(sourceTransition.clipEndSec) ? Math.max(0, sourceTransition.clipEndSec) : null;
    let loopGroupRaw = '';
    if (groupIds.length > i && groupIds[i] != null) {
        loopGroupRaw = String(groupIds[i]);
    }
    const loopGroupId = loopGroupRaw.trim() || null;
    let loopGroupRowLabel = null;
    if (rowGroupLabels.length > i && rowGroupLabels[i] != null && String(rowGroupLabels[i]).trim()) {
        loopGroupRowLabel = String(rowGroupLabels[i]).trim();
    }
    let loopGroupLabel = null;
    if (overlayById && loopGroupId && typeof overlayById[loopGroupId] === 'string' && overlayById[loopGroupId].trim()) {
        loopGroupLabel = overlayById[loopGroupId].trim();
    } else if (loopGroupRowLabel) {
        loopGroupLabel = loopGroupRowLabel;
    }

    let colorFamilies = getColorFamiliesForUrl(url);
    if (colorTagsByUrl && colorTagsByUrl[url]) {
        const fromManifest = expandColorTagsToFamilies(colorTagsByUrl[url]);
        if (fromManifest.length > 0) {
            colorFamilies = fromManifest;
        }
    }

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
        },
        loopGroupId,
        loopGroupLabel,
        colorFamilies
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
return loopPreferenceByUrl.get(entry.url) !== 'dislike'
    && isLoopFolderGroupEntryEnabled(entry)
    && isColorGroupEntryEnabled(entry);
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
const sweep = Math.max(1, currentSetEntries.length);
const maxAttempts = Math.min(sweep * 8, 512);
for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const normalized = ((candidate % sweep) + sweep) % sweep;
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

function queueVideoSet(urls, labels = [], transitions = [], defaults = {}, manifestMeta = {}) {
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

currentSetEntries = normalizeSetEntries(urls, labels, transitions, defaults, manifestMeta);
syncFolderLoopGroupsFromEntries(currentSetEntries, {
    loopGroupLabels: manifestMeta.loopGroupLabels
});
clipVisitByUrl.clear();
loopPreferenceByUrl.clear();
recentLoopHistory.length = 0;
window.__hypermuseLoadedSetCount = currentSetEntries.length;
window.__hypermuseCurrentLoopLabel = "";
window.__hypermuseSetUrls = currentSetEntries.map((entry) => entry.url).filter(Boolean);
const startIdx = firstEligibleEntryIndex();
if (startIdx >= 0) {
    playSetEntryAt(startIdx);
}
broadcastLoopGroupsSnapshot();
broadcastColorGroupsSnapshot();
}

async function loadVideoSetManifest(manifestPath) {
await ensureColorDatasetLoaded();
const response = await fetch(manifestPath, { cache: 'no-store' });
if (!response.ok) {
    throw new Error(`Could not load video set manifest: ${manifestPath}`);
}
const manifest = await response.json();

let defaultTransition = {};
const presetLoopGroupLabels = manifest.loopGroupLabels && typeof manifest.loopGroupLabels === 'object'
    ? manifest.loopGroupLabels
    : {};

const folderLoopRoot = manifest && typeof manifest.folderLoopRoot === 'string' && manifest.folderLoopRoot.trim()
    ? manifest.folderLoopRoot.trim()
    : '';

const manifestMeta = {
    groupIds: [],
    loopGroupLabels: presetLoopGroupLabels,
    loopGroupRowLabels: [],
    registeredLoopGroups: [],
    colorTagsByUrl: {}
};

if (Array.isArray(manifest.sourceDirectories)) {
    manifest.sourceDirectories.forEach((dirRaw) => {
        const dir = String(dirRaw || '').trim().replace(/\\/g, '/');
        if (!dir) {
            return;
        }
        const label = presetLoopGroupLabels[dir]
            || dir.split('/').filter(Boolean).pop()
            || dir;
        manifestMeta.registeredLoopGroups.push({ id: dir, label });
    });
}
if (Array.isArray(manifest.loopGroupCatalog)) {
    manifest.loopGroupCatalog.forEach((row) => {
        if (!row || typeof row !== 'object') {
            return;
        }
        const id = String(row.id || row.groupId || row.loopGroup || '').trim();
        if (!id) {
            return;
        }
        const label = row.label || row.loopGroupLabel || presetLoopGroupLabels[id] || id.split('/').pop();
        manifestMeta.registeredLoopGroups.push({ id, label });
    });
}

const rowsRaw = [];

if (Array.isArray(manifest)) {
    manifest.forEach((loopItem) => {
        const url = typeof loopItem === 'string'
            ? String(loopItem).trim()
            : (loopItem && loopItem.url ? String(loopItem.url).trim() : '');
        if (!url) {
            return;
        }
        const obj = typeof loopItem === 'object' && loopItem !== null ? loopItem : null;
        const label = obj && obj.label ? String(obj.label).trim()
            : (url.split('/') || []).pop();
        const transition = obj && obj.transition && typeof obj.transition === 'object' ? obj.transition : {};
        rowsRaw.push({
            url,
            label,
            transition
        });
    });
} else if (Array.isArray(manifest.loops)) {
    defaultTransition = manifest.defaultTransition || {};
    defaultTransition.playbackMode = manifest.playbackMode || 'pingpong';
    manifest.loops.forEach((loopItem) => {
        const obj = typeof loopItem === 'object' && loopItem !== null ? loopItem : null;
        const url = obj && obj.url != null
            ? String(obj.url).trim()
            : (typeof loopItem === 'string' ? String(loopItem).trim() : '');
        if (!url) {
            return;
        }

        let explicitGroupId = '';
        if (obj) {
            explicitGroupId = String(obj.loopGroup || obj.folderLoop || obj.group || obj.groupId || obj.loop_folder || '').trim();
        }

        let rowGroupDisplayLabel = '';
        if (obj) {
            const maybeLabel = obj.loopGroupLabel || obj.folderLabel || obj.folder_label;
            rowGroupDisplayLabel = maybeLabel != null ? String(maybeLabel).trim() : '';
        }

        const label = obj && obj.label ? String(obj.label).trim()
            : (url.split('/') || []).pop();
        const transition = obj && obj.transition && typeof obj.transition === 'object' ? obj.transition : {};

        let loopGroupDerived = '';
        if (!explicitGroupId && folderLoopRoot) {
            const derivedId = deriveFolderLoopGroupId(url, folderLoopRoot);
            if (derivedId) {
                loopGroupDerived = derivedId;
            }
        }

        const groupIdMerged = explicitGroupId || loopGroupDerived || '';

        let colorTags = [];
        if (obj && Array.isArray(obj.colorTags)) {
            colorTags = obj.colorTags;
        } else if (obj && Array.isArray(obj.colorFamilies)) {
            colorTags = obj.colorFamilies;
        }

        rowsRaw.push({
            url,
            label,
            transition,
            groupId: groupIdMerged,
            loopGroupRowLabel: rowGroupDisplayLabel,
            colorTags
        });
    });
} else {
    throw new Error('Invalid manifest format. Expected array or { loops: [] }.');
}

const filteredRows = [];
for (let r = 0; r < rowsRaw.length; r++) {
    const row = rowsRaw[r];
    if (!row || !row.url) {
        continue;
    }
    const lowered = row.url.toLowerCase();
    let okExt = false;
    for (const ext of supportedVideoExtensions) {
        if (lowered.endsWith(ext)) {
            okExt = true;
            break;
        }
    }
    if (!okExt) {
        continue;
    }
    filteredRows.push(row);
}

filteredRows.forEach((row) => {
    if (row && row.url && Array.isArray(row.colorTags) && row.colorTags.length > 0) {
        manifestMeta.colorTagsByUrl[row.url] = row.colorTags;
    }
});

const urls = filteredRows.map((row) => row.url);
const labels = filteredRows.map((row) => row.label);
const transitions = filteredRows.map((row) => row.transition);
manifestMeta.groupIds = filteredRows.map((row) => row.groupId || '');
manifestMeta.loopGroupRowLabels = filteredRows.map((row) => row.loopGroupRowLabel || '');

queueVideoSet(urls, labels, transitions, defaultTransition, manifestMeta);
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
ensureColorDatasetLoaded();

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

