




# AudioSphere

Live Three.js music & VJ visualizer that maps real-time audio (or selected media files) onto geometries floating over a sphere. A built-in **hypergraph** view (via the `met4hyper` module) now reacts to the same beat.

## Getting Started

open up controller.html. visualizer will open up in separate tab. If desired you can display on a separate screen. Click play to start audio reactive version, otherwise pick a song with the picker. 

You can also pick videos to play over the surface area (i.e. similar to VJing)

If using the onboard microphone it will often filter out any speaker output coming from the same device, so it is recommened to using the picker in this case or use external input. 


<img src="https://github.com/fractastical/sonicsourcecode/assets/589191/4326f557-a1d6-4310-a3bf-826be4644dac" width="500" />

## How It Works

Uses a spectrum analizer to break music into bands, isolate tones, and then make the music visible by assigning each tone to the vertice spread over the surface of a sphere. When tones are played the vertices are activated and resulting lines or polygons are displayed. 

## Why

<img src="https://github.com/fractastical/sonicsourcecode/assets/589191/9fd329b2-dc12-4f12-94b9-3f2b7dfd4cd6" width="250" />

Looks cool during a performance. May also help you to play better music by *seeing* the music. 

As used for projection during a set (https://instagram.com/rootflute) 


## Included Files / Demo Modes

## videosphere

<img src="https://github.com/fractastical/sonicsourcecode/assets/589191/3b94708f-2f0a-40cd-89d1-2f8e859b6349" width="200" height="200" />

Live VJing software allowing frame by frame display of music hyper imposed around a sphere. 

##  polysphere

<img src="https://github.com/fractastical/sonicsourcecode/assets/589191/dfa2e145-26e9-43e6-8758-588dd2bee8df" width="200" height="200" />

Sound reactive input signal is split into bands logarithmicly mapped to the vertices on a sphere, equalized manually and distributed into polygons. 

##  nodesphere

<img src="https://github.com/fractastical/sonicsourcecode/assets/589191/301f81b2-2ee1-4a05-9067-ec538fe68a69" width="200" height="200" />

Sound bands are mapped as edges between vertices mapped over the surface of a sphere. Allows dynamic hues.  

##  dynamicsphere

<img src="https://github.com/fractastical/sonicsourcecode/assets/589191/2d287873-0ade-415d-84ba-769398e86445" width="200" height="200" />

Sound reactive side-scrolling sets of spheres mapped to low, mid, high bands displaying over a time series, allows you to dynamically set number of bands

## staticsphere

<img src="https://github.com/fractastical/sonicsourcecode/assets/589191/1d5cbfab-e8d1-461b-a2f7-209d5a95170d" width="200" height="200" />

sound reactive sets of side scrolling spheres mapped to low, mid, high bands displaying over a time series


# Mathematical Logic Behind Vertex Distribution

## Band Frequency Calculation
The frequency for each band (i) can be calculated using the formula:

`bandFrequency = baseFrequency * ratio^i`

Where:
- `i` is the band number ranging from 0 to `(numBands - 1)`.
- `baseFrequency` is the starting frequency.
- `ratio` is the frequency multiplier factor.

## Golden Ratio and Angle Increment
The golden ratio (phi, φ) is defined as:

`φ = (1 + √5) / 2`

The angle increment based on the golden ratio is:

`angleIncrement = 2π * φ`

## 3D Point Computation
For each band (i), a 3D point is calculated as follows:

- Normalize the band index:
`v = i / numBands`

- Compute spherical coordinates:
`ϕ = v * π`
`θ = angleIncrement * i`

- Convert spherical coordinates to Cartesian coordinates:
`x = sin(ϕ) * cos(θ)`
`y = sin(ϕ) * sin(θ)`
`z = cos(ϕ)`

## Point Creation
A 3D point with coordinates (x, y, z) can be created and added to a scene. The creation of the point is more of a procedural step and does not have a direct mathematical representation.

This mathematical logic is used to distribute vertices in a 3D space, which can be applied to various computer graphics and visualization tasks.



See also the hypermusic repository for the theoertical background: https://github.com/fractastical/hypermusic


