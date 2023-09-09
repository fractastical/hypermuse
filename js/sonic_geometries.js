function createTriangleGeometry(p1, p2, p3) {
    const geometry = new THREE.BufferGeometry();
    
    const vertices = new Float32Array([
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z,
        p3.x, p3.y, p3.z
    ]);


    const uvs = new Float32Array([
        0, 0,
        1, 0,
        0.5, 1
    ]);

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    return geometry;
}

function createInnerTriangleGeometry(p1, p2, p3, triangleOffset=innerTriangleOffset) {
    const geometry = new THREE.BufferGeometry();
    
    const vertices = new Float32Array([
        p1.x - triangleOffset, p1.y - triangleOffset, p1.z  - triangleOffset,
        p2.x - triangleOffset, p2.y - triangleOffset, p2.z - triangleOffset,
        p3.x- triangleOffset, p3.y - triangleOffset, p3.z - triangleOffset
    ]);


    const uvs = new Float32Array([
        0, 0,
        1, 0,
        0.5, 1
    ]);

    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    return geometry;
}

function getNextImageTexture() {
    
    if (loadedImages.length === 0) return null; // Handle the case when no images have been loaded
    
    // For sequential use:
    let nextImage = loadedImages.shift();
    loadedImages.push(nextImage); // Put the image at the end of the array to cycle through the images
    
    // Alternatively, for random use:
    // let nextImage = loadedImages[Math.floor(Math.random() * loadedImages.length)];
    
    let textureCanvas = document.createElement('canvas');
    textureCanvas.width = nextImage.width;
    textureCanvas.height = nextImage.height;
    let ctx = textureCanvas.getContext('2d');
    ctx.drawImage(nextImage, 0, 0);

    let texture = new THREE.Texture(textureCanvas);
    texture.needsUpdate = true;

    return texture;
}

function createTetrahedron(size, flip = false) {
    const geometry = new THREE.TetrahedronGeometry(size);
    if (flip) {
        geometry.rotateY(Math.PI);
    }
    return geometry;
}

function mergeGeometries(geometries) {
    const mergedGeometry = new THREE.BufferGeometry();
    let offset = 0;

    geometries.forEach(geometry => {
        for (let attributeName in geometry.attributes) {
            if (mergedGeometry.attributes[attributeName] === undefined) {
                mergedGeometry.attributes[attributeName] = geometry.attributes[attributeName].clone();
            } else {
                mergedGeometry.attributes[attributeName].array.set(geometry.attributes[attributeName].array, offset);
            }
        }
        offset += geometry.attributes.position.count;
    });

    return mergedGeometry;
}

function createTriangleWithBorder(vertices, defaultColor = "0xffffff", thickness = 0.1) {
    const mainGeometry = new THREE.BufferGeometry().setFromPoints(vertices);

    // Calculate the centroid of the triangle
    const centroid = new THREE.Vector3();
    for (let vertex of vertices) {
        centroid.add(vertex);
    }
    centroid.divideScalar(vertices.length);

    // Create an inner triangle by moving each vertex towards the centroid
    const innerVertices = vertices.map(v => {
        const dir = new THREE.Vector3().subVectors(centroid, v).normalize();
        return new THREE.Vector3().addVectors(v, dir.multiplyScalar(thickness));
    });

    const innerGeometry = new THREE.BufferGeometry().setFromPoints(innerVertices);

    // Create line geometries for the border
    const borderLines = [];
    for (let i = 0; i < vertices.length; i++) {
        borderLines.push(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([vertices[i], innerVertices[i]]),
            new THREE.LineBasicMaterial({ color: defaultColor })
        ));
    }

    // Group everything together
    const group = new THREE.Group();
    group.add(new THREE.Line(mainGeometry, new THREE.LineBasicMaterial({ color: defaultColor })));
    group.add(new THREE.Line(innerGeometry, new THREE.LineBasicMaterial({ color: defaultColor })));
    borderLines.forEach(line => group.add(line));

    return group;
}

// Example usage:
const triangleVertices = [
    new THREE.Vector3(-0.5, -0.5, 0),
    new THREE.Vector3(.5, -0.5, 0),
    new THREE.Vector3(0, .5, 0)
];

// const triangleWithBorder = createTriangleWithBorder(triangleVertices);
// scene.add(triangleWithBorder);



    // const sphereRadius = .1;  // Adjust as needed
    // const sphereWidthDivisions = 32;
    // const sphereHeightDivisions = 32;

    // const sphereGeometry = new THREE.SphereGeometry(sphereRadius, sphereWidthDivisions, sphereHeightDivisions);
    // const sphereMaterial = new THREE.MeshBasicMaterial({ color: "blue" });  // White color
    // const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    // sphere.position.set(0, 0, 0);
    // scene.add(sphere);


// document.getElementById('folderInput').addEventListener('change', function(event) {
//     let files = event.target.files;
//     for (let i = 0; i < files.length; i++) {
//         if (files[i].type.startsWith('image/')) { // Ensure the file is an image
//             let reader = new FileReader();
//             reader.readAsDataURL(files[i]);
//             reader.onload = function() {
//                 let img = new Image();
//                 img.src = reader.result;
//                 loadedImages.push(img);
//             };
//         }
//     }
// });


// ERRORs   
// THREE.Object3D.add: object not an instance of THREE.Object3D. TetrahedronGeometry
// add @ threejs.org_build_three.js:7439
// threejs.org_build_three.js:10826 THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN. The "position" attribute is likely to have NaN values. 

// const size = 0.5;

// const tetrahedron1 = createTetrahedron(size);
// const tetrahedron2 = createTetrahedron(size, true);

// // const starTetrahedronGeometry = mergeGeometries([tetrahedron1, tetrahedron2]);
// // const material = new THREE.MeshBasicMaterial({ color: 0x00ff00, wireframe: true }); // wireframe material for visualization

// // const starTetrahedron = new THREE.Mesh(starTetrahedronGeometry, material);
// // scene.add(starTetrahedron);
// scene.add(tetrahedron1);
// scene.add(tetrahedron2);


// material = new THREE.MeshLambertMaterial({color:0x00ff00, wireframe: false});

// // https://codepen.io/alexpeach/pen/OOOpOZ
// /* PYRAMID */
// //This a bit weird because it's like a cylinder

// geometryPyramid = new THREE.CylinderGeometry(0, 75, 100, 3, false); 
// pyramid = new THREE.Mesh(geometryPyramid, material);
// pyramid.position.x = 10;	
// scene.add(pyramid);

// geometryPyramid = new THREE.CylinderGeometry(0, 75, 100, 3, false); 
// // material = new THREE.MeshLambertMaterial({color:0x00fff, wireframe: false});
// pyramid2 = new THREE.Mesh(geometryPyramid, material);
// pyramid2.position.x = 10;
// pyramid2.position.y = -51;
// pyramid2.rotation.x = 380;
// scene.add(pyramid2);


