export interface BackupConfig {
  enabled: boolean;
  automatic: boolean;
  time: string;
  directory: string;
  retentionDays: number;
}
export interface BackupMessage {
  id: string;
  time: number;
  sender: string;
  outgoing: boolean;
  text: string;
  translation?: string;
  image?: string;
  hasImage?: boolean;
}
export interface BackupPacket {
  ownerId: string;
  accountName: string;
  chatId: string;
  chatName: string;
  messages: BackupMessage[];
}
export interface BackupStats {
  messages: number;
  images: number;
  bytes: number;
  days: string[];
  lastExport?: string;
  error?: string;
}
export interface BackupState {
  config: BackupConfig;
  stats: BackupStats;
}
export const defaultBackupConfig = (directory = ''): BackupConfig => ({
  enabled: true,
  automatic: true,
  time: '23:30',
  directory,
  retentionDays: 365,
});
export function backupDay(time: number): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function validateBackupConfig(value: unknown): BackupConfig {
  const c = value as BackupConfig;
  if (
    !c ||
    typeof c.enabled !== 'boolean' ||
    typeof c.automatic !== 'boolean' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time) ||
    typeof c.directory !== 'string' ||
    c.directory.length > 3000 ||
    ![0, 7, 30, 90, 180, 365, 730].includes(c.retentionDays)
  )
    throw new Error('聊天备份设置无效');
  return {
    enabled: c.enabled,
    automatic: c.automatic,
    time: c.time,
    directory: c.directory,
    retentionDays: c.retentionDays,
  };
}
export function validateBackupPacket(value: unknown): BackupPacket {
  const p = value as BackupPacket;
  if (
    !p ||
    !/^\d{5,30}@(c\.us|lid)$/.test(p.ownerId) ||
    !/^\d{1,40}(?:-\d{1,30})?@(c\.us|lid|g\.us)$/.test(p.chatId) ||
    typeof p.chatName !== 'string' ||
    p.chatName.length > 500 ||
    typeof p.accountName !== 'string' ||
    p.accountName.length > 500 ||
    !Array.isArray(p.messages) ||
    p.messages.length > 250
  )
    throw new Error('聊天备份内容无效');
  let bytes = 0;
  for (const m of p.messages) {
    if (
      !m ||
      typeof m.id !== 'string' ||
      !m.id ||
      ['__proto__', 'constructor', 'prototype'].includes(m.id) ||
      m.id.length > 500 ||
      !Number.isFinite(m.time) ||
      m.time < 1_262_304_000_000 ||
      m.time > Date.now() + 86_400_000 ||
      typeof m.sender !== 'string' ||
      m.sender.length > 500 ||
      typeof m.outgoing !== 'boolean' ||
      typeof m.text !== 'string' ||
      m.text.length > 50_000 ||
      (m.translation !== undefined &&
        (typeof m.translation !== 'string' || m.translation.length > 50_000)) ||
      (m.image !== undefined &&
        (typeof m.image !== 'string' ||
          !/^data:image\/(jpeg|png|webp|gif);base64,[\d+/=A-Za-z]+$/.test(
            m.image,
          ) ||
          m.image.length > 22_000_000))
    )
      throw new Error('备份消息格式无效');
    bytes +=
      m.text.length + (m.translation?.length || 0) + (m.image?.length || 0);
  }
  if (bytes > 32_000_000) throw new Error('单批聊天备份过大，请分批保存');
  return structuredClone(p);
}
