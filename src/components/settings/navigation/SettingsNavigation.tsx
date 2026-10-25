import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import { NavLink } from 'react-router-dom';
import type { StoresProps } from '../../../@types/ferdium-components.types';
import globalMessages from '../../../i18n/globalMessages';

const messages = defineMessages({
  yourServices: {
    id: 'settings.navigation.yourServices',
    defaultMessage: 'Your services',
  },
  account: {
    id: 'settings.navigation.account',
    defaultMessage: 'Account',
  },
  team: {
    id: 'settings.navigation.team',
    defaultMessage: 'Manage Team',
  },
  logout: {
    id: 'settings.navigation.logout',
    defaultMessage: 'Logout',
  },
  exitSession: {
    id: 'settings.navigation.exitSession',
    defaultMessage: 'Exit session',
  },
});

interface IProps extends Partial<StoresProps>, WrappedComponentProps {
  serviceCount: number;
}

@inject('stores', 'actions')
@observer
class SettingsNavigation extends Component<IProps> {
  render() {
    const { serviceCount, stores, intl } = this.props;

    return (
      <div className="settings-navigation">
        <NavLink
          to="/settings/recipes"
          className={({ isActive }) =>
            isActive
              ? 'settings-navigation__link is-active'
              : 'settings-navigation__link'
          }
        >
          可用的服务
        </NavLink>
        <NavLink
          to="/settings/services"
          className={({ isActive }) =>
            isActive
              ? 'settings-navigation__link is-active'
              : 'settings-navigation__link'
          }
        >
          {intl.formatMessage(messages.yourServices)}{' '}
          <span className="badge">{serviceCount}</span>
        </NavLink>
        <NavLink
          to="/settings/app"
          className={({ isActive }) =>
            isActive
              ? 'settings-navigation__link is-active'
              : 'settings-navigation__link'
          }
        >
          {intl.formatMessage(globalMessages.settings)}
          {stores!.settings.app.automaticUpdates &&
            (stores!.ui.showServicesUpdatedInfoBar ||
              stores!.app.updateStatus ===
                stores!.app.updateStatusTypes.AVAILABLE ||
              stores!.app.updateStatus ===
                stores!.app.updateStatusTypes.DOWNLOADED) && (
              <span className="update-available">•</span>
            )}
        </NavLink>
        <NavLink
          to="/settings/chat-backup"
          className={({ isActive }) =>
            isActive
              ? 'settings-navigation__link is-active'
              : 'settings-navigation__link'
          }
        >
          聊天备份
        </NavLink>
        <span className="settings-navigation__expander" />
        <span className="settings-navigation__link">本地模式</span>
      </div>
    );
  }
}

export default injectIntl(SettingsNavigation);
