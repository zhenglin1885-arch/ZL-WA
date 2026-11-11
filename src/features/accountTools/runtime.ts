/* eslint-disable no-void -- Detached, internally handled translation jobs must not block account polling. */
/* eslint-disable @typescript-eslint/no-loop-func -- stopped is intentionally shared by pending jobs on cleanup. */
import { ipcRenderer } from 'electron';
import type { RealStores } from '../../stores';
import { getBulkQueue } from './bulkRuntime';
import { type ToolsConfig } from './config';
import {
  translationTick,
  translationResult,
  translationCacheRequests,
  restoreTranslationCache,
  type TranslationRequest,
  type TranslationCacheBatch,
} from './guest';

type TranslationView = NonNullable<
  RealStores['services']['all'][number]['webview']
>;

const configs = new Map<string, ToolsConfig>();
export async function getTools(id: string): Promise<ToolsConfig> {
  if (!configs.has(id))
    configs.set(id, await ipcRenderer.invoke('account-tools-get', id));
  return configs.get(id)!;
}
export async function saveTools(
  id: string,
  config: ToolsConfig,
  confirmRecovery = false,
): Promise<ToolsConfig> {
  const previous = configs.get(id);
  const saved = confirmRecovery
    ? await ipcRenderer.invoke('account-tools-save', id, config, true)
    : await ipcRenderer.invoke('account-tools-save', id, config);
  configs.set(id, saved);
  if (
    JSON.stringify(previous?.proxy) !== JSON.stringify(saved.proxy) ||
    config.proxy.password !== undefined ||
    previous?.requiresProxyReview !== saved.requiresProxyReview
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
  if (service.webview)
    await service.webview.executeJavaScript(
      `(${translationTick.toString()})(${JSON.stringify({ ...config.translation, textColor })},false)`,
    );
}
export function startTranslations(stores: RealStores): () => void {
  const bulk = getBulkQueue(stores);
  bulk.start();
  let stopped = false;
  const running = new Set<string>();
  const pending = new Map<
    string,
    {
      view: TranslationView;
      job: TranslationRequest;
      delivering: boolean;
    }
  >();
  const cancelGuest = (view: TranslationView, job: TranslationRequest) => {
    void Promise.resolve()
      .then(() =>
        view.executeJavaScript(
          `(${translationResult.toString()})(${job.id},${JSON.stringify(job.token)},{text:'',error:true,message:'翻译任务已取消，请重新点击翻译'},'prepare')`,
        ),
      )
      .catch(() => {});
  };
  const tick = async (service: RealStores['services']['all'][number]) => {
    const view = service.webview;
    if (
      stopped ||
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
      if (stopped || service.webview !== view) return;
      const frame:
        | TranslationRequest[]
        | { jobs: TranslationRequest[]; cache: TranslationCacheBatch | null } =
        await view.executeJavaScript(
          `(()=>{const jobs=(${translationTick.toString()})(${JSON.stringify({ ...c.translation, textColor: stores.settings.app.translationTextColor })});return {jobs,cache:(${translationCacheRequests.toString()})()};})()`,
        );
      const jobs = Array.isArray(frame) ? frame : frame.jobs;
      if (stopped || service.webview !== view) {
        for (const job of jobs) cancelGuest(view, job);
        return;
      }
      const cache = Array.isArray(frame) ? null : frame.cache;
      if (cache?.items.length) {
        try {
          const hits = await ipcRenderer
            .invoke('account-tools-translation-cache', service.id, cache)
            .catch(() => []);
          if (!stopped && service.webview === view)
            await view.executeJavaScript(
              `(${restoreTranslationCache.toString()})(${JSON.stringify(cache)},${JSON.stringify(hits)})`,
            );
        } catch {
          /* Cache misses/read errors never invoke a provider or stop manual jobs. */
        }
      }
      if (stopped || service.webview !== view) {
        for (const job of jobs) cancelGuest(view, job);
        return;
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
        const task = { view, job, delivering: false };
        pending.set(requestKey, task);
        void (async () => {
          let result: { text: string; error: boolean; message?: string };
          try {
            result = await ipcRenderer.invoke(
              'account-tools-translate',
              service.id,
              job.text,
              job.direction,
              Boolean(job.force),
              job.sourceContext,
              Boolean(job.manual),
            );
          } catch (error) {
            const details = String(
              error instanceof Error ? error.message : error,
            );
            const message = details.includes('翻译等待超时')
              ? '翻译等待超时，请重试或切换翻译通道'
              : details.includes('翻译队列繁忙')
                ? '翻译任务较多，请等待当前任务完成后重试'
                : undefined;
            result = { text: '', error: true, ...(message ? { message } : {}) };
          }
          try {
            if (!stopped && service.webview === view) {
              task.delivering = job.direction === 'outgoing';
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
              if (stopped || service.webview !== view) {
                cancelGuest(view, job);
                return;
              }
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
                  if (
                    stopped ||
                    service.webview !== view ||
                    stores.services.active !== service
                  ) {
                    cancelGuest(view, job);
                    return;
                  }
                  await view.insertText(delivered.text);
                  if (
                    stopped ||
                    service.webview !== view ||
                    stores.services.active !== service
                  ) {
                    await view.executeJavaScript(
                      `(${translationResult.toString()})(${job.id},${JSON.stringify(job.token)},{text:'',error:true},'complete')`,
                    );
                    return;
                  }
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
            cancelGuest(view, job);
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
    for (const { view, job, delivering } of pending.values())
      if (!delivering) cancelGuest(view, job);
    pending.clear();
    bulk.dispose();
    clearInterval(timer);
    configs.clear();
  };
}
