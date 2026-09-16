import { expect, it } from 'vitest';
import { taskImage } from '../src/ui/taskImage.ts';
import office from '../assets/tasks/office.jpg';
import shop from '../assets/tasks/shop.jpg';
import warehouse from '../assets/tasks/warehouse.jpg';
import fallback from '../assets/tasks/default.jpg';
it('maps the server type to its supplied photo with a safe default', () => {
  expect(taskImage('office')).toBe(office);
  expect(taskImage('shop')).toBe(shop);
  expect(taskImage('warehouse')).toBe(warehouse);
  for (const type of [null, undefined, 'home', 'unknown', '__proto__']) expect(taskImage(type)).toBe(fallback);
});
