/* eslint-disable no-console -- Command-line source-scope verification. */
const assert = require('node:assert/strict');
const { readFileSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const ts = require('typescript');

const base = '3f23a418c2f2836e290d73b3b3ccb35a7b6cab99';
const file = 'src/features/accountTools/AccountTools.tsx';
function shape(node) {
  const children = [];
  node.forEachChild(child => {
    children.push(shape(child));
  });
  const text =
    ts.isIdentifier(node) ||
    ts.isLiteralExpression(node) ||
    ts.isJsxText(node) ||
    ts.isTemplateLiteralToken(node)
      ? node.text
      : null;
  return [node.kind, text, node.isTypeOnly ?? null, children];
}
function businessSource(source) {
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const transformed = ts.transform(ast, [
    context => root => {
      function visit(node) {
        if (
          ts.isImportDeclaration(node) &&
          node.moduleSpecifier.text === '@mdi/js'
        )
          return [];
        if (
          ts.isJsxElement(node) &&
          node.openingElement.tagName.getText(ast) === 'svg'
        )
          return [];
        if (
          ts.isJsxSelfClosingElement(node) &&
          node.tagName.getText(ast) === 'svg'
        )
          return [];
        if (ts.isJsxText(node)) {
          const value = node.text.trim();
          return !value || ['▤', '译', '☷'].includes(value)
            ? []
            : ts.factory.createJsxText(value);
        }
        if (
          ts.isArrayLiteralExpression(node) &&
          node.elements.length === 3 &&
          ['speech', 'join', 'leave'].includes(node.elements[0].text)
        ) {
          return ts.factory.updateArrayLiteralExpression(node, [
            node.elements[0],
            node.elements[1],
            ts.factory.createStringLiteral('ICON'),
          ]);
        }
        return ts.visitEachChild(node, visit, context);
      }
      return ts.visitNode(root, visit);
    },
  ]);
  return JSON.stringify(shape(transformed.transformed[0]));
}
const original = execFileSync('git', ['show', `${base}:${file}`], {
  encoding: 'utf8',
});
const before = businessSource(original);
const after = businessSource(readFileSync(file, 'utf8'));
assert.equal(
  createHash('sha256').update(after).digest('hex'),
  createHash('sha256').update(before).digest('hex'),
  'Only rail SVG presentation may change; handlers, state, IPC and existing accessibility attributes must match test22',
);
const changed = execFileSync(
  'git',
  ['diff', '--name-only', base, '--', 'src'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n');
assert.deepEqual(
  changed.sort((left, right) => left.localeCompare(right)),
  [
    file,
    'src/styles/_zl-tokens.scss',
    'src/styles/account-tools.scss',
    'src/styles/accounts.scss',
  ].sort((left, right) => left.localeCompare(right)),
);
for (const path of [
  'src/styles/accounts.scss',
  'src/styles/account-tools.scss',
]) {
  const css = readFileSync(path, 'utf8');
  assert(!/#(?:0754da|0654df|353c49|2876ff)\b/i.test(css), path);
  for (const [, value] of css.matchAll(/border-radius:\s*([^;]+);/g))
    assert(
      /^(?:\$zl-radius-[\w-]+|0|50%)$/.test(
        value.replace(/\s*!important$/, ''),
      ),
      `${path}: ${value}`,
    );
  for (const [, value] of css.matchAll(/font-size:\s*\$zl-size-(\d+)/g))
    assert(
      [12, 13, 14, 16, 18, 20].includes(Number(value)),
      `${path}: font ${value}`,
    );
}
const report = {
  sourceBase: base,
  handlersStateAndIpcUnchanged: true,
  webviewSourcesUnchanged: true,
  changedApplicationFiles: changed,
  normalizedBusinessSha256: createHash('sha256').update(after).digest('hex'),
  typographyAndRadiusVerified: true,
};
if (process.env.ZL_ROUNDED_SOURCE_REPORT)
  writeFileSync(
    process.env.ZL_ROUNDED_SOURCE_REPORT,
    `${JSON.stringify(report, null, 2)}\n`,
  );
console.log(
  'PASS rounded UI source scope, equivalent business AST, preserved handlers/attributes, radius and typography tokens',
);
