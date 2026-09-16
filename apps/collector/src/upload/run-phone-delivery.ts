import { ApiError } from '../api/types.ts';
import { runDelivery, type DeliveryDeps, type DeliveryRecord } from '@playerone/delivery';

/** Stop the phone workflow at every async boundary without changing the shared delivery engine. */
export function runPhoneDelivery(
  deps: DeliveryDeps, record: DeliveryRecord, signal: AbortSignal,
  options: Parameters<typeof runDelivery>[2] = {},
) {
  const guarded = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (signal.aborted) throw new ApiError('upload_cancelled');
    let abort!: () => void;
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new ApiError('upload_cancelled'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const result = await Promise.race([operation(), stopped]);
      if (signal.aborted) throw new ApiError('upload_cancelled');
      return result;
    } finally { signal.removeEventListener('abort', abort); }
  };
  return guarded(() => runDelivery({
    api: {
      registerDelivery: value => guarded(() => deps.api.registerDelivery(value)),
      deliveryPlan: id => guarded(() => deps.api.deliveryPlan(id)),
      completeDelivery: id => guarded(() => deps.api.completeDelivery(id)),
    },
    transport: {
      putFile: (...args) => guarded(() => deps.transport.putFile(...args)),
      putRange: (...args) => guarded(() => deps.transport.putRange(...args)),
    },
    store: {
      get: () => guarded(() => deps.store.get()),
      set: value => guarded(() => deps.store.set(value)),
      clear: () => guarded(() => deps.store.clear()),
    },
    wait: ms => guarded(() => deps.wait ? deps.wait(ms) : new Promise(resolve => setTimeout(resolve, ms))),
  }, record, options));
}
