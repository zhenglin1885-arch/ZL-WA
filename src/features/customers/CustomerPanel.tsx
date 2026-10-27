/* eslint-disable no-void, no-param-reassign -- Autosave failures update the shared customer runtime and are displayed locally. */
import { clipboard } from 'electron';
import { useEffect, useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from '@mui/material';
import {
  mdiFlagVariant,
  mdiChartLine,
  mdiClipboardCheckOutline,
  mdiCashCheck,
  mdiClose,
  mdiAccountOutline,
} from '@mdi/js';
import Icon from '../../components/ui/icon';
import {
  customerFlagNames,
  validateCustomer,
  type CustomerProfile,
  type CustomerContext,
  type CustomerFlag,
} from './types';
import type { CustomerRuntime } from './runtime';

export const customerIcons: Record<CustomerFlag, string> = {
  priority: mdiFlagVariant,
  follow: mdiChartLine,
  signup: mdiClipboardCheckOutline,
  deposit: mdiCashCheck,
};
const genders = { male: '男', female: '女', unknown: '未知' };
const stocks = { yes: '是', no: '否', unknown: '未知' };
function CustomerEditor({
  runtime,
  owner,
  id,
  contact,
}: {
  runtime: CustomerRuntime;
  owner: string;
  id: string;
  contact: NonNullable<CustomerContext['chat']>;
}) {
  const [profile, setProfile] = useState<CustomerProfile>();
  const [status, setStatus] = useState('读取中…');
  const [tag, setTag] = useState('');
  const [dirty, setDirty] = useState(false);
  const pending = useRef<CustomerProfile>();
  const draft = useRef<CustomerProfile>();
  const fields = useRef(new Set<keyof CustomerProfile>());
  const save = async (
    value: CustomerProfile,
    keys: (keyof CustomerProfile)[],
  ) => {
    validateCustomer(value);
    await runtime.save(owner, id, value, keys);
  };
  useEffect(() => {
    let mounted = true;
    void runtime
      .profile(owner, id)
      .then(value => {
        if (mounted) {
          draft.current = value;
          setProfile(value);
          setStatus('');
        }
      })
      .catch(error => {
        if (mounted) setStatus(String(error));
      });
    return () => {
      mounted = false;
      if (pending.current)
        void save(pending.current, [...fields.current]).catch(error => {
          runtime.error = `客户资料保存失败：${String(error)}`;
          runtime.notify();
        });
    };
  }, [runtime, owner, id]);
  useEffect(() => {
    if (!profile || !dirty) return () => {};
    try {
      validateCustomer(profile);
    } catch (error) {
      setStatus(String(error));
      return () => {};
    }
    pending.current = profile;
    const keys = [...fields.current];
    if (keys.length === 0) return () => {};
    const timer = setTimeout(() => {
      setStatus('保存中…');
      void save(profile, keys)
        .then(() => {
          for (const key of keys)
            if (draft.current?.[key] === profile[key])
              fields.current.delete(key);
          if (pending.current === profile) {
            pending.current = undefined;
            setStatus('已保存到本机');
          }
        })
        .catch(error => setStatus(`保存失败：${String(error)}`));
    }, 350);
    return () => clearTimeout(timer);
  }, [profile, dirty]);
  const update = <K extends keyof CustomerProfile>(
    key: K,
    value: CustomerProfile[K],
  ) => {
    if (!draft.current) return;
    const next = { ...draft.current, [key]: value };
    fields.current.add(key);
    draft.current = next;
    pending.current = next;
    setDirty(true);
    setProfile(next);
  };
  const externalRemark = runtime.bundle?.summaries[id]?.remarkName;
  useEffect(() => {
    if (
      draft.current &&
      externalRemark !== undefined &&
      !fields.current.has('remarkName') &&
      draft.current.remarkName !== externalRemark
    ) {
      const next = { ...draft.current, remarkName: externalRemark };
      draft.current = next;
      setProfile(next);
    }
  }, [externalRemark]);
  const copy = () => {
    if (!profile) return;
    const text = [
      `客户：${contact.name}`,
      contact.phone ? `手机：${contact.phone}` : `聊天标识：${contact.id}`,
      `备注名：${profile.remarkName || '暂无'}`,
      `标记：${profile.flags.map(f => customerFlagNames[f]).join('、') || '暂无'}`,
      `性别：${genders[profile.gender]}`,
      `年龄：${profile.age || '未知'}`,
      `是否股民：${stocks[profile.stockholder]}`,
      `地址：${profile.address}`,
      `邮箱：${profile.email}`,
      `职业：${profile.occupation}`,
      `收入：${profile.income}`,
      `用户标签：${profile.tags.join('、')}`,
      `备注：${profile.notes}`,
    ].join('\n');
    clipboard.writeText(text);
    setStatus('当前客户资料已复制');
  };
  if (!profile)
    return (
      <p role="status" className="tools-notice">
        {status}
      </p>
    );
  const flags = (Object.keys(customerFlagNames) as CustomerFlag[]).map(flag => (
    <button
      type="button"
      className={`customer-flag customer-flag--${flag}`}
      key={flag}
      aria-pressed={profile.flags.includes(flag)}
      onClick={() =>
        update(
          'flags',
          profile.flags.includes(flag)
            ? profile.flags.filter(f => f !== flag)
            : [...profile.flags, flag],
        )
      }
    >
      <Icon icon={customerIcons[flag]} size={0.7} />
      {customerFlagNames[flag]}
    </button>
  ));
  return (
    <>
      <div className="customer-overview">
        <div className="customer-name">
          <Icon icon={mdiAccountOutline} size={0.9} />
          <strong>{contact.name}</strong>
          <span className="customer-active-flags">
            {profile.flags.map(flag => (
              <span
                className={`customer-flag--${flag}`}
                title={customerFlagNames[flag]}
                key={flag}
              >
                <Icon icon={customerIcons[flag]} size={0.7} />
              </span>
            ))}
          </span>
        </div>
        <small>
          {contact.group ? '群聊' : contact.phone || '手机号待同步'}
        </small>
        <small className="customer-remark-name">
          {profile.remarkName || '还没有备注名'}
        </small>
        <div className="customer-flag-grid">{flags}</div>
      </div>
      <div className="customer-copy">
        <button type="button" onClick={copy}>
          一键复制
        </button>
      </div>
      <label htmlFor="customer-remark-name">
        备注名
        <input
          id="customer-remark-name"
          maxLength={100}
          placeholder="显示在聊天列表的红色短备注"
          value={profile.remarkName}
          onChange={e => update('remarkName', e.target.value)}
        />
      </label>
      <p className="tools-muted">
        备注名同步显示在聊天列表与对话顶部，仅保存在本机。
      </p>
      <div className="customer-choice">
        <span>性别</span>
        <div>
          {(Object.keys(genders) as (keyof typeof genders)[]).map(value => (
            <button
              type="button"
              key={value}
              aria-pressed={profile.gender === value}
              onClick={() => update('gender', value)}
            >
              {genders[value]}
            </button>
          ))}
        </div>
      </div>
      <label htmlFor="customer-age">
        年龄
        <input
          id="customer-age"
          type="number"
          min={0}
          max={150}
          placeholder="例如：45"
          value={profile.age}
          onChange={e => update('age', e.target.value)}
        />
      </label>
      <div className="customer-choice">
        <span>是否股民</span>
        <div>
          {(Object.keys(stocks) as (keyof typeof stocks)[]).map(value => (
            <button
              type="button"
              key={value}
              aria-pressed={profile.stockholder === value}
              onClick={() => update('stockholder', value)}
            >
              {stocks[value]}
            </button>
          ))}
        </div>
      </div>
      {(
        [
          ['address', '地址', 300],
          ['email', '邮箱', 254],
          ['occupation', '职业', 100],
          ['income', '收入', 100],
        ] as const
      ).map(([field, label, max]) => (
        <label htmlFor={`customer-${field}`} key={field}>
          {label}
          <input
            id={`customer-${field}`}
            type="text"
            maxLength={max}
            placeholder={`输入${label}`}
            value={profile[field]}
            onChange={e => update(field, e.target.value)}
          />
        </label>
      ))}
      <p>用户标签</p>
      <div className="customer-tags">
        {profile.tags.map(value => (
          <button
            type="button"
            key={value}
            onClick={() =>
              update(
                'tags',
                profile.tags.filter(t => t !== value),
              )
            }
            title="点击移除此标签"
          >
            {value} ×
          </button>
        ))}
      </div>
      <form
        className="customer-tag-form"
        onSubmit={e => {
          e.preventDefault();
          if (tag.trim() && profile.tags.length < 50) {
            update('tags', [...new Set([...profile.tags, tag.trim()])]);
            setTag('');
          }
        }}
      >
        <input
          aria-label="新用户标签"
          maxLength={50}
          placeholder="输入标签"
          value={tag}
          onChange={e => setTag(e.target.value)}
        />
        <button
          type="submit"
          disabled={!tag.trim() || profile.tags.length >= 50}
        >
          添加
        </button>
      </form>
      <label htmlFor="customer-notes">
        备注
        <textarea
          id="customer-notes"
          rows={6}
          maxLength={10_000}
          placeholder="客户需求、喜好、报价等"
          value={profile.notes}
          onChange={e => update('notes', e.target.value)}
        />
      </label>
      <p role="status" className="tools-notice">
        {status || runtime.error}
      </p>
    </>
  );
}
export default function CustomerPanel({
  runtime,
  activeId,
  onClose,
}: {
  runtime: CustomerRuntime;
  activeId?: string;
  onClose: () => void;
}) {
  const [, render] = useState(0);
  useEffect(() => {
    const listener = () => render(n => n + 1);
    runtime.listeners.add(listener);
    listener();
    return () => {
      runtime.listeners.delete(listener);
    };
  }, [runtime]);
  useEffect(() => {
    void runtime.refresh();
  }, [runtime, activeId]);
  const context = runtime.current;
  const bundle = context ? runtime.bundle : undefined;
  const id = context?.chat?.id;
  const canonical = id ? bundle?.aliases[id] || id : '';
  useEffect(() => {
    void runtime.resolveAliases().catch(error => {
      runtime.error = String(error);
      runtime.notify();
    });
  }, [runtime, activeId, id]);
  return (
    <section
      className="account-tools-panel customer-panel"
      aria-label="客户资料"
    >
      <div className="customer-panel-header">
        <h2>客户资料</h2>
        <button type="button" aria-label="关闭客户资料" onClick={onClose}>
          <Icon icon={mdiClose} size={0.8} />
        </button>
      </div>
      {bundle ? (
        context?.chat?.group ? (
          <p>群聊不显示客户资料，可在聊天列表中填写快速备注。</p>
        ) : context?.chat ? (
          <CustomerEditor
            key={`${bundle.owner}:${canonical}:${context.token}`}
            runtime={runtime}
            owner={bundle.owner}
            id={canonical}
            contact={context.chat}
          />
        ) : (
          <p>请先打开一个私聊联系人，再查看客户资料。</p>
        )
      ) : (
        <p>
          {runtime.error ||
            (context?.canInitialize
              ? '客户功能正在初始化，请稍候…'
              : '请先选择已登录的 WhatsApp 账号。')}
        </p>
      )}
    </section>
  );
}
export function CustomerRemarkDialog({
  runtime,
}: {
  runtime: CustomerRuntime;
}) {
  const [, render] = useState(0);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const previousEditor = useRef(runtime.editor);
  useEffect(() => {
    const listener = () => {
      if (previousEditor.current !== runtime.editor) {
        previousEditor.current = runtime.editor;
        setValue(runtime.editor?.profile.remarkName || '');
        setError('');
      }
      render(n => n + 1);
    };
    runtime.listeners.add(listener);
    listener();
    return () => {
      runtime.listeners.delete(listener);
    };
  }, [runtime]);
  const { editor } = runtime;
  const close = () => {
    if (!busy) {
      runtime.editor = undefined;
      runtime.notify();
    }
  };
  return (
    <>
      {runtime.error && (
        <div className="customer-error" role="alert">
          <span>{runtime.error}</span>
          <button
            type="button"
            aria-label="关闭客户操作提示"
            onClick={() => {
              runtime.error = '';
              runtime.notify();
            }}
          >
            ×
          </button>
        </div>
      )}
      <Dialog
        open={Boolean(editor)}
        className="account-tools-dialog"
        fullWidth
        maxWidth="sm"
        onClose={close}
      >
        <DialogTitle>联系人备注名</DialogTitle>
        <DialogContent>
          <p>{editor?.chatId}</p>
          <input
            aria-label="联系人备注名"
            maxLength={100}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
          <p className="tools-muted">
            红色短备注显示在昵称或号码下方，与客户资料中的备注名同步。
          </p>
          <p role="alert">{error}</p>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={close}>
            取消
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={async () => {
              if (!editor) return;
              setBusy(true);
              try {
                await runtime.save(
                  editor.owner,
                  editor.chatId,
                  { ...editor.profile, remarkName: value },
                  ['remarkName'],
                );
                runtime.editor = undefined;
                runtime.notify();
              } catch (error_) {
                setError(String(error_));
              } finally {
                setBusy(false);
              }
            }}
          >
            保存备注名
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
