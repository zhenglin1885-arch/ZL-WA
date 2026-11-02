/* eslint-disable no-void, no-continue -- UI operations report failures in the panel notice. */
import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { observer } from 'mobx-react';
import { mdiAccountOutline } from '@mdi/js';
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Menu,
  MenuItem,
} from '@mui/material';
import Icon from '../../components/ui/icon';
import type { RealStores } from '../../stores';
import BulkSend from '../accountTools/BulkSend';
import { ConversationRuntime } from './runtime';
import {
  normalizeConversationGroups,
  conversationGroup,
  moveConversations,
  removeConversationGroup,
  searchConversation,
} from './state';
import type { AggregateConversation, ConversationGroups } from './types';

type Entry = {
  top: number;
  height: number;
  group: string;
  row?: AggregateConversation;
};
const formatTime = (timestamp: number) => {
  if (!timestamp) return '';
  const date = new Date(timestamp * 1000);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString();
};

const ConversationSidebar = observer(
  ({
    stores,
    activate,
    onBack,
  }: {
    stores: RealStores;
    activate: (id: string) => void;
    onBack: () => void;
  }) => {
    const runtime = useMemo(
      () => new ConversationRuntime(stores, activate),
      [stores, activate],
    );
    const [, render] = useState(0);
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('all');
    const [status, setStatus] = useState('all');
    const [account, setAccount] = useState('all');
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [opening, setOpening] = useState('');
    const [menu, setMenu] = useState<{ id: string; anchor: HTMLElement }>();
    const [dialog, setDialog] = useState<{
      kind: 'create' | 'rename' | 'delete' | 'move';
      id: string;
      value: string;
    }>();
    const [bulk, setBulk] = useState(false);
    const selectAllId = useId();
    const list = useRef<HTMLDivElement>(null);
    const [scroll, setScroll] = useState(0);
    const [height, setHeight] = useState(600);
    const raw = stores.settings.app.aggregateConversations;
    const config = useMemo(() => normalizeConversationGroups(raw), [raw]);
    useEffect(() => {
      const changed = () => render(value => value + 1);
      runtime.listeners.add(changed);
      runtime.start();
      return () => {
        runtime.listeners.delete(changed);
        runtime.dispose();
      };
    }, [runtime]);
    useEffect(() => {
      const element = list.current;
      if (!element) return () => {};
      const resize = new ResizeObserver(() => setHeight(element.clientHeight));
      resize.observe(element);
      return () => resize.disconnect();
    }, []);
    const all = runtime.rows;
    const visible = all
      .filter(
        row =>
          (account === 'all' || row.accountId === account) &&
          (kind === 'all' ||
            (kind === 'archived'
              ? row.archived
              : row.group === (kind === 'group'))) &&
          (status === 'all' ||
            (status === 'unread'
              ? row.unread > 0
              : status === 'unreplied'
                ? row.lastFromMe === false
                : row.lastFromMe === false && row.unread === 0)) &&
          searchConversation(row, search),
      )
      .sort(
        (a, b) =>
          b.timestamp - a.timestamp ||
          (a.remark || a.name).localeCompare(b.remark || b.name) ||
          a.key.localeCompare(b.key),
      );
    const chosen = visible.filter(row => selected.has(row.key));
    let totalHeight = 0;
    const entries: Entry[] = [];
    for (const group of config.groups) {
      entries.push({ top: totalHeight, height: 38, group: group.id });
      totalHeight += 38;
      if (group.collapsed) continue;
      for (const row of visible.filter(
        item => conversationGroup(config, item) === group.id,
      )) {
        entries.push({ top: totalHeight, height: 86, group: group.id, row });
        totalHeight += 86;
      }
    }
    const displayed = entries.filter(
      entry =>
        entry.top + entry.height >= scroll - 430 &&
        entry.top < scroll + height + 430,
    );
    const avatarRows = displayed.flatMap(entry =>
      entry.row ? [entry.row] : [],
    );
    const avatarKey = avatarRows.map(row => row.key).join('|');
    useEffect(() => {
      void runtime.loadAvatars(avatarRows);
    }, [runtime, avatarKey, runtime.version]);
    const reset = () => {
      setSelected(new Set());
      if (list.current) list.current.scrollTop = 0;
      setScroll(0);
    };
    const save = async (next: ConversationGroups) => {
      await stores.settings._update({
        type: 'app',
        data: { aggregateConversations: next },
      });
    };
    const perform = async (operation: () => Promise<void>) => {
      setBusy(true);
      setNotice('');
      try {
        await operation();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    };
    const submitDialog = () =>
      void perform(async () => {
        if (!dialog) return;
        if (dialog.kind === 'delete')
          await save(removeConversationGroup(config, dialog.id));
        else if (dialog.kind === 'move') {
          await save(moveConversations(config, chosen, dialog.value));
          setSelected(new Set());
        } else {
          const value = dialog.value.trim();
          if (!value) throw new Error('请输入分组名称');
          if (config.groups.some(g => g.name === value && g.id !== dialog.id))
            throw new Error('分组名称已存在');
          await save({
            ...config,
            groups:
              dialog.kind === 'create'
                ? [
                    ...config.groups,
                    { id: crypto.randomUUID(), name: value, collapsed: false },
                  ]
                : config.groups.map(g =>
                    g.id === dialog.id ? { ...g, name: value } : g,
                  ),
          });
        }
        setDialog(undefined);
      });
    const open = async (row: AggregateConversation) => {
      setOpening(row.key);
      setNotice('');
      try {
        await runtime.open(row);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : String(error));
      } finally {
        setOpening(current => (current === row.key ? '' : current));
      }
    };
    return (
      <aside
        className="account-sidebar conversation-sidebar"
        aria-label="聚合会话"
      >
        <header className="conversation-sidebar__header">
          <strong>聚合会话</strong>
          <button type="button" onClick={onBack}>
            ‹ 返回账户列表
          </button>
        </header>
        <input
          className="conversation-search"
          aria-label="搜索聚合会话"
          placeholder="昵称 / 客户备注 / 手机号 / 账号备注"
          value={search}
          onChange={event => {
            setSearch(event.target.value);
            reset();
          }}
        />
        <div className="conversation-filters" aria-label="会话类型">
          {[
            ['all', '所有'],
            ['private', '私聊'],
            ['group', '群聊'],
            ['archived', '已归档'],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={kind === id}
              onClick={() => {
                setKind(id);
                reset();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="conversation-filters"
          aria-label="会话状态"
          title="未回：最后一条消息来自对方；已读未回：未回且没有未读消息"
        >
          {[
            ['all', '所有'],
            ['unread', '未读'],
            ['unreplied', '未回'],
            ['read-unreplied', '已读未回'],
          ].map(([id, label]) => (
            <button
              type="button"
              key={id}
              aria-pressed={status === id}
              onClick={() => {
                setStatus(id);
                reset();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="conversation-accounts">
          <select
            aria-label="筛选所属账号"
            value={account}
            onChange={event => {
              setAccount(event.target.value);
              reset();
            }}
          >
            <option value="all">全部账号</option>
            {stores.services.all
              .filter(service => service.recipe.id === 'whatsapp')
              .map(service => (
                <option key={service.id} value={service.id}>
                  {stores.settings.app.accountSidebar?.accounts?.[service.id]
                    ?.remark ||
                    service.accountSnapshot.nickname ||
                    service.name}
                </option>
              ))}
          </select>
          <button
            type="button"
            disabled={runtime.refreshing}
            onClick={() => void runtime.refresh()}
          >
            刷新
          </button>
        </div>
        <div className="conversation-summary" role="status">
          {runtime.refreshing
            ? `正在读取 ${runtime.checked}/${runtime.total} 个账号`
            : `${visible.length} 个会话`}
          {runtime.errors.size > 0 && (
            <details>
              <summary>{runtime.errors.size} 个账号待同步</summary>
              {[...runtime.errors].map(([id, error]) => (
                <div key={id}>
                  {stores.services.all.find(service => service.id === id)?.name}
                  ：{error}
                </div>
              ))}
            </details>
          )}
        </div>
        {notice && (
          <div className="account-sidebar__notice" role="alert">
            {notice}
            <button
              type="button"
              aria-label="关闭提示"
              onClick={() => setNotice('')}
            >
              ×
            </button>
          </div>
        )}
        <div
          className="conversation-list"
          ref={list}
          onScroll={event => setScroll(event.currentTarget.scrollTop)}
        >
          <div
            className="conversation-list__canvas"
            style={{ height: totalHeight, position: 'relative' }}
          >
            {displayed.map(entry => {
              const group = config.groups.find(
                item => item.id === entry.group,
              )!;
              if (!entry.row)
                return (
                  <div
                    key={`group:${entry.group}`}
                    className="conversation-group"
                    style={{ top: entry.top, height: entry.height }}
                  >
                    <button
                      type="button"
                      aria-expanded={!group.collapsed}
                      onClick={() =>
                        void perform(() =>
                          save({
                            ...config,
                            groups: config.groups.map(g =>
                              g.id === group.id
                                ? { ...g, collapsed: !g.collapsed }
                                : g,
                            ),
                          }),
                        )
                      }
                    >
                      {group.collapsed ? '▸' : '▾'} {group.name} (
                      {
                        visible.filter(
                          row => conversationGroup(config, row) === group.id,
                        ).length
                      }
                      )
                    </button>
                    <button
                      type="button"
                      aria-label="新增会话分组"
                      disabled={busy}
                      onClick={() =>
                        setDialog({ kind: 'create', id: '', value: '' })
                      }
                    >
                      ＋
                    </button>
                    <button
                      type="button"
                      aria-label={`${group.name}分组菜单`}
                      onClick={event =>
                        setMenu({ id: group.id, anchor: event.currentTarget })
                      }
                    >
                      ⋮
                    </button>
                  </div>
                );
              const { row } = entry;
              const avatar = runtime.avatars.get(row.key);
              return (
                <div
                  className={`conversation-row ${opening === row.key ? 'is-opening' : ''}`}
                  key={row.key}
                  data-conversation-key={row.key}
                  style={{ top: entry.top, height: entry.height }}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${row.remark || row.name} · ${row.accountRemark || row.accountName}`}
                    checked={selected.has(row.key)}
                    onChange={() =>
                      setSelected(current => {
                        const next = new Set(current);
                        if (next.has(row.key)) next.delete(row.key);
                        else next.add(row.key);
                        return next;
                      })
                    }
                  />
                  <button
                    type="button"
                    className="conversation-row__open"
                    aria-label={`打开 ${row.remark || row.name} · ${row.accountRemark || row.accountName}`}
                    onClick={() => void open(row)}
                  >
                    <span className="conversation-row__avatar">
                      {avatar ? (
                        <img src={avatar} alt="" />
                      ) : (
                        (row.remark || row.name).slice(0, 2)
                      )}
                      {row.unread > 0 && (
                        <b>{row.unread > 99 ? '99+' : row.unread}</b>
                      )}
                    </span>
                    <span className="conversation-row__content">
                      <span className="conversation-row__title">
                        {row.remark || row.name}
                        <time>{formatTime(row.timestamp)}</time>
                      </span>
                      <span className="conversation-row__preview">
                        {row.archived ? '[已归档] ' : ''}
                        {row.lastFromMe ? '你：' : ''}
                        {row.preview || row.phone || '暂无消息'}
                      </span>
                      <span className="conversation-row__account">
                        <Icon icon={mdiAccountOutline} />{' '}
                        {row.accountRemark || row.accountName}
                      </span>
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          {!runtime.refreshing && visible.length === 0 && (
            <p className="conversation-empty">
              {all.length > 0
                ? '没有符合条件的会话'
                : '等待已登录账号的联系人和会话同步。休眠账号不会被自动唤醒。'}
            </p>
          )}
        </div>
        <footer className="conversation-toolbar">
          <label htmlFor={selectAllId}>
            <input
              type="checkbox"
              id={selectAllId}
              aria-label="全选当前结果"
              checked={visible.length > 0 && chosen.length === visible.length}
              onChange={() =>
                setSelected(
                  chosen.length === visible.length
                    ? new Set()
                    : new Set(visible.map(row => row.key)),
                )
              }
            />
            全选
          </label>
          <span>已选 {chosen.length}</span>
          <button
            type="button"
            disabled={chosen.length === 0 || busy}
            onClick={() =>
              setDialog({ kind: 'move', id: '', value: 'default' })
            }
          >
            移动分组
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => setBulk(true)}
          >
            群发
          </button>
        </footer>
        <Menu
          open={Boolean(menu)}
          anchorEl={menu?.anchor}
          onClose={() => setMenu(undefined)}
        >
          <MenuItem
            disabled={menu?.id === 'default'}
            onClick={() => {
              if (menu)
                setDialog({
                  kind: 'rename',
                  id: menu.id,
                  value: config.groups.find(g => g.id === menu.id)?.name || '',
                });
              setMenu(undefined);
            }}
          >
            重命名分组
          </MenuItem>
          <MenuItem
            disabled={menu?.id === 'default'}
            onClick={() => {
              if (menu) setDialog({ kind: 'delete', id: menu.id, value: '' });
              setMenu(undefined);
            }}
          >
            删除分组
          </MenuItem>
        </Menu>
        <Dialog
          open={Boolean(dialog)}
          onClose={() => {
            if (!busy) setDialog(undefined);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle>
            {dialog?.kind === 'move'
              ? '移动到分组'
              : dialog?.kind === 'delete'
                ? '删除分组'
                : dialog?.kind === 'rename'
                  ? '重命名分组'
                  : '新增分组'}
          </DialogTitle>
          <DialogContent>
            {dialog?.kind === 'delete' ? (
              <p>
                只删除本软件的分组，其中会话将回到默认分组，不删除联系人或聊天。
              </p>
            ) : dialog?.kind === 'move' ? (
              <select
                aria-label="目标会话分组"
                value={dialog.value}
                onChange={event =>
                  setDialog({ ...dialog, value: event.target.value })
                }
              >
                {config.groups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            ) : (
              dialog && (
                <TextField
                  autoFocus
                  fullWidth
                  label="分组名称"
                  value={dialog.value}
                  inputProps={{ maxLength: 60 }}
                  onChange={event =>
                    setDialog({ ...dialog, value: event.target.value })
                  }
                />
              )
            )}
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setDialog(undefined)}>
              取消
            </Button>
            <Button disabled={busy} onClick={submitDialog}>
              确定
            </Button>
          </DialogActions>
        </Dialog>
        {bulk && (
          <BulkSend
            stores={stores}
            initialRecipients={chosen.map(row => ({
              id: row.id,
              accountId: row.accountId,
              ownerId:
                row.ownerAliases.find(id => {
                  const snapshot = stores.services.all.find(
                    service => service.id === row.accountId,
                  )?.accountSnapshot;
                  return (
                    id === snapshot?.ownerId || snapshot?.ownerIds?.includes(id)
                  );
                }) || row.owner,

              name: row.remark || row.name,
              group: row.group,
              archived: row.archived,
              contactOnly: row.contactOnly,
            }))}
            onClose={() => setBulk(false)}
          />
        )}
      </aside>
    );
  },
);
export default ConversationSidebar;
