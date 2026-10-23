import { ipcRenderer } from 'electron';
import { inject, observer } from 'mobx-react';
import { Component } from 'react';
import type { StoresProps } from '../../@types/ferdium-components.types';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/button';
import { state } from './store';

@inject('stores', 'actions')
@observer
class LocalDiagnostics extends Component<
  Partial<StoresProps>,
  { error: string }
> {
  constructor(props: Partial<StoresProps>) {
    super(props);
    this.state = { error: '' };
  }

  async export() {
    try {
      const saved = await ipcRenderer.invoke(
        'zl-export-diagnostics',
        JSON.stringify(this.props.stores?.app.debugInfo, null, 2),
      );
      if (saved) state.isModalVisible = false;
    } catch {
      this.setState({ error: '导出失败，请重试。' });
    }
  }

  render() {
    return (
      <Modal
        isOpen={state.isModalVisible}
        close={() => {
          state.isModalVisible = false;
        }}
      >
        <div style={{ padding: 24, maxWidth: 480 }}>
          <h2>导出诊断信息</h2>
          <p>
            将系统版本与应用配置保存为本地文件，不上传到服务器。分享前请检查文件内容。
          </p>
          {this.state.error && <p>{this.state.error}</p>}
          <Button
            buttonType="secondary"
            onClick={() => {
              state.isModalVisible = false;
            }}
            label="取消"
          />
          <Button onClick={() => this.export()} label="保存文件" />
        </div>
      </Modal>
    );
  }
}
export default LocalDiagnostics;
