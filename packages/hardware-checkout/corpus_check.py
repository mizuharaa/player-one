#!/usr/bin/env python3
"""Four device-health analysers over a directory of Ego session folders.

    python corpus_check.py [SESSIONS_DIR] [--json] [--check]

SESSIONS_DIR is the folder *containing* the ``ego_<serial>_<date>_<time>``
folders. Omitted, it is discovered the way the TypeScript tests do
(``PLAYERONE_SESSIONS``, else ``docs/sample_data/[wrapper/]EgoCamera Sample Data``).

  truncation  PTS sidecar rows vs MP4 packets (the real index truncation test)
              and vs the frame counts the manifest claims (advisory only).
  buffer      PTS file sizes that are exact 4 KiB multiples - an unflushed
              write buffer, not a real row count. 65536 / 49152 / 8192 / 0.
  warmup      per-stream first sample minus the manifest ``start_time``.
  gravity     mean accelerometer vector and its magnitude.

``--check`` additionally asserts the numbers measured from the real 5-session
corpus on 2026-08-25 and prints PASS/FAIL per expectation. Exit 0 all pass,
1 any fail or no corpus, 2 bad arguments.

Nothing here touches a database, a network, or the TF card.
"""
import argparse
import json
import math
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# A write-buffer boundary. A flushed CSV landing on one is a coincidence, so
# this is a SIGNAL, not a proof, and it is evaluated per file: summing the parts
# of a two-part stream can land on a multiple by accident.
BUFFER_UNIT = 4096
SESSION_RE = re.compile(r"^ego_[A-Za-z0-9]+_\d{8}_\d{6}$")
STREAMS = ("audio", "camera_left", "camera_right")


def find_corpus():
    env = os.environ.get("PLAYERONE_SESSIONS")
    if env:
        return Path(env)
    base = Path(__file__).resolve().parents[2] / "docs" / "sample_data"
    direct = base / "EgoCamera Sample Data"
    if direct.is_dir():
        return direct
    if base.is_dir():
        for entry in sorted(base.iterdir()):
            nested = entry / "EgoCamera Sample Data"
            if nested.is_dir():
                return nested
    return None


def pts_rows(path):
    """(complete rows, partial tail). A row is complete only if its newline was
    written: 073055's sidecar stops mid-digit, and counting that stub as a row
    inflates it from 3854 to 3855. The engine drops it too - see
    `truncatedTail` in packages/ingest/src/csv.ts."""
    n = 0
    last = b""
    with path.open("rb") as f:
        for line in f:
            last = line
            if line.endswith(b"\n") and line.strip().isdigit():
                n += 1
    return n, bool(last) and not last.endswith(b"\n")


def first_pts(path):
    with path.open("rb") as f:
        for line in f:
            if line.strip().isdigit():
                return int(line)
    return None


def media_for(pts_path):
    """The MP4 a camera sidecar indexes, by name. Returned whether or not it is
    on disk - a camera part with no MP4 is a finding, not an absence."""
    return pts_path.with_name(pts_path.name[: -len("_pts.csv")] + ".mp4")


def packet_count(mp4):
    """Video packets in the container, via the same ffprobe invocation
    packages/ingest/src/timing.ts uses. A second full read of the file, which is
    why it is behind --packets there and here."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0", "-count_packets",
             "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", str(mp4)],
            capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    if out.stderr.strip():
        return None  # the decoder complained: the container is damaged
    return int(out.stdout.strip() or 0)


def stream_files(d):
    """PTS sidecars per stream, in part order. Files on disk, never the
    manifest's `files` list - that names files which do not exist."""
    out = {k: [] for k in STREAMS}
    for p in sorted(d.glob("*_pts.csv")):
        for key in STREAMS:
            if "_" + key in p.name:
                out[key].append(p)
                break
    return out


