window.addEventListener('message', function(event) {
    const data = event.data;

    // let hueoffset = 20;
    //     let volumeThreshold = 40;
    //     let thresholds = Array(22).fill(40);
    //     let freezeFrameEffectActive = true;

    //     const scene = new THREE.Scene();
    //     const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
    //     camera.position.z = 2;
    //     const renderer = new THREE.WebGLRenderer();

    //     let container = document.getElementById('container');
    //     renderer.setSize(container.clientWidth, container.clientHeight);
    //     container.appendChild(renderer.domElement);

    //     var analyser;

    //     let numBands = 48;

    //     let holographicFanMode = false;

    //     let baseFrequency = 20; // Start from 20 Hz
    //     let maxFrequency = 20000; // Up to 20 kHz

    console.log("got a message");

    if (data.type === "playbackspeed") {
        console.log ("playbackspeed");
        
    }

        

    if (event.data.name === "xrotation") {
        // Same for variable B

        X_ROTATION_SPEED = parseFloat(event.data.value);
        

    }

    if (event.data.name === "mode") {
        // Same for variable B

        if(event.data.value === "color")
        {
            videoElementActive = false;
        }
        if(event.data.value === "video")
        {
            videoElementActive = true;
        }
        

    }
    if (event.data.name.startsWith("threshold")) {


        let threshNum = event.data.name.slice(9,event.data.name.length);
        let threshindex = parseInt(threshNum);
        console.log(threshNum + ":" + volumeThresholds[threshindex]);
        volumeThresholds[threshindex] = parseInt(event.data.value)
        let input = document.getElementById('threshold' + threshindex);
        input.value = volumeThresholds[threshindex];

    }

    if (event.data.name === "master") {
        // Same for variable B
            let masterValue = parseInt(event.data.value);
            master.value = masterValue;
            let delta = masterValue - lastMasterValue;
            // volumeThresholds = volumeThresholds.map(() => masterValue);  // Set all thresholds to the master's value

            for (let i = 0; i < numBands; i++) {
                let input = document.getElementById('threshold' + i);
                volumeThresholds[i] =  parseInt(input.value) + delta;
                input.value = parseInt(input.value) + delta;
                document.getElementById('volume' + i).textContent = 'v: 0 / ' + input.value;
            }

            lastMasterValue = masterValue;

    }


    if (event.data.name === "hueoffset") {

        hueoffset = parseInt(event.data.value);

    }

    if (event.data.name === "audiopop") {

        audioQueue.shift();

    }

    console.log(event.data);

    if (event.data.name === "videopop") {

        console.log("videopop");
        videoQueue.shift();

    }

    if (event.data.name === "numbands") {

        numBands = parseInt(event.data.value);
        initBands();
    }

    if (event.data.name === "holofanmode") {
        console.log(event.data.value);

        let fanon = parseInt(event.data.value);
        if(fanon == 1)
            holographicFanMode = true;
        else(fanon == 0)
            holographicFanMode = false;

    }

    if (event.data.name === "hueoffsetspeed") {

        hueoffsetspeed = parseFloat(event.data.value);
        console.log("speed");
        console.log(event.data);

    }

    if (event.data.name === "yrotation") {

        Y_ROTATION_SPEED = parseFloat(event.data.value);

    }

    if (event.data.name === "playbackrate") {

        //TODO: sort of works but makes no difference
        console.log("playback");
        videoElement.playbackRate = parseFloat(event.data.value);
        console.log(videoElement.playbackRate);
    }

    
    if (event.data.name === "videoInput") {

        console.log(event.data.value);

        videoQueue.length = 0;
        originalVideos.length = 0;

        // Convert FileList to Array and add to videoQueue
        for (let file of event.data.value.files) {
            const url = URL.createObjectURL(file);
            videoQueue.push(url);
            originalVideos.push(url);

        }

        // Play the first video
        if (videoQueue.length > 0) {
            videoElement.src = videoQueue.shift();
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

    }




});
