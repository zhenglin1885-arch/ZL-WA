/* eslint-disable no-await-in-loop, no-continue, unicorn/consistent-function-scoping -- Serialized guest function; each group is read and mutated sequentially. */
import type * as WhatsAppAPI from '@wppconnect/wa-js/dist/whatsapp';
import type { GroupTask, GroupResult } from './types';

export async function groupGuest(request: {
  ownerId: string;
  task?: GroupTask;
  execute?: boolean;
}): Promise<
  | {
      groups: { id: string; name: string; admin: boolean; announce: boolean }[];
    }
  | GroupResult
> {
  if (globalThis.location.hostname !== 'web.whatsapp.com')
    throw new Error('当前页面不是 WhatsApp');
  const page = window as any;
  const wpp = page.WPP;
  if (!wpp?.isReady || !wpp.group) throw new Error('WhatsApp 群组接口尚未就绪');
  const idOf = (id: any): string =>
    id?._serialized ||
    (id?.user && id?.server
      ? `${id.user}@${id.server}`
      : typeof id === 'string'
        ? id
        : '');
  const own = () => {
    let prefs: any;
    try {
      prefs = page.require?.('WAWebUserPrefsMeUser');
    } catch {
      /* Native WPP fallback below. */
    }
    return [
      prefs?.getMaybeMePnUser?.(),
      prefs?.getMaybeMeLidUser?.(),
      wpp.conn?.getMyUserWid?.(),
      wpp.conn?.getMyUserLid?.(),
    ]
      .map(id => idOf(id))
      .includes(request.ownerId);
  };
  if (!own())
    return {
      status: 'failed',
      message: 'WhatsApp 登录身份已变化，请重新选择账号',
      retryable: false,
    };
  // Inventory and announcement settings require the current server group list.
  // Join/leave verification below reads only the target group's membership.
  const fresh = async (): Promise<any[]> => {
    const api = wpp.whatsapp as typeof WhatsAppAPI | undefined;
    const query = api?.functions?.queryAllGroups;
    if (typeof query !== 'function')
      throw new Error('群组读取接口尚未就绪，请刷新群组后重试');
    const values = await query();
    if (!Array.isArray(values)) throw new Error('群组状态返回异常');
    return values;
  };
  if (!request.task) {
    const groups: {
      id: string;
      name: string;
      admin: boolean;
      announce: boolean;
    }[] = [];
    for (const item of await fresh()) {
      const id = idOf(item.id);
      if (!id.endsWith('@g.us') || item.isParentGroup) continue;
      if (!(await wpp.group.iAmMember(id))) continue;
      let admin = false;
      try {
        admin = Boolean(await wpp.group.iAmAdmin(id));
      } catch {
        /* Membership remains visible for leaving. */
      }
      groups.push({
        id,
        name: String(item.subject || id),
        admin,
        announce: Boolean(item.announce),
      });
    }
    return { groups };
  }
  const { task } = request;
  if (task.operation === 'join' && !/^[\w-]{16,64}$/.test(task.target))
    return {
      status: 'failed',
      message: '无效的 WhatsApp 群邀请链接，未提交进群请求',
      retryable: false,
    };
  const describeError = (error: unknown) => {
    const text = String(error).slice(0, 500);
    const rateLimited = /rate[ _-]?overlimit|too many requests|\b429\b/i.test(
      text,
    );
    const invalid =
      /invalid_invite|invalid invite|expired|revoked|\b404\b|\b410\b/i.test(
        text,
      );
    const forbidden = /forbidden|not_allowed|not_authorized|\b403\b/i.test(
      text,
    );
    const full =
      /group[ _-]full|too_many_participants|max[ _-]participants|group.*capacity/i.test(
        text,
      );
    return {
      text,
      rateLimited,
      rejected: rateLimited || invalid || forbidden || full,
      reason: rateLimited
        ? 'WhatsApp 请求过于频繁，服务器限流，请稍后重试'
        : invalid
          ? '群邀请链接无效、已过期或已被撤销'
          : full
            ? '群组人数已满，无法加入'
            : forbidden
              ? 'WhatsApp 拒绝此操作，可能没有权限或账号受到限制'
              : '接口请求失败',
    };
  };
  page.__zlGroupOperations ??= new Map();
  const operations: Map<string, any> = page.__zlGroupOperations;
  const previous = task.token ? operations.get(task.token) : undefined;
  if (previous?.pending)
    return {
      status: 'uncertain',
      message: '上次请求仍在执行，暂不重复操作',
      inFlight: true,
    };
  const collection = () => {
    try {
      return (
        page.require?.('WAWebCollections')?.Chat || wpp.whatsapp?.ChatStore
      );
    } catch {
      return wpp.whatsapp?.ChatStore;
    }
  };
  const membership = async (id: string): Promise<boolean> => {
    try {
      return Boolean(await wpp.group.iAmMember(id));
    } catch (error) {
      if (
        /chat_not_found|chat not found/i.test(String(error)) &&
        (task.operation === 'join' || !collection()?.get(id))
      )
        return false;
      throw error;
    }
  };
  // Do not let WA-JS turn a failed metadata request (including 429) into
  // invalid_invite_code. Keep the native error and reuse a lookup in this call.
  let inviteLookup: Promise<any> | undefined;
  const inviteInfo = () => {
    inviteLookup ??= (async () => {
      const query = wpp.whatsapp?.functions?.sendQueryGroupInvite;
      if (typeof query !== 'function')
        return wpp.group.getGroupInfoFromInviteCode(task.target);
      const response = await query(task.target);
      if (!response?.groupInfo) throw new Error('invalid_invite_code');
      return response.groupInfo;
    })();
    return inviteLookup;
  };
  let attempted = false;
  let mutationReturned = false;
  let action =
    task.operation === 'join'
      ? '进群'
      : task.operation === 'leave'
        ? '退群'
        : '修改发言权限';
  const check = async (): Promise<GroupResult> => {
    let id = task.operation === 'join' ? task.groupId : task.target;
    let invite: any;
    if (task.operation === 'join' && !id) {
      invite = await inviteInfo();
      id = idOf(invite.id);
    }
    if (!id || !/^\d{1,40}(?:-\d{1,30})?@g\.us$/.test(id))
      throw new Error('群组编号未确认');
    // Joining/leaving needs only this group's membership. Repeatedly querying
    // every group before and after every item exhausts WhatsApp's read quota.
    const inventory =
      task.operation === 'join' || task.operation === 'leave'
        ? []
        : await fresh();
    const group = inventory.find(item => idOf(item.id) === id);
    const member =
      task.operation === 'join' || task.operation === 'leave'
        ? await membership(id)
        : group
          ? Boolean(await wpp.group.iAmMember(id))
          : false;
    if (task.operation === 'join') {
      if (member)
        return { status: 'success', message: '已确认加入群组', groupId: id };
      if (previous?.result?.status === 'approval' || task.status === 'approval')
        return {
          status: 'approval',
          message: '等待管理员审批，尚未加入群组',
          groupId: id,
        };
      if (task.joinSubmitted || previous?.result?.submitted)
        return {
          status: 'uncertain',
          message:
            '进群请求已接受，成员状态同步中；不会重复提交，请稍后刷新执行结果',
          groupId: id,
          submitted: true,
        };
      if (!invite && task.attempts > 0) invite = await inviteInfo();
      if (
        invite?.membershipApprovalMode &&
        task.attempts > 0 &&
        (!request.execute || attempted)
      )
        return {
          status: 'uncertain',
          message: '该群需要审批，当前未确认加入；请核查进群申请',
          groupId: id,
        };
      return {
        status: 'not-done',
        message: '尚未加入群组',
        groupId: id,
        retryable: true,
      };
    }
    if (task.operation === 'leave') {
      if (member)
        return {
          status: 'not-done',
          message: '仍在群组中',
          member: true,
          groupId: id,
          retryable: true,
        };
      if (!task.deleteGroup)
        return { status: 'success', message: '已确认退出群组', groupId: id };
      const chats = collection();
      if (!chats?.get)
        return {
          status: 'uncertain',
          message: '已退出，无法核验聊天删除状态',
          groupId: id,
        };
      return chats.get(id)
        ? {
            status: 'not-done',
            message: '已退出，待删除聊天记录',
            groupId: id,
            retryable: true,
          }
        : {
            status: 'success',
            message: '已确认退出并删除群组聊天',
            groupId: id,
          };
    }
    if (!member)
      return {
        status: 'failed',
        message: '当前账号已不在此群组',
        retryable: false,
      };
    if (typeof group.announce !== 'boolean')
      return { status: 'uncertain', message: '群发言权限返回不完整，尚未确认' };
    if (group.announce === (task.operation === 'mute'))
      return {
        status: 'success',
        message:
          task.operation === 'mute'
            ? '已确认仅管理员可发言'
            : '已确认所有成员可发言',
        groupId: id,
      };
    if (!(await wpp.group.iAmAdmin(id)))
      return {
        status: 'failed',
        message: '当前账号不是群管理员，无法修改发言权限',
        retryable: false,
      };
    return {
      status: 'not-done',
      message: '发言权限尚未达到目标',
      groupId: id,
      retryable: true,
    };
  };
  let before: GroupResult;
  try {
    before = await check();
  } catch (error) {
    const failure = describeError(error);
    if (
      request.execute &&
      (task.operation === 'join' || task.operation === 'leave') &&
      !task.joinSubmitted &&
      !previous &&
      (!failure.rejected || failure.rateLimited)
    )
      before = {
        status: 'not-done',
        message: '状态读取暂不可用，按所选对象执行',
        member: task.operation === 'leave',
        groupId: task.groupId,
      };
    else
      return {
        status:
          failure.rejected && !failure.rateLimited ? 'failed' : 'uncertain',
        message: `${failure.reason}；暂未核验状态（${failure.text}）`,
        retryable: false,
        rateLimited: failure.rateLimited,
        ...(task.joinSubmitted
          ? { submitted: true, groupId: task.groupId }
          : {}),
      };
  }
  if (!request.execute || before.status !== 'not-done') return before;
  if (!own())
    return {
      status: 'failed',
      message: '账号身份已变化，操作已取消',
      retryable: false,
    };
  if (!task.token) throw new Error('执行请求缺少唯一编号');
  const current: any = { pending: true };
  operations.set(task.token, current);
  // Keep in-flight entries even when trimming completed checkpoints.
  if (operations.size > 500)
    for (const [key, value] of operations) {
      if (operations.size <= 500) break;
      if (!value.pending) operations.delete(key);
    }
  try {
    attempted = true;
    if (task.operation === 'join') {
      let joined: any;
      const invokeJoin = async (fn: () => Promise<any>) => {
        try {
          return await fn();
        } catch (error: any) {
          // WhatsApp can throw this structured server response when the
          // approval mode changes between metadata lookup and submission.
          if (
            error?.name === 'UnexpectedJoinGroupViaInviteResponse' &&
            error.gid &&
            typeof error.membershipApprovalMode === 'boolean'
          )
            return {
              id: error.gid,
              pendingApproval: error.membershipApprovalMode,
            };
          throw error;
        }
      };
      attempted = false;
      // WA-JS upstream fix #3736 (issue #3734): the IQ function is lazy-loaded.
      // Use WhatsApp's own bootloader, never download executable code elsewhere.
      if (typeof wpp.loader?.ensureLazyModule === 'function')
        await wpp.loader.ensureLazyModule('WAWebGroupInviteJob');
      if (!own()) throw new Error('账号身份已变化，进群已取消');
      try {
        attempted = true;
        joined = await invokeJoin(() => wpp.group.join(task.target));
      } catch (error) {
        // WA-JS 4.7.1 matches joinGroupViaInvite together with resetGroupInviteCode.
        // New WhatsApp builds split these exports; resolve the exact callable
        // from native invite modules instead of changing any server request.
        if (!/joinGroupViaInvite.*not a function/.test(String(error)))
          throw error;
        attempted = false; // The missing callable never submitted a join request.
        let info: any;
        try {
          info = await inviteInfo();
        } catch (error) {
          const failure = describeError(error);
          if (failure.rejected && !failure.rateLimited) throw error;
          info = { membershipApprovalMode: false };
        }
        let native: any;
        let host: any;
        const registry = page.require?.('__debug')?.modulesMap;
        const names = new Set([
          'WAWebGroupInviteJob',
          ...(registry instanceof Map
            ? [...registry.keys()]
            : Object.keys(registry || {})),
        ]);
        for (const name of names) {
          if (!/^waweb.*(?:group.*invite|invite.*group)/i.test(name)) continue;
          try {
            const module = page.require(name);
            const candidates = [module, module?.default];
            host = candidates.find(
              value => typeof value?.joinGroupViaInvite === 'function',
            );
            if (host) {
              native = host.joinGroupViaInvite;
              break;
            }
          } catch {
            /* Unloaded native modules are not a valid adapter. */
          }
        }
        if (!native)
          throw new Error('当前 WhatsApp 进群接口不兼容，请更新软件后重试');
        if (!own()) throw new Error('账号身份已变化，进群已取消');
        try {
          attempted = true;
          const result = await native.call(
            host,
            task.target,
            Boolean(info.membershipApprovalMode),
          );
          joined = {
            id: result?.gid || result?.id,
            pendingApproval: Boolean(
              result?.membershipApprovalMode ?? info.membershipApprovalMode,
            ),
          };
        } catch (nativeError: any) {
          if (
            nativeError?.name !== 'UnexpectedJoinGroupViaInviteResponse' ||
            !nativeError.gid ||
            typeof nativeError.membershipApprovalMode !== 'boolean'
          )
            throw nativeError;
          joined = {
            id: nativeError.gid,
            pendingApproval: Boolean(nativeError.membershipApprovalMode),
          };
        }
      }
      mutationReturned = true;
      const id = idOf(joined?.id || joined);
      task.groupId = id || before.groupId;
      if (joined?.pendingApproval) {
        current.result = {
          status: 'approval',
          message: '进群申请已提交，等待管理员审批',
          groupId: id || before.groupId,
        };
        return current.result;
      }
      // An explicit successful response is a submission checkpoint, not proof
      // that the local membership model has already caught up.
      if (id && !joined?.pendingApproval) {
        task.joinSubmitted = true;
        current.result = { submitted: true };
      }
    } else if (task.operation === 'leave') {
      // A retry after an acknowledged exit only performs the missing deletion.
      if (before.member) {
        await wpp.group.leave(task.target);
        mutationReturned = true;
      }
      if (await membership(task.target))
        return {
          status: 'not-done',
          message: '退出尚未确认，未删除聊天',
          retryable: true,
        };
      if (task.deleteGroup && collection()?.get(task.target)) {
        action = '删除已退出群组的聊天记录';
        // eslint-disable-next-line sonar/no-dead-store -- The catch distinguishes a rejected deletion from failed readback after a successful exit.
        mutationReturned = false;
        await wpp.chat.delete(task.target);
        mutationReturned = true;
      }
    } else {
      await wpp.group.setProperty(
        task.target,
        'announcement',
        task.operation === 'mute',
      );
      mutationReturned = true;
    }
    let result = await check();
    if (task.operation === 'join' && task.joinSubmitted) {
      // Read-only settling checks; never issue a second join during this wait.
      for (const delay of [200, 400, 800]) {
        if (result.status === 'success' || result.status === 'approval') break;
        await new Promise(resolve => {
          setTimeout(resolve, delay);
        });
        if (!own()) throw new Error('账号身份已变化，结果待核验');
        result = await check();
      }
      result = { ...result, submitted: true };
    }
    current.result = result;
    return result;
  } catch (error) {
    if (!own())
      return {
        status: attempted ? 'uncertain' : 'failed',
        message: '账号身份已变化，请重新选择账号后核验结果',
        retryable: false,
        ...(task.joinSubmitted
          ? { submitted: true, groupId: task.groupId }
          : {}),
      };
    const failure = describeError(error);
    if (failure.rejected && !mutationReturned) {
      current.result = {
        status: 'failed',
        message: `${action}失败：${failure.reason}（${failure.text}）`,
        retryable: false,
        rateLimited: failure.rateLimited,
      };
      return current.result;
    }
    if (failure.rateLimited && mutationReturned)
      return {
        status: 'uncertain',
        message: `${action}请求已提交，但核验受到 WhatsApp 限流，结果待确认（${failure.text}）`,
        rateLimited: true,
        groupId: task.groupId || before.groupId,
        ...(task.joinSubmitted ? { submitted: true } : {}),
      };
    // An exception can arrive after the server applied a change. Read it back
    // before allowing the queue to retry any mutation.
    try {
      const result = await check();
      if (result.status !== 'not-done') {
        current.result = result;
        return result;
      }
      if (task.operation === 'join' && attempted) {
        current.result = {
          status: 'uncertain',
          message: `进群请求结果未确认，不自动重复提交：${String(error).slice(0, 500)}`,
          groupId: task.groupId || result.groupId,
          ...(task.joinSubmitted ? { submitted: true } : {}),
        };
        return current.result;
      }
      return {
        ...result,
        message: `${result.message}：${String(error).slice(0, 500)}`,
      };
    } catch {
      return {
        status: 'uncertain',
        message: `请求结果未确认：${String(error).slice(0, 500)}`,
        groupId: task.groupId,
        ...(task.joinSubmitted ? { submitted: true } : {}),
      };
    }
  } finally {
    current.pending = false;
  }
}
