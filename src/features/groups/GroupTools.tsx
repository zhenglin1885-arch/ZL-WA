/* eslint-disable no-void -- Event handlers report asynchronous failures in the dialog. */
import {
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { observer } from 'mobx-react';
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import type { RealStores } from '../../stores';
import { normalizeAccountConfig } from '../accounts/state';
import { getGroupRuntime } from './runtime';
import {
  parseGroupLinks,
  type GroupChoice,
  type GroupMode,
  type GroupOperation,
  type GroupTarget,
} from './types';

const names = {
  speech: '批量禁言 / 开启发言',
  join: '批量进群',
  leave: '批量退群',
};
const statuses = {
  queued: '等待执行',
  running: '处理中',
  success: '成功',
  failed: '失败',
  uncertain: '未确认',
  approval: '等待审批',
  stopped: '已停止',
};
const operations = {
  open: '开启发言',
  mute: '全员禁言',
  join: '进群',
  leave: '退群',
};
export default observer(function GroupTools({
  stores,
  mode,
  onClose,
}: {
  stores: RealStores;
  mode: GroupMode;
  onClose: () => void;
}) {
  const uid = useId();
  const runtime = getGroupRuntime(stores);
  const { queue } = runtime;
  const [, redraw] = useReducer(n => n + 1, 0);
  const [accounts, setAccounts] = useState<string[]>(() => [
    ...new Set(
      queue.state.batches
        .find(b => b.mode === mode)
        ?.tasks.map(t => t.accountId) || [],
    ),
  ]);
  const [groups, setGroups] = useState<GroupChoice[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [speechFilter, setSpeechFilter] = useState('');
  const [links, setLinks] = useState('');
  const [interval, setInterval] = useState(queue.state.intervals[mode]);
  const [deleteGroup, setDeleteGroup] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshingAccounts, setRefreshingAccounts] = useState(false);
  const [accountNotice, setAccountNotice] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [confirm, setConfirm] = useState<GroupTarget[]>();
  const [recordId, setRecordId] = useState('');
  const wasActive = useRef(Boolean(queue.active));
  const config = normalizeAccountConfig(stores.settings.app.accountSidebar);
  const online = stores.services.all.filter(
    s =>
      s.recipe.id === 'whatsapp' &&
      s.isEnabled &&
      !s.isHibernating &&
      s.accountSnapshot.status === 'online' &&
      s.webview &&
      s.accountSnapshot.ownerId,
  );
  const accountTargets = online.map(s => ({
    accountId: s.id,
    ownerId: s.accountSnapshot.ownerId!,
    accountName:
      config.accounts[s.id]?.remark ||
      config.accounts[s.id]?.nickname ||
      s.accountSnapshot.nickname ||
      s.name,
  }));
  const chosen = accountTargets.filter(a => accounts.includes(a.accountId));
  const chosenKey = JSON.stringify(chosen);
  useEffect(() => {
    let mounted = true;
    const change = () => {
      if (!mounted) return;
      redraw();
      if (
        queue.active &&
        queue.state.batches.find(b => b.id === queue.active)?.mode === mode
      )
        setRecordId(queue.active);
      if (wasActive.current && !queue.active) setRefresh(n => n + 1);
      wasActive.current = Boolean(queue.active);
    };
    queue.listeners.add(change);
    void queue
      .load()
      .then(() => {
        if (mounted) setInterval(queue.state.intervals[mode]);
      })
      .catch(error => {
        if (mounted) setNotice(String(error));
      });
    return () => {
      mounted = false;
      queue.listeners.delete(change);
    };
  }, [queue, mode]);
  useEffect(() => {
    let cancelled = false;
    const targets: typeof chosen = JSON.parse(chosenKey);
    setGroups([]);
    setSelected([]);
    if (mode === 'join' || targets.length === 0) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setNotice('');
    void Promise.allSettled(targets.map(a => runtime.list(a))).then(results => {
      if (cancelled) return;
      setGroups(
        results.flatMap(r => (r.status === 'fulfilled' ? r.value : [])),
      );
      setNotice(
        results
          .flatMap((r, i) =>
            r.status === 'rejected'
              ? [`${targets[i].accountName}：${String(r.reason)}`]
              : [],
          )
          .join('\n'),
      );
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, chosenKey, refresh, mode]);
  const key = (g: GroupChoice) => `${g.accountId}:${g.ownerId}:${g.target}`;
  const visibleAccounts = online.filter(s =>
    [
      s.accountSnapshot.nickname,
      s.accountSnapshot.phone,
      s.id,
      config.accounts[s.id]?.remark,
      config.accounts[s.id]?.nickname,
    ].some(v => v?.toLowerCase().includes(accountSearch.toLowerCase())),
  );
  const visibleGroups = groups.filter(
    g =>
      (mode !== 'speech' || g.admin) &&
      (!accountFilter || g.accountId === accountFilter) &&
      (!speechFilter || (speechFilter === 'mute') === g.announce) &&
      `${g.name} ${g.target}`.toLowerCase().includes(groupSearch.toLowerCase()),
  );
  const batch =
    queue.state.batches.find(b => b.mode === mode && b.id === recordId) ||
    queue.state.batches.find(b => b.mode === mode);
  const active = Boolean(queue.active);
  const validInterval =
    Number.isFinite(interval) && interval >= 1 && interval <= 3600;
  const targets = () =>
    mode === 'join'
      ? chosen.flatMap(a =>
          parseGroupLinks(links).map(code => ({
            ...a,
            target: code,
            name: `https://chat.whatsapp.com/${code}`,
          })),
        )
      : groups.filter(
          g =>
            selected.includes(key(g)) &&
            chosen.some(
              a => a.accountId === g.accountId && a.ownerId === g.ownerId,
            ),
        );
  const start = (operation: GroupOperation) => {
    try {
      setNotice('');
      const items = targets();
      if (items.length === 0)
        throw new Error(
          mode === 'join'
            ? '请选择已登录账号并填写群链接'
            : '请选择要执行的群组',
        );
      if (operation === 'leave') {
        setConfirm(items);
        return;
      }
      void queue
        .start(operation, items, interval, deleteGroup)
        .catch(error => setNotice(String(error)));
    } catch (error) {
      setNotice(String(error));
    }
  };
  const refreshAccounts = async () => {
    setRefreshingAccounts(true);
    setAccountNotice('正在刷新账号状态…');
    try {
      const result = await runtime.refreshAccounts();
      setAccountNotice(
        `已刷新 ${result.refreshed} 个账号${result.failed ? `，${result.failed} 个读取失败，请稍后重试` : ''}`,
      );
      setRefresh(n => n + 1);
    } catch (error) {
      setAccountNotice(`刷新账号失败：${String(error)}`);
    } finally {
      setRefreshingAccounts(false);
    }
  };
  const closePointer = (event: React.PointerEvent) => {
    if (event.button === 0) {
      event.preventDefault();
      onClose();
    }
  };
  return (
    <>
      <Dialog
        open
        maxWidth={false}
        className="group-tools-dialog account-tools-dialog"
        onClose={onClose}
        aria-labelledby="group-tools-title"
      >
        <DialogTitle id="group-tools-title">
          {names[mode]}
          <button
            type="button"
            className="group-tools-close"
            aria-label="关闭群组窗口"
            onPointerDown={closePointer}
            onClick={onClose}
          >
            ×
          </button>
        </DialogTitle>
        <DialogContent className="group-tools-columns">
          <section className="group-tools-accounts">
            <h3>
              选择 WhatsApp 账号{' '}
              <button
                type="button"
                aria-label="刷新账号列表"
                title="刷新账号状态"
                disabled={refreshingAccounts || active}
                onClick={() => {
                  void refreshAccounts();
                }}
              >
                ↻
              </button>
            </h3>
            <p>显示已登录账号，支持多选</p>
            {accountNotice && <p role="status">{accountNotice}</p>}
            <input
              aria-label="搜索账号"
              placeholder="搜索号码、昵称、备注"
              value={accountSearch}
              onChange={e => setAccountSearch(e.target.value)}
            />
            <label
              className="group-tools-check"
              htmlFor={`${uid}-accounts-all`}
            >
              <input
                id={`${uid}-accounts-all`}
                type="checkbox"
                disabled={active}
                checked={
                  visibleAccounts.length > 0 &&
                  visibleAccounts.every(s => accounts.includes(s.id))
                }
                onChange={e =>
                  setAccounts(
                    e.target.checked
                      ? [
                          ...new Set([
                            ...accounts,
                            ...visibleAccounts.map(s => s.id),
                          ]),
                        ]
                      : accounts.filter(
                          id => !visibleAccounts.some(s => s.id === id),
                        ),
                  )
                }
              />
              全部（{chosen.length}/{online.length}）
            </label>
            <div className="group-tools-list">
              {visibleAccounts.map(s => (
                <label
                  className="group-tools-check group-tools-account"
                  key={s.id}
                  data-account-id={s.id}
                  htmlFor={`${uid}-account-${s.id}`}
                >
                  <input
                    type="checkbox"
                    id={`${uid}-account-${s.id}`}
                    disabled={active}
                    checked={accounts.includes(s.id)}
                    onChange={e =>
                      setAccounts(
                        e.target.checked
                          ? [...accounts, s.id]
                          : accounts.filter(id => id !== s.id),
                      )
                    }
                  />
                  <span className="group-tools-avatar">
                    {s.accountSnapshot.avatar ? (
                      <img src={s.accountSnapshot.avatar} alt="" />
                    ) : (
                      (s.accountSnapshot.nickname || s.name).slice(0, 1)
                    )}
                  </span>
                  <span>
                    <strong>{s.accountSnapshot.nickname || s.name}</strong>
                    <small>{s.accountSnapshot.phone}</small>
                    <small>
                      {config.accounts[s.id]?.remark || '暂无账户备注'}
                    </small>
                  </span>
                </label>
              ))}
              {online.length === 0 && <p>暂无可执行的已登录 WhatsApp 账号</p>}
            </div>
          </section>
          <section className="group-tools-selection">
            <h3>{mode === 'join' ? '群邀请链接' : '选择群组'}</h3>
            {mode === 'join' ? (
              <>
                <p>
                  可粘贴邀请消息或群链接；每个选中账号加入全部链接，重复链接自动合并。
                </p>
                <textarea
                  aria-label="群邀请链接"
                  placeholder="粘贴邀请消息或群链接，支持一行一条"
                  disabled={active}
                  value={links}
                  onChange={e => setLinks(e.target.value)}
                />
              </>
            ) : (
              <>
                <p>
                  {mode === 'speech'
                    ? '只显示当前账号可管理的群组'
                    : '选择需要退出的群组，按账号分别执行'}
                </p>
                <button
                  type="button"
                  className="group-tools-refresh"
                  aria-label="刷新群组"
                  disabled={
                    active ||
                    loading ||
                    refreshingAccounts ||
                    chosen.length === 0
                  }
                  onClick={() => setRefresh(n => n + 1)}
                >
                  {loading ? '正在刷新群组…' : '刷新群组'}
                </button>
                <div className="group-tools-filters">
                  <select
                    aria-label="筛选群组所属账号"
                    value={accountFilter}
                    onChange={e => setAccountFilter(e.target.value)}
                  >
                    <option value="">全部账号</option>
                    {chosen.map(a => (
                      <option key={a.accountId} value={a.accountId}>
                        {a.accountName}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="搜索群组"
                    placeholder="搜索群名 / 群编号"
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                  />
                </div>
                {mode === 'speech' && (
                  <div className="group-tools-tabs">
                    {[
                      ['', '全部'],
                      ['open', '已开启发言'],
                      ['mute', '仅管理员发言'],
                    ].map(([value, label]) => (
                      <button
                        type="button"
                        key={value}
                        aria-pressed={speechFilter === value}
                        onClick={() => setSpeechFilter(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                <label
                  className="group-tools-check"
                  htmlFor={`${uid}-groups-all`}
                >
                  <input
                    id={`${uid}-groups-all`}
                    type="checkbox"
                    disabled={active || loading}
                    checked={
                      visibleGroups.length > 0 &&
                      visibleGroups.every(g => selected.includes(key(g)))
                    }
                    onChange={e =>
                      setSelected(
                        e.target.checked
                          ? [
                              ...new Set([
                                ...selected,
                                ...visibleGroups.map(g => key(g)),
                              ]),
                            ]
                          : selected.filter(
                              id => !visibleGroups.some(g => key(g) === id),
                            ),
                      )
                    }
                  />
                  全部（{selected.length}/{visibleGroups.length}）
                </label>
                <div className="group-tools-list">
                  {loading ? (
                    <p role="status">正在读取并核验群组…</p>
                  ) : (
                    visibleGroups.map(g => (
                      <label
                        className="group-tools-check group-tools-group"
                        key={key(g)}
                        data-account-id={g.accountId}
                        data-group-id={g.target}
                        htmlFor={`${uid}-group-${key(g)}`}
                      >
                        <input
                          type="checkbox"
                          id={`${uid}-group-${key(g)}`}
                          disabled={active}
                          checked={selected.includes(key(g))}
                          onChange={e =>
                            setSelected(
                              e.target.checked
                                ? [...selected, key(g)]
                                : selected.filter(id => id !== key(g)),
                            )
                          }
                        />
                        <span>
                          <strong>{g.name}</strong>
                          <small>
                            {g.accountName} · {g.target}
                          </small>
                          <small>
                            {g.announce ? '仅管理员可发言' : '所有成员可发言'}
                          </small>
                        </span>
                      </label>
                    ))
                  )}
                  {!loading && visibleGroups.length === 0 && (
                    <p>
                      {chosen.length === 0
                        ? '请先选择 WhatsApp 账号，再点击刷新群组'
                        : '暂无符合条件的群组，可点击刷新群组重试'}
                    </p>
                  )}
                </div>
              </>
            )}
          </section>
          <section className="group-tools-results">
            <h3>
              {mode === 'join'
                ? '进群结果'
                : mode === 'leave'
                  ? '退群设置与结果'
                  : '操作面板'}
            </h3>
            <label htmlFor={`${uid}-interval`}>
              执行间隔（秒）
              <input
                type="number"
                id={`${uid}-interval`}
                min="1"
                max="3600"
                aria-label="群组执行间隔"
                disabled={active}
                value={interval}
                onChange={e => setInterval(Number(e.target.value))}
                onBlur={() => {
                  if (validInterval)
                    void queue
                      .setInterval(mode, interval)
                      .catch(error => setNotice(String(error)));
                }}
              />
            </label>
            {mode === 'leave' && (
              <>
                <label className="group-tools-check" htmlFor={`${uid}-delete`}>
                  <input
                    type="checkbox"
                    id={`${uid}-delete`}
                    disabled={active}
                    checked={deleteGroup}
                    onChange={e => setDeleteGroup(e.target.checked)}
                  />
                  退出后删除群组聊天（默认）
                </label>
                <p>删除会清除所选账号本机的群聊天记录。</p>
              </>
            )}
            <div className="group-tools-actions">
              {mode === 'speech' ? (
                <>
                  <Button
                    variant="contained"
                    disabled={
                      active ||
                      loading ||
                      selected.length === 0 ||
                      !validInterval
                    }
                    onClick={() => start('open')}
                  >
                    开启发言
                  </Button>
                  <Button
                    variant="contained"
                    color="warning"
                    disabled={
                      active ||
                      loading ||
                      selected.length === 0 ||
                      !validInterval
                    }
                    onClick={() => start('mute')}
                  >
                    全员禁言
                  </Button>
                </>
              ) : (
                <Button
                  variant="contained"
                  disabled={
                    active ||
                    loading ||
                    chosen.length === 0 ||
                    !validInterval ||
                    (mode === 'leave' ? selected.length === 0 : !links.trim())
                  }
                  onClick={() => start(mode)}
                >
                  {mode === 'join' ? '开始进群' : '开始退群'}
                </Button>
              )}
              <Button
                disabled={
                  active ||
                  !validInterval ||
                  !batch?.tasks.some(t =>
                    ['failed', 'uncertain', 'stopped'].includes(t.status),
                  )
                }
                onClick={() => {
                  if (batch)
                    void queue
                      .retry(batch.id, interval)
                      .catch(error => setNotice(String(error)));
                }}
              >
                重试失败 / 核验未确认
              </Button>
            </div>
            <Button
              disabled={active || !batch}
              onClick={() => {
                if (batch)
                  void queue
                    .reconcile(batch.id)
                    .catch(error => setNotice(String(error)));
              }}
            >
              刷新执行结果
            </Button>
            <p>
              {mode === 'join'
                ? '全部群先执行一次，首轮结束后再将确认未加入的失败项重试一次。等待管理员审批的申请不重复提交。'
                : '逐个执行并核验，每项最多自动执行 3 次。'}
            </p>
            {batch && (
              <label htmlFor={`${uid}-history`}>
                任务记录
                <select
                  id={`${uid}-history`}
                  aria-label="群组任务记录"
                  value={batch.id}
                  onChange={e => setRecordId(e.target.value)}
                >
                  {queue.state.batches
                    .filter(b => b.mode === mode)
                    .map(b => (
                      <option value={b.id} key={b.id}>
                        {new Date(b.created).toLocaleString()} ·{' '}
                        {operations[b.tasks[0]?.operation]} · {b.tasks.length}{' '}
                        项
                      </option>
                    ))}
                </select>
              </label>
            )}
            {batch && (
              <>
                <div
                  className={`group-tools-counts ${mode === 'join' ? 'has-approval' : ''}`}
                >
                  {(
                    (mode === 'join'
                      ? ['success', 'failed', 'uncertain', 'approval']
                      : [
                          'success',
                          'failed',
                          'uncertain',
                        ]) as (keyof typeof statuses)[]
                  ).map(status => (
                    <span key={status} className={`group-tools-${status}`}>
                      {statuses[status]}
                      <strong>
                        {batch.tasks.filter(t => t.status === status).length}
                      </strong>
                    </span>
                  ))}
                </div>
                <p>
                  本次 {batch.tasks.length} 项 · 已处理{' '}
                  {
                    batch.tasks.filter(
                      t => !['queued', 'running'].includes(t.status),
                    ).length
                  }{' '}
                  项{queue.active === batch.id ? ' · 执行中' : ''}
                </p>
              </>
            )}
            <p className="group-tools-notice" role="status">
              {notice || queue.error}
              {active && queue.active !== batch?.id
                ? '另一个群组任务正在执行，请等待完成或停止。'
                : ''}
            </p>
            <div
              className="group-tools-list group-tools-log"
              aria-live="polite"
            >
              {batch?.tasks.map(t => (
                <article
                  key={t.id}
                  data-task-id={t.id}
                  data-task-status={t.status}
                >
                  <strong>
                    {t.accountName} · {t.name}
                  </strong>
                  <span className={`group-tools-${t.status}`}>
                    {operations[t.operation]} · {statuses[t.status]} · 执行{' '}
                    {t.attempts} 次
                  </span>
                  <p>{t.message}</p>
                </article>
              ))}
              {!batch && <p>暂无执行记录</p>}
            </div>
          </section>
        </DialogContent>
        <DialogActions>
          {active && <p>关闭窗口后继续执行；停止会等待当前请求结束。</p>}
          {active && (
            <Button
              color="warning"
              onClick={() => queue.stop()}
              disabled={queue.stopped}
            >
              {queue.stopped ? '正在停止…' : '停止执行'}
            </Button>
          )}
          <Button onPointerDown={closePointer} onClick={onClose}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(confirm)}
        className="account-dialog"
        onClose={() => setConfirm(undefined)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          确认{deleteGroup ? '退出并删除群组' : '退出群组'}
        </DialogTitle>
        <DialogContent>
          <p>
            将对 {confirm?.length || 0} 个群组执行退群
            {deleteGroup ? '并删除本机群聊天记录' : ''}
            。请确认选中的账号和群组。
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(undefined)}>取消</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              const items = confirm;
              setConfirm(undefined);
              if (items)
                void queue
                  .start('leave', items, interval, deleteGroup)
                  .catch(error => setNotice(String(error)));
            }}
          >
            确认{deleteGroup ? '退出并删除' : '退出'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
});
