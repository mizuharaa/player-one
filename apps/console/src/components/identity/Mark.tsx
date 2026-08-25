/**
 * The PlayerOne mark: two overlapping circles.
 *
 * The Ego headset has two camera lenses side by side, so the mark does too —
 * VNG's sun on the left, PaXini's blue on the right, overlapping where the data
 * is. It is also a pair of eyes, which is where Cú comes from; the identity
 * closes on itself rather than being decoration bolted on.
 *
 * It has to survive four places: 16px in a browser tab, one colour on a printed
 * handover slip, the dark theatre, and an Android launcher icon. That rules out
 * the gradient-and-bevel mark it replaced — a rounded square with a swoosh in
 * it, which is what every generated logo looks like. Two flat circles hold at
 * every one of those sizes.
 *
 * The overlap is drawn as a third shape rather than left to alpha blending: a
 * `mix-blend-mode` overlap renders differently on a dark ground, and this mark
 * appears on both.
 */
export function Mark({
  size = 28,
  monochrome = false,
  className,
  title,
}: {
  size?: number;
  /** For the printed slip and the one-colour lockup. Takes `currentColor`. */
  monochrome?: boolean;
  className?: string;
  /** Omit for decorative use beside the wordmark; the text is then the label. */
  title?: string;
}) {
  const left = monochrome ? 'currentColor' : 'var(--sun-500)';
  const right = monochrome ? 'currentColor' : 'var(--tech-500)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <circle cx="11" cy="16" r="9" fill={left} />
      <circle cx="21" cy="16" r="9" fill={right} opacity={monochrome ? 0.55 : 0.92} />
      {/* Where the two lenses see the same thing. */}
      {monochrome ? null : (
        <path
          d="M16 8.06a9 9 0 000 15.88 9 9 0 000-15.88z"
          fill="var(--sun-600)"
          opacity="0.85"
        />
      )}
    </svg>
  );
}

/** The mark plus the name, which is how it appears in the top bar. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <Mark size={24} />
      <span className="text-[1.0625rem] font-extrabold tracking-[-0.02em] text-foreground">
        PlayerOne
      </span>
    </span>
  );
}
