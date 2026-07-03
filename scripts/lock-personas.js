// Persona lock tool — enforces .agents/AGENTS.md.
//
//   npm run lock-personas      snapshot the CURRENT te/hi/en personas as the approved
//                              baseline (run ONLY after the user explicitly approves
//                              a persona change)
//   npm run restore-personas   overwrite the live personas with the locked baseline
//                              (recover from any unapproved drift)
//
// `npm run preflight` FAILS if any live persona differs byte-for-byte from the baseline.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'agent', 'personas');
const DEST = path.join(SRC, 'locked');
const FILES = ['te.js', 'hi.js', 'en.js'];
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

if (process.argv.includes('--restore')) {
  const manifest = JSON.parse(fs.readFileSync(path.join(DEST, 'manifest.json'), 'utf8'));
  for (const f of FILES) {
    fs.copyFileSync(path.join(DEST, f), path.join(SRC, f));
    console.log(`restored ${f} from baseline (locked ${manifest.lockedAt})`);
  }
  console.log('Personas restored. The server hot-reloads them on the next call.');
} else {
  fs.mkdirSync(DEST, { recursive: true });
  const manifest = { lockedAt: new Date().toISOString(), files: {} };
  for (const f of FILES) {
    const buf = fs.readFileSync(path.join(SRC, f));
    fs.writeFileSync(path.join(DEST, f), buf);
    manifest.files[f] = sha(buf);
  }
  fs.writeFileSync(path.join(DEST, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Personas LOCKED at ${manifest.lockedAt}`);
  for (const [f, h] of Object.entries(manifest.files)) console.log(`  ${f}  sha256 ${h.slice(0, 20)}…`);
}
