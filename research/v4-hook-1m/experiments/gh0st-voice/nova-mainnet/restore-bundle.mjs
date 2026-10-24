import {restoreArtifact,read} from './common.mjs';
const index=read('bundle/parts.json');
for(const[name,entry]of Object.entries(index.artifacts)){restoreArtifact(name,entry.sha256);console.log('Verified '+name);}
