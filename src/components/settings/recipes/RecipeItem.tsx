import { observer } from 'mobx-react';
import { Component, type MouseEventHandler } from 'react';
import type RecipePreview from '../../../models/RecipePreview';

interface IProps {
  recipe: RecipePreview;
  onClick: MouseEventHandler<HTMLButtonElement>;
}

@observer
class RecipeItem extends Component<IProps> {
  render() {
    const { recipe, onClick } = this.props;

    return (
      <button
        type="button"
        className="recipe-teaser zl-picks__item"
        data-recipe-id={recipe.id}
        onClick={onClick}
      >
        {recipe.isDevRecipe && (
          <span className="recipe-teaser__dev-badge">dev</span>
        )}
        <img src={recipe.icons?.svg} className="recipe-teaser__icon" alt="" />
        <span className="recipe-teaser__label">{recipe.name}</span>
        {recipe.aliases && recipe.aliases.length > 0 && (
          <span className="recipe-teaser__alias_label">
            {`Aliases: ${recipe.aliases.join(', ')}`}
          </span>
        )}
      </button>
    );
  }
}

export default RecipeItem;
