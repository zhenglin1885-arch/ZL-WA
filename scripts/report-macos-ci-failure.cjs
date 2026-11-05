// Bounded diagnostics for the disposable macOS build runner; never print environment values.
const fs = require('node:fs');
const text = fs.readFileSync(process.argv[2], 'utf8').split('\n').slice(-120).join('\n');
process.stdout.write('::error::' + text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A') + '\n');
