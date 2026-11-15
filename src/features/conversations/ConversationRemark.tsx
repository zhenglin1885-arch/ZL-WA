/* eslint-disable no-void -- Save errors are shown in the sidebar notice. */
import { useEffect, useRef, useState } from 'react';

export default function ConversationRemark({
  remark,
  name,
  save,
  onError,
}: {
  remark: string;
  name: string;
  save: (value: string) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(remark);
  const [busy, setBusy] = useState(false);
  const editing = useRef(false);
  const cancelled = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(remark);
  }, [remark]);
  const commit = async () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (saving.current || draft === remark) {
      editing.current = false;
      return;
    }
    saving.current = true;
    setBusy(true);
    try {
      await save(draft);
      editing.current = false;
      onError('');
    } catch (error) {
      onError(
        `备注保存失败：${error instanceof Error ? error.message : String(error)}，点击备注后可重试`,
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <input
      className="conversation-row__remark"
      aria-label={`编辑 ${name} 的备注`}
      aria-busy={busy}
      title="输入备注，按 Enter 或移开焦点保存，Esc 取消"
      placeholder="添加备注"
      maxLength={100}
      value={draft}
      readOnly={busy}
      onFocus={() => {
        editing.current = true;
      }}
      onChange={event => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing || saving.current) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          cancelled.current = true;
          editing.current = false;
          setDraft(remark);
          event.currentTarget.blur();
        }
      }}
    />
  );
}
