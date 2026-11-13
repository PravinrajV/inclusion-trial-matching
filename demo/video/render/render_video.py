#!/usr/bin/env python3
"""Picture-lock the Inclusion demo from usable THINK takes only.

Never reads clip1.mp4 or clip4-sam.mp4 (personal info / wrong window).
Crops Chrome chrome (y=104) and scales/crops to 1920x1080 with no letterbox.
"""
from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path("/workspace/competitions/firebase-hybridai/inclusion/demo/video")
TAKES = ROOT / "think-takes"
WORK = ROOT / "render/work"
SEG = WORK / "segments"
FINAL = ROOT / "inclusion-demo-2026-11-12.mp4"
TITLE = ROOT / "title-slide-1920x1080.png"
ENDING = WORK / "ending-card-1920x1080.png"
FONT = "/usr/share/fonts/truetype/sand-box/google/IBM Plex Sans/IBMPlexSans-VariableFont_wdth,wght.ttf"

CLIP2 = TAKES / "clip2.mp4"
CLIP3 = TAKES / "clip3.mp4"
CLIP5 = TAKES / "clip5-sam.mp4"

# Do not even define paths to unusable takes.
FORBIDDEN = {TAKES / "clip1.mp4", TAKES / "clip4-sam.mp4"}

CHROME_Y = 104
SRC_W, SRC_H = 1824, 1080
APP_W, APP_H = 1824, SRC_H - CHROME_Y  # 1824 x 976
FPS = 30
# Base 16:9 window at zoom 1.0 inside the cropped app.
BASE_H = APP_H  # 976
BASE_W = int(round(APP_H * 16 / 9 / 2) * 2)  # 1736? 976*16/9=1735.11 -> 1734
# Use exact 16:9: h=975 is odd. h=972, w=1728.
BASE_H = 972
BASE_W = 1728
BASE_X = (APP_W - BASE_W) // 2  # 48
BASE_Y = 0


def even(n: int) -> int:
    return int(n) // 2 * 2


def run(cmd: list[str], desc: str = "") -> None:
    if desc:
        print(">>", desc)
    print("  ", " ".join(str(c) for c in cmd[:12]), "..." if len(cmd) > 12 else "")
    subprocess.check_call(cmd)


def ff(*args: str, desc: str = "") -> None:
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], desc)


@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int

    def clamp(self) -> "Rect":
        w = even(max(16, self.w))
        h = even(max(16, self.h))
        # keep 16:9 as closely as possible
        # prefer given h, fix w
        w = even(round(h * 16 / 9))
        x = min(max(0, even(self.x)), APP_W - w)
        y = min(max(0, even(self.y)), APP_H - h)
        if x + w > APP_W:
            x = even(APP_W - w)
        if y + h > APP_H:
            y = even(APP_H - h)
        return Rect(x, y, w, h)


def full() -> Rect:
    return Rect(BASE_X, BASE_Y, BASE_W, BASE_H).clamp()


def kb_filters(r0: Rect, r1: Rect, dur: float) -> list[str]:
    """Ken Burns: scale eval=frame + fixed 1920x1080 crop.

    The crop filter evaluates w/h only once (it locks to the end size and
    then animates x/y from the start position), so time-varying crop w/h
    cannot be used for a real zoom. Scale the chrome-cropped app so the
    current 16:9 window fills 1920x1080, then crop a constant 1920x1080.
    """
    r0, r1 = r0.clamp(), r1.clamp()
    d = max(dur, 0.001)
    nmax = d * FPS
    def lerp(a, b):
        if a == b:
            return str(a)
        return f"floor(({a}+({b}-({a}))*min(n/{nmax:.6f}\\,1))/2)*2"
    W, H, X, Y = lerp(r0.w, r1.w), lerp(r0.h, r1.h), lerp(r0.x, r1.x), lerp(r0.y, r1.y)
    return [
        f"scale=w='floor({APP_W}*1080/({H})/2)*2':h='floor({APP_H}*1080/({H})/2)*2':eval=frame:flags=lanczos",
        f"crop=1920:1080:x='floor(({X})*1080/({H})/2)*2':y='floor(({Y})*1080/({H})/2)*2'",
    ]

def sped_overlay() -> str:
    # Visible "Sped up" label, no em dash.
    return (
        f"drawtext=fontfile='{FONT}':text='Sped up':fontsize=36:"
        "fontcolor=white:x=w-280:y=h-96:box=1:boxcolor=0x000000cc:boxborderw=16"
    )


