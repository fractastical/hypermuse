//https://stackoverflow.com/questions/53320479/create-3d-model-of-pile-with-points-with-three-js


var size = { x: 200, y: 200 };
var pointsCount = 1000;
var points3d = [];
for (let i = 0; i < pointsCount; i++) {
  let x = THREE.Math.randFloatSpread(size.x);
  let z = THREE.Math.randFloatSpread(size.y);
  let y = noise.perlin2(x / size.x * 5, z / size.y * 5) * 50;
  points3d.push(new THREE.Vector3(x, y, z));
}

var geom = new THREE.BufferGeometry().setFromPoints(points3d);
var cloud = new THREE.Points(
  geom,
  new THREE.PointsMaterial({ color: 0x99ccff, size: 2 })
);
scene.add(cloud);

// triangulate by [x, z]
var indexDelaunay = Delaunator.from(
  points3d.map(v => {
    return [v.x, v.z];
  })
);

var meshIndex = []; // delaunay index => three.js index
for (let i = 0; i < indexDelaunay.triangles.length; i++){
  meshIndex.push(indexDelaunay.triangles[i]);
}

geom.setIndex(meshIndex); // add three.js index to the existing geometry
geom.computeVertexNormals();
var mesh = new THREE.Mesh(
  geom, // re-use the existing geometry
  new THREE.MeshLambertMaterial({ color: "purple", wireframe: true })
);
scene.add(mesh);

var gui = new dat.GUI();
gui.add(mesh.material, "wireframe");

render();

function resize(renderer) {
    const canvas = renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const needResize = canvas.width !== width || canvas.height !== height;
    if (needResize) {
      renderer.setSize(width, height, false);
    }
    return needResize;
  }
  
  function render() {
    if (resize(renderer)) {
      camera.aspect = canvas.clientWidth / canvas.clientHeight;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    requestAnimationFrame(render);
  }
  