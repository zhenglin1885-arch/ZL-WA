/* eslint-disable no-void -- Detached, internally handled translation jobs must not block account polling. */
/* eslint-disable @typescript-eslint/no-loop-func -- stopped is intentionally shared by pending jobs on cleanup. */
import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { getBulkQueue, ensureBulkLibrary } from './bulkRuntime';
import {
  voiceTranslationTick,
  readVoiceTranslationAudio,
  voiceTranslationResult,
  voiceTranslationCurrent,
  type VoiceTranslationJob,
} from './voiceTranslationGuest';
import { type ToolsConfig } from './config';
import {
  translationTick,
  translationResult,
  type TranslationRequest,
} from './guest';

const configs = new Map<string, ToolsConfig>();
export async function getTools(id: string): Promise<ToolsConfig> {
  if (!configs.has(id))
    configs.set(id, await ipcRenderer.invoke('account-tools-get', id));
  return configs.get(id)!;
}
export async function saveTools(
  id: string,
  config: ToolsConfig,
): Promise<ToolsConfig> {
  const previous = configs.get(id);
  const saved = await ipcRenderer.invoke('account-tools-save', id, config);
  configs.set(id, saved);
  if (
    JSON.stringify(previous?.proxy) !== JSON.stringify(saved.proxy) ||
    config.proxy.password !== undefined
  )
    window.dispatchEvent(
      new CustomEvent('zl-account-network-changed', { detail: id }),
    );
  return saved;
}
export async function configureTranslation(
  service: RealStores['services']['all'][number],
  textColor?: string,
): Promise<void> {
  const config = await getTools(service.id);
  if (service.webview) {
    await service.webview.executeJavaScript(
      `(${translationTick.toString()})(${JSON.stringify({ ...config.translation, textColor })},false)`,
    );
    await service.webview.executeJavaScript(
      `(${voiceTranslationTick.toString()})(${Boolean(config.translation.incoming)},${JSON.stringify(JSON.stringify(config.translation))},false)`,
    );
  }
}
export function startTranslations(stores: RealStores): () => void {
  const bulk = getBulkQueue(stores);
  bulk.start();
  let stopped = false;
  const running = new Set<string>();
  const pending = new Set<string>();
  const voiceJobs = new Set<string>();
  const runVoice = async (
    service: RealStores['services']['all'][number],
    view: Electron.WebviewTag,
    job: VoiceTranslationJob,
  ) => {
    if (voiceJobs.has(service.id)) return;
    voiceJobs.add(service.id);
    let transcript = '';
    try {
      // Check credentials before downloading/decrypting any media.
      await ipcRenderer.invoke('account-tools-voice-ready', service.id);
      await ensureBulkLibrary(view);
      const media = await view.executeJavaScript(
        `(${readVoiceTranslationAudio.toString()})(${JSON.stringify(job)})`,
      );
      if (
        stopped ||
        service.webview !== view ||
        !(await view.executeJavaScript(
          `(${voiceTranslationCurrent.toString()})(${JSON.stringify(job)})`,
        ))
      )
        return;
      const recognized = media.transcript
        ? { text: media.transcript, error: false }
        : await ipcRenderer.invoke(
            'account-tools-transcribe',
            service.id,
            media.audio,
          );
      if (recognized.error)
        throw new Error(recognized.message || '语音识别失败');
      transcript = recognized.text;
      if (
        stopped ||
        service.webview !== view ||
        !(await view.executeJavaScript(
          `(${voiceTranslationCurrent.toString()})(${JSON.stringify(job)})`,
        ))
      )
        return;
      const result = await ipcRenderer.invoke(
        'account-tools-translate',
        service.id,
        transcript,
        'incoming',
      );
      if (!stopped && service.webview === view)
        await view.executeJavaScript(
          `(${voiceTranslationResult.toString()})(${JSON.stringify(job)},${JSON.stringify({ ...result, transcript })})`,
        );
    } catch (error) {
      if (!stopped && service.webview === view) {
        try {
          await view.executeJavaScript(
            `(${voiceTranslationResult.toString()})(${JSON.stringify(job)},${JSON.stringify({ error: true, transcript, message: error instanceof Error ? error.message : '语音翻译失败，请重试' })})`,
          );
        } catch {
          /* Navigation discards results belonging to the previous document. */
        }
      }
    } finally {
      voiceJobs.delete(service.id);
    }
  };
  const tick = async (service: RealStores['services']['all'][number]) => {
    const view = service.webview;
    if (
      stores.services.active !== service ||
      !view ||
      service.isHibernating ||
      service.isLoading ||
      service.recipe.id !== 'whatsapp' ||
      running.has(service.id)
    )
      return;
    running.add(service.id);
    try {
      const c = await getTools(service.id);
      const jobs: TranslationRequest[] = await view.executeJavaScript(
        `(${translationTick.toString()})(${JSON.stringify({ ...c.translation, textColor: stores.settings.app.translationTextColor })})`,
      );
      try {
        const voice: VoiceTranslationJob[] = await view.executeJavaScript(
          `(${voiceTranslationTick.toString()})(${Boolean(c.translation.incoming)},${JSON.stringify(JSON.stringify(c.translation))},${!voiceJobs.has(service.id)})`,
        );
        for (const job of voice) void runVoice(service, view, job);
      } catch {
        /* A voice decoration failure must not discard drained text jobs. */
      }
      for (const job of jobs.sort(
        (a, b) =>
          Number(b.direction === 'outgoing') -
          Number(a.direction === 'outgoing'),
      )) {
        const requestKey = `${service.id}:${job.token}:${job.id}`;
        if (pending.has(requestKey)) {
          // eslint-disable-next-line no-continue
          continue;
        }
        pending.add(requestKey);
        void (async () => {
          let result: { text: string; error: boolean; message?: string };
          try {
            result = await ipcRenderer.invoke(
              'account-tools-translate',
              service.id,
              job.text,
              job.direction,
              Boolean(job.force),
            );
          } catch {
            result = { text: '', error: true };
          }
          try {
            if (!stopped && service.webview === view) {
              let delivered = result ?? { text: '', error: true };
              if (job.direction === 'outgoing' && !delivered.error) {
                if (
                  stores.services.active !== service ||
                  document.querySelector('[role="dialog"], [role="menu"]') ||
                  document.activeElement?.matches(
                    'input, textarea, select, [contenteditable="true"]',
                  )
                )
                  delivered = {
                    text: '',
                    error: true,
                    message: '账号、焦点已变化或有弹窗打开，请返回聊天重新翻译',
                  };
                else view.focus();
              }
              const ready = await view.executeJavaScript(
                `(${translationResult.toString()})(${job.id},${JSON.stringify(job.token)},${JSON.stringify(delivered)},'prepare')`,
              );
              if (ready) {
                try {
                  const modifier =
                    process.platform === 'darwin' ? 'meta' : 'control';
                  await view.sendInputEvent({
                    type: 'keyDown',
                    keyCode: 'A',
                    modifiers: [modifier],
                  });
                  await view.sendInputEvent({
                    type: 'keyUp',
                    keyCode: 'A',
                    modifiers: [modifier],
                  });
                  const selected = await view.executeJavaScript(
                    `(${translationResult.toString()})(${job.id},${JSON.stringify(job.token)},${JSON.stringify(delivered)},'selected')`,
                  );
                  if (!selected) return;
                  await view.insertText(delivered.text);
                  await view.executeJavaScript(
                    `(${translationResult.toString()})(${job.id},${JSON.stringify(job.token)},${JSON.stringify(delivered)},'complete')`,
                  );
                } catch {
                  await view.executeJavaScript(
                    `(${translationResult.toString()})(${job.id},${JSON.stringify(job.token)},{text:'',error:true,message:'无法写入输入框，消息尚未发送'},'prepare')`,
                  );
                }
              }
            }
          } catch {
            /* A navigation or sleep discards the old document's request. */
          } finally {
            pending.delete(requestKey);
          }
        })();
      }
    } catch {
      /* QR/login pages do not expose message elements. Retry after loading. */
    } finally {
      running.delete(service.id);
    }
  };
  const timer = setInterval(() => {
    for (const service of stores.services.all) void tick(service);
  }, 400);
  return () => {
    stopped = true;
    bulk.dispose();
    clearInterval(timer);
    configs.clear();
  };
}
