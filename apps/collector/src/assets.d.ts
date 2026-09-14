/**
 * Image files imported as modules.
 *
 * Metro turns `import poster from './x.jpg'` into an asset reference (a
 * number); Vite, which is what the browser harness runs, turns it into a URL
 * string. `<Image source>` accepts each on its own platform, and
 * `ImageSourcePropType` is the type that covers the shape React Native itself
 * expects — so the app is typed against the phone, which is the target.
 */
declare module '*.jpg' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}

/**
 * WebP, which is what the console's `/discover` stills are and therefore what
 * the landing's stills are. Android decodes WebP natively at every API level
 * this app supports (minSdk 28), Metro lists `webp` among its default
 * `assetExts`, and `@vitejs/plugin-react` serves it in the harness — so it
 * needs no loader on either side. iOS is the open one: see `DEVICE_DEPS.md`.
 */
declare module '*.webp' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}

/**
 * Video files, which `expo-video` takes as its source.
 *
 * Metro yields an asset reference (a number), Vite a URL string, and
 * `VideoSource` accepts both — so the union is the honest type here rather
 * than the platform-specific half. `mp4` is a default Metro `assetExt` and a
 * default Vite asset type; neither side needs configuring.
 */
declare module '*.mp4' {
  const source: string | number;
  export default source;
}
