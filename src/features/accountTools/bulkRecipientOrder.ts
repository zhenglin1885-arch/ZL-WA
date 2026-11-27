import type { Recipient } from './config';

// Input follows the displayed recipient list, not the order checkboxes were clicked.
// Reverse only group recipients within each account; keep account/private slots.
export function bottomUpGroupRecipients(targets: Recipient[]): Recipient[] {
  const groups = new Map<string, Recipient[]>();
  for (const target of targets) {
    if (target.group) {
      const account = groups.get(target.accountId) || [];
      account.push(target);
      groups.set(target.accountId, account);
    }
  }
  return targets.map(target =>
    target.group ? groups.get(target.accountId)!.pop()! : target,
  );
}
