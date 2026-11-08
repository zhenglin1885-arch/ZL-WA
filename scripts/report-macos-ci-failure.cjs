// Bounded diagnostics for the disposable macOS runner; never print environment values.
const fs = require('node:fs');

const text = fs
  .readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .slice(-160)
  .join('\n');
for (let start = 0; start < text.length; start += 1700) {
  const chunk = text
    .slice(start, start + 1700)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A');
  process.stdout.write(`::error::${chunk}\n`);
}
