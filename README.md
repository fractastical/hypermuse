# sonicsphere 0.333

# instructions

open up controller.html. visualizer will open up in separate tab. If desired you can display on a separate screen. Click play to start audio reactive version, otherwise pick a song with the picker. 

# description

Encodings for doing audio reactive visualization with spheres and other geometries. 

Ultimate goal is to use higher order math, especially hypergraphs, to deterministiically render the mathematical structure behind the music and serve as an aide to musicians as they play there music and... of course... to viewers to have a more immersive experience of the music. 

See also the hypermusic repository for the theoertical background: https://github.com/fractastical/hypermusic

![bach-techno-cathedral](https://github.com/fractastical/sonicsourcecode/assets/589191/a54d9be5-cf29-4983-a944-a333e4375b6a)


# usage notes

If using the onboard microphone it will often filter out any speaker output coming from the same device, so it is recommened to using the picker in this case or use external input. 


# videosphere

Live VJing software allowing frame by frame display of music hyper imposed around a sphere. 


# poly sphere

Sound reactive input signal is split into bands logarithmicly mapped to the vertices on a sphere, equalized manually and distributed into polygons. 

<img width="572" alt="Screenshot 2023-07-30 at 13 19 03" src="https://github.com/fractastical/audiosphere/assets/589191/9f220bc4-c54e-4fd6-91ad-3f52ca5c14e2">



# node sphere

Sound bands are mapped as edges between vertices mapped over the surface of a sphere. Allows dynamic hues.  

![estaban-polygons](https://github.com/fractastical/sonicsourcecode/assets/589191/301f81b2-2ee1-4a05-9067-ec538fe68a69)



# static sphere

sound reactive sets of side scrolling spheres mapped to low, mid, high bands displaying over a time series

<img width="1006" alt="Screenshot 2023-07-28 at 19 16 13" src="https://github.com/fractastical/audiosphere/assets/589191/d147a44c-f533-49b1-944f-c31ad5c26613">

![richardawatson_speaking](https://github.com/fractastical/sonicsourcecode/assets/589191/2d287873-0ade-415d-84ba-769398e86445)


# dynamic sphere

Sound reactive sides crolling sets of spheres mapped to low, mid, high bands displaying over a time series, allows you to dynamically set number of bands


# d3

d3 - sound reactive 2d version circle


Version .33 : added video controls
