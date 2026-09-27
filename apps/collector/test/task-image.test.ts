import kitchen from '../assets/discover/setting-kitchen.jpg';
import { expect, it } from 'vitest';
import { taskImage, taskImageLabel } from '../src/ui/taskImage.ts';
import office from '../assets/tasks/office.jpg';
import shop from '../assets/tasks/shop.jpg';
import warehouse from '../assets/tasks/warehouse.jpg';
import fallback from '../assets/tasks/default.jpg';
it('maps the server type to its supplied photo with a safe default', () => {
  expect(taskImage({ type: 'office' })).toBe(office);
  expect(taskImage({ type: 'shop' })).toBe(shop);
  expect(taskImage({ type: 'warehouse' })).toBe(warehouse);
  for (const type of [null, undefined, 'unknown', '__proto__']) expect(taskImage({ type })).toBe(fallback);
});

it('prefers scenario and restores the kitchen image for home tasks', () => {
  expect(taskImage({ scenario: 'home', type: 'office' })).toBe(kitchen);
  expect(taskImage({ scenario: null, type: 'home' })).toBe(kitchen);
  expect(taskImage({ type: 'kitchen' })).toBe(kitchen);
  expect(taskImage({ scenario: 'unknown', type: 'office' })).toBe(fallback);
});

it('distinguishes folding clothes from kitchen work without overriding a server scenario', () => {
  expect(taskImage({ scenario: 'home', title: 'Fold Clothes' })).not.toBe(kitchen);
  expect(taskImage({ scenario: 'home', title: 'Set a Table' })).toBe(kitchen);
  expect(taskImage({ scenario: 'office', title: 'Fold Clothes' })).toBe(office);
});

it('discloses AI illustrations and does not confuse urgent or backpack tasks with activities', () => {
  expect(taskImageLabel({ scenario: 'home', title: 'Fold Clothes' })).toBe('hall.aiImageLabel');
  expect(taskImageLabel({ scenario: 'warehouse', title: 'Packing parcels' })).toBe('hall.aiImageLabel');
  expect(taskImageLabel({ scenario: 'home', title: 'Nhiệm vụ gấp' })).toBe('hall.imageLabel');
  expect(taskImage({ scenario: 'home', title: 'Nhiệm vụ gấp' })).toBe(kitchen);
  expect(taskImage({ scenario: 'warehouse', title: 'Find a backpack' })).toBe(warehouse);
  expect(taskImage({ scenario: 'warehouse', title: 'Scan a package' })).toBe(warehouse);
});
