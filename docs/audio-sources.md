# Audio source notes

## Player swim-stroke effects

- Source: [Water Splash and sand footsteps](https://opengameart.org/content/water-splash-and-sand-footsteps)
- Source file: `drowning.wav`
- Creator: Peludo
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
- Processing: retained the full 0.50-second splash and water-flow tail, converted it to mono 22.05 kHz PCM, removed moving voice harmonics frame by frame, filled the removed bins with spectral texture learned from the clean opening water sound, faded both edges, and peak-normalized.

The resulting runtime file is `assets/music/sfx/stroke_water_01.wav`.
