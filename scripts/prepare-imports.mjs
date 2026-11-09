import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const vendor = new URL('../site/vendor/', import.meta.url);
await mkdir(vendor, { recursive: true });
await Promise.all([
  build({
    stdin: { contents: "export { SaxesParser } from 'saxes'; export { Unzip, UnzipInflate } from 'fflate';", resolveDir: root },
    bundle: true, minify: true, platform: 'browser', format: 'esm',
    outfile: fileURLToPath(new URL('health-codecs.js', vendor)),
  }),
  copyFile(new URL('../licenses/saxes.txt', import.meta.url), new URL('saxes-LICENSE.txt', vendor)),
  ...['pdf.mjs', 'pdf.worker.mjs'].map(file => copyFile(
    new URL('../node_modules/pdfjs-dist/legacy/build/' + file.replace('.mjs', '.min.mjs'), import.meta.url), new URL(file, vendor))),
  ...['pdfjs-dist', 'fflate', 'xmlchars'].map(name => copyFile(
    new URL('../node_modules/' + name + '/LICENSE', import.meta.url), new URL(name + '-LICENSE.txt', vendor))),
]);
