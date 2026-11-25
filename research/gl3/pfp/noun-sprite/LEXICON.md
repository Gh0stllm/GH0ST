# Animal appearance vocabulary

The frozen vocabulary contains 100 English names. Each name resolves to a shared representation of external animal traits and a small palette. The four renderer families represent mammal portraits, bird portraits, frontal marine invertebrates, and side-on fish. The marine invertebrate family covers octopuses, squid, cuttlefish, and jellies. It is a visual grouping.

The traits summarize typical or recognizable variants, with explicit representative species for generic names. For example, “fox” uses red fox coloration, “panda” represents the giant panda, and “penguin” uses emperor penguin coloration. Authors selected the RGB colors and the 0–255 emphasis, breadth, and elongation values for stylized rendering. Those values are approximations. The vocabulary contains no image assets, body-part positions, pixel data, or instructions for arranging individual animals. [Source notes per noun](lexicon.json)

| Bytes | Contents |
| --- | --- |
| 0–7 | FNV-1a 64-bit hash of the normalized ASCII name, big endian |
| 8 | Family, 0 for mammal, 1 for bird, 2 for frontal marine invertebrate, 3 for fish |
| 9 | Mammal ear form, bird tuft indicator, or marine body form depending on family |
| 10 | Plain, light muzzle or belly, or distinct eye markings |
| 11 | Solid, striped, or spotted |
| 12 | Bit flags for horns or antlers, whiskers, and extended neck |
| 13–21 | Main, light and accent colors in RGB order |
| 22–24 | Feature emphasis, breadth and elongation on a 0–255 scale |

Records use normalized lowercase names and one ASCII space between words. The binary is sorted by ascending unsigned name hash. The packer checks all fields, the 25-byte record size, and hash uniqueness. [Packing script](pack_lexicon.py)

The main references are the Animal Diversity Web’s [fox](https://animaldiversity.org/accounts/Vulpes/), [giant panda](https://animaldiversity.org/accounts/Ailuropoda_melanoleuca/) and [cottontail](https://animaldiversity.org/accounts/Sylvilagus_floridanus/) accounts, the San Diego Zoo Wildlife Alliance’s [giraffe](https://animals.sandiegozoo.org/animals/giraffe), [tiger](https://animals.sandiegozoo.org/animals/tiger) and [koala](https://animals.sandiegozoo.org/animals/koala) profiles, and the Cornell Lab’s [great horned owl identification guide](https://www.allaboutbirds.org/guide/great_horned_owl/id). The marine catalog draws from the [Monterey Bay Aquarium animal guides](https://www.montereybayaquarium.org/animals-the-ocean/animals-a-to-z), the California Academy of Sciences’ [reef identification guide](https://www.calacademy.org/sites/default/files/assets/docs/sah-reefs2-ocean-habitat-activity_210208.pdf), and the University of Florida’s [saltwater tank species notes](https://aquatic.vetmed.ufl.edu/about-us/students/aquatic-animal-health-club/large-animal-clinical-sciences-saltwater-tank/).

```sh
python3 pack_lexicon.py
```

The binary contains 2,500 bytes. Its SHA-256 is `4195e14d3627392fc010ae78f4d0861b67a3c476710b491b14275942652b41c7`.
