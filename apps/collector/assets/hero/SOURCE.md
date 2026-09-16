# Login film source

`login.mp4` was introduced by commit `640fa9be1cb78e7d8597e458a1c1421ca52dc1ee`.
The commit contains no generation command. The matching file in
`C:/build/mobile-v3-qa/apps/collector/assets/hero/` has the same SHA-256:

`A07FA8A542104B5FA048EFE225C54EC47A1AA43E177E3574C561D461806714B3`

Measured with ffprobe: H.264, 1282 x 718, 7.041667 seconds,
1,550,017 bit/s video bitrate, 1,367,122 bytes. The six distinct login,
landing and opening video candidates under `C:/build` are all at most
1282 x 720; none is a higher-resolution source for this film.

Keep the supplied film and poster at their original resolution. Upscaling
would not recover detail. A genuine 1080p replacement requires owner
regeneration or the original higher-resolution export. For that replacement,
preserve its orientation, encode H.264 High at CRF 20 within 5 MB, and
regenerate the poster from the replacement itself.

Recheck the asset from the repository root:

```powershell
ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height,bit_rate -show_entries format=duration,size -of json apps/collector/assets/hero/login.mp4
```
