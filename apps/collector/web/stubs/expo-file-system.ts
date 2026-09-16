/**
 * `expo-file-system`, for the browser harness only.
 *
 * The real module is a native one and there is no Storage Access Framework in
 * a browser. Same reasoning as the `expo-secure-store` stub beside this file,
 * and the same rule: it pretends nothing. Every entry point throws, so the
 * uploads screen in the harness shows its own "no folder was chosen" path
 * rather than a fabricated session directory — a harness that invented an
 * inventory would screenshot an upload that could never happen.
 *
 * It never ships. `vite.config.ts` in this directory is the only thing that
 * points at it.
 */
const stalledPreview = () => new URLSearchParams(window.location.search).get('state') === 'upload-stalled';
const unavailable = (): never => {
  throw new Error('expo-file-system: there is no filesystem in the browser harness');
};

export enum FileMode {
  ReadWrite = 'rw',
  ReadOnly = 'r',
  WriteOnly = 'w',
  Append = 'wa',
  Truncate = 'wt',
}

export enum UploadType {
  BINARY_CONTENT = 0,
  MULTIPART = 1,
}

export class Directory {
  static pickDirectoryAsync(): Promise<Directory> {
    if (stalledPreview()) return Promise.resolve(new Directory());
    return unavailable();
  }

  readonly uri = 'content://ego_PREVIEW_20260916_120000';

  list(): (Directory | File)[] {
    if (stalledPreview()) return [new File()];
    return unavailable();
  }
}

export class File {
  readonly uri = 'content://ego_PREVIEW_20260916_120000/camera.mp4';
  readonly size = 4;

  create(): never {
    return unavailable();
  }

  open() {
    if (stalledPreview()) { let read = false; return { readBytes() { if (read) return new Uint8Array(); read = true; return new Uint8Array(4); }, close() {} }; }
    return unavailable();
  }

  upload(_url: string, options: { signal: AbortSignal; onProgress?: (value: { bytesSent: number; totalBytes: number }) => void }): Promise<{ status: number }> {
    if (stalledPreview() && new URLSearchParams(window.location.search).has('uploadResult')) {
      options.onProgress?.({ bytesSent: 4, totalBytes: 4 });
      return Promise.resolve({ status: 200 });
    }
    // Explicit browser fixture: one measured sample, then a stalled connection. Not native upload evidence.
    if (stalledPreview()) return new Promise((_resolve, reject) => {
      options.onProgress?.({ bytesSent: 1, totalBytes: 4 });
      options.signal.addEventListener('abort', () => reject(new Error('Preview cancelled')), { once: true });
    });
    return unavailable();
  }

  delete(): never {
    return unavailable();
  }
}

export const Paths = {
  get cache(): Directory {
    return unavailable();
  },
  get document(): Directory {
    return unavailable();
  },
};