def imu_accel(d, start_dt):
    """Accelerometer summary, plus rows whose device clock is nowhere near the
    session. 072516 opens with 916 such rows: the clock is ~56 years ahead for
    the first 0.458 s, then snaps back. Taking row 0 as the stream start there
    reports a 1.77-billion-second warm-up.
    ponytail: the manifest start_time is advisory but is the only session-wide
    clock reference on disk; an hour either side is generous for a 3600 s
    segment cap. Replace with the audio/camera consensus if a manifest ever
    lands with no usable start_time."""
    # Naive-as-UTC, the same convention gap_sec() reads the PTS epoch in.
    base = start_dt.replace(tzinfo=timezone.utc).timestamp() if start_dt else None
    first = None
    n = 0
    sx = sy = sz = 0.0
    mag = 0.0
    outliers = 0
    for path in sorted(d.glob("*_imu_part*.csv")):
        with path.open("r", encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split(",")
                if len(parts) < 5 or not parts[0].strip().isdigit():
                    continue
                ts = int(parts[0])
                sane = base is None or abs(ts / 1e6 - base) <= 3600
                if not sane:
                    outliers += 1
                elif first is None:
                    first = ts
                if parts[4].strip() != "accel":
                    continue
                x, y, z = float(parts[1]), float(parts[2]), float(parts[3])
                n += 1
                sx += x
                sy += y
                sz += z
                mag += math.sqrt(x * x + y * y + z * z)
    return {
        "first_pts_us": first,
        "clock_outlier_rows": outliers,
        "accel_rows": n,
        "sums": (sx, sy, sz, mag),
    }


def gap_sec(first_us, start_dt):
    """Device PTS is a microsecond epoch already in the manifest's wall clock,
    so both sides are read naive.
    ponytail: no timezone database until a device records outside the region."""
    if first_us is None or start_dt is None:
        return None
    naive = datetime.fromtimestamp(first_us / 1e6, timezone.utc).replace(tzinfo=None)
    return round((naive - start_dt).total_seconds(), 3)


def verdict(rows, partial, packets, manifest, media="n/a"):
    """Which of the engine's defect codes this stream earns.

    The distinction matters and is easy to get backwards. A sidecar shorter than
    the MEDIA is a real index truncation (`PTS-TRUNCATED`). A sidecar that
    disagrees with the MANIFEST is only the manifest being advisory
    (`FRAMECOUNT-MISMATCH`) - the manifest overstates on every closed session in
    the corpus while the sidecar matches the media exactly. Codes are the ones
    in packages/contracts/src/episode.ts, deliberately.

    `media` says what the packet reference is worth. A camera part whose MP4 is
    absent or unreadable is its OWN failure and must never fall through to the
    audio tail-only path: with no packets to compare against, a half-length
    sidecar reads as healthy, which is exactly backwards."""
    if media in ("missing", "unreadable"):
        return "MEDIA-" + media.upper()
    if media == "unmeasured":
        return "UNMEASURED"  # re-run with --packets
    if packets is None:
        # Audio: the WAV gives no packet reference the sidecar can be measured
        # against, so only the tail is evidence. TAIL-OK is not OK.
        return "PTS-TRUNCATED" if partial or rows == 0 else "TAIL-OK"
    if partial or rows < packets:
        return "PTS-TRUNCATED"
    if isinstance(manifest, int) and manifest not in (0, packets):
        return "FRAMECOUNT-MISMATCH"
    return "OK"


def analyse_session(d, with_packets=False):
    meta_files = sorted(d.glob("meta_*.json"))
    meta = json.loads(meta_files[0].read_text(encoding="utf-8")) if meta_files else {}
    rec = meta.get("recording", {})
    stats = meta.get("statistics", {})
    claimed = {
        "audio": stats.get("audio_frame_count"),
        "camera_left": stats.get("video_left_frame_count"),
        "camera_right": stats.get("video_right_frame_count"),
    }
    start = rec.get("start_time")
    start_dt = datetime.fromisoformat(start) if start else None

    out = {
        "session": d.name,
        "status": rec.get("status"),
        "start_time": start,
        "streams": {},
    }
    for name, files in stream_files(d).items():
        if not files:
            continue
        counted = [pts_rows(p) for p in files]
        rows = sum(c for c, _ in counted)
        partial = any(p for _, p in counted)
        sizes = [p.stat().st_size for p in files]
        size = sum(sizes)
        f0 = first_pts(files[0])
        m = claimed.get(name)
        # One packet result per camera part, or the whole stream is a failure.
        # Dropping the missing ones and summing the rest hid both a camera with
        # no MP4 at all and a two-part camera missing its second file.
        packets = None
        media = "n/a" if name == "audio" else "unmeasured"
        if with_packets and name != "audio":
            mp4s = [media_for(p) for p in files]
            got = [packet_count(m) if m.exists() else None for m in mp4s]
            packets = sum(got) if None not in got else None
            media = ("ok" if packets is not None
                     else "missing" if not all(m.exists() for m in mp4s)
                     else "unreadable")
        out["streams"][name] = {
            "pts_files": [p.name for p in files],
            "pts_rows": rows,
            "pts_partial_tail": partial,
            "pts_bytes": size,
            "manifest_frames": m,
            "media_packets": packets,
            "media": media,
            "verdict": verdict(rows, partial, packets, m, media),
            "buffer_suspect": [
                {"file": f.name, "bytes": b, "units": b // BUFFER_UNIT}
                for f, b in zip(files, sizes) if b % BUFFER_UNIT == 0
            ],
            "first_pts_us": f0,
            "warmup_sec": gap_sec(f0, start_dt),
        }

    imu = imu_accel(d, start_dt)
    sx, sy, sz, mag = imu.pop("sums")
    imu["warmup_sec"] = gap_sec(imu["first_pts_us"], start_dt)
    n = imu["accel_rows"]
    if n:
        mean = (sx / n, sy / n, sz / n)
        # Gravity is the mean of the per-sample magnitudes: it survives the head
        # turning. The magnitude OF the mean vector does not - 072310 reads 6.94
        # there purely because the collector looked around - so it is reported
        # as a steadiness number, never as the gravity check.
        imu["mean_sample_magnitude"] = round(mag / n, 4)
        imu["mean_accel"] = [round(v, 4) for v in mean]
        imu["mean_vector_magnitude"] = round(math.sqrt(sum(v * v for v in mean)), 4)
        # Axes carrying more than 1 m/s^2 of the mean, with their sign: the
        # orientation gravity was pulling in for most of the recording.
        imu["signature"] = "".join(
            ("-" if v < 0 else "+") + ax
            for v, ax in zip(mean, "XYZ")
            if abs(v) > 1.0
        )
    out["imu"] = imu
    return out


def analyse(root, with_packets=False):
    return [
        analyse_session(d, with_packets)
        for d in sorted(root.iterdir())
        if d.is_dir() and SESSION_RE.match(d.name)
    ]


def render(report):
    print("== truncation: PTS rows vs media packets vs manifest frame count")
    print("{:<36} {:<13} {:>6} {:>4} {:>8} {:>9} {:>20}".format(
        "session", "stream", "rows", "cut", "packets", "manifest", "verdict"))
    for s in report:
        for name, st in s["streams"].items():
            m, pk = st["manifest_frames"], st["media_packets"]
            print("{:<36} {:<13} {:>6} {:>4} {:>8} {:>9} {:>20}".format(
                s["session"], name, st["pts_rows"],
                "yes" if st["pts_partial_tail"] else "-",
                "-" if pk is None else pk, "-" if m is None else m,
                st["verdict"]))
    print("  TAIL-OK: audio, which has no packet reference; only its tail is checked.")
    print("  UNMEASURED: camera, no packet count taken - re-run with --packets.")
    print("  MEDIA-MISSING / MEDIA-UNREADABLE: a camera part has no usable MP4,")
    print("  so its sidecar cannot be checked for truncation at all.")

    print("\n== buffer: PTS files whose size is an exact multiple of %d"
          % BUFFER_UNIT)
    print("  A boundary hit alone is a signal, not proof. `corroboration` is "
          "the evidence\n  that the write really was cut: an unterminated final "
          "row, a session still\n  marked `recording`, or a sidecar short of its "
          "media. A hit with none of\n  those is a coincidence until something "
          "else says otherwise.")
    hit = False
    for s in report:
        for name, st in s["streams"].items():
            for b in st["buffer_suspect"]:
                hit = True
                why = []
                if st["pts_partial_tail"]:
                    why.append("final row unterminated")
                if s["status"] != "completed":
                    why.append("status=" + str(s["status"]))
                if st["verdict"] == "PTS-TRUNCATED":
                    why.append("short of media")
                print("  {:<56} {:>7} B ({} x {})".format(
                    b["file"], b["bytes"], b["units"], BUFFER_UNIT))
                print("      corroboration: " +
                      (", ".join(why) if why else "NONE - treat as coincidence"))
    if not hit:
        print("  none")

    print("\n== warm-up: first sample minus manifest start_time (seconds)")
    print("{:<36} {:<10} {:>7} {:>7} {:>7} {:>7}".format(
        "session", "status", "imu", "audio", "cam_l", "cam_r"))
    for s in report:
        vals = [s["imu"].get("warmup_sec")] + [
            s["streams"].get(k, {}).get("warmup_sec")
            for k in ("audio", "camera_left", "camera_right")
        ]
        cells = " ".join(
            "{:>7}".format("-" if v is None else "{:+.3f}".format(v)) for v in vals)
        print("{:<36} {:<10} {}".format(s["session"], str(s["status"]), cells))

    print("\n== gravity: mean |accel| per sample, and the mean vector")
    print("{:<36} {:>7} {:>7} {:>30} {:>7} {:>6}".format(
        "session", "rows", "mean|a|", "mean x,y,z (m/s^2)", "|mean|", "sig"))
    for s in report:
        i = s["imu"]
        if not i.get("accel_rows"):
            print("{:<36} {:>7}".format(s["session"], 0))
            continue
        v = ", ".join("{:+.3f}".format(x) for x in i["mean_accel"])
        print("{:<36} {:>7} {:>7.3f} {:>30} {:>7.3f} {:>6}".format(
            s["session"], i["accel_rows"], i["mean_sample_magnitude"], v,
            i["mean_vector_magnitude"], i["signature"]))
    bad = [(s["session"], s["imu"]["clock_outlier_rows"]) for s in report
           if s["imu"].get("clock_outlier_rows")]
    for name, rows in bad:
        print("  {}: {} leading IMU rows carry a clock outside the session; "
              "warm-up measured from the first sane row".format(name, rows))


def check(report):
    """The numbers measured from the real corpus on 2026-08-25."""
    by_id = {s["session"][-6:]: s for s in report}
    results = []

    def add(label, ok, got):
        results.append((label, bool(ok), str(got)))

    # Codex, 2026-08-25: the "256 vs 260 truncation" framing was wrong. The
    # sidecar matches the MEDIA exactly on every closed session; it is the
    # manifest that overstates. Real index truncation is 073055 and 072538.
    s = by_id.get("072310")
    st = s["streams"]["camera_left"] if s else None
    add("072310 camera_left: 256 PTS rows == 256 MP4 packets, manifest claims 260",
        st and (st["pts_rows"], st["media_packets"], st["manifest_frames"]) == (256, 256, 260),
        (st["pts_rows"], st["media_packets"], st["manifest_frames"]) if st else "no session")
    add("072310 camera_left verdict FRAMECOUNT-MISMATCH, not PTS-TRUNCATED",
        st and st["verdict"] == "FRAMECOUNT-MISMATCH",
        st["verdict"] if st else "no session")
    add("no closed session is PTS-TRUNCATED",
        all(v["verdict"] != "PTS-TRUNCATED"
            for x in report if x["status"] == "completed"
            for v in x["streams"].values()),
        [(x["session"][-6:], k) for x in report if x["status"] == "completed"
         for k, v in x["streams"].items() if v["verdict"] == "PTS-TRUNCATED"])

    s = by_id.get("073055")
    st = s["streams"]["camera_left"] if s else None
    add("073055 camera PTS exactly 65536 bytes, 3854 complete rows + a partial, "
        "vs 3990 MP4 packets",
        st and (st["pts_bytes"], st["pts_rows"], st["pts_partial_tail"],
                st["media_packets"]) == (65536, 3854, True, 3990),
        (st["pts_bytes"], st["pts_rows"], st["pts_partial_tail"], st["media_packets"])
        if st else "no session")
    a = s["streams"]["audio"] if s else None
    add("073055 audio PTS 49152 bytes and ends mid-value",
        a and a["pts_bytes"] == 49152 and a["pts_partial_tail"],
        (a["pts_bytes"], a["pts_partial_tail"]) if a else "no session")

    s = by_id.get("072538")
    add("072538 camera PTS files are zero bytes against 630 MP4 packets",
        s and all(s["streams"][k]["pts_bytes"] == 0
                  and s["streams"][k]["media_packets"] == 630
                  for k in ("camera_left", "camera_right")),
        [(k, s["streams"][k]["pts_bytes"], s["streams"][k]["media_packets"])
         for k in ("camera_left", "camera_right")] if s else "no session")
    add("both interrupted sessions are PTS-TRUNCATED on every stream",
        all(v["verdict"] == "PTS-TRUNCATED"
            for x in report if x["status"] == "recording"
            for v in x["streams"].values()),
        [(x["session"][-6:], k, v["verdict"])
         for x in report if x["status"] == "recording"
         for k, v in x["streams"].items() if v["verdict"] != "PTS-TRUNCATED"])

    closed = [s for s in report if s["status"] == "completed"]
    add("three closed sessions present", len(closed) == 3, len(closed))

    s = by_id.get("072516")
    add("072516 opens with 916 IMU rows on a corrupt clock",
        s and s["imu"].get("clock_outlier_rows") == 916,
        s["imu"].get("clock_outlier_rows") if s else "no session")
    # After the corrupt block the IMU there leads the manifest start_time
    # instead of trailing it, which is why it is pinned separately below.
    w = s["imu"].get("warmup_sec") if s else None
    add("072516 IMU warm-up after the corrupt block = -1.528 s",
        w is not None and abs(w + 1.528) < 0.002, w)

    for s in closed:
        sid = s["session"][-6:]
        i = s["imu"]
        w = i.get("warmup_sec")
        if not i.get("clock_outlier_rows"):
            add(sid + " IMU warm-up ~ +3.5 s", w is not None and 3.3 <= w <= 3.7, w)
        for k in ("audio", "camera_left", "camera_right"):
            w = s["streams"].get(k, {}).get("warmup_sec")
            add("{} {} warm-up ~ +4.0 s".format(sid, k),
                w is not None and 3.8 <= w <= 4.2, w)
        g = i.get("mean_sample_magnitude")
        add(sid + " mean |accel| ~ 9.8 m/s^2 (gravity)",
            g is not None and 9.7 <= g <= 10.1, g)
        add(sid + " gravity signature -Y-Z", i.get("signature") == "-Y-Z",
            i.get("signature"))

    print("\n== check")
    for label, ok, got in results:
        print("  {}  {}  [{}]".format("PASS" if ok else "FAIL", label, got))
    failed = sum(1 for _, ok, _ in results if not ok)
    print("  {}/{} pass".format(len(results) - failed, len(results)))
    return failed == 0


def selftest():
    """The one runnable check for the cases the real corpus cannot show, because
    every session in it happens to have all its MP4s. Builds a session in a temp
    dir and asserts a camera sidecar with no media is its own failure rather
    than quietly inheriting the audio tail-only verdict."""
    import tempfile
    assert verdict(10, False, None, None, "missing") == "MEDIA-MISSING"
    assert verdict(10, False, None, None, "unreadable") == "MEDIA-UNREADABLE"
    assert verdict(10, False, None, None, "unmeasured") == "UNMEASURED"
    assert verdict(10, False, None, None, "n/a") == "TAIL-OK"      # audio
    assert verdict(0, False, None, None, "n/a") == "PTS-TRUNCATED"  # empty audio
    with tempfile.TemporaryDirectory() as tmp:
        d = Path(tmp) / "ego_TEST00000000_20260825_000000"
        d.mkdir()
        (d / "meta_x.json").write_text(json.dumps(
            {"recording": {"status": "completed",
                           "start_time": "2026-08-25T00:00:00"},
             "statistics": {"video_left_frame_count": 3}}), encoding="utf-8")
        # A row per line, terminated: a healthy-looking sidecar with no media.
        (d / "x_camera_left_part0_pts.csv").write_text(
            "1787616000000000\n1787616000033000\n", encoding="utf-8")
        (d / "x_audio_part0_pts.csv").write_text(
            "1787616000000000\n", encoding="utf-8")
        got = analyse(d.parent, with_packets=True)[0]["streams"]
        assert got["camera_left"]["verdict"] == "MEDIA-MISSING", got
        assert got["camera_left"]["media_packets"] is None, got
        assert got["audio"]["verdict"] == "TAIL-OK", got
        # Without --packets a camera is not silently blessed either.
        un = analyse(d.parent, with_packets=False)[0]["streams"]
        assert un["camera_left"]["verdict"] == "UNMEASURED", un
    print("selftest: PASS")
    return True


def main(argv=None):
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sessions_dir", nargs="?", type=Path)
    ap.add_argument("--json", action="store_true", help="machine-readable report")
    ap.add_argument("--packets", action="store_true",
                    help="count MP4 packets with ffprobe (a second full read)")
    ap.add_argument("--selftest", action="store_true",
                    help="run the built-in assertions; needs no corpus")
    ap.add_argument("--check", action="store_true",
                    help="assert known corpus numbers; implies --packets")
    a = ap.parse_args(argv)
    if a.selftest:
        selftest()
        return 0

    root = a.sessions_dir or find_corpus()
    if root is None or not root.is_dir():
        print("no sessions directory ({})".format(root), file=sys.stderr)
        return 1
    report = analyse(root, a.packets or a.check)
    if not report:
        print("no ego_* session folders under {}".format(root), file=sys.stderr)
        return 1
    if a.json:
        print(json.dumps(report, indent=2))
    else:
        print("corpus: {}  ({} sessions)\n".format(root, len(report)))
        render(report)
    return 0 if (not a.check or check(report)) else 1


if __name__ == "__main__":
    sys.exit(main())
