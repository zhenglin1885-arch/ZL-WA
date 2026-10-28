import { observer } from 'mobx-react';
import { Component, type ReactElement } from 'react';
import {
  type WrappedComponentProps,
  defineMessages,
  injectIntl,
} from 'react-intl';
import withStyles, { type WithStylesProps } from 'react-jss';
import Button from '../../ui/button';
import { H1 } from '../../ui/headline';

const messages = defineMessages({
  headline: {
    id: 'service.errorHandler.headline',
    defaultMessage: 'Oh no!',
  },
  text: {
    id: 'service.errorHandler.text',
    defaultMessage: '{name} has failed to load.',
  },
  action: {
    id: 'service.errorHandler.action',
    defaultMessage: 'Reload {name}',
  },
  editAction: {
    id: 'service.errorHandler.editAction',
    defaultMessage: 'Edit {name}',
  },
  errorMessage: {
    id: 'service.errorHandler.message',
    defaultMessage: 'Error',
  },
});

const styles = theme => ({
  component: {
    left: 0,
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '100%',
    zIndex: 6,
    alignItems: 'center',
    background: theme.colorWebviewErrorHandlerBackground,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    textAlign: 'center',
  },
  buttonContainer: {
    display: 'flex',
    flexDirection: 'row',
    height: 'auto',
    margin: [40, 0, 20],

    '& button': {
      margin: [0, 10, 0, 10],
    },
  },
});

interface IProps extends WithStylesProps<typeof styles>, WrappedComponentProps {
  name: string;
  reload: () => void;
  edit: () => void;
  errorMessage: string;
}

@observer
class WebviewErrorHandler extends Component<IProps> {
  render(): ReactElement {
    const { name, reload, edit, errorMessage, classes, intl } = this.props;

    return (
      <div className={classes.component}>
        <H1>{intl.formatMessage(messages.headline)}</H1>
        <p>{intl.formatMessage(messages.text, { name })}</p>
        <p>
          <strong>{intl.formatMessage(messages.errorMessage)}:</strong>{' '}
          {errorMessage}
        </p>
        {/ERR_(?:PROXY|TUNNEL|SOCKS|CONNECTION|NAME_NOT_RESOLVED|TIMED_OUT|NETWORK_CHANGED|NO_SUPPORTED_PROXIES)/.test(
          errorMessage,
        ) && (
          <p>
            网络连接失败。请在右侧“代理”检查协议、主机、端口和认证信息，点击“应用并测试连接”后重新加载会话。
          </p>
        )}
        <div className={classes.buttonContainer}>
          <Button
            label={intl.formatMessage(messages.editAction, { name })}
            buttonType="inverted"
            onClick={() => edit()}
          />
          <Button
            label={intl.formatMessage(messages.action, { name })}
            buttonType="inverted"
            onClick={() => reload()}
          />
        </div>
      </div>
    );
  }
}

export default injectIntl(
  withStyles(styles, { injectTheme: true })(WebviewErrorHandler),
);
