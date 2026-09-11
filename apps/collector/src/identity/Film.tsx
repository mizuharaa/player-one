import { useEffect, useState } from 'react';
import { Image, StyleSheet } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import film from '../../assets/landing.mp4';
import poster from '../../assets/landing-poster.jpg';

/**
 * The landing film, full-bleed, behind everything.
 *
 * This is the seam the web-harness version left open ("replace the native
 * branch with `<VideoView>` at the first native build"): the clip is bundled
 * (`assets/landing.mp4`, the console's accepted 7.04 s landing film, re-encoded
 * at 1.58 MB) and played by `expo-video`, muted and looping, with no native
 * controls. The poster is a frame of the same clip and is always drawn
 * underneath, so the first paint, a decode failure and "remove animations"
 * all show the same honest still rather than a black panel.
 *
 * `still` is the caller's word: reduced motion, or the app being in the
 * background. Either pauses the player; a status of `error` hides the view for
 * good and leaves the poster.
 */
export function Film({ label, still }: { label: string; still: boolean }) {
  const [failed, setFailed] = useState(false);
  const player = useVideoPlayer(film, (p) => {
    p.loop = true;
    p.muted = true;
    p.staysActiveInBackground = false;
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') setFailed(true);
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (still || failed) player.pause();
    else player.play();
  }, [player, still, failed]);

  return (
    <>
      <Image
        accessibilityRole="image"
        accessibilityLabel={label}
        source={poster}
        resizeMode="cover"
        style={StyleSheet.absoluteFill}
      />
      {still || failed ? null : (
        <VideoView
          player={player}
          contentFit="cover"
          nativeControls={false}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          style={StyleSheet.absoluteFill}
        />
      )}
    </>
  );
}
