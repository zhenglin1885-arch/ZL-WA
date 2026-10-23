import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IRecipePreview } from '../models/RecipePreview';

export function validRecipeId(id: string): boolean {
  return (
    typeof id === 'string' && /^\w[\w.-]{0,127}$/.test(id) && !id.includes('..')
  );
}

export const isRemovedRecipe = (id: string): boolean =>
  ['msteams', 'teamsChat'].includes(id);

// The catalogue and icons ship with the application; no remote CDN fallback.
export function localRecipePreviews(directory: string): IRecipePreview[] {
  const entries = JSON.parse(readFileSync(join(directory, 'all.json'), 'utf8'));
  return entries
    .filter(
      (entry: IRecipePreview) =>
        validRecipeId(entry.id) && !isRemovedRecipe(entry.id),
    )
    .map((entry: IRecipePreview) => ({
      ...entry,
      ...(entry.id === 'meta-business-suite'
        ? { name: 'Facebook Business', featured: true }
        : {}),
      icons: {
        svg: existsSync(join(directory, 'icons', `${entry.id}.svg`))
          ? pathToFileURL(join(directory, 'icons', `${entry.id}.svg`)).href
          : '',
      },
    }));
}
