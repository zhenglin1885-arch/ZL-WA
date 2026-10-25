/* eslint-disable jsx-a11y/media-has-caption -- Selected local preview files do not include subtitle tracks. */
/* eslint-disable no-void -- Reading an already selected local attachment is asynchronous. */
import { ipcRenderer } from 'electron';
import { useEffect, useRef, useState } from 'react';
import type { BulkMedia, BulkMessageType } from './config';

export default function BulkMediaPreview({
  media,
  type,
}: {
  media: BulkMedia;
  type: BulkMessageType;
}) {
  const [preview, setPreview] = useState<{
    id: string;
    url?: string;
    failed?: boolean;
  }>();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const node = video.current;
    return () => {
      node?.pause();
      node?.removeAttribute('src');
      node?.load();
    };
  }, [preview?.url]);
  const supported =
    ['image', 'caption', 'video'].includes(type) &&
    /^(?:image|video)\//.test(media.mime);
  useEffect(() => {
    let active = true;
    setPreview(undefined);
    if (supported)
      void ipcRenderer
        .invoke('account-tools-media-read', media.id)
        .then(url => {
          if (active) setPreview({ id: media.id, url });
        })
        .catch(() => {
          if (active) setPreview({ id: media.id, failed: true });
        });
    return () => {
      active = false;
    };
  }, [media, supported]);
  if (!supported) return null;
  const current = preview?.id === media.id ? preview : undefined;
  const fail = () => setPreview({ id: media.id, failed: true });
  return (
    <div className="bulk-media-preview" aria-label="附件预览">
      {current?.failed ? (
        <p className="tools-muted">暂时无法预览此附件</p>
      ) : current?.url ? (
        media.mime.startsWith('video/') ? (
          <video
            ref={video}
            key={media.id}
            src={current.url}
            controls
            playsInline
            preload="metadata"
            onError={fail}
            aria-label={media.name}
          />
        ) : (
          <img src={current.url} alt={media.name} onError={fail} />
        )
      ) : (
        <p className="tools-muted">正在加载预览…</p>
      )}
    </div>
  );
}
