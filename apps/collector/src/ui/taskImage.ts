import office from '../../assets/tasks/office.jpg';
import shop from '../../assets/tasks/shop.jpg';
import warehouse from '../../assets/tasks/warehouse.jpg';
import fallback from '../../assets/tasks/default.jpg';

/** Photos follow the server type; an unknown type never borrows another setting. */
export const taskImage = (type?: string | null) => type === 'office' ? office : type === 'shop' ? shop : type === 'warehouse' ? warehouse : fallback;

/** Attribution travels with the bundled crops. */
export const TASK_PHOTO_CREDITS = [
  { title: 'Toong Coworking Space in Hanoi', author: 'Ann0611', source: 'https://commons.wikimedia.org/wiki/File:Toong_Coworking_Space_in_Hanoi.jpg', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  { title: 'Very common easy and fresh to pick up something quick at convenience stores in Japan', author: 'amanderson2', source: 'https://commons.wikimedia.org/wiki/File:Very_common_easy_and_fresh_to_pick_up_something_quick_at_convenience_stores_in_Japan_(14870984321).jpg', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/' },
  { title: 'Modern warehouse with pallet rack storage system', author: 'Axisadman', source: 'https://commons.wikimedia.org/wiki/File:Modern_warehouse_with_pallet_rack_storage_system.jpg', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/' },
  { title: 'Ho Chi Minh City motorbikers', author: 'Frank McKenna', source: 'https://commons.wikimedia.org/wiki/File:Ho_Chi_Minh_City_motorbikers_(Unsplash_LhENdA-0yCM).jpg', license: 'CC0 1.0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/' },
] as const;
