import { ipcRenderer, clipboard } from 'electron';
import { observer } from 'mobx-react';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import type Service from '../../models/Service';
import type { RealStores } from '../../stores';
import type { BulkMedia, ToolsConfig } from '../accountTools/config';
import { getTools } from '../accountTools/runtime';
import { getCustomerRuntime } from '../customers/runtime';
import { customerFlagNames } from '../customers/types';
import { protocolRequest, subscribeProtocol, protocolChats } from './client';
import type { ProtocolMessage, ProtocolState } from './types';
import { protocolChatStyles } from './styles';
import ProtocolAvatar from './ProtocolAvatar';

const statusNames: Record<string, string> = {
  idle: '等待连接',
  connecting: '正在连接',
  qr: '请用手机 WhatsApp 扫码',
  connected: '已连接',
  'logged-out': '登录已失效，请重新扫码',
  disconnected: '连接断开',
  reconnecting: '正在重连',
  stopped: '已断开',
  error: '连接异常',
};
function needsTranslation(text: string) {
  const withoutEmoji = text.replaceAll(
    /\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:[\uFE0E\uFE0F]|\p{Emoji_Modifier})?)*/gu,
    '',
  );
  return (
    /\p{L}/u.test(withoutEmoji) &&
    !/^(?:https?:\/\/|www\.)\S+$/i.test(text.trim())
  );
}
const drafts = new Map<string, string>();
const pendingOutgoing = new Map<
  string,
  { chat: string; owner: string; token: string; messageId?: string }
