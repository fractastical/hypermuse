
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

const videoElement = document.getElementById('videoElement');

document.getElementById('videoInput').addEventListener('change', function(event) {

// if(activeVideoQueue.length > 0)
//      allVideoQueues.push("video1", )

activeVideoQueue.length = 0;
originalVideos.length = 0;

// Convert FileList to Array and add to activeVideoQueue
for (let file of event.target.files) {
    const url = URL.createObjectURL(file);
    console.log(url);
    activeVideoQueue.push(url);
    originalVideos.push(url);
    appendFilenameToList(file.name);

}

allVideoLoops.push([...originalVideos]);

// Play the first video
if (activeVideoQueue.length > 0) {
    videoElement.src = activeVideoQueue.shift();
    videoElement.play();
    videoElementActive = true;

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

