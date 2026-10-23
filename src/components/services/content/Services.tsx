import { observer } from 'mobx-react';
import ms from 'ms';
import { Component, type ReactElement } from 'react';
import Confetti from 'react-confetti';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import withStyles, { type WithStylesProps } from 'react-jss';
import { Link } from 'react-router-dom';
import type Service from '../../../models/Service';
import Appear from '../../ui/effects/Appear';
import ServiceView from './ServiceView';
import StartupQueue from '../../../features/accounts/StartupQueue';
import {
  normalizeAccountConfig,
  orderedAccountIds,
} from '../../../features/accounts/state';
import type { AccountSidebarConfig } from '../../../features/accounts/state';

const messages = defineMessages({
  getStarted: {
    id: 'services.getStarted',
    defaultMessage: 'Get started',
  },
  login: {
    id: 'services.login',
    defaultMessage: 'Please login to use Ferdium.',
  },
  serverless: {
    id: 'services.serverless',
    defaultMessage: 'Use Ferdium without an Account',
  },
  serverInfo: {
    id: 'services.serverInfo',
    defaultMessage:
      'Optionally, you can change your Ferdium server by clicking the cog in the bottom left corner. If you are switching over (from one of the hosted servers) to using Ferdium without an account, please be informed that you can export your data from that server and subsequently import it using the Help menu to resurrect all your workspaces and configured services!',
  },
});

const styles = {
  confettiContainer: {
    position: 'absolute',
    width: '100%',
    zIndex: 9999,
    pointerEvents: 'none',
  },
};

interface IProps extends WrappedComponentProps, WithStylesProps<typeof styles> {
  services?: Service[];
  accountSidebar?: AccountSidebarConfig;
  setWebviewReference: () => void;
  detachService: () => void;
  // handleIPCMessage: () => void; // TODO: [TECH DEBT] later check it
  // openWindow: () => void; // TODO: [TECH DEBT] later check it
  reload: (options: { serviceId: string }) => void;
  openSettings: (options: { path: string }) => void;
  update: (options: {
    serviceId: string;
    serviceData: { isEnabled: boolean };
    redirect: boolean;
  }) => void;
  userHasCompletedSignup: boolean;
  isSpellcheckerEnabled: boolean;
}

interface IState {
  showConfetti: boolean;
}

@observer
class Services extends Component<IProps, IState> {
  confettiTimeout: number | null = null;

  private startupMounted = false;

  // eslint-disable-next-line unicorn/consistent-function-scoping -- Callback belongs to this component instance.
  startup = new StartupQueue(() => {
    if (this.startupMounted) this.forceUpdate();
  });

  syncStartup = () => {
    const config = normalizeAccountConfig(this.props.accountSidebar);
    const services = (this.props.services || []).filter(
      s => s.isEnabled && !s.isHibernating && !s.isTodosService,
    );
    const order = orderedAccountIds(
      config,
      services.map(s => s.id),
    );
    const rank = new Map(config.groups.map((g, index) => [g.id, index]));
    const ids = [...order].sort(
      (a, b) =>
        (rank.get(config.accounts[a]?.groupId || 'default') ?? 0) -
        (rank.get(config.accounts[b]?.groupId || 'default') ?? 0),
    );
    this.startup.update(ids);
  };

  constructor(props: IProps) {
    super(props);

    this.state = {
      showConfetti: true,
    };
  }

  componentDidMount(): void {
    this.startupMounted = true;
    this.syncStartup();
    this.confettiTimeout = window.setTimeout(() => {
      this.setState({
        showConfetti: false,
      });
    }, ms('8s'));
  }

  componentDidUpdate(): void {
    this.syncStartup();
  }

  componentWillUnmount(): void {
    this.startupMounted = false;
    if (this.confettiTimeout) {
      clearTimeout(this.confettiTimeout);
    }
  }

  render(): ReactElement {
    const {
      services = [],
      // handleIPCMessage, // TODO: [TECH DEBT] later check it
      setWebviewReference,
      detachService,
      // openWindow, // TODO: [TECH DEBT] later check it
      reload,
      openSettings,
      update,
      userHasCompletedSignup,
      classes,
      isSpellcheckerEnabled,
      intl,
    } = this.props;

    const { showConfetti } = this.state;

    return (
      <div className="services">
        {userHasCompletedSignup && (
          <div className={classes.confettiContainer}>
            <Confetti
              width={window.innerWidth}
              height={window.innerHeight}
              numberOfPieces={showConfetti ? 200 : 0}
            />
          </div>
        )}
        {services.length === 0 && (
          <Appear transitionName="slideUp">
            <div className="services__no-service">
              <img
                src="./assets/images/logo-beard-only.svg"
                alt="Logo"
                style={{ maxHeight: '50vh' }}
              />
              <Appear transitionName="slideUp">
                <Link to="/settings/recipes" className="button">
                  {intl.formatMessage(messages.getStarted)}
                </Link>
              </Appear>
            </div>
          </Appear>
        )}
        {services
          .filter(service => !service.isTodosService)
          .map(service => (
            <ServiceView
              key={service.id}
              service={service}
              startupAllowed={this.startup.admitted.has(service.id)}
              onStartupReady={() => this.startup.complete(service.id)}
              // handleIPCMessage={handleIPCMessage} //  TODO: [TECH DEBT][PROPS NOT EXIST IN COMPONENT] later check it
              setWebviewRef={setWebviewReference}
              detachService={detachService}
              // openWindow={openWindow} //  TODO: [TECH DEBT][PROPS NOT EXIST IN COMPONENT] later check it
              reload={() => reload({ serviceId: service.id })}
              edit={() => openSettings({ path: `services/edit/${service.id}` })}
              enable={() =>
                update({
                  serviceId: service.id,
                  serviceData: {
                    isEnabled: true,
                  },
                  redirect: false,
                })
              }
              isSpellcheckerEnabled={isSpellcheckerEnabled}
            />
          ))}
      </div>
    );
  }
}

export default injectIntl(withStyles(styles, { injectTheme: true })(Services));
