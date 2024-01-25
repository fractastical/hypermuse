const vertexShader = `
    varying vec2 vUv;

    void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const fragmentShader = `
    varying vec2 vUv;
    uniform sampler2D texture;

    void main() {
        vec4 texel = texture2D(texture, vUv);
        
        // Detect red hue and replace with blue
        if (texel.r > 0.8 && texel.g < 0.2 && texel.b < 0.2) {
            gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); // Blue color
        } else {
            gl_FragColor = texel;
        }
    }
`;

const material = new THREE.ShaderMaterial({
    uniforms: {
        texture: { value: null }
    },
    vertexShader,
    fragmentShader
});


const loader = new THREE.TextureLoader();
loader.load('path/to/your/image.jpg', function(texture) {
    material.uniforms.texture.value = texture;
});


const geometry = new THREE.PlaneGeometry(5, 5);
const plane = new THREE.Mesh(geometry, material);
scene.add(plane);
