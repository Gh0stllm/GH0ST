# GH0ST public roadmap

This directory owns the public [GH0ST roadmap](https://gh0st.fyi/roadmap/) and its homepage entry point. It contains the eight planned protocol identities, the original roadmap infographic and a portrait explainer of the upcoming protocols. Each asset is available separately and in one downloadable archive.

The completed checklist is a November 4, 2026 snapshot. AgentKit retains its developer-preview label. The eight new modules are marked planned with no promised release date or delivery sequence. The HTML provides the same product descriptions as readable text alongside the image artwork.

## Build the deployment overlay

Use Python 3.9 or later from this directory. Supply the unmodified, published homepage and a new output directory.

```sh
python3 build.py /path/to/published/index.html /path/to/roadmap-overlay
```

The builder requires homepage SHA-1 `d5565f8affe1402e2ec75a3bd84a3cac9e2caf7f`, validates the ten source PNG dimensions, and adds a Roadmap link in the navigation and footer. A dark preview section appears before the existing homepage join section. The section has a separate stylesheet. The builder copies the roadmap assets and writes an archive with fixed timestamps and file order, so repeated builds are identical.

The output contains 15 files. Overlay it on the current [Netlify](https://app.netlify.com/projects/gh0st-observatory) site inventory, preserving all other published paths, functions, schedules, aliases, redirects and headers. A deployment of this partial directory alone would omit the other live applications.

The page uses the site's existing fonts and GH0ST mark. It requires no JavaScript, wallet or external API request. The portrait image and gallery use lazy loading with explicit dimensions. The supplied image-generation prompts are in `design-prompts.json` for provenance and are excluded from the public overlay.
