export interface ProtocolChat {
  id: string;
  name: string;
  group: boolean;
  unread: number;
  timestamp: number;
  lastText?: string;
  archived?: boolean;
}
export interface ProtocolState {
  status: string;
  qr: string | null;
  syncEvents: number;
  nickname: string;
  ownerId: string;
  ownerIds: string[];
  phone: string;
  error: string;
  chats: ProtocolChat[];
  lastCode?: number | null;
}
export interface ProtocolMessage {
  id: string;
  jid: string;
  fromMe: boolean;
  participant: string;
  senderName?: string;
  text: string;
  kind: string;
  timestamp: number;
  status: number;
}