def render_still(image: Path, duration: float, dest: Path, r0: Rect | None = None, r1: Rect | None = None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    vf = [f"fps={FPS}", "scale=1920:1080:flags=lanczos", "setsar=1", "format=yuv420p"]
    if r0 and r1:
        # still is already 1920x1080; optional slight zoom via zoompan-like crop
        # Work in 1920x1080 space.
        pass
    ff(
        "-loop", "1", "-framerate", str(FPS), "-t", f"{duration:.3f}",
        "-i", str(image),
        "-vf", ",".join(vf),
        "-an", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(dest),
        desc=f"still {dest.name} {duration:.2f}s",
    )


def render_still_zoom(image: Path, duration: float, dest: Path, z0: float = 1.0, z1: float = 1.06) -> None:
    """Ken Burns on an already-1920x1080 still (print pages, ending if needed)."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    d = max(duration, 0.001)
    # crop in 1920x1080, keep 16:9
    # z=1 -> 1920x1080; z>1 smaller window centered (or slightly up)
    w = f"floor((1920/({z0}+({z1}-{z0})*min(t/{d:.6f}\\,1)))/2)*2"
    h = f"floor((1080/({z0}+({z1}-{z0})*min(t/{d:.6f}\\,1)))/2)*2"
    x = f"floor((1920-({w}))/4)*2"  # slightly left of center? no, center:
    x = f"floor((in_w-out_w)/4)*2"
    # crop x/y can use iw,ow after w/h set? Use:
    vf = (
        f"fps={FPS},"
        f"crop=w='{w}':h='{h}':x='(in_w-ow)/2':y='(in_h-oh)/2',"
        "scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p"
    )
    ff(
        "-loop", "1", "-framerate", str(FPS), "-t", f"{duration:.3f}",
        "-i", str(image),
        "-vf", vf,
        "-an", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        str(dest),
        desc=f"still-zoom {dest.name} {duration:.2f}s",
    )


def render_clip(
    src: Path,
    t0: float,
    t1: float,
    out_dur: float,
    dest: Path,
    r0: Rect,
    r1: Rect,
    speed: float = 1.0,
    label_sped: bool = False,
) -> None:
    if src in FORBIDDEN:
        raise RuntimeError(f"Refusing to use forbidden take: {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    r0, r1 = r0.clamp(), r1.clamp()
    src_len = max(0.05, t1 - t0)
    media = src_len / speed
    hold = max(0.0, out_dur - media + 0.02)
    # Build filter.
    # 1) trim 2) chrome crop 3) speed 4) fps 5) tpad hold 6) kenburns crop 7) scale
    filters = [
        f"trim=start=0:duration={src_len:.4f}",
        "setpts=PTS-STARTPTS",
        f"crop={APP_W}:{APP_H}:0:{CHROME_Y}",
    ]
    if abs(speed - 1.0) > 0.001:
        filters.append(f"setpts=PTS/{speed:.6f}")
    filters.append(f"fps={FPS}")
    if hold > 0.03:
        filters.append(f"tpad=stop_mode=clone:stop_duration={hold:.4f}")
    filters.extend(kb_filters(r0, r1, out_dur))
    filters.append("setsar=1")
    if label_sped:
        filters.append(sped_overlay())
    filters.append("format=yuv420p")
    vf = ",".join(filters)
    ff(
        "-ss", f"{t0:.4f}", "-i", str(src),
        "-vf", vf,
        "-an", "-t", f"{out_dur:.4f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        str(dest),
        desc=f"clip {dest.name} src {t0:.2f}-{t1:.2f} @ {speed}x -> {out_dur:.2f}s",
    )


def concat(paths: list[Path], dest: Path) -> None:
    lst = WORK / "concat.txt"
    lines = []
    for p in paths:
        if not p.exists():
            raise FileNotFoundError(p)
        lines.append(f"file '{p}'")
    lst.write_text("\n".join(lines) + "\n")
    ff(
        "-f", "concat", "-safe", "0", "-i", str(lst),
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(dest),
        desc=f"concat {len(paths)} segments -> {dest.name}",
    )


# --- Zoom windows (cropped-app coordinates) ---
# Briefing panel:
BRIEF = Rect(1210, 0, 608, 342)          # title, site, NCT, refresh button
BRIEF_STATUS = Rect(1210, 80, 608, 342)  # Canton + refresh status text
BRIEF_DRIVER = Rect(1210, 460, 608, 342) # EGFR row + trial quote
BRIEF_DISC = Rect(1210, 420, 608, 342)   # brain mets discuss
SAM_TOP = Rect(1210, 0, 608, 342)        # Cincinnati 2 miles
SAM_ALK = Rect(1210, 300, 608, 342)      # ALK met line; will also try 380
SAM_ALK_Q = Rect(1210, 580, 608, 342)    # ALK quote listing ALK, ROS1, NTRK
SAM_OPEN = Rect(0, 0, 992, 558)         # 4 Strong, 277, 4 of 6, above ROS1 ask
# Facts / chips (clip2)
FACTS = Rect(48, 0, 1728, 972)
FACTS_IN = Rect(480, 8, 1408, 792)
# Proof pill zoom
PROOF0 = Rect(900, 0, 900, 506)
PROOF1 = Rect(1180, 0, 640, 360)
# Landing
LAND = full()
LAND_IN = Rect(64, 8, 1600, 900)


def main() -> None:
    for p in FORBIDDEN:
        if "clip1" in p.name or "clip4" in p.name:
            pass
    WORK.mkdir(parents=True, exist_ok=True)
    SEG.mkdir(parents=True, exist_ok=True)

    parts: list[tuple[str, float, Path]] = []

    def add(name: str, dur: float, path: Path):
        parts.append((name, dur, path))

    # 0:00-0:03 title
    p = SEG / "00-title.mp4"
    render_still(TITLE, 3.0, p)
    add("title", 3.0, p)

    # 0:03-0:15 landing / problem (12s). Footage 0.00-6.20 then hold+zoom.
    p = SEG / "01-problem.mp4"
    render_clip(CLIP2, 0.00, 6.20, 12.0, p, LAND, LAND_IN)
    add("problem", 12.0, p)

    # 0:15-0:23 walk into chart (8s). 6.20-13.50 is 7.3s + short hold.
    p = SEG / "02-chart.mp4"
    render_clip(CLIP2, 6.20, 13.50, 8.0, p, full(), Rect(80, 40, 1408, 792))
    add("chart", 8.0, p)

    # 0:23-0:46 Nano (23s): paste+click, sped wait, facts.
    # 13.50-16.15 real ~2.65s
    p = SEG / "03a-paste.mp4"
    render_clip(CLIP2, 13.50, 16.15, 3.0, p, full(), full())
    add("nano-paste", 3.0, p)
    # 16.15-36.875 wait, ~20.725s -> 4.0s (5.181x) with Sped up
    p = SEG / "03b-wait.mp4"
    render_clip(CLIP2, 16.15, 36.875, 4.0, p, full(), full(), speed=20.725 / 4.0, label_sped=True)
    add("nano-wait", 4.0, p)
    # facts 36.875-49.85 = 12.975s, need 16s (23-3-4)
    p = SEG / "03c-facts.mp4"
    render_clip(CLIP2, 36.875, 49.85, 16.0, p, FACTS, FACTS_IN)
    add("nano-facts", 16.0, p)

    # 0:46-0:58 Proof (12s). Zoom the proof pill on the facts header.
    p = SEG / "04-proof.mp4"
    render_clip(CLIP2, 47.50, 49.90, 12.0, p, PROOF0, PROOF1)
    add("proof", 12.0, p)

    # 0:58-1:16 Nine strong (18s). clip3 7.40-15.60 only (avoid 15.70-18.70).
    p = SEG / "05-nine.mp4"
    render_clip(CLIP3, 7.40, 15.60, 18.0, p, full(), Rect(40, 0, 1536, 864))
    add("nine", 18.0, p)

    # 1:16-1:50 Briefing + refresh (34s).
    # 18.80-20.75 results after return from CT.gov, then briefing 20.75-39.50
    # Split:
    #  a) 18.80-22.80 open briefing and approach the button (4.0s)
    #  b) 22.80-36.40 refresh wait 13.6s -> keep real? Long. Speed to 8s with label, or keep 10s.
    #     I'll keep 6s of the start (status readable) then speed the rest to 4s? Simpler: play 22.80-36.40 at 13.6/8=1.7x without label? That's mild. Or real-time 13.6s.
    #     Budget 34s: 4 open + 10 refresh (13.6->10, 1.36x, no label) + 10 hold status + 10 driver quote.
    p = SEG / "06a-open-brief.mp4"
    render_clip(CLIP3, 18.80, 22.85, 5.0, p, full(), BRIEF)
    add("brief-open", 5.0, p)
    p = SEG / "06b-refresh.mp4"
    # 22.85-36.40 is 13.55s. Play 9.0s (speed 1.505x) — slight, no "Sped up" (it's a status wait, but 1.5x is mild; I'll use a light speed without label to keep the 34s budget honest... Actually user asked for honest sped-up on the Nano wait. For refresh I'll play real-time for 10s of the most useful part: click + first seconds of refreshing + jump to the completed status.
    # Better honest cut: play 22.85-26.00 (3.15s refreshing starts), then cut to 36.20-39.60 (3.4s completed status), then hold and pan to driver.
    render_clip(CLIP3, 22.85, 26.20, 3.5, p, BRIEF, BRIEF_STATUS)
    add("refresh-run", 3.5, p)
    p = SEG / "06c-refreshed.mp4"
    render_clip(CLIP3, 36.20, 39.60, 12.5, p, BRIEF_STATUS, BRIEF_STATUS)
    add("refreshed", 12.5, p)
    p = SEG / "06d-driver.mp4"
    # Use a late hold on 39.0 (still at top) — actually 39.6 is still top. Use a still-like hold from 38.8 and Ken Burns down to driver? The frame at 38.8 is top of briefing (not scrolled). Ken Burns crop can move the window down to the driver quote on the same frame, because the quote is already in the frame's lower part of the panel... On the un-scrolled briefing, the driver quote is lower in the panel, so cropping down on the 38.8-39.6 frames works!
    render_clip(CLIP3, 38.80, 39.60, 13.0, p, BRIEF_STATUS, BRIEF_DRIVER)
    add("brief-driver", 13.0, p)
    # 5+3.5+12.5+13=34. Good.

    # 1:50-2:08 Discuss (18s). 39.75-41.00 scroll to brain mets, then hold zoom.
    p = SEG / "07-discuss.mp4"
    # Brain mets is only in view ~40.15-40.55; hold that frame, do not use the later scroll-back.
    render_clip(CLIP3, 40.15, 40.55, 18.0, p, Rect(1210, 540, 608, 342), Rect(1210, 556, 608, 342))
    add("discuss", 18.0, p)

    # 2:08-2:26 Print (18s). Pages 1 then 2.
    p = SEG / "08a-print1.mp4"
    render_still_zoom(WORK / "print-page-1-1920x1080.png", 8.0, p, 1.0, 1.06)
    add("print1", 8.0, p)
    p = SEG / "08b-print2.mp4"
    render_still_zoom(WORK / "print-page-2-1920x1080.png", 10.0, p, 1.0, 1.08)
    add("print2", 10.0, p)

    # 2:26-2:34 Sam (8s). 2.5s opener (no ROS1), 5.5s ALK briefing.
    p = SEG / "09a-sam-open.mp4"
    render_clip(CLIP5, 10.90, 12.35, 2.5, p, SAM_OPEN, SAM_OPEN)
    add("sam-open", 2.5, p)
    p = SEG / "09b-sam-alk.mp4"
    render_clip(CLIP5, 12.50, 19.80, 5.5, p, SAM_TOP, SAM_ALK_Q)
    add("sam-alk", 5.5, p)

    # 2:34-2:42 ending
    p = SEG / "10-ending.mp4"
    render_still(ENDING, 8.0, p)
    add("ending", 8.0, p)

    total = sum(d for _, d, _ in parts)
    print("Scheduled total:", total, "s")
    if abs(total - 162.0) > 0.05:
        print("WARNING: total is not 162s")

    picture = WORK / "picture-lock.mp4"
    concat([pth for _, _, pth in parts], picture)
    # Also copy/remux to FINAL as picture-only for now; audio mux happens later.
    ff("-i", str(picture), "-c:v", "copy", "-an", "-movflags", "+faststart", str(FINAL), desc="write picture-only final")

    beatlist = []
    t = 0.0
    for name, dur, pth in parts:
        beatlist.append({"name": name, "start": round(t, 3), "end": round(t + dur, 3), "duration": dur, "file": str(pth)})
        t += dur
    (WORK / "beatlist.json").write_text(json.dumps({"total": t, "beats": beatlist}, indent=2))
    print("PICTURE DONE", t, "s ->", FINAL)


if __name__ == "__main__":
    main()
