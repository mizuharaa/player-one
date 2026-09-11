/**
 * Media files imported as modules.
 *
 * Metro turns `import poster from './x.jpg'` into an asset reference (a
 * number) that `<Image source>` accepts, and `import film from './x.mp4'`
 * into the same kind of reference, which `expo-video`'s `useVideoPlayer`
 * accepts as a `VideoSource`. The app is typed against the phone, which is the
 * target; the browser harness aliases these to URLs on its own side.
 */
declare module '*.jpg' {
  const source: import('react-native').ImageSourcePropType;
  export default source;
}

declare module '*.mp4' {
  const source: number;
  export default source;
}
