import {
  mkdir,
  readFile,
  writeFile,
  rename,
  mkdtemp,
  rm,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import makeSocket, {
  useMultiFileAuthState,
  BufferJSON,
  downloadMediaMessage,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { deviceBrowser } from './device.mjs';
import QRCode from 'qrcode';
import ffmpeg from 'ffmpeg-static';
import {
  ProtocolAccount,
  normalizeJid,
  wireJid,
  messageText,
  matchesText,
} from './model.mjs';
const port = process.parentPort;
if (!port) throw Error('Protocol backend requires its application parent');
const logger = pino({ level: 'silent' });
let account, directory;
const run = promisify(execFile);
async function voice(media) {
  if (!media) return media;
  const temporary = await mkdtemp(join(tmpdir(), 'zl-voice-'));
  try {
    await writeFile(join(temporary, 'input'), media.buffer, { mode: 0o600 });
    await run(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        join(temporary, 'input'),
        '-vn',
        '-ac',
        '1',
        '-c:a',
        'libopus',
        '-b:a',
        '32k',
        '-y',
        join(temporary, 'voice.ogg'),
      ],
      { timeout: 90000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    return {
      ...media,
      buffer: await readFile(join(temporary, 'voice.ogg')),
      mime: 'audio/ogg; codecs=opus',
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
async function video(media) {
  if (!media) return media;
  const temporary = await mkdtemp(join(tmpdir(), 'zl-video-'));
  try {
    const input = join(temporary, 'input'),
      output = join(temporary, 'video.mp4'),
      thumb = join(temporary, 'thumb.jpg');
    await writeFile(input, media.buffer, { mode: 0o600 });
    await run(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-protocol_whitelist',
        'file,pipe',
        '-i',
        input,
        '-map',
        '0:v:0',
        '-map',
        '0:a?',
        '-c:v',
        'libx264',
        '-threads',
        '2',
        '-preset',
        'veryfast',
        '-crf',
        '24',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-movflags',
        '+faststart',
        '-y',
        output,
      ],
      { timeout: 90000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    const buffer = await readFile(output);
    if (buffer.length > 50 * 1024 * 1024)
      throw Error('转换后的视频超过 50 MB，未发送');
    await run(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-i',
        output,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2',
        '-y',
        thumb,
      ],
      { timeout: 20000, maxBuffer: 1024 * 1024, windowsHide: true },
    );
    return {
      ...media,
      buffer,
      mime: 'video/mp4',
      thumbnail: await readFile(thumb),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function make(config, network) {
  if (network?.url) throw Error('此测试版本只支持直连，不会绕过已配置的代理');
  return makeSocket({ ...config, browser: deviceBrowser() });
}

async function request(action, args) {
  if (action === 'initialize') {
    if (account) return account.snapshot();
    directory = args.directory;
    await mkdir(join(directory, 'auth'), { recursive: true, mode: 0o700 });
    account = new ProtocolAccount({
      createSocket: make,
      credentials: () => useMultiFileAuthState(join(directory, 'auth')),
      qrImage: token => QRCode.toDataURL(token, { width: 300, margin: 2 }),
      logger,
      load: async () => {
        try {
          return JSON.parse(
            await readFile(join(directory, 'messages.json'), 'utf8'),
            BufferJSON.reviver,
          );
        } catch (error) {
          if (error.code === 'ENOENT') return null;
          throw Error('消息缓存无法读取，未覆盖旧文件');
        }
      },
      persist: async data => {
        const temp = join(directory, 'messages.tmp');
        await writeFile(temp, JSON.stringify(data, BufferJSON.replacer), {
          mode: 0o600,
        });
        await rename(temp, join(directory, 'messages.json'));
      },
      emit: state => port.postMessage({ event: 'state', state }),
    });
    await account.initialize();
    return account.snapshot();
  }
  if (!account) throw Error('账号尚未初始化');
  if (action === 'start') {
    await account.start(args.network);
    return account.snapshot();
  }
  if (action === 'stop') {
    account.stop();
    await account.authSaves;
    await account.flush();
    return true;
  }
  if (action === 'state') return account.snapshot();
  if (action === 'aliases') {
    account.assertOwner(args.owner);
    const ids = [normalizeJid(args.jid)];
    if (args.jid?.endsWith('@lid')) {
      const pn = await account.socket.signalRepository?.lidMapping?.getPNForLID(
        args.jid,
      );
      if (pn) ids.push(normalizeJid(pn));
    }
    return [...new Set(ids)];
  }
  if (action === 'profile-photo') {
    account.assertOwner(args.owner);
    try {
      const url = new URL(
        await account.socket.profilePictureUrl(
          wireJid(args.jid),
          'preview',
          5000,
        ),
      );
      if (
        url.protocol !== 'https:' ||
        !['whatsapp.net', 'fbcdn.net'].some(domain =>
          url.hostname.endsWith('.' + domain),
        )
      )
        return '';
      return url.href;
    } catch {
      return '';
    }
  }
  if (action === 'messages') return account.listMessages(args.jid);
  if (action === 'recipients') return account.recipients(args.kind);
  if (action === 'groups') return account.groups(args.owner);
  if (action === 'group-operation')
    return account.groupOperation(args.task, args.execute);
  if (action === 'read') return account.read(args.jid);
  if (action === 'read-all') {
    let read = 0,
      failed = 0;
    for (const chat of account.chats.values()) {
      if (!chat.unread) continue;
      try {
        await account.read(chat.id);
        read++;
      } catch {
        failed++;
      }
    }
    return { read, failed };
  }
  if (action === 'send') {
    let media = args.media
      ? { ...args.media, buffer: Buffer.from(args.media.data, 'base64') }
      : undefined;
    if (args.spec?.type === 'audio') media = await voice(media);
    if (args.spec?.type === 'video') media = await video(media);
    return account.send(
      args.jid,
      args.spec,
      media,
      args.owner,
      args.blockChinese,
    );
  }
  if (action === 'reconcile')
    return account.reconcile(
      args.jid,
      args.id || account.pendingGroups.get(`send:${args.token}`)?.messageId,
      args.owner,
    );
  if (action === 'edit')
    return account.edit(
      args.jid,
      args.id,
      args.text,
      args.owner,
      args.blockChinese,
    );
  if (action === 'revoke') return account.revoke(args.jid, args.id, args.owner);
  if (action === 'media') {
    account.assertOwner(args.owner);
    const row = account.messages
      .get(args.jid)
      ?.find(row => row.key.id === args.id);
    if (!row) throw Error('消息尚未同步');
    const buffer = await downloadMediaMessage(
      row,
      'buffer',
      {},
      { logger, reuploadRequest: account.socket.updateMediaMessage },
    );
    if (buffer.length > 50 * 1024 * 1024) throw Error('附件超过 50 MB');
    const content = row.message;
    const meta =
      content.imageMessage ||
      content.videoMessage ||
      content.audioMessage ||
      content.documentMessage;
    if (!meta) throw Error('消息没有可下载的附件');
    return {
      data: buffer.toString('base64'),
      mime: meta.mimetype || 'application/octet-stream',
      name: meta.fileName || '附件',
    };
  }
  if (action === 'reaction-candidates') {
    account.assertOwner(args.owner);
    return (account.messages.get(args.jid) || [])
      .filter(row => row.message?.imageMessage)
      .slice(-100)
      .reverse()
      .map(row => ({
        messageId: row.key.id,
        text: messageText(row.message),
        timestamp: Number(row.messageTimestamp) * 1000,
        imageHash: Buffer.from(
          row.message.imageMessage.fileSha256 || [],
        ).toString('hex'),
      }));
  }
  if (action === 'reaction') {
    account.assertOwner(args.owner);
    if (!args.jid?.endsWith('@g.us')) throw Error('无效群组');
    const meta = await account.socket.groupMetadata(wireJid(args.jid));
    if (
      !meta.participants?.some(p =>
        account.state.ownerIds.includes(normalizeJid(p.id)),
      )
    )
      throw Error('当前账号已不在群组');
    const rows = account.messages.get(args.jid) || [];
    const selected = args.task
      ? rows.find(row => row.key.id === args.task.messageId)
      : [...rows]
          .reverse()
          .find(row => matchesText(messageText(row.message), args.rules));
    if (!selected)
      return {
        error: '已同步消息中未找到匹配内容',
        status: 'failed',
        message: '未找到消息，未发送表情',
      };
    const text =
      account.listMessages(args.jid).find(m => m.id === selected.key.id)
        ?.text || '';
    if (!args.task)
      return {
        messageId: selected.key.id,
        text,
        timestamp: Number(selected.messageTimestamp) * 1000,
      };
    if (
      args.rules?.content === 'image' &&
      (!args.task.imageHash ||
        Buffer.from(selected.message?.imageMessage?.fileSha256 || []).toString(
          'hex',
        ) !== args.task.imageHash)
    )
      return {
        status: 'failed',
        message: '图片内容未确认或已变化，未发送表情',
      };
    if (args.rules?.content !== 'image' && text !== args.task.text)
      return { status: 'failed', message: '消息正文已变化，未提交表情' };
    const own = selected.reactions?.find(r => r.key?.fromMe);
    if (own?.text === args.task.emoji)
      return { status: 'success', message: '已核验表情' };
    if (args.verifyOnly)
      return { status: 'uncertain', message: '服务器表情状态尚未确认，未重发' };
    const key = `reaction:${args.task.id}`;
    if (account.pendingGroups.has(key))
      return { status: 'uncertain', message: '已提交表情，未重复发送' };
    account.pendingGroups.set(key, { submitted: true });
    await account.flush();
    await account.socket.sendMessage(wireJid(args.jid), {
      react: { key: selected.key, text: args.task.emoji },
    });
    await account.sleep(500);
    if (
      selected.reactions?.some(r => r.key?.fromMe && r.text === args.task.emoji)
    )
      return { status: 'success', message: '已核验表情' };
    return { status: 'uncertain', message: '表情已提交，等待服务器同步核验' };
  }
  if (action === 'diagnostics') return account.diagnostics();
  throw Error('不支持此操作');
}
port.on('message', async ({ data }) => {
  if (!data || typeof data.id !== 'number' || typeof data.action !== 'string')
    return;
  try {
    const value = await request(data.action, data.args || {});
    port.postMessage({ id: data.id, value });
  } catch (error) {
    if (
      data.action === 'send' &&
      !account?.pendingGroups.has(`send:${data.args?.spec?.operationToken}`)
    ) {
      port.postMessage({
        id: data.id,
        value: {
          messageId: '',
          confirmed: false,
          notSubmitted: true,
          error: String(error?.message || '发送准备失败，未提交').slice(0, 500),
        },
      });
      return;
    }
    port.postMessage({
      id: data.id,
      error: String(error?.message || '操作失败')
        .replace(/(?:https?|socks5?):\/\/[^\s]+/g, '[网络地址]')
        .slice(0, 500),
    });
  }
});
