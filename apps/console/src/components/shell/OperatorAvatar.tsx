import { useEffect, useState } from 'react';

const eventName = 'playerone:avatar';
const keyFor = (id: string) => `playerone.avatar.${id}`;
function read(id?: string) {
  if (!id) return null;
  try {
    const value = localStorage.getItem(keyFor(id));
    return value && /^data:image\/(png|jpeg|webp);base64,/.test(value) ? value : null;
  } catch { return null; }
}

export function saveOperatorAvatar(id: string, value: string | null) {
  if (value === null) localStorage.removeItem(keyFor(id));
  else localStorage.setItem(keyFor(id), value);
  window.dispatchEvent(new Event(eventName));
}

export function useOperatorAvatar(id?: string) {
  const [photo, setPhoto] = useState(() => read(id));
  useEffect(() => {
    const update = () => setPhoto(read(id));
    update();
    window.addEventListener(eventName, update); window.addEventListener('storage', update);
    return () => { window.removeEventListener(eventName, update); window.removeEventListener('storage', update); };
  }, [id]);
  return photo;
}

export function OperatorAvatar({ id, reference, large = false }: { id?: string; reference?: string | null; large?: boolean }) {
  const photo = useOperatorAvatar(id);
  const initial = reference?.trim().slice(0, 1).toLocaleUpperCase();
  return <span className={large ? 'workspace-avatar workspace-avatar-large' : 'workspace-avatar'} aria-hidden="true">
    {photo ? <img src={photo} alt="" /> : initial || <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8" r="3.5" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></svg>}
  </span>;
}
