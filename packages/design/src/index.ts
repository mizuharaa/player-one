/**
 * The design system's public surface.
 *
 * The console imports `toCss()` at build time and the collector app imports
 * the objects directly. Nothing here reaches for a DOM or a React Native API,
 * so the same module loads in Vite, in Metro and in a Node test.
 */
export * from './tokens.ts';
export * from './native.ts';
