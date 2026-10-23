/* eslint-disable import/no-import-module-exports */
/* eslint-disable global-require */
import { join } from 'node:path';
import { ipcRenderer } from 'electron';
import {
  copySync,
  ensureDirSync,
  pathExistsSync,
  readJsonSync,
  readdirSync,
  removeSync,
  statSync,
} from 'fs-extra';
import ms from 'ms';
import tar from 'tar';

import RecipeModel, { type IRecipe } from '../../models/Recipe';
import RecipePreviewModel, {
  type IRecipePreview,
} from '../../models/RecipePreview';
import ServiceModel from '../../models/Service';
import UserModel from '../../models/User';

import sleep from '../../helpers/async-helpers';

import {
  localRecipePreviews,
  isRemovedRecipe,
  validRecipeId,
} from '../../helpers/local-recipes';
import { SERVER_NOT_LOADED } from '../../config';
import { userDataRecipesPath } from '../../environment-remote';
import { asarRecipesPath } from '../../helpers/asar-helpers';
import apiBase from '../apiBase';
import {
  prepareAuthRequest,
  prepareLocalToken,
  sendAuthRequest,
} from '../utils/auth';

import {
  getDevRecipeDirectory,
  getRecipeDirectory,
  loadRecipeConfig,
} from '../../helpers/recipe-helpers';

import { removeServicePartitionDirectory } from '../../helpers/service-helpers';

const debug = require('../../preload-safe-debug')('Ferdium:ServerApi');

module.paths.unshift(getDevRecipeDirectory(), getRecipeDirectory());

export default class ServerApi {
  recipePreviews: IRecipePreview[] = [];

  recipes: IRecipe[] = [];

  // User
  async login(email: string, passwordHash: string) {
    const request = await sendAuthRequest(
      `${apiBase()}/auth/login`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(
            `${email}:${passwordHash}`,
          ).toString('base64')}`,
        },
      },
      false,
    );
    try {
      const responseJson = await request.json();

      if (!request.ok) {
        throw responseJson;
      }

      debug('ServerApi::login resolves', responseJson);
      return responseJson.token;
    } catch (error) {
      debug('ServerApi::login ERROR:', error);
      throw error;
    }
  }

  async signup(data: any) {
    const request = await sendAuthRequest(
      `${apiBase()}/auth/signup`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      false,
    );
    try {
      const responseJson = await request.json();

      if (!request.ok) {
        throw responseJson;
      }

      debug('ServerApi::signup resolves', responseJson);
      return responseJson.token;
    } catch (error) {
      debug('ServerApi::signup ERROR:', error);
      throw error;
    }
  }

  async inviteUser(data: any) {
    const request = await sendAuthRequest(`${apiBase()}/invite`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
    if (!request.ok) {
      throw new Error(request.statusText);
    }

    debug('ServerApi::inviteUser');
    return true;
  }

  async retrievePassword(email: string) {
    const request = await sendAuthRequest(
      `${apiBase()}/auth/password`,
      {
        method: 'POST',
        body: JSON.stringify({
          email,
        }),
      },
      false,
    );
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const r = await request.json();

    debug('ServerApi::retrievePassword');
    return r;
  }

  async userInfo() {
    if (apiBase() === SERVER_NOT_LOADED) {
      throw new Error('Server not loaded');
    }

    const request = await sendAuthRequest(`${apiBase()}/me`);
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const data = await request.json();

    const user = new UserModel(data);
    debug('ServerApi::userInfo resolves', user);

    return user;
  }

  async requestNewToken() {
    if (apiBase() === SERVER_NOT_LOADED) {
      throw new Error('Server not loaded');
    }

    const request = await sendAuthRequest(`${apiBase()}/me/newtoken`);
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const data = await request.json();

    debug('ServerApi::requestNewToken new authToken received');

    return data;
  }

  async updateUserInfo(data: any) {
    const request = await sendAuthRequest(`${apiBase()}/me`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const updatedData = await request.json();

    const user = Object.assign(updatedData, {
      data: new UserModel(updatedData.data),
    });
    debug('ServerApi::updateUserInfo resolves', user);
    return user;
  }

  async deleteAccount() {
    const request = await sendAuthRequest(`${apiBase()}/me`, {
      method: 'DELETE',
    });
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const data = await request.json();

    debug('ServerApi::deleteAccount resolves', data);
    return data;
  }

  // Services
  async getServices() {
    if (apiBase() === SERVER_NOT_LOADED) {
      throw new Error('Server not loaded');
    }

    const request = await sendAuthRequest(`${apiBase()}/me/services`);
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const data = await request.json();

    // Retired services are removed before any recipe or webview can load.
    await Promise.all(
      data
        .filter((service: { recipeId: string }) =>
          isRemovedRecipe(service.recipeId),
        )
        .map((service: { id: string }) => this.deleteService(service.id)),
    );
    const services = await this._mapServiceModels(
      data.filter(
        (service: { recipeId: string }) => !isRemovedRecipe(service.recipeId),
      ),
    );
    const filteredServices = services.filter(service => !!service);
    debug('ServerApi::getServices resolves', filteredServices);
    return filteredServices;
  }

  async createService(recipeId: string, data: { iconFile: any }) {
    if (isRemovedRecipe(recipeId)) throw new Error('Teams 服务已移除');
    const request = await sendAuthRequest(`${apiBase()}/service`, {
      method: 'POST',
      body: JSON.stringify({ recipeId, ...data }),
    });
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const serviceData = await request.json();

    if (data.iconFile) {
      const iconData = await this.uploadServiceIcon(
        serviceData.data.id,
        data.iconFile,
      );

      serviceData.data = iconData;
    }

    const service = Object.assign(serviceData, {
      data: await this._prepareServiceModel(serviceData.data),
    });

    debug('ServerApi::createService resolves', service);
    return service;
  }

  async updateService(serviceId: string, rawData: any) {
    const data = rawData;

    if (data.iconFile) {
      await this.uploadServiceIcon(serviceId, data.iconFile);
    }

    const request = await sendAuthRequest(`${apiBase()}/service/${serviceId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });

