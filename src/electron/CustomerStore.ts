import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import {
  emptyCustomer,
  validateCustomer,
  type CustomerProfile,
  type CustomerBundle,
} from '../features/customers/types';

interface Account {
  revision: number;
  profiles: Record<string, CustomerProfile>;
  aliases: Record<string, string>;
  pins: string[];
  pinsInitialized?: boolean;
  unpinned?: string[];
}
export function customerId(id: unknown, owner = false): string {
  if (
    typeof id !== 'string' ||
    !new RegExp(
      owner
        ? '^\\d{5,30}@(c\\.us|lid)$'
        : '^\\d{1,40}(?:-\\d{1,30})?@(c\\.us|lid|g\\.us)$',
    ).test(id)
  )
    throw new Error('无效 WhatsApp 标识');
  return id;
}
export default class CustomerStore {
  private data: {
    version: 1;
    owners: Record<string, string>;
    accounts: Record<string, Account>;
  } = { version: 1, owners: {}, accounts: {} };

  constructor(private path: string) {
    if (existsSync(path)) {
      const value = JSON.parse(readFileSync(path, 'utf8'));
      if (value.version !== 1 || !value.owners || !value.accounts)
        throw new Error('客户资料文件格式无效，请保留文件并检查');
      this.data = value;
    }
  }

