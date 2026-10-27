/* eslint-disable unicorn/consistent-function-scoping -- Serialized guest UI keeps its helpers local. */
import type { sendBulkMessage } from '../accountTools/bulkGuest';

// Intercept only an explicitly audio-only file picker. This route does not
// depend on private MediaPrep methods used by the native upload preview.
export function configureWhatsAppAudioUpload(
  send: typeof sendBulkMessage,
): boolean {
  if (globalThis.location.hostname !== 'web.whatsapp.com') return false;
  const page = window as any;
  if (page.__zlAudioUpload) {
    page.__zlAudioUpload.send = send;
    return true;
  }
  const state = { revision: 1, send, last: 'ready', dialog: null as any };
  page.__zlAudioUpload = state;
  const idOf = (value: any): string =>
    typeof value === 'string' ? value : value?._serialized || '';
  const audioExtensions = /\.(?:ogg|oga|opus|mp3|m4a|aac|wav|amr|flac|webm)$/i;
  const isAudioPicker = (input: HTMLInputElement) => {
    const types = input.accept
      .split(',')
      .map(type => type.trim().toLowerCase());
    return (
      input.type === 'file' &&
      types.length > 0 &&
      types.every(
        type => type.startsWith('audio/') || audioExtensions.test(type),
      )
    );
  };
  const show = (message: string, file?: File, context?: any) => {
    if (state.dialog) return;
    const dialog = document.createElement('dialog');
    state.dialog = dialog;
    dialog.dataset.zlAudioUpload = '';
    dialog.style.cssText =
      'max-width:440px;width:85%;border:1px solid #777;border-radius:12px;padding:24px;background:Canvas;color:CanvasText;';
    const title = document.createElement('h3');
    title.textContent = '发送语音';
    const status = document.createElement('p');
    status.dataset.zlAudioStatus = '';
    status.textContent = message;
    status.setAttribute('aria-live', 'polite');
    const cancel = document.createElement('button');
    cancel.textContent = file ? '取消' : '关闭';
    cancel.dataset.zlAudioCancel = '';
    let url: string | undefined;
    let sending = false;
    let attempted = false;
    const close = () => {
      if (sending) return;
      dialog.close();
      dialog.remove();
      if (url) URL.revokeObjectURL(url);
      state.dialog = null;
    };
    cancel.addEventListener('click', close);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      close();
    });
    dialog.append(title, status);
    if (file && context) {
      const name = document.createElement('p');
      name.textContent = file.name;
      const player = document.createElement('audio');
      player.controls = true;
      url = URL.createObjectURL(file);
      player.src = url;
      player.style.width = '100%';
      const confirm = document.createElement('button');
      confirm.textContent = '发送';
      confirm.dataset.zlAudioSend = '';
      confirm.style.marginInlineStart = '12px';
      confirm.addEventListener('click', async () => {
        if (sending || attempted) return;
        attempted = true;
        sending = true;
        confirm.disabled = true;
        cancel.disabled = true;
        state.last = 'sending';
        player.pause();
        status.textContent = '正在生成波形并发送语音…';
        try {
          const data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () =>
              resolve(String(reader.result)),
            );
            reader.addEventListener('error', () =>
              reject(new Error('无法读取音频文件，未发送')),
            );
            reader.readAsDataURL(file);
          });
          const result = await state.send(
            context.chatId,
            {
              type: 'audio',
              text: '',
              targets: [],
              typingSeconds: 0,
              intervalMin: 0,
              intervalMax: 0,
              mentionAll: false,
              failure: 'stop',
              media: {
                id: '',
                name: file.name,
                mime: file.type,
                size: file.size,
              },
            },
            data,
            {
              ownerId: context.ownerId,
              quotedMessageId: context.quotedMessageId,
            },
          );
          state.last = result.confirmed ? 'submitted' : 'unconfirmed';
          status.textContent = result.confirmed
            ? '语音已发送'
            : '语音已提交，服务器回执仍待确认。请核对聊天记录，勿重复发送。';
          if (result.confirmed && context.quotedMessageId) {
            try {
              const active = page.WPP?.chat?.getActiveChat?.();
              if (
                idOf(page.WPP?.conn?.getMyUserWid?.()) === context.ownerId &&
                idOf(active?.id) === context.chatId &&
                idOf(active?.composeQuotedMsg?.id) === context.quotedMessageId
              )
                active.set?.({
                  composeQuotedMsg: null,
                  composeQuotedMsgRemoteJid: null,
                });
            } catch {
              // Composer cleanup cannot turn a confirmed send into a failure.
            }
          }
        } catch (error) {
          state.last = 'failed';
          status.textContent = `${error instanceof Error ? error.message : '语音发送未完成'}。请核对聊天记录后再操作。`;
        } finally {
          sending = false;
          cancel.disabled = false;
          cancel.textContent = '关闭';
        }
      });
      dialog.append(name, player, cancel, confirm);
    } else dialog.append(cancel);
    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  };
  document.addEventListener(
    'change',
    event => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !isAudioPicker(input)) return;
      const files = [...(input.files || [])];
      if (files.length === 0) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      input.value = '';
      if (state.dialog) return;
      if (files.length !== 1) {
        show('请每次选择一个音频文件，以便试听并确认接收人。');
        return;
      }
      let file = files[0];
      if (!file.type.startsWith('audio/') && !audioExtensions.test(file.name)) {
        show('所选文件不是可识别的音频，未发送。');
        return;
      }
      const wpp = page.WPP;
      let active: any;
      let ownerId = '';
      try {
        if (wpp?.isReady) {
          active = wpp.chat?.getActiveChat?.();
          ownerId = idOf(wpp.conn?.getMyUserWid?.());
        }
      } catch {
        // Lazy native exports may still be loading. Keep the file unsent.
      }
      const chatId = idOf(active?.id);
      if (!ownerId || !/^\d[\d-]*@(c\.us|lid|g\.us)$/.test(chatId)) {
        state.last = 'not-ready';
        show(
          '语音接口尚未就绪或没有选中聊天。请稍后在目标聊天中重新选择音频。',
        );
        return;
      }
      if (!file.type.startsWith('audio/')) {
        const extension = file.name.split('.').at(-1)?.toLowerCase() || '';
        const mime = {
          ogg: 'audio/ogg',
          oga: 'audio/ogg',
          opus: 'audio/ogg',
          mp3: 'audio/mpeg',
          m4a: 'audio/mp4',
          aac: 'audio/aac',
          wav: 'audio/wav',
          amr: 'audio/amr',
          flac: 'audio/flac',
          webm: 'audio/webm',
        }[extension];
        file = new File([file], file.name, {
          type: mime || 'application/octet-stream',
        });
      }
      const quotedMessageId = idOf(active.composeQuotedMsg?.id);
      show(
        `接收人：${active.formattedTitle || active.name || chatId}${quotedMessageId ? '（引用回复）' : ''}`,
        file,
        {
          chatId,
          ownerId,
          quotedMessageId,
        },
      );
    },
    true,
  );
  return true;
}
