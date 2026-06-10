const {downloadArtifact} = require('@electron/get');
const extract = require('extract-zip');
const fs = require('fs');
const path = require('path');

async function main() {
  const pkg = require('./node_modules/electron/package.json');
  const base = __dirname;
  console.log('Downloading electron', pkg.version);
  const zipPath = await downloadArtifact({version: pkg.version, artifactName: 'electron'});
  console.log('Downloaded to', zipPath);
  console.log('Extracting...');
  await extract(zipPath, {dir: path.join(base, 'node_modules/electron/dist')});
  console.log('Extracted. Writing path.txt');
  fs.writeFileSync(path.join(base, 'node_modules/electron/path.txt'), 'electron.exe');
  console.log('DONE');
}

main().catch(e => {
  console.error('FAIL:', e.message, e.stack);
  process.exit(1);
});
