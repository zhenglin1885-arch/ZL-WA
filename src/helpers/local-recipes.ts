import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IRecipePreview } from '../models/RecipePreview';

export function validRecipeId(id: string): boolean {
  return (
    typeof id === 'string' && /^\w[\w.-]{0,127}$/.test(id) && !id.includes('..')
  );
}

// The catalogue and icons ship with the application; no remote CDN fallback.
export function localRecipePreviews(directory: string): IRecipePreview[] {
  const entries = JSON.parse(readFileSync(join(directory, 'all.json'), 'utf8'));
  return entries
    .filter((entry: IRecipePreview) => validRecipeId(entry.id))
    .map((entry: IRecipePreview) => ({
      ...entry,
      icons: {
        svg: existsSync(join(directory, 'icons', `${entry.id}.svg`))
          ? pathToFileURL(join(directory, 'icons', `${entry.id}.svg`)).href
          : '',
      },
    }));
}
