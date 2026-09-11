import { useEffect, useState } from 'react';
import { AssemblyLogo } from '../logo-animation/AssemblyLogo.tsx';

function surface(): 'light' | 'dark' {
  const theme = document.documentElement.dataset['theme'];
  return theme === 'dark' || (theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}

/** Uses the shared colored mark on the shell's actual themed surface. */
export function ConsoleLogo() {
  const [ground, setGround] = useState(surface);
  useEffect(() => {
    const update = () => setGround(surface());
    const observer = new MutationObserver(update);
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    scheme.addEventListener('change', update);
    return () => { observer.disconnect(); scheme.removeEventListener('change', update); };
  }, []);
  return <AssemblyLogo surface={ground} className="ops-brand-logo" />;
}
