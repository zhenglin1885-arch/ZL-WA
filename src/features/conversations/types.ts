import type { CustomerFlag } from '../customers/types';

export interface ConversationItem {
  id: string;
  aliases: string[];
  name: string;
  phone: string;
  group: boolean;
  archived: boolean;
  unread: number;
  preview: string;
  timestamp: number;
  lastFromMe?: boolean;
  contactOnly?: boolean;
}
export interface AggregateConversation extends ConversationItem {
  key: string;
  membershipKey: string;
  accountId: string;
  owner: string;
  ownerAliases: string[];
  accountName: string;
  accountRemark: string;
  remark: string;
  flags?: CustomerFlag[];
}
export interface ConversationGroups {
  groups: { id: string; name: string; collapsed: boolean }[];
  members: Record<string, string>;
}
