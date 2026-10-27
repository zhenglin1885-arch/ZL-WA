// ZL-WA modification: independent WhatsApp sessions, live metadata and overlay focus.
import { join } from 'node:path';
import { ipcRenderer } from 'electron';
import {
  type IReactionDisposer,
  action,
  makeObservable,
  observable,
  reaction,
  runInAction,
} from 'mobx';
import { observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import ElectronWebView from 'react-electron-web-view';
import type ServiceModel from '../../../models/Service';
import type { RealStores } from '../../../stores';
import {
  applyWhatsAppTheme,
  readWhatsAppSnapshot,
  mergeAccountSnapshot,
  accountIdentity,
} from '../../../features/accounts/whatsapp';
import { configureWhatsAppLayout } from '../../../features/accounts/layout';
import { watchWhatsAppUnread } from '../../../features/accounts/unread';
import { configureWhatsAppVoice } from '../../../features/accounts/voice';
import { configureWhatsAppAudioUpload } from '../../../features/accounts/audioUpload';
import { sendBulkMessage } from '../../../features/accountTools/bulkGuest';
import { ensureBulkLibrary } from '../../../features/accountTools/bulkRuntime';
import { configureTranslation } from '../../../features/accountTools/runtime';

const debug = require('../../../preload-safe-debug')('Ferdium:Services');

type WebviewElement = ElectronWebView['view'];

interface IProps {
  service: ServiceModel;
  onStartupReady?: () => void;
  setWebviewReference: (options: {
    serviceId: string;
    webview: ElectronWebView | null;
  }) => void;
  detachService: (options: { service: ServiceModel }) => void;
  isSpellcheckerEnabled: boolean;
  stores?: RealStores;
}

@observer
class ServiceWebview extends Component<IProps> {
  @observable webview: ElectronWebView | null = null;

  @observable proxyReady = false;

  @observable proxyError = '';

  private startupTimer?: ReturnType<typeof setTimeout>;

  private startupDone = false;

  @observable startupError = false;

  finishStartup = () => {
    if (this.startupDone) return;
    this.startupDone = true;
    clearTimeout(this.startupTimer);
    this.props.onStartupReady?.();
  };

  componentDidMount(): void {
    this.startupTimer = setTimeout(() => {
      if (!this.startupDone) {
        this.webview?.view?.stop();
        runInAction(() => {
          this.startupError = true;
        });
        this.finishStartup();
      }
    }, 45_000);
    this.prepareProxy();
  }

  prepareProxy = (): void => {
    if (this.props.service.recipe.id !== 'whatsapp') return;
    runInAction(() => {
      this.proxyError = '';
    });
    ipcRenderer
      .invoke('account-tools-prepare', this.props.service.id)
      .then(() => {
        runInAction(() => {
          this.proxyReady = true;
        });
      })
      .catch(() => {
        this.finishStartup();
        runInAction(() => {
          this.proxyError =
            '账号代理初始化失败，请检查右侧代理设置后重新打开会话';
        });
      });
  };

  private webviewReactionDisposer: IReactionDisposer;

  private didAttachTimeout: ReturnType<typeof setTimeout> | null = null;

  private accountPollTimer: ReturnType<typeof setInterval> | null = null;

  private accountPollRunning = false;

  private unreadRevision = 0;

  private lastAppliedZoom: number | null = null;

  private lastStoredIdentity = '';

  private disposed = false;

  pollAccount = async (): Promise<void> => {
    const { service, stores } = this.props;
    const view = this.webview?.view;
    if (
      !view ||
      service.recipe?.id !== 'whatsapp' ||
      this.accountPollRunning ||
      this.disposed
    )
      return;
    this.accountPollRunning = true;
    const { unreadRevision } = this;
    try {
      // Mount the split handle independently of unread/theme adapters: a
      // changed WhatsApp module must not prevent this basic UI control.
      await view
        .executeJavaScript(`(${configureWhatsAppLayout.toString()})()`)
        .catch(error => debug('Could not mount WhatsApp split handle', error));
      await view
        .executeJavaScript(
          `(${configureWhatsAppVoice.toString()})();(${configureWhatsAppAudioUpload.toString()})(${sendBulkMessage.toString()})`,
        )
        .catch(error =>
          debug('Could not configure WhatsApp voice uploads', error),
        );
      await view.executeJavaScript(`(${watchWhatsAppUnread.toString()})()`);
      await view.executeJavaScript(
        `(${applyWhatsAppTheme.toString()})(${Boolean(stores?.ui.isDarkThemeActive || service.isDarkModeEnabled)})`,
      );
      await configureTranslation(
        service,
        stores?.settings.app.translationTextColor,
      );
      const snapshot = await view.executeJavaScript(
        `(${readWhatsAppSnapshot.toString()})()`,
      );
      if (snapshot.status === 'online')
        ensureBulkLibrary(view).catch(error =>
          debug('Could not prepare WhatsApp Audio upload interface', error),
        );
      if (snapshot.status !== 'loading' && !service.isLoading)
        this.finishStartup();
      if (this.webview?.view !== view || this.disposed) return;
      runInAction(() => {
        service.accountSnapshot = mergeAccountSnapshot(
          service.accountSnapshot,
          snapshot,
        );
        if (
          (unreadRevision === this.unreadRevision &&
            Number.isFinite(snapshot.unreadMessages)) ||
          snapshot.status === 'logged-out'
        ) {
          service.unreadDirectMessageCount = snapshot.unreadMessages ?? 0;
          service.unreadIndirectMessageCount = 0;
        }
      });
      if (snapshot.status === 'online' && snapshot.ownerId) {
        const profile = accountIdentity(service.accountSnapshot);
        const identity = JSON.stringify(profile);
        if (identity !== this.lastStoredIdentity) {
          await ipcRenderer
            .invoke('account-tools-profile', service.id, {
              ...profile,
              status: 'online',
            })
            .then(() => {
              this.lastStoredIdentity = identity;
            })
            .catch(error => {
              debug('Could not save last WhatsApp identity', error);
            });
        }
      }
      const zoom =
        stores?.settings.app.accountSidebar?.accounts[service.id]?.zoom ?? 1;
      if (zoom !== this.lastAppliedZoom) {
        view.setZoomFactor(zoom);
        this.lastAppliedZoom = zoom;
      }
    } catch {
      if (this.webview?.view === view) {
        runInAction(() => {
          service.accountSnapshot = {
            ...service.accountSnapshot,
            status: 'error',
          };
        });
      }
    } finally {
      this.accountPollRunning = false;
    }
  };

  handleUnread = (event: Electron.IpcMessageEvent): void => {
    if (
      event.channel !== 'zl-wa-unread' ||
      event.currentTarget !== this.webview?.view ||
      this.disposed
    )
      return;
    const { service } = this.props;
    const value = event.args?.[0];
    if (
      !service.isEnabled ||
      service.isHibernating ||
      service.recipe.id !== 'whatsapp' ||
      !value ||
      !/^\d{5,30}@(c\.us|lid)$/.test(value.ownerId) ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0
    )
      return;
    const owners = [
      service.accountSnapshot.ownerId,
      ...(service.accountSnapshot.ownerIds || []),
    ];
    if (service.accountSnapshot.ownerId && !owners.includes(value.ownerId))
      return;
    this.unreadRevision += 1;
    service.accountUnreadLive = true;
    runInAction(() => {
      service.unreadDirectMessageCount = value.count;
      service.unreadIndirectMessageCount = 0;
      service.accountSnapshot = {
        ...service.accountSnapshot,
        unreadMessages: value.count,
      };
    });
  };

  accountNavigationStarted = (): void => {
    this.props.service.accountUnreadLive = false;
    this.lastAppliedZoom = null;
    runInAction(() => {
      this.props.service.accountSnapshot = {
        ...this.props.service.accountSnapshot,
        status: 'loading',
      };
    });
  };

  constructor(props: IProps) {
    super(props);

    this._setWebview = this._setWebview.bind(this);

    makeObservable(this);

    this.webviewReactionDisposer = reaction(
      () => this.webview?.view ?? null,
      (webview, previousWebview) => {
        this.removeWebviewEventListeners(previousWebview);
        this.addWebviewEventListeners(webview);
      },
    );
  }

  componentWillUnmount(): void {
    this.disposed = true;
    this.finishStartup();
    const { service, detachService } = this.props;
    this.webviewReactionDisposer();
    this.removeWebviewEventListeners(this.webview?.view ?? null);
    if (this.didAttachTimeout) {
      clearTimeout(this.didAttachTimeout);
      this.didAttachTimeout = null;
    }
    detachService({ service });
  }

  handleConsoleMessage = (e): void => {
    debug('Service logged a message:', e.message);
  };

  @action handleDidNavigate = (): void => {
    if (this.props.service._webview) {
      this.props.service.pageTitle = this.props.service._webview.getTitle();
    }
  };

  @action handlePageTitleUpdated = (
    event: Electron.PageTitleUpdatedEvent,
  ): void => {
    this.props.service.pageTitle = event.title;
  };

  handleWebviewRef = (webview: ElectronWebView | null): void => {
    this._setWebview(webview);
  };

  handleDidAttach = (): void => {
    const { service, setWebviewReference } = this.props;

    // Force the event handler to run in a new task.
    // This resolves a race condition when the `did-attach` is called,
    // but the webview is not attached to the DOM yet:
    // https://github.com/electron/electron/issues/31918
    // This prevents us from immediately attaching listeners such as `did-stop-load`:
    // https://github.com/ferdium/ferdium-app/issues/157
    this.didAttachTimeout = setTimeout(() => {
      setWebviewReference({
        serviceId: service.id,
        webview: this.webview?.view ?? null,
      });
      this.didAttachTimeout = null;
    }, 0);
  };

  refocusWebview = (): void => {
    if (
      typeof document !== 'undefined' &&
      document.querySelector?.(
        '.settings, .auth, [role="dialog"], [role="menu"]',
      )
    )
      return;
    const { webview } = this;
    debug('Refocus Webview is called', this.props.service);
    if (!webview) {
      return;
    }

    if (this.props.service.isActive) {
      webview.view.blur();
      webview.view.focus();
    } else {
      debug('Refocus not required - Not active service');
    }
  };

  startupFailed = (event: Electron.DidFailLoadEvent): void => {
    if (event.isMainFrame && event.errorCode !== -3) this.finishStartup();
  };

  startupStopped = (): void => {
    if (this.props.service.recipe?.id !== 'whatsapp') this.finishStartup();
    this.refocusWebview();
  };

  addWebviewEventListeners(webview: WebviewElement | null): void {
    if (!webview) {
      return;
    }

    webview.addEventListener('did-stop-loading', this.startupStopped);
    webview.addEventListener('did-fail-load', this.startupFailed);
    webview.addEventListener('console-message', this.handleConsoleMessage);
    webview.addEventListener('did-navigate', this.handleDidNavigate);
    webview.addEventListener('page-title-updated', this.handlePageTitleUpdated);
    if (this.props.service.recipe?.id === 'whatsapp') {
      webview.addEventListener(
        'did-start-loading',
        this.accountNavigationStarted,
      );
      webview.addEventListener('ipc-message', this.handleUnread);
      webview.addEventListener('did-stop-loading', this.pollAccount);
      this.accountPollTimer = setInterval(() => {
        this.pollAccount();
      }, 6000);
    }
  }

  removeWebviewEventListeners(webview: WebviewElement | null): void {
    if (this.accountPollTimer) {
      clearInterval(this.accountPollTimer);
      this.accountPollTimer = null;
    }
    if (!webview) {
      return;
    }

    webview.removeEventListener('did-stop-loading', this.startupStopped);
    webview.removeEventListener('did-fail-load', this.startupFailed);
    webview.removeEventListener('console-message', this.handleConsoleMessage);
    webview.removeEventListener('did-navigate', this.handleDidNavigate);
    webview.removeEventListener(
      'page-title-updated',
      this.handlePageTitleUpdated,
    );
    webview.removeEventListener(
      'did-start-loading',
      this.accountNavigationStarted,
    );
    webview.removeEventListener('did-stop-loading', this.pollAccount);
    webview.removeEventListener('ipc-message', this.handleUnread);
    this.props.service.accountUnreadLive = false;
  }

  @action _setWebview(webview: ElectronWebView | null): void {
    this.webview = webview;
  }

  render(): ReactElement {
    const { service, isSpellcheckerEnabled, stores } = this.props;

    if (this.startupError)
      return (
        <div role="status">
          账号启动超时，后续账号将继续启动。
          <button
            type="button"
            onClick={() => {
              runInAction(() => {
                this.startupError = false;
              });
            }}
          >
            重试此账号
          </button>
        </div>
      );
    if (service.recipe.id === 'whatsapp' && !this.proxyReady) {
      return (
        <div role="status">
          {this.proxyError || '正在准备账号独立网络环境…'}
          {this.proxyError && (
            <button type="button" onClick={this.prepareProxy}>
              重试加载会话
            </button>
          )}
        </div>
      );
    }

    const { sandboxServices } = stores!.settings.app;

    const { sandboxServices: sandboxes } = stores!.app;

    const checkForSandbox = () => {
      const sandbox = sandboxes.find(s => s.services.includes(service.id));

      if (sandbox) {
        return `persist:sandbox-${sandbox.id}`;
      }

      return service.partition;
    };

    const preloadScript = join(
      __dirname,
      '..',
      '..',
      '..',
      'webview',
      'recipe.js',
    );

    return (
      <ElectronWebView
        ref={this.handleWebviewRef}
        autosize
        src={service.url}
        preload={preloadScript}
        partition={
          service.recipe.id === 'whatsapp'
            ? `persist:service-${service.id}`
            : sandboxServices
              ? checkForSandbox()
              : 'persist:general-session'
        }
        onDidAttach={this.handleDidAttach}
        // onUpdateTargetUrl={this.updateTargetUrl} // TODO: [TS DEBT] need to check where its from
        useragent={service.userAgent}
        disablewebsecurity={
          service.recipe.disablewebsecurity ? true : undefined
        }
        allowpopups
        nodeintegration
        webpreferences={`spellcheck=${
          isSpellcheckerEnabled ? 1 : 0
        }, contextIsolation=1`}
      />
    );
  }
}

export default ServiceWebview;
