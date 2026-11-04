# Add Spawn to the public AgentKit

Build the four browser files in the sibling `agentkit-spawn` project first. From this directory, run

```sh
node build.mjs /path/to/published/agentkit ../agentkit-spawn/dist /path/to/staging/agentkit
```

The input directory is the previously published AgentKit 0.3.0-alpha.1 release. The builder verifies the original landing page and manifest digests, changes the main action to “Spawn a GH0ST,” and adds the four browser assets under `spawn/`. It updates file sizes and SHA-256 digests in the Kit manifest. Rebuilding with the same inputs produces the same six files.

Overlay those six files on the existing site. The active Netlify deployment also supplies the Kit fonts and GH0ST logos used by the page. Existing AgentKit archives, the paid access panel and its deployment manifest keep their original contents.
