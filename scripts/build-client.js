'use strict';

// Bundles the browser-side scripts in client/ (and the npm packages they
// import) into files the browser can load from public/js/.
// Run with: npm run build
//
//   client/sparkle.jsx     ->  public/js/sparkle.js     (React, react-sparkle)
//   client/attunement.js   ->  public/js/attunement.js  (torph)

const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');

esbuild
  .build({
    entryPoints: {
      sparkle: path.join(root, 'client', 'sparkle.jsx'),
      attunement: path.join(root, 'client', 'attunement.js'),
    },
    outdir: path.join(root, 'public', 'js'),
    bundle: true,
    minify: true,
    target: 'es2020',
    define: { 'process.env.NODE_ENV': '"production"' },
    legalComments: 'none',
    metafile: true,
  })
  .then((result) => {
    for (const [file, info] of Object.entries(result.metafile.outputs)) {
      console.log(`Built ${path.relative(root, path.resolve(file))} (${Math.round(info.bytes / 1024)} kB)`);
    }
  })
  .catch(() => process.exit(1));
