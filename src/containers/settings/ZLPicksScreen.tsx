import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import { Link } from 'react-router-dom';
import type { StoresProps } from '../../@types/ferdium-components.types';
import SearchInput from '../../components/ui/SearchInput';
import { H1 } from '../../components/ui/headline';

@inject('stores', 'actions')
@observer
class ZLPicksScreen extends Component<
  Partial<StoresProps>,
  { needle: string }
> {
  constructor(props: Partial<StoresProps>) {
    super(props);
    this.state = { needle: '' };
  }

  render() {
    const needle = this.state.needle.trim().toLowerCase();
    const recipes = this.props
      .stores!.recipePreviews.featured.filter(recipe =>
        [recipe.name, ...(recipe.aliases || [])].some(name =>
          name.toLowerCase().includes(needle),
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name));

    return (
      <div className="settings__main">
        <div className="settings__header">
          <H1>可用的服务</H1>
        </div>
        <div className="settings__body zl-picks">
          <SearchInput
            placeholder="搜索服务"
            onChange={value => this.setState({ needle: value })}
            onReset={() => this.setState({ needle: '' })}
          />
          <div className="zl-picks__navigation">
            <span className="badge badge--primary">ZL Picks</span>
          </div>
          <div className="zl-picks__list">
            {recipes.map(recipe => (
              <Link
                key={recipe.id}
                to={`/settings/services/add/${recipe.id}`}
                className="zl-picks__item"
                data-recipe-id={recipe.id}
              >
                <img src={recipe.icons?.svg} alt="" />
                <span>{recipe.name}</span>
              </Link>
            ))}
          </div>
          {recipes.length === 0 && <p role="status">没有匹配的服务</p>}
        </div>
      </div>
    );
  }
}

export default ZLPicksScreen;
