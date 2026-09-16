import type { ReactNode } from 'react';
/** Native blur is verified on device; behavior tests only need its child boundary. */
export function BlurView({ children }: { children?: ReactNode }) { return <>{children}</>; }
