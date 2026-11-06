import { Component, type ReactNode } from 'react';
import { reportRendererException } from '../../electron/rendererStartup';

// The app shell needs a fallback outside providers/router as well as feature boundaries.
export default class AppErrorBoundary extends Component<
  {
    children?: ReactNode;
    onReload?: () => void;
  },
  { failed: boolean }
> {
  constructor(props: { children?: ReactNode; onReload?: () => void }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    reportRendererException(error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          padding: '48px',
          minHeight: '100vh',
          boxSizing: 'border-box',
          background: '#202124',
          color: '#f1f3f4',
          font: '16px/1.7 sans-serif',
        }}
      >
        <h1>界面遇到异常</h1>
        <p>账号和聊天数据会保留。重新载入后，请先核查进行中任务的执行结果。</p>
        <button
          type="button"
          onClick={this.props.onReload || (() => window.location.reload())}
          style={{ padding: '10px 20px', cursor: 'pointer' }}
        >
          重新载入界面
        </button>
        <p>如果仍无法恢复，可从系统托盘菜单导出窗口诊断。</p>
      </div>
    );
  }
}
