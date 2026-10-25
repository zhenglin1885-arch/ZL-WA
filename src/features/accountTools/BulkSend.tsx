/* eslint-disable no-void -- UI operations catch and display asynchronous errors. */
import { ipcRenderer } from 'electron';
import { observer } from 'mobx-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
} from '@mui/material';
import type { RealStores } from '../../stores';
import type { Recipient, BulkSpec, BulkMedia, BulkMessageType } from './config';
import { listRecipients } from './guest';
import { listBulkContacts } from './bulkGuest';
import { ensureBulkLibrary, getBulkQueue } from './bulkRuntime';
import { validateBulkSpec } from './BulkQueue';
import BulkHistory from './BulkHistory';
import BulkMediaPreview from './BulkMediaPreview';
import { normalizeAccountConfig } from '../accounts/state';
import { normalizeBulkPreferences } from './bulkPreferences';

const messageTypes: [BulkMessageType, string][] = [
  ['text', '文本'],
  ['image', '图片'],
  ['caption', '图文'],
  ['video', '视频'],
  ['audio', '语音'],
  ['contact', '名片'],
  ['document', '文件'],
];
const BulkSend = observer(
  ({ stores, onClose }: { stores: RealStores; onClose: () => void }) => {
    const queue = getBulkQueue(stores);
    const [, render] = useState(0);
    const [creating, setCreating] = useState(false);
    const [accounts, setAccounts] = useState<string[]>([]);
    const [recipients, setRecipients] = useState<Recipient[]>([]);
    const [selected, setSelected] = useState<string[]>([]);
    const [kind, setKind] = useState('all');
    const [search, setSearch] = useState('');
    const [accountSearch, setAccountSearch] = useState('');
    const [recipientAccount, setRecipientAccount] = useState('all');
    const [text, setText] = useState('');
    const [type, setType] = useState<BulkMessageType>('text');
    const [media, setMedia] = useState<BulkMedia>();
    const [contactName, setContactName] = useState('');
    const [contactPhone, setContactPhone] = useState('');
    const [scheduled, setScheduled] = useState(false);
    const [scheduledAt, setScheduledAt] = useState('');
    const [randomInterval, setRandomInterval] = useState(false);
    const [intervalMin, setIntervalMin] = useState(1.5);
    const [intervalMax, setIntervalMax] = useState(3);
    const [typingSeconds, setTypingSeconds] = useState(0);
    const [mentionAll, setMentionAll] = useState(false);
    const [failure, setFailure] = useState<'stop' | 'continue'>('stop');
    const [notice, setNotice] = useState('');
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [confirm, setConfirm] = useState<BulkSpec>();
    const generation = useRef(0);
    const [preferencesReady, setPreferencesReady] = useState(false);
    const pendingPreferences =
      useRef<ReturnType<typeof normalizeBulkPreferences>>();
    useEffect(() => {
      let mounted = true;
      void ipcRenderer
        .invoke('account-tools-bulk-preferences')
        .then(value => {
          if (!mounted) return;
          const prefs = normalizeBulkPreferences(value);
          setType(prefs.type);
          setScheduled(prefs.scheduled);
          setRandomInterval(prefs.randomInterval);
          setIntervalMin(prefs.intervalMin);
          setIntervalMax(prefs.intervalMax);
          setTypingSeconds(prefs.typingSeconds);
          setMentionAll(prefs.mentionAll);
          setFailure(prefs.failure);
          setKind(prefs.kind);
          setPreferencesReady(true);
        })
        .catch(() => {
          if (mounted) {
            setPreferencesReady(true);
            setNotice('群发设置读取失败，暂时使用默认值');
          }
        });
      return () => {
        mounted = false;
        if (pendingPreferences.current)
          void ipcRenderer
            .invoke(
              'account-tools-bulk-preferences',
              pendingPreferences.current,
            )
            .catch(() => {});
      };
    }, []);
    useEffect(() => {
      if (!preferencesReady) return () => {};
      const prefs = normalizeBulkPreferences({
        type,
        scheduled,
        randomInterval,
        intervalMin,
        intervalMax,
        typingSeconds,
        mentionAll,
        failure,
        kind,
      });
      pendingPreferences.current = prefs;
      const timer = setTimeout(() => {
        void ipcRenderer
          .invoke('account-tools-bulk-preferences', prefs)
          .then(() => {
            if (pendingPreferences.current === prefs)
              pendingPreferences.current = undefined;
          })
          .catch(() => setNotice('群发设置保存失败，请检查数据目录后重试'));
      }, 300);
      return () => clearTimeout(timer);
    }, [
      preferencesReady,
      type,
      scheduled,
      randomInterval,
      intervalMin,
      intervalMax,
      typingSeconds,
      mentionAll,
      failure,
      kind,
    ]);
    const profiles = normalizeAccountConfig(
      stores.settings.app.accountSidebar,
    ).accounts;
    const { activeIds } = queue;
    const running = activeIds.size > 0;
    const disabled = loading || submitting || !preferencesReady;
    const online = stores.services.all.filter(
      s =>
        s.recipe.id === 'whatsapp' &&
        s.isEnabled &&
        !s.isHibernating &&
        s.accountSnapshot.status === 'online' &&
        s.webview,
    );
    const displayName = (s: (typeof online)[number]) =>
      profiles[s.id]?.nickname || s.accountSnapshot.nickname || s.name;
    const visibleAccounts = online.filter(s =>
      `${s.id} ${displayName(s)} ${s.accountSnapshot.phone} ${profiles[s.id]?.remark ?? ''}`
        .toLowerCase()
        .includes(accountSearch.trim().toLowerCase()),
    );
    const key = (r: Recipient) => `${r.accountId}:${r.id}`;
    const eligible = recipients.filter(
      r =>
        accounts.includes(r.accountId) &&
        online.some(s => s.id === r.accountId),
    );
    const visible = eligible.filter(
      r =>
        (recipientAccount === 'all' || r.accountId === recipientAccount) &&
        (kind === 'all' ||
          kind === 'contact' ||
          (kind === 'archived'
            ? r.archived
            : r.group === (kind === 'group'))) &&
        `${r.name} ${r.id}`.toLowerCase().includes(search.trim().toLowerCase()),
    );
    const chosen = eligible.filter(r => selected.includes(key(r)));
    useEffect(() => {
      const changed = () => render(n => n + 1);
      queue.listeners.add(changed);
      queue.start();
      void queue
        .load()
        .then(changed)
        .catch(error => setNotice(String(error)));
      return () => {
        queue.listeners.delete(changed);
        generation.current += 1;
      };
    }, [queue]);
    const refresh = async (source = kind) => {
      generation.current += 1;
      const { current } = generation;
      setLoading(true);
      setNotice('');
      setRecipients([]);
      setSelected([]);
      try {
        const results = await Promise.all(
          accounts.map(async id => {
            const service = online.find(s => s.id === id);
            if (!service?.webview) throw new Error('账号已离线，请重新选择');
            if (source === 'contact') await ensureBulkLibrary(service.webview);
            const fn = source === 'contact' ? listBulkContacts : listRecipients;
            const items = await service.webview.executeJavaScript(
              `(${fn.toString()})()`,
            );
            return items.map(r => ({ ...r, accountId: id }));
          }),
        );
        if (generation.current === current) setRecipients(results.flat());
      } catch (error) {
        if (generation.current === current) setNotice(String(error));
      } finally {
        if (generation.current === current) setLoading(false);
      }
    };
    const toggleAccount = (id: string, checked: boolean) => {
      generation.current += 1;
      setLoading(false);
      setAccounts(current =>
        checked ? [...current, id] : current.filter(a => a !== id),
      );
      setRecipients([]);
      setSelected([]);
      setRecipientAccount('all');
    };
    const pickMedia = async () => {
      try {
        const value = await ipcRenderer.invoke(
          'account-tools-media-pick',
          type,
        );
        if (value) setMedia(value);
      } catch (error) {
        setNotice(String(error));
      }
    };
    const prepare = () => {
      try {
        const spec: BulkSpec = {
          type,
          text: ['image', 'audio', 'contact'].includes(type) ? '' : text,
          media,
          contactName,
          contactPhone: contactPhone.replace(/^\+/, ''),
          targets: chosen,
          scheduledAt: scheduled
            ? scheduledAt
              ? new Date(scheduledAt).toISOString()
              : ''
            : undefined,
          intervalMin,
          intervalMax: randomInterval ? intervalMax : intervalMin,
          typingSeconds,
          mentionAll,
          failure,
        };
        if (scheduled && !scheduledAt) throw new Error('请选择发送时间');
        validateBulkSpec(spec);
        setConfirm(spec);
        setNotice('');
      } catch (error) {
        setNotice(String(error));
      }
    };
    const submit = async () => {
      if (!confirm || submitting) return;
      const spec = confirm;
      setConfirm(undefined);
      setSubmitting(true);
      setNotice('');
      setCreating(false);
      try {
        await queue.submit(spec, true);
      } catch (error) {
        setNotice(String(error));
      } finally {
        setSubmitting(false);
      }
    };
    // Close on the primary mouse press as well as click/keyboard activation.
    // Regaining window focus (for example after a Windows toast) can interrupt
    // the later click event; this dismissal must not depend on that event.
    const closeFromPointer = (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    return (
      <Dialog
        open
        maxWidth={false}
        fullWidth
        scroll="paper"
        aria-labelledby="bulk-dialog-title"
        className="account-tools-dialog bulk-dialog"
        onClose={onClose}
      >
        <DialogTitle id="bulk-dialog-title" className="bulk-dialog__header">
          <span className="bulk-dialog__heading">
            {creating ? '创建群发' : '批量发送'}
            <span className="tools-muted">
              {creating ? '选择账号、对象并配置消息' : '发送记录'}
            </span>
          </span>
          <span className="bulk-dialog__header-actions">
            {!creating && (
              <Button
                variant="contained"
                disabled={submitting}
                onClick={() => {
                  setCreating(true);
                  setNotice('');
                }}
              >
                新建转发
              </Button>
            )}
            <IconButton
              className="bulk-dialog__close-icon"
              aria-label="关闭转发窗口"
              title="关闭转发窗口（任务继续后台执行）"
              onPointerDown={closeFromPointer}
              onClick={onClose}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                aria-hidden="true"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </IconButton>
          </span>
        </DialogTitle>
        <DialogContent>
          {creating ? (
            <div className="bulk-columns">
              <fieldset disabled={disabled}>
                <h3>选择账号</h3>
                <p className="tools-muted">仅显示在线账号，支持多选</p>
                <input
                  aria-label="搜索账号"
                  placeholder="搜索 ID / 名称 / 手机号 / 备注"
                  value={accountSearch}
                  onChange={e => setAccountSearch(e.target.value)}
                />
                <p className="tools-muted">
                  已选{' '}
                  {accounts.filter(id => online.some(s => s.id === id)).length}{' '}
                  / {online.length} 个账号
                </p>
                <div className="bulk-account-list">
                  {visibleAccounts.map(s => (
                    <label
                      htmlFor={`bulk-account-${s.id}`}
                      className="tools-check"
                      key={s.id}
                    >
                      <input
                        id={`bulk-account-${s.id}`}
                        type="checkbox"
                        checked={accounts.includes(s.id)}
                        onChange={e => toggleAccount(s.id, e.target.checked)}
                      />
                      {s.accountSnapshot.avatar ? (
                        <img
                          className="bulk-avatar"
                          src={s.accountSnapshot.avatar}
                          alt=""
                        />
                      ) : (
                        <span className="bulk-avatar bulk-avatar--placeholder">
                          W
                        </span>
                      )}
                      <span>
                        {displayName(s)}
                        <small>
                          {s.accountSnapshot.phone || '未读取到手机号'}
                        </small>
                        <small>{profiles[s.id]?.remark || '暂无备注'}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {online.length === 0 && (
                  <p>暂无在线账号，请先登录 WhatsApp。</p>
                )}
                <Button
                  disabled={accounts.length === 0 || disabled}
                  onClick={() => void refresh()}
                >
                  {loading ? '读取中…' : '读取聊天对象'}
                </Button>
              </fieldset>
              <fieldset disabled={disabled}>
                <h3>群发对象（已选 {chosen.length}）</h3>
                <select
                  aria-label="筛选对象所属账号"
                  value={recipientAccount}
                  onChange={e => setRecipientAccount(e.target.value)}
                >
                  <option value="all">全部所选账号</option>
                  {online
                    .filter(s => accounts.includes(s.id))
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {displayName(s)}
                      </option>
                    ))}
                </select>
                <input
                  aria-label="搜索聊天对象"
                  placeholder="搜索名称或 ID"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
                <div
                  className="bulk-type-tabs"
                  role="group"
                  aria-label="聊天类型"
                >
                  {[
                    ['all', '全部'],
                    ['group', '群聊'],
                    ['private', '私聊'],
                    ['contact', '通讯录'],
                    ['archived', '已归档'],
                  ].map(([value, label]) => (
                    <button
                      type="button"
                      aria-pressed={kind === value}
                      key={value}
                      onClick={() => {
                        const reload =
                          kind === 'contact' || value === 'contact';
                        setKind(value);
                        if (reload && accounts.length > 0) void refresh(value);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label htmlFor="zl-BulkSend-2" className="tools-check">
                  <input
                    id="zl-BulkSend-2"
                    type="checkbox"
                    checked={
                      visible.length > 0 &&
                      visible.every(r => selected.includes(key(r)))
                    }
                    onChange={e =>
                      setSelected(current =>
                        e.target.checked
                          ? [
                              ...new Set([
                                ...current,
                                ...visible.map(r => key(r)),
                              ]),
                            ]
                          : current.filter(
                              id => !visible.some(r => key(r) === id),
                            ),
                      )
                    }
                  />
                  全选当前列表（{visible.length}）
                </label>
                <div className="bulk-recipient-list">
                  {visible.map(r => (
                    <label
                      htmlFor={`bulk-recipient-${key(r)}`}
                      className="tools-check"
                      key={key(r)}
                    >
                      <input
                        id={`bulk-recipient-${key(r)}`}
                        type="checkbox"
                        checked={selected.includes(key(r))}
                        onChange={e =>
                          setSelected(current =>
                            e.target.checked
                              ? [...current, key(r)]
                              : current.filter(id => id !== key(r)),
                          )
                        }
                      />
                      <span>
                        {r.name}
                        <small>
                          {r.group ? '群聊' : '私聊'} · {r.id}
                        </small>
                        <small>
                          来自账号：
                          {online.find(s => s.id === r.accountId)
                            ?.accountSnapshot.nickname ||
                            online.find(s => s.id === r.accountId)?.name}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
                {visible.length === 0 && (
                  <p className="tools-muted">
                    暂无对象。选择账号后点击「读取聊天对象」。
                  </p>
                )}
              </fieldset>
              <fieldset disabled={disabled}>
                <h3>群发设置</h3>
                <p>消息类型</p>
                <div className="bulk-type-tabs bulk-message-types">
                  {messageTypes.map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      aria-pressed={type === value}
                      onClick={() => {
                        setType(value);
                        setMedia(undefined);
                        if (['image', 'audio', 'contact'].includes(value))
                          setMentionAll(false);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {!['text', 'contact'].includes(type) && (
                  <div className="bulk-media">
                    <Button onClick={() => void pickMedia()}>
                      选择{messageTypes.find(([value]) => value === type)?.[1]}
                      附件
                    </Button>
                    {media && <BulkMediaPreview media={media} type={type} />}
                    {media ? (
                      <p>
                        {media.name}
                        <small>
                          {(media.size / 1024 / 1024).toFixed(2)} MB ·
                          已复制到软件数据目录
                        </small>
                        <Button onClick={() => setMedia(undefined)}>
                          移除附件
                        </Button>
                      </p>
                    ) : (
                      <p className="tools-muted">
                        暂无附件，单个文件最大 50 MB
                      </p>
                    )}
                  </div>
                )}
                {type === 'contact' ? (
                  <>
                    <label htmlFor="bulk-contact-name">
                      名片名称
                      <input
                        id="bulk-contact-name"
                        type="text"
                        value={contactName}
                        maxLength={100}
                        onChange={e => setContactName(e.target.value)}
                      />
                    </label>
                    <label htmlFor="bulk-contact-phone">
                      手机号码（含国家区号）
                      <input
                        id="bulk-contact-phone"
                        type="text"
                        placeholder="例如 8613800000000"
                        value={contactPhone}
                        onChange={e => setContactPhone(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  !['image', 'audio'].includes(type) && (
                    <>
                      <label htmlFor="bulk-text">
                        {type === 'text' ? '文本内容' : '说明文字'}
                      </label>
                      <textarea
                        id="bulk-text"
                        aria-label="发送内容"
                        rows={6}
                        maxLength={12_000}
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder="请输入自定义文字"
                      />
                      <small>{text.length}/12000</small>
                    </>
                  )
                )}
                <h4>发送时间</h4>
                <div className="bulk-type-tabs">
                  <button
                    type="button"
                    aria-pressed={!scheduled}
                    onClick={() => setScheduled(false)}
                  >
                    立即发送
                  </button>
                  <button
                    type="button"
                    aria-pressed={scheduled}
                    onClick={() => setScheduled(true)}
                  >
                    定时发送
                  </button>
                </div>
                {scheduled && (
                  <>
                    <input
                      type="datetime-local"
                      aria-label="定时发送时间"
                      value={scheduledAt}
                      onChange={e => setScheduledAt(e.target.value)}
                    />
                    <p className="tools-muted">
                      按本机时间执行。软件须保持运行、账号在线；关闭后错过的任务不会自动补发。
                    </p>
                  </>
                )}
                <h4>会话发送间隔（秒）</h4>
                <label className="tools-check" htmlFor="bulk-random">
                  <input
                    id="bulk-random"
                    type="checkbox"
                    checked={randomInterval}
                    onChange={e => setRandomInterval(e.target.checked)}
                  />
                  使用随机范围
                </label>
                <div className="bulk-interval">
                  <label htmlFor="bulk-min">
                    {randomInterval ? '最小间隔' : '固定间隔'}
                    <input
                      id="bulk-min"
                      type="number"
                      min="0.5"
                      max="3600"
                      step="0.5"
                      value={intervalMin}
                      onChange={e => setIntervalMin(Number(e.target.value))}
                    />
                  </label>
                  {randomInterval && (
                    <label htmlFor="bulk-max">
                      最大间隔
                      <input
                        id="bulk-max"
                        type="number"
                        min={intervalMin}
                        max="3600"
                        step="0.5"
                        value={intervalMax}
                        onChange={e => setIntervalMax(Number(e.target.value))}
                      />
                    </label>
                  )}
                </div>
                <label htmlFor="bulk-typing">
                  发送前显示输入状态（秒，0 为关闭）
                  <input
                    id="bulk-typing"
                    type="number"
                    min="0"
                    max="30"
                    value={typingSeconds}
                    onChange={e => setTypingSeconds(Number(e.target.value))}
                  />
                </label>
                <label htmlFor="bulk-mention" className="tools-check">
                  <input
                    id="bulk-mention"
                    type="checkbox"
                    disabled={['image', 'audio', 'contact'].includes(type)}
                    checked={mentionAll}
                    onChange={e => setMentionAll(e.target.checked)}
                  />
                  提及所有成员（仅群聊，含管理员；正文不显示名单）
                </label>
                <label htmlFor="bulk-failure">
                  消息失败策略
                  <select
                    id="bulk-failure"
                    value={failure}
                    onChange={e =>
                      setFailure(e.target.value as 'stop' | 'continue')
                    }
                  >
                    <option value="stop">遇到失败立即停止</option>
                    <option value="continue">跳过失败，继续后续对象</option>
                  </select>
                </label>
                <p className="tools-muted">
                  发送结果超时未确认时停止任务。群发正文按原样发送，不使用聊天输入框翻译。
                </p>
              </fieldset>
            </div>
          ) : (
            <BulkHistory
              records={queue.records}
              activeIds={activeIds}
              onCompose={record => {
                const previous = record.spec;
                setType(previous?.type ?? 'text');
                setText(record.editedText || previous?.text || record.text);
                setMedia(previous?.media);
                setContactName(previous?.contactName ?? '');
                setContactPhone(previous?.contactPhone ?? '');
                setScheduled(false);
                setScheduledAt('');
                if (previous) {
                  setAccounts([
                    ...new Set(previous.targets.map(r => r.accountId)),
                  ]);
                  setRecipients(previous.targets);
                  setSelected(previous.targets.map(r => key(r)));
                  setIntervalMin(previous.intervalMin);
                  setIntervalMax(previous.intervalMax);
                  setRandomInterval(
                    previous.intervalMax !== previous.intervalMin,
                  );
                  setTypingSeconds(previous.typingSeconds);
                  setMentionAll(previous.mentionAll);
                  setFailure(previous.failure);
                }
                setKind('all');
                setSearch('');
                setRecipientAccount('all');
                setCreating(true);
                setNotice('已带入原任务，请核对账号、对象和内容后确认发送');
              }}
              onDelete={ids => queue.remove(ids)}
              onReconcile={id => queue.reconcile(id)}
              onEdit={(id, text, targets) => queue.edit(id, text, targets)}
              onStop={id => queue.stop(id)}
              onRevoke={(id, targets) => queue.revoke(id, targets)}
            />
          )}
          {running && (
            <p role="status">
              当前 {activeIds.size}{' '}
              个任务执行中，可继续新建群发或关闭窗口；可在对应记录中单独停止。
            </p>
          )}
          <p role="status" className="tools-notice">
            {notice || queue.error}
          </p>
        </DialogContent>
        <DialogActions>
          <Button
            className="bulk-dialog__close"
            onPointerDown={closeFromPointer}
            onClick={onClose}
          >
            关闭
          </Button>
          {activeIds.size === 1 &&
            ['send', 'revoke'].includes(queue.activeOperation) && (
              <Button
                onClick={() =>
                  void queue
                    .stop(queue.activeId)
                    .catch(error => setNotice(String(error)))
                }
              >
                {queue.activeOperation === 'revoke' ? '停止撤回' : '停止发送'}
              </Button>
            )}
          {creating && (
            <>
              <Button onClick={() => setCreating(false)}>返回记录</Button>
              <Button
                variant="contained"
                disabled={disabled || chosen.length === 0}
                onClick={prepare}
              >
                检查并发送
              </Button>
            </>
          )}
        </DialogActions>
        <Dialog
          open={Boolean(confirm)}
          className="account-tools-dialog"
          onClose={() => setConfirm(undefined)}
        >
          <DialogTitle>
            确认{confirm?.scheduledAt ? '定时' : ''}发送
          </DialogTitle>
          <DialogContent>
            将通过 {new Set(confirm?.targets.map(r => r.accountId)).size}{' '}
            个账号向 {confirm?.targets.length} 个聊天发送
            {messageTypes.find(([value]) => value === confirm?.type)?.[1]}消息：
            <p className="bulk-record-text">{confirm?.text}</p>
            {confirm?.media && <p>附件：{confirm.media.name}</p>}
            {confirm?.type === 'contact' && (
              <p>
                名片：{confirm.contactName} · {confirm.contactPhone}
              </p>
            )}
            {confirm?.scheduledAt && (
              <p>发送时间：{new Date(confirm.scheduledAt).toLocaleString()}</p>
            )}
            <p>
              间隔 {confirm?.intervalMin}–{confirm?.intervalMax} 秒；
              {confirm?.failure === 'continue'
                ? '跳过失败继续'
                : '遇到失败停止'}
              {confirm?.mentionAll ? '；群聊 @所有人' : ''}。
            </p>
            此操作会实际发送 WhatsApp 消息。
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfirm(undefined)}>返回修改</Button>
            <Button
              variant="contained"
              disabled={submitting}
              onClick={() => void submit()}
            >
              确认发送
            </Button>
          </DialogActions>
        </Dialog>
      </Dialog>
    );
  },
);
export default BulkSend;
