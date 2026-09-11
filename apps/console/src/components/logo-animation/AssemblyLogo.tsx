import { forwardRef, useId } from 'react';
import type { SVGProps } from 'react';
import { LOGO_VIEWBOX, logoPieces } from './logoPieces';
import { familyForPiece } from './logoChoreography';
import './logo-animation.css';

export interface AssemblyLogoProps extends SVGProps<SVGSVGElement> {
  title?: string;
  debug?: boolean;
  /** Use currentColor for the opening geometry or one-colour applications. */
  monochrome?: boolean;
  /** Select a blue with contrast against the actual surrounding surface. */
  surface?: 'light' | 'dark';
}

/** This same final-layout vector is used in the intro and navigation. */
export const AssemblyLogo = forwardRef<SVGSVGElement, AssemblyLogoProps>(
  function AssemblyLogo({ title, debug = false, monochrome = false, surface = 'light', className = '', ...props }, ref) {
    const titleId = useId();
    return (
      <svg ref={ref} viewBox={LOGO_VIEWBOX} fill="currentColor"
        className={`assembly-logo ${className}`} data-logo-surface={surface} role={title ? 'img' : undefined}
        aria-labelledby={title ? titleId : undefined} aria-hidden={title ? undefined : true}
        {...props}>
        {title && <title id={titleId}>{title}</title>}
        {logoPieces.map((piece) => (
          <g key={piece.id} data-logo-piece={piece.id} data-logo-color={piece.colorGroup}
            data-family={familyForPiece(piece.id)}
            fill={monochrome ? 'currentColor' : `var(--logo-${piece.colorGroup})`}
            className="assembly-logo__piece">
            <path d={piece.d} />
            {debug && <title>{piece.id}</title>}
          </g>
        ))}
        {import.meta.env.DEV && debug && logoPieces.map((piece) => (
          <text key={`label-${piece.id}`} data-logo-label={piece.id}
            data-family={familyForPiece(piece.id)} className="assembly-logo__label"
            textAnchor="middle">{piece.id}</text>
        ))}
      </svg>
    );
  },
);
