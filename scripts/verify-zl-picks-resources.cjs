/* eslint-disable no-console -- Build artifact verification. */
/* eslint-disable no-await-in-loop -- Verify each extracted recipe in sequence. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tar = require('tar');
const prepareZLPicksRecipes = require('../build-helpers/prepare-zl-picks-recipes.cjs');

async function verify() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zl-picks-recipes-'));
  try {
    const output = 'build/recipes';
    const expected = [
      'discord',
      'gitter',
      'gmail',
      'google-calendar',
      'hangouts',
      'mattermost',
      'messenger',
      'meta-business-suite',
      'proton-mail',
      'skype',
      'slack',
      'telegram',
      'trello',
      'tweetdeck',
      'wechat',
      'whatsapp',
    ];
    const metadata = JSON.parse(fs.readFileSync(path.join(output, 'all.json')));
    assert.deepEqual(
      metadata.map(recipe => recipe.id),
      expected,
    );
    assert(metadata.every(recipe => recipe.featured));
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(output, 'featured.json'))),
      expected,
    );
    assert.equal(fs.readdirSync(output).length, expected.length + 3);
    assert.equal(
      fs.readdirSync(path.join(output, 'icons')).length,
      expected.length,
    );
    for (const recipe of metadata) {
      const extracted = path.join(directory, recipe.id);
      fs.mkdirSync(extracted);
      await tar.x({
        file: path.join(output, `${recipe.id}.tar.gz`),
        cwd: extracted,
      });
      const installed = JSON.parse(
        fs.readFileSync(path.join(extracted, 'package.json')),
      );
      assert.equal(installed.id, recipe.id);
      assert.equal(installed.version, recipe.version);
      assert(fs.statSync(path.join(extracted, 'index.js')).size > 0);
      assert(
        fs.statSync(path.join(output, 'icons', `${recipe.id}.svg`)).size > 0,
      );
      if (recipe.id === 'whatsapp') {
        assert.equal(installed.config.serviceURL, 'https://web.whatsapp.com');
        for (const file of ['webview.js', 'webview-unsafe.js'])
          assert(fs.statSync(path.join(extracted, file)).size > 0);
      }
    }
    const before = fs.readFileSync(path.join(output, 'all.json'));
    fs.writeFileSync(path.join(directory, 'all.json'), '[]');
    assert.throws(() => prepareZLPicksRecipes(directory, output));
    assert.deepEqual(fs.readFileSync(path.join(output, 'all.json')), before);
    console.log(
      'PASS all 16 original supported Picks ship with matching installable archives and local icons; unrelated catalogue excluded',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}
verify().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
