/* eslint-disable no-void, no-continue -- UI operations report failures in the panel notice. */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  useCallback,
} from 'react';
import { observer } from 'mobx-react';
import {
  mdiAccountOutline,
  mdiEmailOpenOutline,
  mdiPencilOutline,
  mdiDeleteOutline,
} from '@mdi/js';
import { Popover, Menu, MenuItem } from '@mui/material';
import Icon from '../../components/ui/icon';
import type { RealStores } from '../../stores';
import BulkSend from '../accountTools/BulkSend';
import CustomerFlagIcon from '../customers/CustomerFlagIcon';
import { customerFlagNames, type CustomerFlag } from '../customers/types';
import { getConversationRuntime } from './runtime';
import {
  normalizeConversationGroups,
  conversationGroup,
  moveConversations,
  searchConversation,
  matchesConversationKind,
  expandedConversations,
  removeConversationGroup,
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
      () => getConversationRuntime(stores, activate),
      [stores, activate],
    );
    const [, render] = useState(0);
    const [search, setSearch] = useState('');
    const [kind, setKind] = useState('all');
    const [account, setAccount] = useState('all');
    const [selected, setSelected] = useState<Set<string>>(() => new Set());
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [opening, setOpening] = useState('');
    const [active, setActive] = useState('');
    const latestOpen = useRef('');
    const [menu, setMenu] = useState<{
      id: string;
      anchor: HTMLElement;
      left: number;
      top: number;
    }>();
    const [dialog, setDialog] = useState<{
      kind: 'create' | 'move' | 'rename';
      id?: string;
      anchor: HTMLElement;
      value: string;
    }>();
    const [bulk, setBulk] = useState(false);
    const selectAllId = useId();
    const focusFolderField = useCallback(
      (element: HTMLInputElement | HTMLSelectElement | null) =>
        element?.focus(),
      [],
    );
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
        runtime.pause();
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
          matchesConversationKind(row, kind) &&
          searchConversation(row, search),
      )
      .sort(
        (a, b) =>
          b.timestamp - a.timestamp ||
          a.name.localeCompare(b.name) ||
          a.key.localeCompare(b.key),
      );
    const selectable = expandedConversations(config, visible);
    const chosen = selectable.filter(row => selected.has(row.key));
    const selectionScope = JSON.stringify(selectable.map(row => row.key));
    useEffect(() => {
      setSelected(current => {
        if (current.size === 0) return current;
        const allowed = new Set<string>(JSON.parse(selectionScope));
        const next = new Set([...current].filter(key => allowed.has(key)));
        return next.size === current.size ? current : next;
      });
    }, [selectionScope]);
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
        if (dialog.kind === 'move') {
          if (chosen.length === 0) throw new Error('请先选择会话');
          if (!dialog.value) throw new Error('请选择分组');
          await save(moveConversations(config, chosen, dialog.value));
          setSelected(new Set());
        } else {
          if (
            dialog.kind === 'rename' &&
            (dialog.id === 'default' ||
              !config.groups.some(group => group.id === dialog.id))
          )
            throw new Error('该分组不能编辑');
          const value = dialog.value.trim();
          if (!value) throw new Error('请输入分组名称');
          if (config.groups.some(g => g.name === value && g.id !== dialog.id))
            throw new Error('分组名称已存在');
          await save({
            ...config,
            groups:
              dialog.kind === 'rename'
                ? config.groups.map(group =>
                    group.id === dialog.id ? { ...group, name: value } : group,
                  )
                : [
                    ...config.groups,
                    { id: crypto.randomUUID(), name: value, collapsed: false },
                  ],
          });
        }
        setDialog(undefined);
      });
    const markGroupRead = (id: string) => {
      setMenu(undefined);
      void perform(async () => {
        setNotice('正在标记该分组中的会话为已读…');
        const result = await runtime.markRead(
          all.filter(row => conversationGroup(config, row) === id),
        );
        setNotice(
          result.failed > 0
            ? `已标记 ${result.read} 个会话为已读，${result.failed} 个未完成，请检查账号连接`
            : result.read > 0
              ? `已标记 ${result.read} 个会话为已读`
              : '该分组暂无未读消息',
        );
      });
    };
    const open = async (row: AggregateConversation) => {
      latestOpen.current = row.key;
      setOpening(row.key);
      setNotice('');
      try {
        await runtime.open(row);
        if (latestOpen.current === row.key) setActive(row.key);
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
          {visible.length} 个会话
        </div>
        {notice && !dialog && (
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
                      disabled={busy}
                      onContextMenu={event => {
                        event.preventDefault();
                        if (!busy)
                          setMenu({
                            id: group.id,
                            anchor: event.currentTarget,
                            left: event.clientX,
                            top: event.clientY,
                          });
                      }}
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
                      className="conversation-group__add"
                      aria-label="新增会话分组"
                      disabled={busy}
                      onClick={event => {
                        setNotice('');
                        setDialog({
                          kind: 'create',
                          anchor: event.currentTarget,
                          value: '',
                        });
                      }}
                    >
                      ＋
                    </button>
                  </div>
                );
              const { row } = entry;
              const avatar = runtime.avatars.get(row.key);
              const title = row.name || row.phone;
              const flags = (
                Object.keys(customerFlagNames) as CustomerFlag[]
              ).filter(flag => row.flags?.includes(flag));
              const isActive =
                active === row.key &&
                stores.services.active?.id === row.accountId;
              return (
                <div
                  className={`conversation-row ${opening === row.key ? 'is-opening' : ''} ${isActive ? 'is-active' : ''} ${selected.has(row.key) ? 'is-selected' : ''}`}
                  key={row.key}
                  data-conversation-key={row.key}
                  style={{ top: entry.top, height: entry.height }}
                >
                  <input
                    type="checkbox"
                    aria-label={`选择 ${title} · ${row.accountRemark || row.accountName}`}
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
                    aria-pressed={isActive}
                    aria-label={`打开 ${title} · ${row.accountRemark || row.accountName}`}
                    onClick={() => void open(row)}
                  >
                    <span className="conversation-row__avatar">
                      {avatar ? <img src={avatar} alt="" /> : title.slice(0, 2)}
                      {row.unread > 0 && (
                        <b aria-label={`未读消息 ${row.unread} 条`}>
                          {row.unread > 99 ? '99+' : row.unread}
                        </b>
                      )}
                    </span>
                    <span className="conversation-row__content">
                      <span className="conversation-row__title">
                        <span className="conversation-row__name">{title}</span>
                        {flags.length > 0 && (
                          <span
                            className="conversation-row__flags"
                            role="img"
                            aria-label={`客户标记 ${flags.map(flag => customerFlagNames[flag]).join('、')}`}
                          >
                            {flags.map(flag => (
                              <CustomerFlagIcon key={flag} flag={flag} />
                            ))}
                          </span>
                        )}
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
                : '暂无会话，请确认账号已登录后点击刷新。'}
            </p>
          )}
        </div>
        <footer className="conversation-toolbar">
          <label htmlFor={selectAllId}>
            <input
              type="checkbox"
              id={selectAllId}
              aria-label="全选当前结果"
              checked={
                selectable.length > 0 && chosen.length === selectable.length
              }
              disabled={selectable.length === 0}
              title="全选已展开分组中的当前筛选结果"
              onChange={() =>
                setSelected(
                  chosen.length === selectable.length
                    ? new Set()
                    : new Set(selectable.map(row => row.key)),
                )
              }
            />
            全选
          </label>
          <span>已选 {chosen.length}</span>
          <button
            type="button"
            disabled={chosen.length === 0 || busy}
            onClick={event => {
              setNotice('');
              setDialog({
                kind: 'move',
                anchor: event.currentTarget,
                value: '',
              });
            }}
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
          className="account-context-menu conversation-group-menu"
          open={Boolean(menu)}
          anchorReference="anchorPosition"
          anchorPosition={menu ? { left: menu.left, top: menu.top } : undefined}
          onClose={() => setMenu(undefined)}
        >
          <MenuItem
            disabled={busy}
            onClick={() => menu && markGroupRead(menu.id)}
          >
            <Icon icon={mdiEmailOpenOutline} size={0.8} />
            全部已读
          </MenuItem>
          {menu && menu.id !== 'default' && (
            <MenuItem
              disabled={busy}
              onClick={() => {
                const group = config.groups.find(item => item.id === menu.id);
                if (group) {
                  setNotice('');
                  setDialog({
                    kind: 'rename',
                    id: group.id,
                    value: group.name,
                    anchor: menu.anchor,
                  });
                }
                setMenu(undefined);
              }}
            >
              <Icon icon={mdiPencilOutline} size={0.8} />
              编辑
            </MenuItem>
          )}
          {menu && menu.id !== 'default' && (
            <MenuItem
              disabled={busy}
              onClick={() => {
                const { id } = menu;
                setMenu(undefined);
                void perform(() => save(removeConversationGroup(config, id)));
              }}
            >
              <Icon icon={mdiDeleteOutline} size={0.8} />
              删除
            </MenuItem>
          )}
        </Menu>
        <Popover
          className="account-dialog conversation-popup"
          open={Boolean(dialog)}
          anchorEl={dialog?.anchor}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          marginThreshold={8}
          onClose={() => {
            if (!busy) setDialog(undefined);
          }}
          slotProps={{
            paper: {
              role: 'dialog',
              'aria-label':
                dialog?.kind === 'move'
                  ? '移动分组'
                  : dialog?.kind === 'rename'
                    ? '编辑分组'
                    : '新增分组',
            },
          }}
        >
          {dialog && (
            <form
              onSubmit={event => {
                event.preventDefault();
                submitDialog();
              }}
            >
              <label htmlFor={`${selectAllId}-folder`}>
                {dialog.kind === 'move'
                  ? '移动到分组'
                  : dialog.kind === 'rename'
                    ? '编辑分组名称'
                    : '新增分组'}
              </label>
              {dialog.kind === 'move' ? (
                <select
                  id={`${selectAllId}-folder`}
                  aria-label="目标会话分组"
                  value={dialog.value}
                  ref={focusFolderField}
                  disabled={busy}
                  onChange={event =>
                    setDialog({ ...dialog, value: event.target.value })
                  }
                >
                  <option value="" disabled>
                    请选择分组
                  </option>
                  {config.groups.map(group => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id={`${selectAllId}-folder`}
                  aria-label="分组名称"
                  placeholder="请输入分组名称"
                  ref={focusFolderField}
                  maxLength={60}
                  disabled={busy}
                  value={dialog.value}
                  onChange={event =>
                    setDialog({ ...dialog, value: event.target.value })
                  }
                />
              )}
              {notice && <p role="alert">{notice}</p>}
              <div className="conversation-popup__actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setDialog(undefined)}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={
                    busy ||
                    (dialog.kind === 'move' &&
                      (!dialog.value || chosen.length === 0))
                  }
                >
                  确认
                </button>
              </div>
            </form>
          )}
        </Popover>
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

              name: row.name,
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
