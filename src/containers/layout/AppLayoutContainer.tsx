// ZL-WA modification: grouped account sidebar; original service rendering retained.
import { inject, observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import { ThemeProvider } from 'react-jss';
import { Outlet } from 'react-router-dom';

import { ThemeProvider as MUIThemeProvider } from '@mui/material/styles';
import type { StoresProps } from '../../@types/ferdium-components.types';
import AppLayout from '../../components/layout/AppLayout';
import AccountSidebar from '../../features/accounts/AccountSidebar';
import AccountTools from '../../features/accountTools/AccountTools';
import AccountNetworkStatus from '../../features/accountTools/AccountNetworkStatus';
import Services from '../../components/services/content/Services';
import AppLoader from '../../components/ui/AppLoader';
import { workspaceStore } from '../../features/workspaces';
import WorkspaceDrawer from '../../features/workspaces/components/WorkspaceDrawer';

interface IProps extends StoresProps {}

@inject('stores', 'actions')
@observer
class AppLayoutContainer extends Component<IProps> {
  render(): ReactElement {
    const { app, features, services, ui, settings, requests, user, router } =
      this.props.stores;

    /* HOTFIX for:
      [mobx] Encountered an uncaught exception that was thrown by a reaction or observer component, in: 'Reaction[bound ]' TypeError: Cannot read properties of null (reading 'push')
      at RouterStore.push (store.js:25)
      at UserStore._requireAuthenticatedUser
    */
    if (!user.isLoggedIn) {
      router.push('/auth/welcome');
    }

    const {
      // handleIPCMessage,
      setWebviewReference,
      detachService,
      // openWindow,
      reload,
      updateService,
    } = this.props.actions.service;

    const { retryRequiredRequests } = this.props.actions.requests;

    const { installUpdate } = this.props.actions.app;

    const { openSettings } = this.props.actions.ui;

    const isLoadingFeatures =
      features.featuresRequest.isExecuting &&
      !features.featuresRequest.wasExecuted;

    const isLoadingServices =
      services.allServicesRequest.isExecuting &&
      services.allServicesRequest.isExecutingFirstTime;

    const isLoadingSettings = !settings.loaded;

    if (
      !user.localSessionReady ||
      isLoadingSettings ||
      isLoadingFeatures ||
      isLoadingServices
    ) {
      return (
        <ThemeProvider theme={ui.theme}>
          <AppLoader theme={ui.theme} />
        </ThemeProvider>
      );
    }

    const workspacesDrawer = (
      <WorkspaceDrawer
        getServicesForWorkspace={workspace =>
          workspace
            ? workspaceStore.getWorkspaceServices(workspace).map(s => s.name)
            : services.all.map(s => s.name)
        }
        stores={this.props.stores}
        actions={this.props.actions}
      />
    );

    const sidebar = (
      <AccountSidebar stores={this.props.stores} actions={this.props.actions} />
    );

    const servicesContainer = (
      <Services
        services={services.allDisplayedUnordered}
        // handleIPCMessage={handleIPCMessage} // TODO: [TECH DEBT] check it later
        setWebviewReference={setWebviewReference}
        detachService={detachService}
        // openWindow={openWindow} // TODO: [TECH DEBT] check it later
        reload={reload}
        openSettings={openSettings}
        update={updateService}
        userHasCompletedSignup={user.hasCompletedSignup}
        isSpellcheckerEnabled={settings.app.enableSpellchecking}
      />
    );

    return (
      // TODO: Using 2 ThemeProviders is not ideal, but it's a workaround for now
      <MUIThemeProvider theme={ui.muiTheme}>
        <ThemeProvider theme={ui.theme}>
          <AppLayout
            networkStatus={<AccountNetworkStatus stores={this.props.stores} />}
            settings={settings}
            isFullScreen={app.isFullScreen}
            showServicesUpdatedInfoBar={ui.showServicesUpdatedInfoBar}
            updateDownloading={app.updateDownloading}
            updateDownloadProgress={app.updateDownloadProgress}
            appUpdateIsDownloaded={
              app.updateStatus === app.updateStatusTypes.DOWNLOADED
            }
            authRequestFailed={app.authRequestFailed}
            sidebar={sidebar}
            accountTools={
              <AccountTools
                stores={this.props.stores}
                actions={this.props.actions}
              />
            }
            workspacesDrawer={workspacesDrawer}
            services={servicesContainer}
            installAppUpdate={installUpdate}
            showRequiredRequestsError={requests.showRequiredRequestsError}
            areRequiredRequestsSuccessful={
              requests.areRequiredRequestsSuccessful
            }
            retryRequiredRequests={retryRequiredRequests}
            areRequiredRequestsLoading={requests.areRequiredRequestsLoading}
            updateVersion={app.updateVersion}
            isUpdateAvailable={
              app.updateStatus === app.updateStatusTypes.AVAILABLE
            }
          >
            <Outlet />
          </AppLayout>
        </ThemeProvider>
      </MUIThemeProvider>
    );
  }
}

export default AppLayoutContainer;
