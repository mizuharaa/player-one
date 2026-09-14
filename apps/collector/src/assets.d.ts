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
 * The §21.1 bundle is WebP apart from one JPEG. Same bargain as `*.jpg`
 * above: Metro hands back an asset reference, Vite hands back a URL, and
 * `ImageSourcePropType` is the shape `<Image source>` takes on the target.
 */
declare module '*.webp' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}
