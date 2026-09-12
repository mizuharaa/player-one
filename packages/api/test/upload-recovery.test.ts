import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { READBACK_STALLS, verifyReadBack } from '../src/upload-worker.ts';

const bytes = Buffer.from('a recording whose bytes must survive a dropped connection');
const file = { relative_path: 'camera.mp4', sha256: createHash('sha256').update(bytes).digest('hex') };
const keyOf = (path: string) => `episodes/recovery/ingest/${path}`;

describe('UPL-16 read-back recovery while opening a ranged request', () => {
  it('keeps the hash offset when the next GET fails before returning a body', async () => {
    const offsets: number[] = [];
    const read = vi.fn(async (_key: string, from = 0) => {
      offsets.push(from);
      if (offsets.length === 2) throw new Error('ECONNRESET before response headers');
      return (async function* () {
        if (offsets.length === 1) {
          yield bytes.subarray(0, 11);
          throw new Error('ECONNRESET during response body');
        }
        yield bytes.subarray(from);
      })();
    });
    const matched = vi.fn(async () => {});
    expect(await verifyReadBack({ read }, [file], keyOf, matched)).toEqual([]);
    expect(offsets).toEqual([0, 11, 11]);
    expect(matched).toHaveBeenCalledTimes(1);
    expect(matched).toHaveBeenCalledWith(keyOf(file.relative_path), file);
  });

  it('bounds consecutive GET-open failures and never records a receipt', async () => {
    const read = vi.fn(async () => { throw new Error('ECONNREFUSED'); });
    const matched = vi.fn(async () => {});
    await expect(verifyReadBack({ read }, [file], keyOf, matched)).rejects.toThrow('ECONNREFUSED');
    expect(read).toHaveBeenCalledTimes(READBACK_STALLS);
    expect(matched).not.toHaveBeenCalled();
  });

  it('does not retry rejected credentials or record a receipt', async () => {
    const read = vi.fn(async () => {
      throw Object.assign(new Error('AccessDenied'), { $metadata: { httpStatusCode: 403 } });
    });
    const matched = vi.fn(async () => {});
    await expect(verifyReadBack({ read }, [file], keyOf, matched)).rejects.toThrow('AccessDenied');
    expect(read).toHaveBeenCalledTimes(1);
    expect(matched).not.toHaveBeenCalled();
  });

  it.each([429, 503])('retries a temporary HTTP %i while opening the GET', async (status) => {
    const read = vi.fn(async () => {
      if (read.mock.calls.length === 1) {
        throw Object.assign(new Error('temporarily unavailable'), { $metadata: { httpStatusCode: status } });
      }
      return (async function* () { yield bytes; })();
    });
    expect(await verifyReadBack({ read }, [file], keyOf)).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
