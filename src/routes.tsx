import type { HashHistory } from 'history';
import { inject, observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import {
  unstable_HistoryRouter as HistoryRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';
import type { Actions } from './actions/lib/actions';
import DownloadManagerScreen from './containers/download-manager/DownloadManagerScreen';
import DownloadManagerWindow from './containers/download-manager/DownloadManagerWindow';
import AppLayoutContainer from './containers/layout/AppLayoutContainer';
import EditServiceScreen from './containers/settings/EditServiceScreen';
import EditSettingsScreen from './containers/settings/EditSettingsScreen';
import ReleaseNotesScreen from './containers/settings/ReleaseNotesScreen';
import ReleaseNotesWindow from './containers/settings/ReleaseNotesWindow';
import ServicesScreen from './containers/settings/ServicesScreen';
import SettingsWindow from './containers/settings/SettingsWindow';
import ZLPicksScreen from './containers/settings/ZLPicksScreen';
import SupportFerdiumScreen from './containers/settings/SupportScreen';
import { WORKSPACES_ROUTES } from './features/workspaces/constants';
import EditWorkspaceScreen from './features/workspaces/containers/EditWorkspaceScreen';
import WorkspacesScreen from './features/workspaces/containers/WorkspacesScreen';
import ChatBackupPage from './features/chatBackup/ChatBackupPage';
import type { RealStores } from './stores';

interface IProps {
  history: HashHistory;
  actions?: Actions;
  stores?: RealStores;
}

@inject('stores', 'actions')
@observer
class FerdiumRoutes extends Component<IProps> {
  render(): ReactElement {
    const { history } = this.props;

    return (
      // @ts-expect-error Fix me
      <HistoryRouter history={history}>
        <Routes>
          <Route path="/auth/*" element={<Navigate to="/" replace />} />

          <Route
            path="/"
            element={
              <AppLayoutContainer
                stores={this.props.stores!}
                actions={this.props.actions!}
              />
            }
          >
            <Route
              path="/releasenotes"
              element={<ReleaseNotesWindow {...this.props} />}
            >
              <Route
                path="/releasenotes"
                // @ts-expect-error Fix me
                element={<ReleaseNotesScreen {...this.props} />}
              />
            </Route>
            <Route
              path="/downloadmanager"
              element={<DownloadManagerWindow {...this.props} />}
            >
              <Route
                path="/downloadmanager"
                element={<DownloadManagerScreen {...this.props} />}
              />
            </Route>
            <Route
              path="/settings"
              element={<SettingsWindow {...this.props} />}
            >
              <Route
                path="/settings/recipes"
                element={<ZLPicksScreen {...this.props} />}
              />
              <Route
                path="/settings/recipes/:filter"
                element={<Navigate to="/settings/services" replace />}
              />
              <Route
                path="/settings/services"
                // @ts-expect-error Fix me
                element={<ServicesScreen {...this.props} />}
              />
              <Route
                path="/settings/services/:action/:id"
                element={<EditServiceScreen {...this.props} />}
              />
              <Route
                path={WORKSPACES_ROUTES.ROOT}
                // @ts-expect-error Fix me
                element={<WorkspacesScreen {...this.props} />}
              />
              <Route
                path={WORKSPACES_ROUTES.EDIT}
                // @ts-expect-error Fix me
                element={<EditWorkspaceScreen {...this.props} />}
              />
              <Route
                path="/settings/user"
                element={<Navigate to="/settings/app" replace />}
              />
              <Route
                path="/settings/user/edit"
                element={<Navigate to="/settings/app" replace />}
              />
              <Route
                path="/settings/team"
                element={<Navigate to="/settings/app" replace />}
              />
              <Route
                path="/settings/chat-backup"
                element={<ChatBackupPage {...this.props} />}
              />
              <Route
                path="/settings/app"
                // @ts-expect-error Fix me
                element={<EditSettingsScreen {...this.props} />}
              />
              <Route
                path="/settings/invite"
                element={<Navigate to="/settings/app" replace />}
              />
              <Route
                path="/settings/support"
                // @ts-expect-error Fix me
                element={<SupportFerdiumScreen {...this.props} />}
              />
              <Route
                path="/settings/releasenotes"
                // @ts-expect-error Fix me
                element={<ReleaseNotesScreen {...this.props} />}
              />
            </Route>
          </Route>
        </Routes>
      </HistoryRouter>
    );
  }
}

export default FerdiumRoutes;
