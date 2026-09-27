import laundry from '../../assets/discover/work-portrait.webp';
import packing from '../../assets/discover/work-detail.webp';
import kitchen from '../../assets/discover/setting-kitchen.jpg';
import office from '../../assets/tasks/office.jpg';
import shop from '../../assets/tasks/shop.jpg';
import warehouse from '../../assets/tasks/warehouse.jpg';
import fallback from '../../assets/tasks/default.jpg';

/** The server scenario takes precedence; unknown settings use the default photo. */
export const taskImage = (task: { scenario?: string | null; type?: string | null; title?: string }) => {
  const type = task.scenario ?? task.type;
  // Illustrative activity cues; server scenario still wins over title hints.
  if (type === 'home' && /\b(?:fold(?:ing)?|laundry|clothes)\b|gấp\s+(?:quần\s+áo|đồ)|叠|衣服/iu.test(task.title ?? '')) return laundry;
  if ((type === 'shop' || type === 'warehouse') && /\b(?:pack(?:ing)?|parcels?)\b|đóng\s+gói|包装/iu.test(task.title ?? '')) return packing;
  return type === 'home' || type === 'kitchen' ? kitchen : type === 'office' ? office : type === 'shop' ? shop : type === 'warehouse' ? warehouse : fallback;
};

export const taskImageLabel = (task: Parameters<typeof taskImage>[0]) => {
  const image = taskImage(task);
  return image === laundry || image === packing ? 'hall.aiImageLabel' : 'hall.imageLabel';
};

/** Attribution travels with the bundled crops. */
export const TASK_PHOTO_CREDITS = [
  { title: 'Toong Coworking Space in Hanoi', author: 'Ann0611', source: 'https://commons.wikimedia.org/wiki/File:Toong_Coworking_Space_in_Hanoi.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  { title: 'Very common easy and fresh to pick up something quick at convenience stores in Japan', author: 'amanderson2', source: 'https://commons.wikimedia.org/wiki/File:Very_common_easy_and_fresh_to_pick_up_something_quick_at_convenience_stores_in_Japan_(14870984321).jpg', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/' },
  { title: 'Modern warehouse with pallet rack storage system', author: 'Axisadman', source: 'https://commons.wikimedia.org/wiki/File:Modern_warehouse_with_pallet_rack_storage_system.jpg', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  { title: 'Ho Chi Minh City motorbikers', author: 'Frank McKenna', source: 'https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_City_motorbikers_(Unsplash_LhENdA-0yCM).jpg', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
] as const;
