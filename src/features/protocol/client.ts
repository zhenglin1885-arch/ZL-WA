import { ipcRenderer } from 'electron';
import { runInAction } from 'mobx';
import type Service from '../../models/Service';
import { mergeAccountSnapshot } from '../accounts/whatsapp';
import type { ProtocolState } from './types';
export const protocolStates = new Map<string, ProtocolState>();
export const protocolChats = new Map<string, string>();
const savedProfiles = new Map<string, string>();
const listeners = new Map<string, Set<(state: ProtocolState) => void>>();
let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  ipcRenderer.on(
    'protocol-state',
    (_event, id: string, update: Partial<ProtocolState>) => {
      const state = {
        ...(protocolStates.get(id) || {}),
        ...update,
      } as ProtocolState;
      protocolStates.set(id, state);
      for (const listener of listeners.get(id) || []) listener(state);
    },
  );
}
export function protocolRequest<T = any>(
  id: string,
  action: string,
  args: any = {},
): Promise<T> {
  return ipcRenderer.invoke('protocol-request', id, action, args);
}
export function subscribeProtocol(
  service: Service,
  listener: (state: ProtocolState) => void,
) {
  listen();
  const receive = (state: ProtocolState) => {
    if (!service.isProtocol || service.isHibernating || !service.isEnabled)
      return;
    runInAction(() => {
      service.accountSnapshot = mergeAccountSnapshot(service.accountSnapshot, {
        status:
          state.status === 'connected'
            ? 'online'
            : ['qr', 'logged-out'].includes(state.status)
              ? 'logged-out'
              : ['error', 'disconnected'].includes(state.status)
                ? 'error'
                : 'loading',
        ...(state.ownerId
          ? {
              ownerId: state.ownerId,
              ownerIds: state.ownerIds,
              nickname: state.nickname,
              phone: state.phone,
            }
          : {}),
        unreadMessages: (state.chats || []).reduce(
          (n, chat) => n + chat.unread,
          0,
        ),
      });
      service.hasCrashed = false;
      service.unreadDirectMessageCount =
        service.accountSnapshot.unreadMessages || 0;
      service.unreadIndirectMessageCount = 0;
      service.isLoading = false;
      service.isLoadingPage = false;
      service.isError = false;
    });
    if (state.status === 'connected' && state.ownerId) {
      const profile = {
        status: 'online',
        ownerId: state.ownerId,
        ownerIds: state.ownerIds,
        nickname: state.nickname.slice(0, 100),
        ...(state.phone ? { phone: state.phone } : {}),
      };
      const fingerprint = JSON.stringify(profile);
      if (savedProfiles.get(service.id) !== fingerprint) {
        savedProfiles.set(service.id, fingerprint);
        void ipcRenderer
          .invoke('account-tools-profile', service.id, profile)
          .catch(() => savedProfiles.delete(service.id));
      }
    }
    listener(state);
  };
  if (!listeners.has(service.id)) listeners.set(service.id, new Set());
  listeners.get(service.id)!.add(receive);
  if (protocolStates.has(service.id))
    receive({
      ...protocolStates.get(service.id)!,
      status: 'connecting',
      qr: null,
    });
  return () => {
    listeners.get(service.id)?.delete(receive);
    protocolStates.delete(service.id);
    if (service.isProtocol)
      runInAction(() => {
        service.accountSnapshot = {
          ...service.accountSnapshot,
          status: 'loading',
        };
      });
  };
}
export function protocolTarget(service: Service | undefined, owner?: string) {
  if (
    !service?.isProtocol ||
    !service.isEnabled ||
    service.isHibernating ||
    service.accountSnapshot.status !== 'online'
  )
    throw new Error('账号已离线或休眠');
  if (
    owner &&
    ![
      service.accountSnapshot.ownerId,
      ...(service.accountSnapshot.ownerIds || []),
    ].includes(owner)
  )
    throw new Error('账号登录身份已变化，请重新选择');
  return service.id;
}
export function openProtocolChat(serviceId: string, jid: string) {
  protocolChats.set(serviceId, jid);
  window.dispatchEvent(
    new CustomEvent('zl-protocol-open', { detail: { serviceId, jid } }),
  );
}
