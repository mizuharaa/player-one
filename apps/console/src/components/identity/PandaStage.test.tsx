// @vitest-environment jsdom
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { PandaStage } from './PandaStage.tsx';

afterEach(() => history.replaceState(null, '', '/'));
it('keeps the illustrated helper accessible and excludes footage review', () => {
  const html = renderToStaticMarkup(<PandaStage label="Open PlayerOne guidance" onPress={() => {}} />);
  expect(html).toContain('<button');
  expect(html).toContain('aria-label="Open PlayerOne guidance"');
  expect(html).toContain('panda-wave.png');
  expect(html).not.toContain('<canvas');
  history.replaceState(null, '', '/review');
  expect(renderToStaticMarkup(<PandaStage />)).toBe('');
});
