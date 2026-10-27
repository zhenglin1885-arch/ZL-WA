/* eslint-disable no-void, no-await-in-loop -- UI operations handle their own failures; searches are sequential. */
import { Button, Dialog, DialogTitle, DialogContent } from '@mui/material';
import { observer } from 'mobx-react';
import { useEffect, useId, useMemo, useReducer, useRef, useState } from 'react';
import type { RealStores } from '../../stores';
import { normalizeAccountConfig } from '../accounts/state';
import type { GroupChoice } from '../groups/types';
import { getGroupRuntime, getReactionRuntime } from './runtime';
import { prepareReactionImage } from './image';
import {
  defaultReactionPreferences,
  reactionEmojis,
  type ReactionMatch,
  type ReactionPreferences,
} from './types';

const statuses = {
  queued: '等待执行',
  running: '处理中',
  success: '成功',
  failed: '失败',
  uncertain: '未确认',
  stopped: '已停止',
};
const localDate = (time: number) => {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export default observer(function ReactionTools({
  stores,
  onClose,
}: {
  stores: RealStores;
  onClose: () => void;
}) {
  const uid = useId();
  const runtime = getReactionRuntime(stores);
  const { queue } = runtime;
  const [, redraw] = useReducer(n => n + 1, 0);
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupChoice[]>([]);
  const [accountSearch, setAccountSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [accountFilter, setAccountFilter] = useState('');
  const [rules, setRules] = useState(defaultReactionPreferences);
  const [preview, setPreview] = useState<ReactionMatch[]>([]);
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pictureLoading, setPictureLoading] = useState(false);
  const pictureInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [record, setRecord] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const config = normalizeAccountConfig(stores.settings.app.accountSidebar);
  const online = stores.services.all.filter(
    s =>
      s.recipe.id === 'whatsapp' &&
      s.isEnabled &&
      !s.isHibernating &&
      s.webview &&
      s.accountSnapshot.status === 'online' &&
      s.accountSnapshot.ownerId,
  );
  const chosen = online
    .filter(s => accounts.includes(s.id))
    .map(s => ({
      accountId: s.id,
      ownerId: s.accountSnapshot.ownerId!,
      accountName: (
        config.accounts[s.id]?.remark ||
        config.accounts[s.id]?.nickname ||
        s.accountSnapshot.nickname ||
        s.name
      ).slice(0, 500),
    }));
  const chosenKey = JSON.stringify(chosen);
  const active = Boolean(queue.active);
  const locked = active || busy || pictureLoading || !ready;
  const imageMode = rules.content === 'image';
  const hasMatchInput = imageMode
    ? Boolean(rules.picture)
    : Boolean(rules.text.trim());
  useEffect(() => {
    mounted.current = true;
    const change = () => {
      redraw();
    };
    queue.listeners.add(change);
    void queue
      .load()
      .then(() => {
        if (!mounted.current) return;
        setRules(queue.state.preferences);
        setReady(true);
      })
      .catch(error => {
        if (mounted.current) setNotice(String(error));
      });
    return () => {
      mounted.current = false;
      generation.current += 1;
      queue.listeners.delete(change);
    };
  }, [queue]);
  useEffect(() => {
    let cancelled = false;
    generation.current += 1;
    setPreview([]);
    setGroups([]);
    const targets: typeof chosen = JSON.parse(chosenKey);
    if (targets.length === 0) {
      setReading(false);
      return () => {
        cancelled = true;
      };
    }
    setReading(true);
    void (async () => {
      const rows: GroupChoice[] = [];
      const errors: string[] = [];
      for (const a of targets) {
        if (cancelled) return;
        try {
          rows.push(...(await getGroupRuntime(stores).list(a)));
        } catch (error) {
          errors.push(`${a.accountName}：${String(error)}`);
        }
      }
      if (cancelled) return;
      setGroups(rows);
      setSelected(old => old.filter(id => rows.some(g => g.target === id)));
      setNotice(errors.join('\n'));
      setReading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [stores, chosenKey, refresh]);
  const changeRules = (
    next: Partial<ReactionPreferences>,
    invalidate = true,
  ) => {
    setRules(p => ({ ...p, ...next }));
    if (invalidate) {
      generation.current += 1;
      setPreview([]);
    }
  };
  const groupRows = useMemo(() => {
    const rows = new Map<
      string,
      { id: string; name: string; members: GroupChoice[] }
    >();
    for (const group of groups) {
      const row = rows.get(group.target);
      if (row) row.members.push(group);
      else
        rows.set(group.target, {
          id: group.target,
          name: group.name,
          members: [group],
        });
    }
    return [...rows.values()];
  }, [groups]);
  const visibleGroups = groupRows.filter(
    g =>
      (!accountFilter || g.members.some(m => m.accountId === accountFilter)) &&
      `${g.id} ${g.name}`.toLowerCase().includes(groupSearch.toLowerCase()),
  );
  const visibleAccounts = online.filter(s =>
    [
      s.accountSnapshot.nickname,
      s.accountSnapshot.phone,
      config.accounts[s.id]?.remark,
      s.name,
      s.id,
    ].some(v => v?.toLowerCase().includes(accountSearch.toLowerCase())),
  );
  const targets = useMemo(() => {
    const ids = new Set(selected);
    return groups.filter(group => ids.has(group.target));
  }, [groups, selected]);
  const matchedCount = preview.filter(
    row => row.messageId && !row.error,
  ).length;
  const visiblePreview = expandedPreview ? preview : preview.slice(0, 10);
  const selectedKey = JSON.stringify(targets);
  useEffect(() => {
    generation.current += 1;
    setPreview([]);
    setExpandedPreview(false);
  }, [selectedKey]);
  const find = async () => {
    generation.current += 1;
    const token = generation.current;
    setBusy(true);
    setNotice('');
    setPreview([]);
    setExpandedPreview(false);
    const rows: ReactionMatch[] = [];
    try {
      for (const target of targets) {
        if (generation.current !== token || !mounted.current) return;
        rows.push(await runtime.findMessage(target, rules));
        if (generation.current === token && mounted.current)
          setPreview([...rows]);
      }
    } catch (error) {
      if (mounted.current) setNotice(String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const start = async () => {
    setBusy(true);
    setNotice('');
    try {
      const id = await queue.start(preview, rules);
      if (mounted.current) setRecord(id);
    } catch (error) {
      if (mounted.current) setNotice(String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const choosePicture = async (file?: File) => {
    if (!file) return;
    setPictureLoading(true);
    setNotice('');
    try {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
        throw new Error('请选择 JPG、PNG 或 WebP 图片');
      const image = await prepareReactionImage(file);
      if (!mounted.current) return;
      changeRules({
        picture: {
          name: file.name.slice(0, 255),
          width: image.width,
          height: image.height,
          pixels: image.pixels,
          preview: image.preview,
        },
      });
    } catch (error) {
      if (mounted.current) setNotice(String(error));
    } finally {
      if (mounted.current) setPictureLoading(false);
    }
  };
  const batch =
    queue.state.batches.find(b => b.id === record) || queue.state.batches[0];
  const selectGroups = (values: string[]) => {
    setSelected(values);
    generation.current += 1;
    setPreview([]);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={false}
      className="group-tools-dialog account-tools-dialog reaction-tools-dialog"
      aria-labelledby={`${uid}-title`}
    >
      <DialogTitle id={`${uid}-title`}>
        批量点赞
        <Button
          className="group-tools-close"
          aria-label="关闭批量点赞"
          onClick={onClose}
        >
          ×
        </Button>
      </DialogTitle>
      <DialogContent className="group-tools-columns">
        <section className="reaction-accounts">
          <h3>选择账号</h3>
          <p>仅显示已登录的 WhatsApp 账号，可多选。</p>
          <Button
            disabled={locked || reading}
            onClick={() => {
              setBusy(true);
              void getGroupRuntime(stores)
                .refreshAccounts()
                .then(r =>
                  setNotice(`已刷新 ${r.refreshed} 个账号，${r.failed} 个失败`),
                )
                .catch(error => setNotice(String(error)))
                .finally(() => {
                  if (mounted.current) setBusy(false);
                });
            }}
          >
            刷新账号
          </Button>
          <input
            aria-label="搜索点赞账号"
            placeholder="搜索账号 / 名称 / 备注"
            value={accountSearch}
            onChange={e => setAccountSearch(e.target.value)}
          />
          <label className="group-tools-check" htmlFor={`${uid}-all-accounts`}>
            <input
              type="checkbox"
              id={`${uid}-all-accounts`}
              disabled={locked || reading || visibleAccounts.length === 0}
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
            已选 {chosen.length} 个账号
          </label>
          <div className="group-tools-list">
            {visibleAccounts.map(s => (
              <label
                key={s.id}
                className="group-tools-check group-tools-account"
                htmlFor={`${uid}-account-${s.id}`}
                data-account-id={s.id}
              >
                <input
                  type="checkbox"
                  id={`${uid}-account-${s.id}`}
                  aria-label={`选择账号 ${s.name}`}
                  disabled={locked || reading}
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
                  <small>{config.accounts[s.id]?.remark || s.name}</small>
                </span>
              </label>
            ))}
            {online.length === 0 && <p>暂无在线账号</p>}
          </div>
        </section>
        <section className="reaction-groups">
          <h3>选择群组</h3>
          <p>相同群组合并显示；只在已加入该群的所选账号上执行。</p>
          <Button
            disabled={locked || reading || chosen.length === 0}
            onClick={() => setRefresh(n => n + 1)}
          >
            {reading ? '读取群组中…' : '刷新群组'}
          </Button>
          <div className="group-tools-filters">
            <select
              aria-label="筛选点赞群组账号"
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
              aria-label="搜索点赞群组"
              placeholder="搜索群名 / 群编号"
              value={groupSearch}
              onChange={e => setGroupSearch(e.target.value)}
            />
          </div>
          <label className="group-tools-check" htmlFor={`${uid}-all-groups`}>
            <input
              type="checkbox"
              id={`${uid}-all-groups`}
              disabled={locked || reading || visibleGroups.length === 0}
              checked={
                visibleGroups.length > 0 &&
                visibleGroups.every(g => selected.includes(g.id))
              }
              onChange={e =>
                selectGroups(
                  e.target.checked
                    ? [
                        ...new Set([
                          ...selected,
                          ...visibleGroups.map(g => g.id),
                        ]),
                      ]
                    : selected.filter(
                        id => !visibleGroups.some(g => g.id === id),
                      ),
                )
              }
            />
            已选 {selected.length} 个群组 · {targets.length} 个账号群组对象
          </label>
          <div className="group-tools-list">
            {visibleGroups.map(g => (
              <label
                key={g.id}
                className="group-tools-check group-tools-group"
                htmlFor={`${uid}-group-${g.id}`}
                data-group-id={g.id}
              >
                <input
                  type="checkbox"
                  id={`${uid}-group-${g.id}`}
                  aria-label={`选择群组 ${g.name}`}
                  disabled={locked || reading}
                  checked={selected.includes(g.id)}
                  onChange={e =>
                    selectGroups(
                      e.target.checked
                        ? [...selected, g.id]
                        : selected.filter(id => id !== g.id),
                    )
                  }
                />
                <span>
                  <strong>{g.name}</strong>
                  <small>{g.id}</small>
                  <small>{g.members.map(m => m.accountName).join('、')}</small>
                </span>
              </label>
            ))}
          </div>
        </section>
        <section className="reaction-rules">
          <div className="reaction-scroll">
            <h3>点赞规则</h3>
            <p>一次性执行，每个账号在每个选中群内只处理最新一条匹配消息。</p>
            <div
              className="reaction-match-tabs"
              role="group"
              aria-label="点赞匹配内容"
            >
              <Button
                aria-pressed={!imageMode}
                disabled={locked}
                onClick={() => changeRules({ content: 'text' })}
              >
                匹配文字
              </Button>
              <Button
                aria-pressed={imageMode}
                disabled={locked}
                onClick={() => changeRules({ content: 'image' })}
              >
                匹配图片
              </Button>
            </div>
            {imageMode ? (
              <div className="reaction-reference-image">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  ref={pictureInput}
                  aria-label="上传点赞匹配图片"
                  style={{ display: 'none' }}
                  disabled={locked}
                  onChange={e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    void choosePicture(file);
                  }}
                />
                <Button
                  disabled={locked}
                  onClick={() => pictureInput.current?.click()}
                >
                  {pictureLoading ? '读取图片中…' : '选择匹配图片'}
                </Button>
                {rules.picture && (
                  <>
                    <img src={rules.picture.preview} alt="上传的匹配图片预览" />
                    <small>{rules.picture.name}</small>
                    <Button
                      disabled={locked}
                      onClick={() => changeRules({ picture: undefined })}
                    >
                      移除图片
                    </Button>
                  </>
                )}
                <p>
                  按画面匹配，兼容常见压缩和缩放；先检查下方的匹配图片预览。
                </p>
              </div>
            ) : (
              <>
                <textarea
                  id={`${uid}-text`}
                  aria-label="点赞匹配文字"
                  rows={4}
                  maxLength={20_000}
                  disabled={locked}
                  placeholder="粘贴要匹配的消息文字"
                  value={rules.text}
                  onChange={e => changeRules({ text: e.target.value })}
                />
                <select
                  aria-label="点赞文字匹配方式"
                  disabled={locked}
                  value={rules.match}
                  onChange={e =>
                    changeRules({
                      match: e.target.value as ReactionPreferences['match'],
                    })
                  }
                >
                  <option value="exact">完全相同</option>
                  <option value="contains">包含这段文字</option>
                  <option value="normalized">忽略空格和标点后完全相同</option>
                </select>
              </>
            )}
            <h3>点赞表情</h3>
            <p>可多选，每个账号群组任务随机分配一个表情。</p>
            <div className="reaction-emojis">
              {reactionEmojis.map(emoji => (
                <button
                  type="button"
                  key={emoji}
                  aria-label={`表情 ${emoji}`}
                  aria-pressed={rules.emojis.includes(emoji)}
                  disabled={locked}
                  onClick={() =>
                    changeRules(
                      {
                        emojis: rules.emojis.includes(emoji)
                          ? rules.emojis.filter(e => e !== emoji)
                          : [...rules.emojis, emoji],
                      },
                      false,
                    )
                  }
                >
                  {emoji}
                </button>
              ))}
            </div>
            <h3>执行时间</h3>
            <select
              aria-label="点赞执行时间方式"
              disabled={locked}
              value={rules.timing}
              onChange={e =>
                changeRules(
                  { timing: e.target.value as ReactionPreferences['timing'] },
                  false,
                )
              }
            >
              <option value="window">指定时间段内随机执行</option>
              <option value="interval">从现在开始，按随机间隔执行</option>
            </select>
            {rules.timing === 'window' ? (
              <>
                <label htmlFor={`${uid}-start`}>
                  开始时间（本机时间）
                  <input
                    id={`${uid}-start`}
                    aria-label="点赞开始时间"
                    type="datetime-local"
                    disabled={locked}
                    value={localDate(rules.start)}
                    onChange={e => {
                      const value = new Date(e.target.value).getTime();
                      if (Number.isFinite(value))
                        changeRules({ start: value }, false);
                    }}
                  />
                </label>
                <label htmlFor={`${uid}-end`}>
                  结束时间（本机时间）
                  <input
                    id={`${uid}-end`}
                    aria-label="点赞结束时间"
                    type="datetime-local"
                    disabled={locked}
                    value={localDate(rules.end)}
                    onChange={e => {
                      const value = new Date(e.target.value).getTime();
                      if (Number.isFinite(value))
                        changeRules({ end: value }, false);
                    }}
                  />
                </label>
              </>
            ) : (
              <div className="reaction-interval">
                <label htmlFor={`${uid}-min`}>
                  最短间隔（秒）
                  <input
                    id={`${uid}-min`}
                    aria-label="点赞最短间隔"
                    type="number"
                    min={1}
                    max={86_400}
                    disabled={locked}
                    value={rules.minSeconds}
                    onChange={e =>
                      changeRules({ minSeconds: Number(e.target.value) }, false)
                    }
                  />
                </label>
                <label htmlFor={`${uid}-max`}>
                  最长间隔（秒）
                  <input
                    id={`${uid}-max`}
                    aria-label="点赞最长间隔"
                    type="number"
                    min={1}
                    max={86_400}
                    disabled={locked}
                    value={rules.maxSeconds}
                    onChange={e =>
                      changeRules({ maxSeconds: Number(e.target.value) }, false)
                    }
                  />
                </label>
              </div>
            )}
            <p>
              全部账号共用设置，随机错开并逐项执行。请保持软件运行；关闭本窗口继续执行，退出软件暂停，重开后需手动继续。超过结束时间不补发。
            </p>
            <div className="reaction-find-actions">
              <Button
                disabled={
                  locked ||
                  reading ||
                  !hasMatchInput ||
                  targets.length === 0 ||
                  targets.length > 1000
                }
                onClick={() => void find()}
              >
                {busy ? '查找中…' : '查找匹配消息'}
              </Button>
              <span
                className="reaction-match-summary"
                role="status"
                aria-live="polite"
              >
                匹配任务 {matchedCount} 项
              </span>
            </div>
            <small className="reaction-find-progress">
              已检查 {preview.length}/{targets.length} 个账号群组对象
            </small>
            {preview.length > 10 && (
              <Button
                aria-expanded={expandedPreview}
                aria-controls={`${uid}-reaction-preview`}
                onClick={() => setExpandedPreview(value => !value)}
              >
                {expandedPreview
                  ? '收起，仅显示前10条'
                  : `展开全部 ${preview.length} 条结果`}
              </Button>
            )}
            <div
              className="reaction-preview"
              id={`${uid}-reaction-preview`}
              aria-label="匹配消息结果"
            >
              {visiblePreview.map(m => (
                <article key={`${m.accountId}:${m.target}`}>
                  <strong>
                    {m.accountName} · {m.name}
                  </strong>
                  <small>
                    {m.timestamp ? new Date(m.timestamp).toLocaleString() : ''}
                  </small>
                  <p>{m.error || m.text}</p>
                  {m.imagePreview && (
                    <img src={m.imagePreview} alt="查找到的匹配图片预览" />
                  )}
                </article>
              ))}
            </div>
            <div className="reaction-execution-actions">
              <Button
                variant="contained"
                disabled={
                  locked ||
                  reading ||
                  rules.emojis.length === 0 ||
                  !preview.some(m => m.messageId && !m.error) ||
                  preview.length !== targets.length
                }
                onClick={() => void start()}
              >
                开始点赞
              </Button>
              <Button disabled={!active} onClick={() => queue.stop()}>
                终止执行
              </Button>
            </div>
            <h3>执行结果</h3>
            <select
              aria-label="点赞任务记录"
              value={batch?.id || ''}
              onChange={e => setRecord(e.target.value)}
            >
              {queue.state.batches.map(b => (
                <option key={b.id} value={b.id}>
                  {new Date(b.created).toLocaleString()} · {b.tasks.length} 项
                </option>
              ))}
            </select>
            {!active && batch?.tasks.some(t => t.status === 'uncertain') && (
              <Button
                disabled={locked}
                onClick={() => void queue.reconcile(batch.id)}
              >
                核验未确认结果
              </Button>
            )}
            {!active && batch?.tasks.some(t => t.status === 'queued') && (
              <Button
                disabled={locked}
                onClick={() => {
                  try {
                    queue.resume(batch.id);
                  } catch (error) {
                    setNotice(String(error));
                  }
                }}
              >
                继续待执行任务
              </Button>
            )}
            {batch && (
              <p className="reaction-counts">
                {(
                  [
                    'queued',
                    'success',
                    'failed',
                    'uncertain',
                    'stopped',
                  ] as const
                )
                  .map(
                    s =>
                      `${statuses[s]} ${batch.tasks.filter(t => t.status === s).length}`,
                  )
                  .join(' · ')}
              </p>
            )}
            <div className="group-tools-log">
              {batch?.tasks.map(t => (
                <article key={t.id} data-task-status={t.status}>
                  <strong>
                    {t.accountName} · {t.name}
                  </strong>
                  <small>
                    {t.emoji} · {statuses[t.status]} · 计划{' '}
                    {new Date(t.plannedAt).toLocaleString()}
                  </small>
                  <p>{t.result}</p>
                </article>
              ))}
            </div>
          </div>
          <p role="status" className="group-tools-notice">
            {notice || queue.error}
          </p>
        </section>
      </DialogContent>
    </Dialog>
  );
});
