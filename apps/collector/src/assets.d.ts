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
