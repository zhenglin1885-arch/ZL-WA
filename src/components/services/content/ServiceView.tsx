import classnames from 'classnames';
import { type IReactionDisposer, autorun } from 'mobx';
import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import TopBarProgress from 'react-topbar-progress-indicator';
import { CUSTOM_WEBSITE_RECIPE_ID } from '../../../config';
import WebControlsScreen from '../../../features/webControls/containers/WebControlsScreen';
import type ServiceModel from '../../../models/Service';
import type { RealStores } from '../../../stores';
import MediaSource from '../../MediaSource';
import StatusBarTargetUrl from '../../ui/StatusBarTargetUrl';
import WebviewLoader from '../../ui/WebviewLoader';
import ServiceDisabled from './ServiceDisabled';
import ServiceWebview from './ServiceWebview';
import WebviewCrashHandler from './WebviewCrashHandler';
import WebviewErrorHandler from './WebviewErrorHandler';

const messages = defineMessages({
  hibernatingMessage: {
    id: 'service.hibernating.message',
    defaultMessage: 'This service is currently hibernating.',
  },
  hibernatingAction: {
    id: 'service.hibernating.action',
    defaultMessage: 'Try switching services or reloading ZL-WA.',
  },
});

interface IProps extends WrappedComponentProps {
  service: ServiceModel;
  startupAllowed?: boolean;
  onStartupReady?: () => void;
  setWebviewRef: () => void;
  detachService: () => void;
  reload: () => void;
  edit: () => void;
  enable: () => void;
  // isActive?: boolean; // TODO: [TECH DEBT][PROP NOT USED IN COMPONENT] check it
  stores?: RealStores;
  isSpellcheckerEnabled: boolean;
}

interface IState {
  forceRepaint: boolean;
  targetUrl: string;
  statusBarVisible: boolean;
}

@inject('stores', 'actions')
@observer
class ServiceView extends Component<IProps, IState> {
  // hibernationTimer = null; // TODO: [TS DEBT] class property not reassigned, need to find its purpose

  autorunDisposer: IReactionDisposer | undefined;

  forceRepaintTimeout: NodeJS.Timeout | undefined;

  constructor(props: IProps) {
    super(props);

    this.state = {
      forceRepaint: false,
      targetUrl: '',
      statusBarVisible: false,
    };
  }

  componentDidMount() {
    this.autorunDisposer = autorun(() => {
      if (this.props.service.isActive) {
        this.setState({ forceRepaint: true });
        this.forceRepaintTimeout = setTimeout(() => {
          this.setState({ forceRepaint: false });
        }, 100);
      }
    });
  }

  componentWillUnmount() {
    this.autorunDisposer!();
    clearTimeout(this.forceRepaintTimeout);
    // clearTimeout(this.hibernationTimer); // TODO: [TS DEBT] class property not reassigned, need to find its purpose
  }

  render() {
    const {
      detachService,
      service,
      setWebviewRef,
      reload,
      edit,
      enable,
      stores,
      isSpellcheckerEnabled,
      intl,
    } = this.props;

    const { navigationBarBehaviour, navigationBarManualActive } =
      stores!.settings.app;

    const showNavBar =
      navigationBarBehaviour === 'always' ||
      (navigationBarBehaviour === 'custom' &&
        service.recipe.id === CUSTOM_WEBSITE_RECIPE_ID) ||
      navigationBarManualActive;

    const webviewClasses = classnames({
      services__webview: true,
      'services__webview-wrapper': true,
      'services__webview-wrapper--with-navbar': showNavBar,
      'is-active': service.isActive,
      'services__webview--force-repaint': this.state.forceRepaint,
    });

    const statusBar = this.state.statusBarVisible ? (
      <StatusBarTargetUrl text={this.state.targetUrl} />
    ) : null;

    return (
      <div
        className={webviewClasses}
        data-name={service.name}
        style={{ order: service.order }}
      >
        {service.isActive && service.isEnabled && (
          <>
            {service.hasCrashed && (
              <WebviewCrashHandler
                name={service.recipe.name}
                // webview={service.webview} // TODO: [TECH DEBT][PROPS NOT EXIST IN COMPONENT] check it
                reload={reload}
              />
            )}
            {service.isEnabled &&
              service.isLoading &&
              service.isFirstLoad &&
              !service.isHibernating &&
              !service.isServiceAccessRestricted && (
                <WebviewLoader loaded={false} name={service.name} />
              )}
            {service.isProgressbarEnabled &&
              service.isLoadingPage &&
              !service.isFirstLoad && <TopBarProgress />}
            {service.isError && !service.isHibernating && (
              <WebviewErrorHandler
                name={service.recipe.name}
                errorMessage={service.errorMessage}
                reload={reload}
                edit={edit}
              />
            )}
          </>
        )}
        {service.isEnabled ? (
          // eslint-disable-next-line react/jsx-no-useless-fragment
          <>
            {service.isHibernating ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  textAlign: 'center',
                }}
              >
                <span
                  role="img"
                  aria-label="Sleeping Emoji"
                  style={{ fontSize: 42 }}
                >
                  😴
                </span>
                <br />
                <br />
                {service.isManuallyHibernating
                  ? '此 WhatsApp 会话已休眠'
                  : intl.formatMessage(messages.hibernatingMessage)}
                <br />
                {service.isManuallyHibernating
                  ? '点击账户卡片上的休眠按钮可重新打开，登录数据会保留。'
                  : intl.formatMessage(messages.hibernatingAction)}
              </div>
            ) : (
              <>
                {showNavBar && <WebControlsScreen service={service} />}
                <MediaSource service={service} />
                {this.props.startupAllowed === false ? (
                  <div role="status" className="account-startup-wait">
                    等待前面的账号启动…
                  </div>
                ) : (
                  <ServiceWebview
                    service={service}
                    onStartupReady={this.props.onStartupReady}
                    setWebviewReference={setWebviewRef}
                    detachService={detachService}
                    isSpellcheckerEnabled={isSpellcheckerEnabled}
                    stores={stores}
                  />
                )}
              </>
            )}
          </>
        ) : (
          // eslint-disable-next-line react/jsx-no-useless-fragment
          <>
            {service.isActive && (
              <ServiceDisabled
                name={service.name === '' ? service.recipe.name : service.name}
                // webview={service.webview} // TODO: [TECH DEBT][PROPS NOT EXIST IN COMPONENT] check it
                enable={enable}
              />
            )}
          </>
        )}
        {statusBar}
      </div>
    );
  }
}

export default injectIntl(ServiceView);
