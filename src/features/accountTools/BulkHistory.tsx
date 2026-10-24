import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import type { SendRecord } from './config';

// Keep the actionable cause, omitting Electron's transport wrapper.
const errorText = (value: string) =>
  value.replace(
    /^(?:Error:\s*|Error invoking remote method ['"][^'"]+['"]:\s*)+/u,
    '',
  );

const time = (value?: string) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

export default function BulkHistory({
  records,
  activeIds,
  onCompose,
  onDelete,
  onReconcile,
  onEdit,
  onStop,
  onRevoke,
}: {
  records: SendRecord[];
  activeIds: ReadonlySet<string>;
  onCompose: (record: SendRecord) => void;
  onStop: (id: string) => Promise<void>;
  onRevoke: (id: string, targets?: string[]) => Promise<void>;
  onDelete: (ids: string[]) => Promise<void>;
  onReconcile: (id: string) => Promise<SendRecord>;
  onEdit: (id: string, text: string, targets: string[]) => Promise<void>;
}) {
  const running = activeIds.size > 0;
  const empty = { text: '', status: 'all', from: '', to: '' };
  const [draft, setDraft] = useState(empty);
  const [filters, setFilters] = useState(empty);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailId, setDetailId] = useState('');
  const detail = records.find(r => r.id === detailId);
  const [tab, setTab] = useState('send');
  const [revoking, setRevoking] = useState<SendRecord>();
  const [revokeTargets, setRevokeTargets] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [editing, setEditing] = useState<SendRecord>();
  const [editText, setEditText] = useState('');
  const [editTargets, setEditTargets] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const hasActionTargets = (record: SendRecord) =>
    record.deliveries?.some(d => !d.revoked && (d.messageId || record.spec));
  const prepareAction = async (record: SendRecord, edit: boolean) => {
    setBusy(true);
    setError('');
    try {
      const current =
        record.spec && record.deliveries?.some(d => !d.revoked && !d.messageId)
          ? await onReconcile(record.id)
          : record;
      const targets =
        current.deliveries
          ?.filter(d => d.messageId && !d.revoked)
          .map(d => `${d.target.accountId}:${d.target.id}`) || [];
      if (targets.length === 0)
        throw new Error(
          current.deliveries?.find(d => d.checkError)?.checkError ||
            '未找到可操作的消息编号，请先核对发送结果',
        );
      if (edit) {
        setEditing(current);
        setEditText(current.editedText || current.spec?.text || current.text);
        setEditTargets(targets);
      } else {
        setRevoking(current);
        setRevokeTargets(targets);
      }
    } catch (error_) {
      setError(errorText(String(error_)));
    } finally {
      setBusy(false);
    }
  };
  const status = (r: SendRecord) =>
    r.status === '发送中' && !activeIds.has(r.id) ? '已中断' : r.status;
  const filtered = records.filter(r => {
    if (
      tab === 'revoke' &&
      !r.deliveries?.some(d => d.revoked || d.revokeError)
    )
      return false;
    const date = new Date(
      tab === 'revoke' ? (r.revokeStarted ?? r.started) : r.started,
    );
    const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    return (
      [r.text, r.editedText, ...(r.deliveries || []).map(d => d.editedText)]
        .join('\n')
        .toLowerCase()
        .includes(filters.text.trim().toLowerCase()) &&
      (filters.status === 'all' || status(r) === filters.status) &&
      (!filters.from || localDate >= filters.from) &&
      (!filters.to || localDate <= filters.to)
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages);
  return (
    <div className="bulk-history">
      <div className="bulk-type-tabs" role="group" aria-label="记录类型">
        <button
          type="button"
          aria-pressed={tab === 'send'}
          onClick={() => {
            setTab('send');
            setPage(1);
          }}
        >
          发送记录
        </button>
        <button
          type="button"
          aria-pressed={tab === 'revoke'}
          onClick={() => {
            setTab('revoke');
            setPage(1);
          }}
        >
          撤回记录
        </button>
      </div>
      <form
        className="bulk-history__filters"
        onSubmit={e => {
          e.preventDefault();
          setFilters(draft);
          setPage(1);
        }}
      >
        <input
          aria-label="搜索消息内容"
          placeholder="搜索消息内容"
          value={draft.text}
          onChange={e => setDraft({ ...draft, text: e.target.value })}
        />
        <select
          aria-label="筛选发送状态"
          value={draft.status}
          onChange={e => setDraft({ ...draft, status: e.target.value })}
        >
          <option value="all">全部状态</option>
          {[
            '待发送',
            '发送中',
            '已完成',
            '部分失败',
            '待确认',
            '已停止',
            '已中断',
            '已取消',
            '已错过',
          ].map(s => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input
          aria-label="开始日期"
          type="date"
          value={draft.from}
          max={draft.to || undefined}
          onChange={e => setDraft({ ...draft, from: e.target.value })}
        />
        <span>至</span>
        <input
          aria-label="结束日期"
          type="date"
          value={draft.to}
          min={draft.from || undefined}
          onChange={e => setDraft({ ...draft, to: e.target.value })}
        />
        <Button type="submit" variant="contained">
          搜索
        </Button>
        <Button
          onClick={() => {
            setDraft(empty);
            setFilters(empty);
            setPage(1);
          }}
        >
          重置
        </Button>
        <Button
          color="error"
          disabled={running || records.length === 0}
          onClick={() => setDeleting(records.map(r => r.id))}
        >
          清空记录
        </Button>
      </form>
      <div className="bulk-history__table">
        <table>
          <thead>
            <tr>
              {[
                '发送内容',
                '状态',
                '发送方式',
                tab === 'revoke' ? '撤回进度' : '发送进度',
                '消息发送策略',
                tab === 'revoke' ? '撤回时间' : '发送时间',
                '结束时间',
                '操作',
              ].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered
              .slice((current - 1) * pageSize, current * pageSize)
              .map(r => (
                <tr key={r.id}>
                  <td>
                    <div
                      className="bulk-history__text"
                      title={r.editedText || r.text}
                    >
                      {r.editedText || r.text}
                    </div>
                    {r.editStarted && (
                      <small>
                        已更正{' '}
                        {r.deliveries?.filter(d => d.editedAt).length || 0} ·
                        编辑异常{' '}
                        {r.deliveries?.filter(d => d.editError).length || 0}
                        （详情）
                      </small>
                    )}
                  </td>
                  <td>
                    <span
                      className={`bulk-status${status(r) === '已完成' ? ' bulk-status--complete' : ''}`}
                    >
                      {tab === 'revoke'
                        ? r.deliveries?.every(d => !d.messageId || d.revoked)
                          ? '已撤回'
                          : '部分撤回或失败'
                        : status(r)}
                    </span>
                  </td>
                  <td>
                    {r.spec?.scheduledAt ? (
                      <>
                        定时发送<small>{time(r.spec.scheduledAt)}</small>
                      </>
                    ) : (
                      '立即发送'
                    )}
                  </td>
                  <td>
                    <progress
                      aria-label="发送进度"
                      value={
                        tab === 'revoke'
                          ? (r.deliveries?.filter(
                              d => d.revoked || d.revokeError,
                            ).length ?? 0)
                          : r.success + r.failed
                      }
                      max={Math.max(1, r.total)}
                    />
                    <small>
                      {tab === 'revoke'
                        ? `已撤回 ${r.deliveries?.filter(d => d.revoked).length ?? 0} · 失败 ${r.deliveries?.filter(d => d.revokeError).length ?? 0}`
                        : `成功 ${r.success} · 待确认 ${r.deliveries?.filter(d => ['uncertain', 'sending'].includes(d.status)).length || 0} · 失败 ${r.deliveries ? r.deliveries.filter(d => d.status === 'failed').length : r.failed} · 总计 ${r.total}`}
                    </small>
                  </td>
                  <td>
                    {r.spec?.failure === 'continue'
                      ? '跳过失败，继续后续对象'
                      : '遇到失败即停止'}
                  </td>
                  <td>
                    {time(tab === 'revoke' ? r.revokeStarted : r.started)}
                  </td>
                  <td>{time(tab === 'revoke' ? r.revokeEnded : r.ended)}</td>
                  <td>
                    <div className="bulk-history__actions">
                      <Button onClick={() => setDetailId(r.id)}>详情</Button>
                      {activeIds.has(r.id) &&
                        (r.status === '发送中' ||
                          (r.revokeStarted && !r.revokeEnded)) && (
                          <Button
                            onClick={async () => {
                              try {
                                await onStop(r.id);
                              } catch (error_) {
                                setError(String(error_));
                              }
                            }}
                          >
                            {r.status === '发送中' ? '停止发送' : '停止撤回'}
                          </Button>
                        )}
                      <Button onClick={() => onCompose(r)}>再发一条</Button>
                      <details className="bulk-history__more">
                        <summary>更多</summary>
                        <div>
                          {r.status === '待发送' && (
                            <Button
                              disabled={activeIds.has(r.id)}
                              onClick={async () => {
                                try {
                                  await onStop(r.id);
                                } catch (error_) {
                                  setError(String(error_));
                                }
                              }}
                            >
                              取消定时任务
                            </Button>
                          )}
                          <Button
                            disabled={
                              activeIds.has(r.id) ||
                              busy ||
                              !r.deliveries?.length
                            }
                            onClick={async () => {
                              setBusy(true);
                              setError('');
                              try {
                                await onReconcile(r.id);
                                setDetailId(r.id);
                              } catch (error_) {
                                setError(String(error_));
                              } finally {
                                setBusy(false);
                              }
                            }}
                          >
                            核对发送结果
                          </Button>
                          <Button
                            disabled={
                              activeIds.has(r.id) ||
                              busy ||
                              !hasActionTargets(r)
                            }
                            title={
                              hasActionTargets(r)
                                ? ''
                                : '此记录缺少可核对的发送对象或消息编号'
                            }
                            onClick={async () => {
                              await prepareAction(r, false);
                            }}
                          >
                            撤回已发消息
                          </Button>
                          <Button
                            disabled={
                              activeIds.has(r.id) ||
                              busy ||
                              (r.spec &&
                                ![
                                  'text',
                                  'caption',
                                  'video',
                                  'document',
                                ].includes(r.spec.type)) ||
                              !hasActionTargets(r)
                            }
                            title={
                              hasActionTargets(r)
                                ? ''
                                : '此记录缺少可核对的发送对象或消息编号'
                            }
                            onClick={async () => {
                              await prepareAction(r, true);
                            }}
                          >
                            编辑已发消息
                          </Button>
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="bulk-history__empty">
                  {records.length > 0 ? '没有符合条件的记录' : '暂无发送记录'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="bulk-history__pagination">
        <span>共 {filtered.length} 条</span>
        <Button
          aria-label="上一页"
          disabled={current <= 1}
          onClick={() => setPage(current - 1)}
        >
          上一页
        </Button>
        <span>
          {current} / {pages}
        </span>
        <Button
          aria-label="下一页"
          disabled={current >= pages}
          onClick={() => setPage(current + 1)}
        >
          下一页
        </Button>
        <select
          aria-label="每页条数"
          value={pageSize}
          onChange={e => {
            setPageSize(Number(e.target.value));
            setPage(1);
          }}
        >
          {[10, 20, 50].map(n => (
            <option key={n} value={n}>
              {n} 条/页
            </option>
          ))}
        </select>
      </div>
      <Dialog
        open={Boolean(detail)}
        className="account-tools-dialog"
        fullWidth
        maxWidth="md"
        onClose={() => setDetailId('')}
      >
        <DialogTitle>发送详情</DialogTitle>
        <DialogContent>
          {detail?.deliveries?.map(d => (
            <div
              className="bulk-delivery"
              key={`${d.target.accountId}:${d.target.id}`}
            >
              <p>
                {d.target.name} ·{' '}
                {d.revoked
                  ? '已撤回'
                  : d.status === 'sent'
                    ? '成功'
                    : d.status === 'failed'
                      ? '失败'
                      : d.status === 'sending' && activeIds.has(detail.id)
                        ? '执行中'
                        : '结果待确认'}
              </p>
              {d.status === 'failed' && (
                <p role="alert">
                  失败原因：{errorText(d.error || '发送未成功，未返回具体原因')}
                </p>
              )}
              {d.status === 'uncertain' && (
                <p>
                  {errorText(d.error || '未能确认发送结果，请核对后再操作')}
                </p>
              )}
              {d.checkError && (
                <p role="alert">核对失败：{errorText(d.checkError)}</p>
              )}
              {d.editError && (
                <p role="alert">修改失败：{errorText(d.editError)}</p>
              )}
              {d.revokeError && (
                <p role="alert">撤回失败：{errorText(d.revokeError)}</p>
              )}
            </div>
          ))}
          {!detail?.deliveries &&
            [...new Set(detail?.details ?? [])].map(d => <p key={d}>{d}</p>)}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailId('')}>关闭详情</Button>
        </DialogActions>
      </Dialog>
      <p role="alert" className="tools-notice">
        {error}
      </p>
      <Dialog
        open={Boolean(revoking)}
        className="account-tools-dialog"
        onClose={() => {
          if (!busy) setRevoking(undefined);
        }}
      >
        <DialogTitle>撤回已发消息</DialogTitle>
        <DialogContent>
          将尝试对所有人撤回这条任务中 {revokeTargets.length}{' '}
          条已发消息。平台时限或权限可能导致撤回失败，请到「详情」查看逐条结果。
          <p className="bulk-record-text">{revoking?.text}</p>
          {revoking?.deliveries
            ?.filter(d => d.messageId && !d.revoked)
            .map(d => {
              const targetKey = `${d.target.accountId}:${d.target.id}`;
              return (
                <label
                  className="tools-check"
                  htmlFor={`revoke-${targetKey}`}
                  key={targetKey}
                >
                  <input
                    id={`revoke-${targetKey}`}
                    type="checkbox"
                    checked={revokeTargets.includes(targetKey)}
                    disabled={busy}
                    onChange={e =>
                      setRevokeTargets(current =>
                        e.target.checked
                          ? [...current, targetKey]
                          : current.filter(id => id !== targetKey),
                      )
                    }
                  />
                  <span>
                    {d.target.name}
                    <small>{d.target.id}</small>
                  </span>
                </label>
              );
            })}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setRevoking(undefined)}>
            取消
          </Button>
          <Button
            disabled={
              busy ||
              (!!revoking && activeIds.has(revoking.id)) ||
              revokeTargets.length === 0
            }
            color="error"
            onClick={async () => {
              if (!revoking) return;
              setBusy(true);
              try {
                await onRevoke(revoking.id, revokeTargets);
                setDetailId(revoking.id);
                setRevoking(undefined);
              } catch (error_) {
                setError(String(error_));
              } finally {
                setBusy(false);
              }
            }}
          >
            确认撤回消息
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(editing)}
        className="account-tools-dialog"
        maxWidth="md"
        fullWidth
        onClose={() => {
          if (!busy) setEditing(undefined);
        }}
      >
        <DialogTitle>编辑已发送的消息</DialogTitle>
        <DialogContent>
          <p>
            将修改所选聊天中这条消息的实际文字或附件说明，不会重新发送。WhatsApp
            通常仅允许发送后 15 分钟内编辑；不支持的类型或超时会逐条报告。
          </p>
          <p className="bulk-record-text">
            原内容：{editing?.editedText || editing?.text}
          </p>
          <label htmlFor="bulk-edit-message">
            更正后的内容
            <textarea
              id="bulk-edit-message"
              value={editText}
              maxLength={12_000}
              disabled={busy}
              onChange={e => setEditText(e.target.value)}
            />
          </label>
          {editing?.deliveries
            ?.filter(d => d.messageId && !d.revoked)
            .map(d => {
              const key = `${d.target.accountId}:${d.target.id}`;
              return (
                <label
                  className="tools-check"
                  htmlFor={`edit-${key}`}
                  key={key}
                >
                  <input
                    id={`edit-${key}`}
                    type="checkbox"
                    checked={editTargets.includes(key)}
                    disabled={busy}
                    onChange={e =>
                      setEditTargets(current =>
                        e.target.checked
                          ? [...current, key]
                          : current.filter(id => id !== key),
                      )
                    }
                  />
                  <span>
                    {d.target.name}
                    <small>{d.target.id}</small>
                  </span>
                </label>
              );
            })}
          <p role="alert">{error}</p>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setEditing(undefined)}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={
              busy ||
              (!!editing && activeIds.has(editing.id)) ||
              !editText.trim() ||
              editTargets.length === 0
            }
            onClick={async () => {
              if (!editing) return;
              setBusy(true);
              setError('');
              try {
                await onEdit(editing.id, editText, editTargets);
                setDetailId(editing.id);
                setEditing(undefined);
              } catch (error_) {
                setError(String(error_));
              } finally {
                setBusy(false);
              }
            }}
          >
            确认编辑消息
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={deleting.length > 0}
        className="account-tools-dialog"
        onClose={() => {
          if (!busy) setDeleting([]);
        }}
      >
        <DialogTitle>删除发送记录</DialogTitle>
        <DialogContent>
          将删除 {deleting.length} 条本地记录。已发送的 WhatsApp 消息不会撤回。
          <p role="alert">{error}</p>
        </DialogContent>
        <DialogActions>
          <Button
            disabled={busy}
            onClick={() => {
              setDeleting([]);
              setError('');
            }}
          >
            取消
          </Button>
          <Button
            disabled={busy || deleting.some(id => activeIds.has(id))}
            color="error"
            onClick={async () => {
              setBusy(true);
              try {
                await onDelete(deleting);
                setDeleting([]);
                setError('');
              } catch {
                setError('删除记录失败，请重试');
              } finally {
                setBusy(false);
              }
            }}
          >
            确认删除记录
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
