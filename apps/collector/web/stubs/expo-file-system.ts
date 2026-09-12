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
const unavailable = (): never => {
  throw new Error('expo-file-system: there is no filesystem in the browser harness');
};

export enum FileMode {
  ReadOnly = 0,
  WriteOnly = 1,
  ReadWrite = 2,
  Append = 3,
}

export enum UploadType {
  BINARY_CONTENT = 0,
  MULTIPART = 1,
}

export class Directory {
  static pickDirectoryAsync(): Promise<Directory> {
    return unavailable();
  }

  readonly uri = '';

  list(): (Directory | File)[] {
    return unavailable();
  }
}

export class File {
  readonly uri = '';
  readonly size = 0;

  open(): never {
    return unavailable();
  }

  upload(): never {
    return unavailable();
  }
}
