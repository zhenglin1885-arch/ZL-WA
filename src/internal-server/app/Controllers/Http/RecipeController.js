const Recipe = use('App/Models/Recipe');
const Drive = use('Drive');
const { convertToJSON } = require('../../../../jsUtils');
const { asarRecipesPath } = require('../../../../helpers/asar-helpers');
const {
  localRecipePreviews,
  validRecipeId,
} = require('../../../../helpers/local-recipes');

class RecipeController {
  async list({ response }) {
    const allRecipes = await Recipe.all();
    const custom = allRecipes.rows.map(recipe => ({
      ...convertToJSON(recipe.data),
      id: recipe.recipeId,
      name: recipe.name,
    }));
    return response.send([
      ...localRecipePreviews(asarRecipesPath()),
      ...custom,
    ]);
  }

  async search({ request, response }) {
    const query = String(request.input('needle', '')).toLocaleLowerCase();
    const allRecipes = await Recipe.all();
    const custom = allRecipes.rows.map(recipe => ({
      ...convertToJSON(recipe.data),
      id: recipe.recipeId,
      name: recipe.name,
    }));
    const list =
      query === 'ferdium:custom'
        ? custom
        : [...localRecipePreviews(asarRecipesPath()), ...custom];
    return response.send(
      query === 'ferdium:custom'
        ? list
        : list.filter(recipe =>
            [recipe.id, recipe.name, ...(recipe.aliases || [])].some(value =>
              value.toLocaleLowerCase().includes(query),
            ),
          ),
    );
  }

  update({ response }) {
    return response.send([]);
  }

  popularRecipes({ response }) {
    return response.send(
      localRecipePreviews(asarRecipesPath()).filter(recipe => recipe.featured),
    );
  }

  async download({ response, params }) {
    const service = params.recipe;
    if (!validRecipeId(service))
      return response.status(400).send('Invalid recipe name');
    if (await Drive.exists(`${service}.tar.gz`))
      return response.send(await Drive.get(`${service}.tar.gz`));
    return response
      .status(404)
      .send({ message: 'Recipe not bundled', code: 'recipe-not-found' });
  }
}
module.exports = RecipeController;