>();
export default observer(function ProtocolView({
  service,
  stores,
  onReady,
}: {
  service: Service;
  stores: RealStores;
  onReady?: () => void;
}) {
  const [state, setState] = useState<ProtocolState>();
  const [chat, setChat] = useState(protocolChats.get(service.id) || '');
  const [messages, setMessages] = useState<ProtocolMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [filter, setFilter] = useState('all');
  const messageList = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const [unseen, setUnseen] = useState(false);
  const [remarkEditor, setRemarkEditor] = useState<{
    id: string;
    value: string;
  }>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [media, setMedia] = useState<{ type: string; meta: BulkMedia }>();
  const [quote, setQuote] = useState<ProtocolMessage>();
  const [edit, setEdit] = useState<ProtocolMessage>();
  const editOriginal = useRef('');
  const [preview, setPreview] = useState<{ text: string; source: string }>();
  const [config, setConfig] = useState<ToolsConfig>();
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<Record<string, string>>({});
  const owner = state?.ownerId || '';
  const previousOwner = useRef(owner);
  useEffect(() => {
    if (previousOwner.current && owner && previousOwner.current !== owner) {
      setChat('');
      setRemarkEditor(undefined);
      protocolChats.delete(service.id);
    }
    previousOwner.current = owner;
  }, [owner]);
  const selection = useRef({ chat, owner });
  selection.current = { chat, owner };
  const [pendingSend, setPendingSend] = useState<{
    chat: string;
    owner: string;
    token: string;
    messageId?: string;
  }>();
  const composing = useRef(false);
  const submitting = useRef(false);
  const translationPending = useRef(new Set<string>());
  const ready = useRef(onReady);
  ready.current = onReady;
  const draftKey = `${service.id}:${owner}:${chat}`;
  const trackPending = (
    value:
      | { chat: string; owner: string; token: string; messageId?: string }
      | undefined,
  ) => {
    if (value) pendingOutgoing.set(draftKey, value);
    else pendingOutgoing.delete(draftKey);
    if (
      draftKey ===
      `${service.id}:${selection.current.owner}:${selection.current.chat}`
    )
      setPendingSend(value);
  };
  const customer = getCustomerRuntime(stores);
  const [customerRevision, setCustomerRevision] = useState(0);
  useEffect(() => {
    const changed = () => setCustomerRevision(n => n + 1);
    customer.listeners.add(changed);
    return () => {
      customer.listeners.delete(changed);
    };
  }, [customer]);
  const summary =
    customerRevision >= 0 && customer.bundle?.owner === owner
      ? customer.bundle
      : undefined;
  useEffect(() => {
    let live = true;
    const unsubscribe = subscribeProtocol(service, value => {
      if (live) {
        setState(value);
        if (
          ['qr', 'connected', 'error', 'logged-out', 'disconnected'].includes(
            value.status,
          )
        )
          ready.current?.();
      }
    });
    const start = async () => {
      try {
        const initial = await protocolRequest<ProtocolState>(
          service.id,
          'state',
        );
        if (!live) return;
        setState(initial);
        await ipcRenderer.invoke('account-tools-prepare', service.id);
        if (live) await protocolRequest(service.id, 'start');
      } catch (error) {
        if (live) {
          setNotice(String(error));
          ready.current?.();
        }
      }
    };
    void start();
    const opened = (event: Event) => {
      const value = (event as CustomEvent).detail;
      if (value?.serviceId === service.id) setChat(value.jid);
    };
    window.addEventListener('zl-protocol-open', opened);
    const timer = setInterval(() => {
      void getTools(service.id).then(value => {
        if (live) setConfig(value);
      });
    }, 1000);
    void getTools(service.id).then(value => {
      if (live) setConfig(value);
    });
    return () => {
      live = false;
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('zl-protocol-open', opened);
      void protocolRequest(service.id, 'stop').catch(() => {});
    };
  }, [service.id]);
  useEffect(() => {
    followLatest.current = true;
    setUnseen(false);
    setNotice('');
    setDraft(drafts.get(draftKey) || '');
    setPendingSend(pendingOutgoing.get(draftKey));
    setMedia(undefined);
    setQuote(undefined);
    setEdit(undefined);
    setPreview(undefined);
    setMessages([]);
    setTranslations({});
    setAttachments({});
  }, [draftKey]);
  useEffect(() => {
    if (!chat || !owner || state?.status !== 'connected') return;
    let live = true;
    const current = { chat, owner };
    protocolChats.set(service.id, chat);
    customer.notify();
    void customer.refresh();
    void protocolRequest<ProtocolMessage[]>(service.id, 'messages', {
      jid: chat,
    })
      .then(rows => {
        if (
          live &&
          selection.current.chat === current.chat &&
          selection.current.owner === current.owner
        )
          setMessages(rows);
      })
      .catch(error => {
        if (live) setNotice(String(error));
      });
    return () => {
      live = false;
    };
  }, [state, chat, owner]);
  useEffect(() => {
    if (
      chat &&
      owner &&
      service.isActive &&
      state?.status === 'connected' &&
      (state.chats.find(row => row.id === chat)?.unread || 0) > 0
    )
      void protocolRequest(service.id, 'read', { jid: chat }).catch(error =>
        setNotice(String(error)),
      );
  }, [
    chat,
    owner,
    state?.chats.find(row => row.id === chat)?.unread,
    service.isActive,
  ]);
  useEffect(() => {
    const list = messageList.current;
    if (!list) return;
    if (followLatest.current) {
      list.scrollTop = list.scrollHeight;
      setUnseen(false);
    } else setUnseen(true);
  }, [chat, messages.length, messages[messages.length - 1]?.id]);
  const translate = async (message: ProtocolMessage, manual = true) => {
    if (!message.text || translationPending.current.has(message.id)) return;
    translationPending.current.add(message.id);
    const current = { ...selection.current };
    try {
      const result = await ipcRenderer.invoke(
        'account-tools-translate',
        service.id,
        message.text,
        'incoming',
        false,
        undefined,
        manual,
      );
      if (
        selection.current.chat === current.chat &&
        selection.current.owner === current.owner
      ) {
        if (result.error) throw Error(result.message || '翻译失败');
        setTranslations(rows => ({ ...rows, [message.id]: result.text }));
      }
    } catch (error) {
      setNotice(String(error));
    } finally {
      translationPending.current.delete(message.id);
    }
  };
  useEffect(() => {
    if (config?.translation.incoming)
      for (const message of messages.slice(-20))
        if (
          !message.fromMe &&
          needsTranslation(message.text) &&
          !translations[message.id]
        )
          void translate(message, false);
  }, [messages, config?.translation.incoming]);
  const updateDraft = (value: string) => {
    setDraft(value);
    if (!edit) drafts.set(draftKey, value);
    setPreview(undefined);
  };
  const send = async () => {
    if (submitting.current || !chat || !owner || state?.status !== 'connected')
      return;
    if (!draft.trim() && !media && !pendingSend) return;
    const current = { ...selection.current };
    const operationToken =
      pendingSend?.chat === chat && pendingSend.owner === owner
        ? pendingSend.token
        : crypto.randomUUID();
    const source = draft;
    submitting.current = true;
    setBusy(true);
    setNotice('');
    try {
      if (pendingSend?.chat === chat && pendingSend.owner === owner) {
        const result = await protocolRequest(service.id, 'reconcile', {
          jid: chat,
          id: pendingSend.messageId,
          token: pendingSend.token,
          owner,
        });
        setNotice(
          result.confirmed
            ? '上一条消息已取得服务器回执。请先核对聊天，避免重复发送。'
            : result.error || '上一条消息仍待核验，未重复发送',
        );
        if (result.confirmed) {
          trackPending(undefined);
          updateDraft('');
          setMedia(undefined);
          setQuote(undefined);
        }
        return;
      }
      let text = draft;
      if (
        config?.translation.outgoing &&
        draft.trim() &&
        needsTranslation(draft) &&
        !edit
      ) {
        if (preview?.source === draft) text = preview.text;
        else {
          const result = await ipcRenderer.invoke(
            'account-tools-translate',
            service.id,
            draft,
            'outgoing',
            false,
            undefined,
            true,
          );
          if (result.error) throw Error(result.message || '翻译失败，未发送');
          text = result.text;
          if (
            selection.current.chat !== current.chat ||
            selection.current.owner !== current.owner
          )
            throw Error('当前聊天已变化，未发送');
          if (config.translation.preview) {
            setPreview({ text, source: draft });
            setNotice('请核对下方译文，确认后再次点击发送。');
            return;
          }
        }
      }
      if (
        selection.current.chat !== current.chat ||
        selection.current.owner !== current.owner
      )
        throw Error('当前聊天已变化，未发送');
      if (edit) {
        await protocolRequest(service.id, 'edit', {
          jid: chat,
          id: edit.id,
          text,
          owner,
        });
        setNotice('修改请求已提交，请核对聊天结果。');
      } else {
        const spec = {
          type: media?.type || 'text',
          text,
          media: media?.meta,
          operationToken,
          typingSeconds: 0,
          mentionAll: false,
          ...(quote
            ? {
                reply: { text: quote.text, match: 'exact' },
                quotedId: quote.id,
              }
            : {}),
        };
        trackPending({ chat, owner, token: operationToken });
        const result = await protocolRequest(service.id, 'send', {
          jid: chat,
          spec,
          owner,
        });
        setNotice(
          result.confirmed
            ? '服务器已确认提交，请以对方实际收到为准。'
            : result.error || '结果待确认，请先核对对方是否收到；未自动重发。',
        );
        if (result.notSubmitted) {
          trackPending(undefined);
          return;
        }
        if (!result.confirmed) {
          trackPending({
            chat,
            owner,
            token: operationToken,
            messageId: result.messageId,
          });
          return;
        }
        trackPending(undefined);
        if (!result.messageId) return;
      }
      if (
        selection.current.chat === current.chat &&
        selection.current.owner === current.owner &&
        (Boolean(edit) || drafts.get(draftKey) === source)
      ) {
        updateDraft(edit ? editOriginal.current : '');
        setMedia(undefined);
        setQuote(undefined);
        setEdit(undefined);
      }
      const rows = await protocolRequest<ProtocolMessage[]>(
        service.id,
        'messages',
        { jid: current.chat },
      );
      if (
        selection.current.chat === current.chat &&
        selection.current.owner === current.owner
      )
        setMessages(rows);
    } catch (error) {
      setNotice(String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const choose = async (type: string) => {
    try {
      const meta = await ipcRenderer.invoke('account-tools-media-pick', type);
      if (meta) setMedia({ type, meta });
    } catch (error) {
      setNotice(String(error));
    }
  };
  const openMedia = async (message: ProtocolMessage) => {
    try {
      const result = await protocolRequest(service.id, 'media', {
        jid: chat,
        id: message.id,
        owner,
      });
      if (selection.current.chat === message.jid)
        setAttachments(rows => ({
          ...rows,
          [message.id]: `data:${result.mime};base64,${result.data}`,
        }));
    } catch (error) {
      setNotice(String(error));
    }
  };
  const zoom =
    stores.settings.app.accountSidebar?.accounts?.[service.id]?.zoom || 1;
  const rows = [...(state?.chats || [])]
    .sort((a, b) => {
      const pa = summary?.pins.indexOf(summary.aliases[a.id] || a.id) ?? -1,
        pb = summary?.pins.indexOf(summary.aliases[b.id] || b.id) ?? -1;
      return (
        (pa < 0 ? Number.MAX_SAFE_INTEGER : pa) -
        (pb < 0 ? Number.MAX_SAFE_INTEGER : pb)
      );
    })
    .filter(row =>
      filter === 'unread'
        ? row.unread > 0
        : filter === 'groups'
          ? row.group
          : filter === 'archived'
            ? row.archived
            : !row.archived,
    )
    .filter(row =>
      `${row.name} ${row.id} ${summary?.summaries[row.id]?.remarkName || ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  const selected = state?.chats.find(row => row.id === chat);
  return (
    <section
      className={`protocol-chat${stores.ui.isDarkThemeActive ? ' protocol-chat--dark' : ''}`}
      aria-label="新连接聊天"
      style={
        {
          '--pc-zoom': zoom,
          display: 'flex',
          height: '100%',
          minHeight: 0,
          minWidth: 0,
          overflow: 'hidden',
          width: '100%',
          fontSize: 16 * zoom,
          background: stores.ui.isDarkThemeActive ? '#151a1f' : '#f5f7f6',
          color: stores.ui.isDarkThemeActive ? '#eee' : '#172c22',
        } as CSSProperties
      }
    >
      <style>{protocolChatStyles}</style>
      <aside
        className="protocol-chat__sidebar"
        style={{
          width: 300,
          minWidth: 210,
          maxWidth: '34%',
          flexShrink: 0,
          minHeight: 0,
          borderRight: '1px solid #879b8c',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          padding: 12,
        }}
      >
        <div className="protocol-chat__account">
          <div className="protocol-chat__title">
            <h3>WhatsApp</h3>
            <button
              type="button"
              aria-label="连接设置"
              onClick={() => {
                const el = document.querySelector(
                  `[data-protocol-settings="${service.id}"]`,
                ) as HTMLDetailsElement;
                if (el) el.open = !el.open;
              }}
            >
              ⋮
            </button>
            <button
              type="button"
              aria-label="新建聊天"
              onClick={() => setShowNewChat(value => !value)}
            >
              ＋
            </button>
          </div>
          <p role="status" className="protocol-chat__account-status">
            {state?.nickname || service.name} ·{' '}
            {statusNames[state?.status || 'idle'] || state?.status}
          </p>
          <details
            className="protocol-chat__connection-menu"
            data-protocol-settings={service.id}
          >
            <summary>连接选项</summary>
            <button
              type="button"
              onClick={() => {
                void protocolRequest(service.id, 'start').catch(error =>
                  setNotice(String(error)),
                );
              }}
            >
              连接 / 恢复
            </button>
            <button
              type="button"
              onClick={() => {
                void protocolRequest(service.id, 'groups', { owner }).catch(
                  error => setNotice(String(error)),
                );
              }}
              disabled={state?.status !== 'connected'}
            >
              刷新群组
            </button>
            <button
              type="button"
              onClick={() => {
                void protocolRequest(service.id, 'diagnostics')
                  .then(result => {
                    clipboard.writeText(JSON.stringify(result, null, 2));
                    setNotice('诊断已复制，不包含账号号码、正文或密钥');
                  })
                  .catch(error => setNotice(String(error)));
              }}
            >
              复制连接诊断
            </button>
          </details>
        </div>
        <input
          className="protocol-chat__search"
          aria-label="搜索聊天"
          placeholder="搜索名称、号码或备注"
          value={search}
          onChange={event => setSearch(event.target.value)}
          style={{ width: '100%', margin: '12px 0', boxSizing: 'border-box' }}
        />
        {showNewChat && (
          <form
            className="protocol-chat__new-chat"
            onSubmit={event => {
              event.preventDefault();
              if (!/^\+?[1-9]\d{6,14}$/.test(newPhone.trim())) {
                setNotice('请输入含国家码的完整手机号码');
                return;
              }
              const jid = `${newPhone.trim().replace(/^\+/, '')}@c.us`;
              setChat(jid);
              protocolChats.set(service.id, jid);
              setSearch('');
              setNotice('');
              setNewPhone('');
              setShowNewChat(false);
            }}
          >
            <input
              aria-label="新聊天号码"
              placeholder="国家码＋手机号"
              value={newPhone}
              onChange={event => setNewPhone(event.target.value)}
            />
            <button type="submit">开始聊天</button>
          </form>
        )}
        <div className="protocol-chat__filters">
          {[
            ['all', '全部'],
            ['unread', '未读'],
            ['groups', '群聊'],
            ['archived', '已归档'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="protocol-chat__chat-list" aria-label="聊天列表">
          {rows.map(row => (
            <div className="protocol-chat__chat-row" key={row.id}>
              <button
                type="button"
                aria-pressed={chat === row.id}
                onClick={() => {
                  setChat(row.id);
                  setNotice('');
                  protocolChats.set(service.id, row.id);
                }}
                className="protocol-chat__chat-button"
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: 12,
                  marginTop: 4,
                  background: chat === row.id ? '#b9d9c8' : undefined,
                  color: '#152c21',
                }}
              >
                <ProtocolAvatar
                  serviceId={service.id}
                  owner={owner}
                  jid={row.id}
                  name={row.name}
                  group={row.group}
                  connected={state?.status === 'connected'}
                />
                <span className="protocol-chat__row-content">
                  <span className="protocol-chat__row-title">
                    <strong>{row.name}</strong>
                    <span className="protocol-chat__row-time">
                      {row.timestamp
                        ? new Date(row.timestamp * 1000).toLocaleDateString(
                            undefined,
                            { month: 'numeric', day: 'numeric' },
                          )
                        : ''}
                    </span>
                  </span>
                  <span className="protocol-chat__remark">
                    {summary?.summaries[summary.aliases[row.id] || row.id]
                      ?.remarkName || '添加备注'}{' '}
                    {summary?.summaries[
                      summary.aliases[row.id] || row.id
                    ]?.flags
                      .map(flag => customerFlagNames[flag])
                      .join(' · ')}
                  </span>
                  <span className="protocol-chat__preview">
                    <span>
                      {row.lastText || (row.group ? '群聊' : '点击开始聊天')}
                    </span>
                    {row.unread > 0 && (
                      <span className="protocol-chat__unread">
                        {row.unread > 99 ? '99+' : row.unread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <details className="protocol-chat__row-actions">
                <summary aria-label="聊天操作">⌄</summary>
                <button
                  type="button"
                  onClick={() =>
                    setRemarkEditor({
                      id: row.id,
                      value:
                        summary?.summaries[summary.aliases[row.id] || row.id]
                          ?.remarkName || '',
                    })
                  }
                >
                  备注
                </button>
                {summary && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        const pinned = summary.pins.includes(
                          summary.aliases[row.id] || row.id,
                        );
                        void ipcRenderer
                          .invoke(
                            'customers-pin',
                            summary.owner,
                            row.id,
                            pinned ? 'unpin' : 'pin',
                          )
                          .then(() => customer.refresh())
                          .catch(error => setNotice(String(error)));
                      }}
                    >
                      {summary.pins.includes(summary.aliases[row.id] || row.id)
                        ? '取消置顶'
                        : '置顶'}
                    </button>
                    {summary.pins.includes(
                      summary.aliases[row.id] || row.id,
                    ) && (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            void ipcRenderer
                              .invoke(
                                'customers-pin',
                                summary.owner,
                                row.id,
                                'up',
                              )
                              .then(() => customer.refresh())
                              .catch(error => setNotice(String(error)));
                          }}
                        >
                          上移
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            void ipcRenderer
                              .invoke(
                                'customers-pin',
                                summary.owner,
                                row.id,
                                'down',
                              )
                              .then(() => customer.refresh())
                              .catch(error => setNotice(String(error)));
                          }}
                        >
                          下移
                        </button>
                      </>
                    )}
                  </>
                )}
              </details>
            </div>
          ))}
        </div>
        {remarkEditor && (
          <fieldset>
            <label>
              聊天备注
              <input
                value={remarkEditor.value}
                maxLength={100}
                onChange={event =>
                  setRemarkEditor({
                    ...remarkEditor,
                    value: event.target.value,
                  })
                }
              />
            </label>
            <button
              type="button"
              onClick={() => {
                if (!summary) return;
                void ipcRenderer
                  .invoke('customers-patch', summary.owner, remarkEditor.id, {
                    remarkName: remarkEditor.value.trim(),
                  })
                  .then(() => {
                    setRemarkEditor(undefined);
                    return customer.refresh();
                  })
                  .catch(error => setNotice(String(error)));
              }}
            >
              保存备注
            </button>
            <button type="button" onClick={() => setRemarkEditor(undefined)}>
              取消
            </button>
          </fieldset>
        )}
        {state?.status === 'connected' && !rows.length && (
          <p>连接已建立，正在等待聊天同步。也可以按号码打开聊天或刷新群组。</p>
        )}
      </aside>
      <div
        className="protocol-chat__conversation"
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
        }}
      >
        <header className="protocol-chat__header">
          <ProtocolAvatar
            serviceId={service.id}
            owner={owner}
            jid={chat}
            name={selected?.name || 'WhatsApp'}
            group={selected?.group}
            connected={state?.status === 'connected'}
          />
          <div>
            <strong>
              {selected?.name || (chat ? chat.split('@')[0] : 'WhatsApp')}
            </strong>
            <small style={{ display: 'block' }}>
              新连接 ·{' '}
              {state?.status === 'connected'
                ? '已连接'
                : statusNames[state?.status || 'idle']}
            </small>
          </div>
        </header>
        {state?.qr && (
          <div style={{ textAlign: 'center' }}>
            <p>手机 WhatsApp → 已关联设备 → 关联设备</p>
            <img src={state.qr} alt="扫码登录" width={300} height={300} />
          </div>
        )}
        {(notice || state?.error) && (
          <p role="status" style={{ whiteSpace: 'pre-wrap', color: '#b47b24' }}>
            {notice || state?.error}
          </p>
        )}
        <div
          ref={messageList}
          className="protocol-chat__messages"
          aria-label="聊天消息"
          onScroll={() => {
            const list = messageList.current;
            if (!list) return;
            followLatest.current =
              list.scrollHeight - list.scrollTop - list.clientHeight < 80;
            if (followLatest.current) setUnseen(false);
          }}
        >
          {!chat && !state?.qr && (
            <div className="protocol-chat__empty">
              <span className="protocol-chat__welcome-icon">☏</span>
              <strong>WhatsApp</strong>
              <span>选择左侧聊天，开始发送和接收消息</span>
              <span>聊天备注、客户标记和置顶保留在原来的功能中</span>
            </div>
          )}
          {chat && !messages.length && (
            <div className="protocol-chat__empty">
              暂无已同步消息，可以直接发送消息
            </div>
          )}
          {messages.map(message => (
            <article
              key={message.id}
              className={`protocol-chat__bubble${message.fromMe ? ' protocol-chat__bubble--own' : ''}`}
              style={{
                margin: '8px 0',
                marginLeft: message.fromMe ? 'auto' : 0,
                marginRight: message.fromMe ? 0 : 'auto',
                maxWidth: '82%',
                padding: 12,
                border: '1px solid #8aa292',
                borderRadius: 8,
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
              }}
            >
              <small>
                {message.fromMe
                  ? '我'
                  : message.senderName ||
                    (selected?.group
                      ? message.participant?.split('@')[0]
                      : selected?.name)}{' '}
                · {new Date(message.timestamp * 1000).toLocaleString()}{' '}
                {message.fromMe
                  ? message.status >= 3
                    ? '已送达'
                    : message.status >= 2
                      ? '服务器已接收'
                      : '待确认'
                  : ''}
              </small>
              <div>{message.text}</div>
              {message.kind !== 'text' && (
                <button
                  type="button"
                  onClick={() => {
                    void openMedia(message);
                  }}
                >
                  读取
                  {message.kind === 'audio'
                    ? '语音'
                    : message.kind === 'image'
                      ? '图片'
                      : '附件'}
                </button>
              )}
              {attachments[message.id] &&
                (message.kind === 'audio' ? (
                  <audio controls src={attachments[message.id]} />
                ) : message.kind === 'image' ? (
                  <img
                    alt="消息图片"
                    src={attachments[message.id]}
                    style={{ maxWidth: '100%', maxHeight: 350 }}
                  />
                ) : message.kind === 'video' ? (
                  <video
                    controls
                    src={attachments[message.id]}
                    style={{ maxWidth: '100%', maxHeight: 350 }}
                  />
                ) : (
                  <a href={attachments[message.id]} download="附件">
                    下载附件
                  </a>
                ))}
              <div className="protocol-chat__message-actions">
                {message.text && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setQuote(message);
                        setEdit(undefined);
                      }}
                    >
                      引用
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        void translate(message);
                      }}
                    >
                      翻译
                    </button>
                  </>
                )}
                {message.fromMe && message.kind === 'text' && (
                  <button
                    type="button"
                    onClick={() => {
                      editOriginal.current = draft;
                      setEdit(message);
                      setQuote(undefined);
                      setDraft(message.text);
                      setPreview(undefined);
                    }}
                  >
                    编辑
                  </button>
                )}
                {message.fromMe && (
                  <button
                    type="button"
                    onClick={() => {
                      void protocolRequest(service.id, 'revoke', {
                        jid: chat,
                        id: message.id,
                        owner,
                      })
                        .then(() => setNotice('撤回请求已提交，请核对结果。'))
                        .catch(error => setNotice(String(error)));
                    }}
                  >
                    撤回
                  </button>
                )}
              </div>
              {translations[message.id] && (
                <p
                  style={{
                    color:
                      stores.settings.app.translationTextColor || '#718f42',
                  }}
                >
                  {translations[message.id]}
                </p>
              )}
            </article>
          ))}
        </div>
        {unseen && (
          <button
            className="protocol-chat__latest"
            type="button"
            onClick={() => {
              followLatest.current = true;
              if (messageList.current)
                messageList.current.scrollTop =
                  messageList.current.scrollHeight;
              setUnseen(false);
            }}
          >
            回到最新消息 ↓
          </button>
        )}
        {chat && state?.status === 'connected' && (
          <footer className="protocol-chat__composer">
            {(quote || edit) && (
              <p>
                {edit ? '编辑消息' : '引用消息'}：
                {(edit || quote)?.text.slice(0, 150)}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setQuote(undefined);
                    setEdit(undefined);
                  }}
                >
                  取消
                </button>
              </p>
            )}
            {media && (
              <p>
                附件：{media.meta.name}
                <button type="button" onClick={() => setMedia(undefined)}>
                  移除
                </button>
              </p>
            )}
            {preview && (
              <label>
                发送译文（可修改）
                <textarea
                  aria-label="发送译文"
                  value={preview.text}
                  onChange={event =>
                    setPreview({ ...preview, text: event.target.value })
                  }
                />
              </label>
            )}
            {pendingSend?.chat === chat && pendingSend.owner === owner && (
              <p>
                上一条结果待核验。请先检查对方是否收到。
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    trackPending(undefined);
                    updateDraft('');
                    setMedia(undefined);
                    setQuote(undefined);
                  }}
                >
                  已人工核对，开始新消息
                </button>
              </p>
            )}
            <textarea
              aria-label="消息内容"
              placeholder="输入消息"
              value={draft}
              disabled={busy}
              onChange={event => updateDraft(event.target.value)}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={event => {
                if (
                  event.key !== 'Enter' ||
                  event.nativeEvent.isComposing ||
                  composing.current ||
                  event.repeat ||
                  event.ctrlKey ||
                  event.altKey ||
                  event.metaKey
                )
                  return;
                const shift =
                  stores.settings.app.messageSendMode === 'shift-enter';
                if (event.shiftKey === shift) {
                  event.preventDefault();
                  void send();
                }
              }}
              style={{ width: '100%', minHeight: 70, boxSizing: 'border-box' }}
            />
            <div className="protocol-chat__toolbar">
              {['image', 'video', 'audio', 'document'].map(type => (
                <button
                  type="button"
                  key={type}
                  disabled={busy}
                  onClick={() => {
                    void choose(type);
                  }}
                >
                  {
                    {
                      image: '图片',
                      video: '视频',
                      audio: '语音',
                      document: '文件',
                    }[type]
                  }
                </button>
              ))}
              <button
                type="button"
                aria-label="发送消息"
                disabled={busy || (!draft.trim() && !media && !pendingSend)}
                onClick={() => {
                  void send();
                }}
              >
                {busy
                  ? '提交中…'
                  : pendingSend?.chat === chat && pendingSend.owner === owner
                    ? '核验上一条（不重发）'
                    : preview
                      ? '确认译文并发送'
                      : '发送'}
              </button>
            </div>
            <small>
              {stores.settings.app.messageSendMode === 'shift-enter'
                ? 'Shift+Enter 发送 · Enter 换行'
                : 'Enter 发送 · Shift+Enter 换行'}
            </small>
          </footer>
        )}
      </div>
    </section>
  );
});
