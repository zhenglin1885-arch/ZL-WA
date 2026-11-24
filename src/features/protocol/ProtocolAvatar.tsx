import { useEffect, useRef, useState } from 'react';
import { protocolRequest } from './client';

// Read photos only for visible chats, at most two queries at a time. Cache failed
// lookups too, so a private/unavailable photo is not queried on every state event.
const photos = new Map<string, Promise<string>>();
const waiting: (() => void)[] = [];
let active = 0;
function photo(key: string, serviceId: string, owner: string, jid: string) {
  if (!photos.has(key)) {
    const result = new Promise<string>(resolve => {
      const run = () => {
        active++;
        void protocolRequest<string>(serviceId, 'profile-photo', { owner, jid })
          .then(value => resolve(typeof value === 'string' ? value : ''))
          .catch(() => resolve(''))
          .finally(() => {
            active--;
            waiting.shift()?.();
          });
      };
      if (active < 2) run();
      else waiting.push(run);
    });
    photos.set(key, result);
    if (photos.size > 2000) photos.delete(photos.keys().next().value!);
  }
  return photos.get(key)!;
}
export default function ProtocolAvatar({
  serviceId,
  owner,
  jid,
  name,
  group,
  connected,
}: {
  serviceId: string;
  owner: string;
  jid: string;
  name: string;
  group?: boolean;
  connected: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = `${serviceId}:${owner}:${jid}`;
  const [image, setImage] = useState<{ key: string; url: string }>();
  useEffect(() => {
    if (!ref.current || !connected || !owner || !jid) return;
    let live = true;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      void photo(key, serviceId, owner, jid).then(url => {
        if (live && url) setImage({ key, url });
      });
    });
    observer.observe(ref.current);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [key, connected]);
  return (
    <span ref={ref} className="protocol-chat__avatar" aria-hidden="true">
      {image?.key === key ? (
        <img
          src={image.url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImage(undefined)}
        />
      ) : group ? (
        '♧'
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
