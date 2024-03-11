const fragmentShader = `
    varying vec2 vUv;
    uniform sampler2D texture;
    uniform float time;

    void main() {
        vec4 texel = texture2D(texture, vUv);

        // Use the time variable to modify the shading
        // Example: oscillating between red and blue hues
        float redStrength = sin(time) * 0.5 + 0.5;
        float blueStrength = cos(time) * 0.5 + 0.5;

        vec4 modifiedColor = mix(vec4(1.0, 0.0, 0.0, 1.0), vec4(0.0, 0.0, 1.0, 1.0), blueStrength);
        modifiedColor = mix(texel, modifiedColor, redStrength);

        gl_FragColor = modifiedColor;
    }
`;

const material = new THREE.ShaderMaterial({
    uniforms: {
        texture: { value: null },
        time: { value: 0.0 }
    },
    vertexShader,
    fragmentShader
});