  private save() {
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.data), {
      mode: 0o600,
    });
    renameSync(`${this.path}.tmp`, this.path);
  }

  private mutate<T>(fn: () => T): T {
    const previous = structuredClone(this.data);
    try {
      const result = fn();
      this.save();
      return result;
    } catch (error) {
      this.data = previous;
      throw error;
    }
  }

  private account(owner: string): Account {
    customerId(owner, true);
    const key = this.data.owners[owner] || owner;
    this.data.accounts[key] ??= {
      revision: 0,
      profiles: {},
      aliases: {},
      pins: [],
    };
    return this.data.accounts[key];
  }

  bind(identities: string[]): CustomerBundle {
    if (
      !Array.isArray(identities) ||
      identities.length === 0 ||
      identities.length > 2
    )
      throw new Error('请先登录 WhatsApp');
    identities.forEach(id => customerId(id, true));
    const preferred =
      identities.find(id => id.endsWith('@c.us')) || identities[0];
    const known = identities.map(id => this.data.owners[id] || id);
    const owner = this.data.owners[preferred] || preferred;
    if (
      identities.some(id => this.data.owners[id] !== owner) ||
      known.some(key => key !== owner && this.data.accounts[key])
    )
      this.mutate(() => {
        const target = this.account(owner);
        for (const key of known)
          if (key !== owner && this.data.accounts[key]) {
            const old = this.data.accounts[key];
            target.profiles = { ...old.profiles, ...target.profiles };
            target.aliases = { ...old.aliases, ...target.aliases };
            target.pins = [...new Set([...target.pins, ...old.pins])];
            target.unpinned = [
              ...new Set([...(target.unpinned || []), ...(old.unpinned || [])]),
            ].filter(id => !target.pins.includes(id));
            target.pinsInitialized ||= old.pinsInitialized;
            Reflect.deleteProperty(this.data.accounts, key);
            for (const [alias, canonical] of Object.entries(this.data.owners))
              if (canonical === key) this.data.owners[alias] = owner;
          }
        identities.forEach(id => {
          this.data.owners[id] = owner;
        });
        target.revision += 1;
      });
    return this.bundle(owner);
  }

  bundle(owner: string): CustomerBundle {
    const account = this.account(owner);
    const canonicalOwner = this.data.owners[owner] || owner;
    return {
      owner: canonicalOwner,
      ownerAliases: [
        ...new Set([
          canonicalOwner,
          ...Object.entries(this.data.owners)
            .filter(([, target]) => target === canonicalOwner)
            .map(([id]) => id),
        ]),
      ],
      revision: account.revision,
      pins: [...account.pins],
      pinsInitialized: Boolean(account.pinsInitialized),
      unpinned: [...(account.unpinned || [])],
      aliases: { ...account.aliases },
      summaries: Object.fromEntries(
        Object.entries(account.profiles).map(([id, p]) => [
          id,
          { remarkName: p.remarkName, flags: [...p.flags] },
        ]),
      ),
    };
  }

  link(owner: string, ids: string[]): string {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 2)
      throw new Error('无效联系人映射');
    ids.forEach(id => customerId(id));
    const account = this.account(owner);
    const canonical =
      ids.find(id => id.endsWith('@c.us')) ||
      ids.map(id => account.aliases[id]).find(id => id?.endsWith('@c.us')) ||
      account.aliases[ids[0]] ||
      ids[0];
    if (ids.every(id => account.aliases[id] === canonical)) return canonical;
    return this.mutate(() => {
      for (const id of ids) {
        const oldKey = account.aliases[id] || id;
        if (oldKey !== canonical && account.profiles[oldKey]) {
          account.profiles[canonical] =
            account.profiles[canonical] || account.profiles[oldKey];
          Reflect.deleteProperty(account.profiles, oldKey);
        }
        for (const [alias, target] of Object.entries(account.aliases))
          if (target === oldKey) account.aliases[alias] = canonical;
        account.aliases[id] = canonical;
        account.pins = [
          ...new Set(account.pins.map(p => (p === oldKey ? canonical : p))),
        ];
        account.unpinned = [
          ...new Set(
            (account.unpinned || []).map(p => (p === oldKey ? canonical : p)),
          ),
        ];
      }
      account.revision += 1;
      return canonical;
    });
  }

  profile(owner: string, id: string): CustomerProfile {
    customerId(id);
    const account = this.account(owner);
    return structuredClone(
      account.profiles[account.aliases[id] || id] || emptyCustomer(),
    );
  }

  update(owner: string, id: string, input: unknown): CustomerBundle {
    customerId(id);
    const profile = validateCustomer(input);
    return this.mutate(() => {
      const a = this.account(owner);
      a.profiles[a.aliases[id] || id] = profile;
      a.revision += 1;
      return this.bundle(owner);
    });
  }

  patch(owner: string, id: string, input: unknown): CustomerBundle {
    if (
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input) ||
      Object.keys(input).some(key => !Object.hasOwn(emptyCustomer(), key))
    )
      throw new Error('无效客户资料字段');
    return this.update(owner, id, { ...this.profile(owner, id), ...input });
  }

  importPins(owner: string, ids: string[]): CustomerBundle {
    if (!Array.isArray(ids) || ids.length > 10_000)
      throw new Error('无效置顶列表');
    ids.forEach(id => customerId(id));
    const account = this.account(owner);
    if (account.pinsInitialized) return this.bundle(owner);
    return this.mutate(() => {
      account.pins = [
        ...new Set([
          ...account.pins,
          ...ids
            .map(id => account.aliases[id] || id)
            .filter(id => !account.unpinned?.includes(id)),
        ]),
      ];
      account.pinsInitialized = true;
      account.revision += 1;
      return this.bundle(owner);
    });
  }

  pin(
    owner: string,
    id: string,
    action: 'pin' | 'unpin' | 'up' | 'down',
  ): CustomerBundle {
    customerId(id);
    if (!['pin', 'unpin', 'up', 'down'].includes(action))
      throw new Error('无效置顶操作');
    return this.mutate(() => {
      const a = this.account(owner);
      const key = a.aliases[id] || id;
      const index = a.pins.indexOf(key);
      if (action === 'pin' && index < 0) a.pins.unshift(key);
      if (action === 'pin')
        a.unpinned = (a.unpinned || []).filter(p => p !== key);
      if (action === 'unpin') {
        a.pins = a.pins.filter(p => p !== key);
        a.unpinned = [...new Set([...(a.unpinned || []), key])];
      }
      const next = action === 'up' ? index - 1 : index + 1;
      if (
        ['up', 'down'].includes(action) &&
        index >= 0 &&
        next >= 0 &&
        next < a.pins.length
      )
        [a.pins[index], a.pins[next]] = [a.pins[next], a.pins[index]];
      a.revision += 1;
      return this.bundle(owner);
    });
  }
}
