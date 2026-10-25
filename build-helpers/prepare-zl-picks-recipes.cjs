const fs = require('node:fs');
const path = require('node:path');

// Ship the original recommended services, with their local runtime and icons.
// Installed recipes in the user's profile are deliberately left untouched.
module.exports = function prepareZLPicksRecipes(source, destination) {
  const catalogue = JSON.parse(
    fs.readFileSync(path.join(source, 'all.json'), 'utf8'),
  );
  const picks = catalogue
    .filter(
      recipe =>
        (recipe.featured || recipe.id === 'meta-business-suite') &&
        !['msteams', 'teamsChat'].includes(recipe.id),
    )
    .map(recipe => ({ ...recipe, featured: true }));
  if (!picks.some(recipe => recipe.id === 'whatsapp'))
    throw new Error('Required WhatsApp recipe metadata is missing');
  // Validate all inputs before replacing any previous build output.
  for (const recipe of picks) {
    if (!/^\w[\w.-]{0,127}$/.test(recipe.id) || recipe.id.includes('..'))
      throw new Error('Invalid recipe ID');
    fs.accessSync(
      path.join(source, 'archives', `${recipe.id}.tar.gz`),
      fs.constants.R_OK,
    );
    fs.accessSync(
      path.join(source, 'recipes', recipe.id, 'icon.svg'),
      fs.constants.R_OK,
    );
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.join(destination, 'icons'), { recursive: true });
  fs.writeFileSync(path.join(destination, 'all.json'), JSON.stringify(picks));
  fs.writeFileSync(
    path.join(destination, 'featured.json'),
    JSON.stringify(picks.map(recipe => recipe.id)),
  );
  for (const recipe of picks) {
    fs.copyFileSync(
      path.join(source, 'archives', `${recipe.id}.tar.gz`),
      path.join(destination, `${recipe.id}.tar.gz`),
    );
    fs.copyFileSync(
      path.join(source, 'recipes', recipe.id, 'icon.svg'),
      path.join(destination, 'icons', `${recipe.id}.svg`),
    );
  }
};