    if (!request.ok) {
      throw new Error(request.statusText);
    }

    const serviceData = await request.json();

    const service = Object.assign(serviceData, {
      data: await this._prepareServiceModel(serviceData.data),
    });

    debug('ServerApi::updateService resolves', service);
    return service;
  }

  async uploadServiceIcon(serviceId: string, icon: string | Blob) {
    const formData = new FormData();
    formData.append('icon', icon);

    const requestData = prepareAuthRequest({
      method: 'PUT',
      // @ts-expect-error Argument of type '{ method: string; body: FormData; }' is not assignable to parameter of type '{ method: string; }'.
      body: formData,
    });

    delete requestData.headers['Content-Type'];

    await prepareLocalToken(requestData);

    const request = await window.fetch(
      `${apiBase()}/service/${serviceId}`,
      // @ts-expect-error Argument of type '{ method: string; } & { mode: string; headers: any; }' is not assignable to parameter of type 'RequestInit | undefined'.
      requestData,
    );

    if (!request.ok) {
      throw new Error(request.statusText);
    }

    const serviceData = await request.json();

    return serviceData.data;
  }

  async reorderService(data: any) {
    const request = await sendAuthRequest(`${apiBase()}/service/reorder`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const serviceData = await request.json();
    debug('ServerApi::reorderService resolves', serviceData);
    return serviceData;
  }

  async deleteService(id: string) {
    const request = await sendAuthRequest(`${apiBase()}/service/${id}`, {
      method: 'DELETE',
    });
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const data = await request.json();

    // Chromium keeps persistent service sessions alive independently of the
    // webview. Clear browser storage first so a locked partition cannot retain
    // a corrupt IndexedDB database (for example WhatsApp's login database)
    // while filesystem cleanup is deferred until the next app start.
    try {
      await ipcRenderer.invoke('clear-storage-data', { serviceId: id });
    } catch (error) {
      debug('Unable to clear service storage before partition removal', error);
    }

    removeServicePartitionDirectory(id, true);

    debug('ServerApi::deleteService resolves', data);
    return data;
  }

  // Features
  async getDefaultFeatures() {
    return {};
  }

  async getFeatures() {
    return {};
  }

  // Recipes
  async getInstalledRecipes() {
    const recipesDirectory = getRecipeDirectory();
    const paths = readdirSync(recipesDirectory).filter(
      file =>
        statSync(join(recipesDirectory, file)).isDirectory() &&
        file !== 'temp' &&
        file !== 'dev' &&
        !isRemovedRecipe(file),
    );

    const icons = new Map(
      localRecipePreviews(asarRecipesPath()).map(recipe => [
        recipe.id,
        recipe.icons?.svg,
      ]),
    );
    this.recipes = paths
      .map(id => {
        // eslint-disable-next-line import/no-dynamic-require
        const Recipe = require(id)(RecipeModel);
        const recipe = new Recipe(loadRecipeConfig(id));
        if (id === 'meta-business-suite') recipe.name = 'Facebook Business';
        const icon = icons.get(id);
        if (icon) recipe.defaultIcon = icon;
        return recipe;
      })
      .filter(recipe => recipe.id);

    // @ts-expect-error Type 'boolean' is not assignable to type 'ConcatArray<IRecipe>'.
    // eslint-disable-next-line unicorn/prefer-spread
    this.recipes = this.recipes.concat(this._getDevRecipes());

    debug('StubServerApi::getInstalledRecipes resolves', this.recipes);
    return this.recipes;
  }

  async getRecipeUpdates(recipeVersions: any) {
    const request = await sendAuthRequest(`${apiBase()}/recipes/update`, {
      method: 'POST',
      body: JSON.stringify(recipeVersions),
    });
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    const recipes = await request.json();
    debug('ServerApi::getRecipeUpdates resolves', recipes);
    return recipes;
  }

  // Recipes Previews
  async getRecipePreviews() {
    return this._mapRecipePreviewModel(localRecipePreviews(asarRecipesPath()));
  }

  async getFeaturedRecipePreviews() {
    const recipes = await this.getRecipePreviews();
    return recipes.filter(recipe => recipe?.featured);
  }

  async searchRecipePreviews(needle: string) {
    const query = needle.toLocaleLowerCase();
    const recipes = await this.getRecipePreviews();
    return recipes.filter(
      recipe =>
        recipe &&
        [recipe.id, recipe.name, ...(recipe.aliases || [])].some(value =>
          value.toLocaleLowerCase().includes(query),
        ),
    );
  }

  async getRecipePackage(recipeId: string) {
    if (!validRecipeId(recipeId) || isRemovedRecipe(recipeId))
      throw new Error('无效或已移除的服务 ID');
    const recipesDirectory = userDataRecipesPath();
    const recipeTempDirectory = join(recipesDirectory, 'temp', recipeId);

    const internalRecipeFile = asarRecipesPath(`${recipeId}.tar.gz`);

    ensureDirSync(recipeTempDirectory);

    if (!pathExistsSync(internalRecipeFile))
      throw new Error('此服务未包含在本地安装包中，请更新应用后重试');
    const archivePath = internalRecipeFile;
    debug(archivePath);

    await sleep(ms('10ms'));

    await tar.x({
      file: archivePath,
      cwd: recipeTempDirectory,
      preservePaths: false,
      filter: (path, entry) =>
        !path.startsWith('/') &&
        !path.split(/[/\\]/).includes('..') &&
        !['SymbolicLink', 'Link'].includes(String(entry.type)),
      unlink: true,
      preserveOwner: false,
      onwarn: x => debug('warn', recipeId, x),
    });

    await sleep(ms('10ms'));

    const { id, defaultIcon } = readJsonSync(
      join(recipeTempDirectory, 'package.json'),
    );
    if (id !== recipeId) throw new Error('服务包 ID 不匹配');
    const recipeDirectory = join(recipesDirectory, id);
    copySync(recipeTempDirectory, recipeDirectory);
    removeSync(recipeTempDirectory);
    removeSync(join(recipesDirectory, recipeId, 'recipe.tar.gz'));

    // TODO: This is a temporary fix to remove svg icons from the user AppData. This should be removed after versions of all recipes have been bumped up
    if (defaultIcon) {
      removeSync(join(recipeDirectory, 'icon.svg'));
    }

    return id;
  }

  // Health Check
  async healthCheck() {
    if (apiBase() === SERVER_NOT_LOADED) {
      throw new Error('Server not loaded');
    }

    const request = await sendAuthRequest(
      `${apiBase(false)}/health`,
      {
        method: 'GET',
      },
      false,
    );
    if (!request.ok) {
      throw new Error(request.statusText);
    }
    debug('ServerApi::healthCheck resolves');
  }

  // Helper
  async _mapServiceModels(services: any[]) {
    const recipes = services.map((s: { recipeId: string }) => s.recipeId);
    await this._bulkRecipeCheck(recipes);

    return Promise.all(
      services.map(async (service: any) => this._prepareServiceModel(service)),
    );
  }

  async _prepareServiceModel(service: { recipeId: string }) {
    try {
      const recipe = this.recipes.find(r => r.id === service.recipeId);

      if (!recipe) {
        console.warn(`Recipe ${service.recipeId} not loaded`);
        return null;
      }

      return new ServiceModel(service, recipe);
    } catch (error) {
      debug(error);
      return null;
    }
  }

  async _bulkRecipeCheck(unfilteredRecipes: string[]) {
    // Filter recipe duplicates as we don't need to download 3 Slack recipes
    const recipes = unfilteredRecipes.filter(
      (elem: string, pos: number, arr: string[]) => arr.indexOf(elem) === pos,
    );

    return Promise.all(
      recipes.map(async (recipeId: string) => {
        let recipe = this.recipes.find(r => r.id === recipeId);

        if (!recipe) {
          console.warn(
            `Recipe '${recipeId}' not installed, trying to fetch from server`,
          );

          await this.getRecipePackage(recipeId);

          debug('Rerun ServerAPI::getInstalledRecipes');
          await this.getInstalledRecipes();

          recipe = this.recipes.find(r => r.id === recipeId);

          if (!recipe) {
            console.warn(`Could not load recipe ${recipeId}`);
            return null;
          }
        }

        return recipe;
      }),
    ).catch(error => console.error("Can't load recipe", error));
  }

  _mapRecipePreviewModel(recipes: IRecipePreview[]) {
    return recipes
      .map(recipe => {
        try {
          return new RecipePreviewModel(recipe);
        } catch (error) {
          console.error(error);
          return null;
        }
      })
      .filter(Boolean);
  }

  _getDevRecipes() {
    const recipesDirectory = getDevRecipeDirectory();
    try {
      const paths = readdirSync(recipesDirectory).filter(
        file =>
          statSync(join(recipesDirectory, file)).isDirectory() &&
          file !== 'temp' &&
          !isRemovedRecipe(file),
      );

      const recipes: IRecipe[] = paths
        .map(id => {
          try {
            // eslint-disable-next-line import/no-dynamic-require
            const Recipe = require(id)(RecipeModel);

            return new Recipe(loadRecipeConfig(id));
          } catch (error) {
            console.error(error);
          }
          return false;
        })
        .filter(recipe => recipe.id)
        .map(data => {
          const recipe = data;

          recipe.icons = {
            svg: `${recipe.path}/icon.svg`,
          };
          recipe.local = true;

          return data;
        });

      return recipes;
    } catch {
      debug('Could not load dev recipes');
      return false;
    }
  }
}
