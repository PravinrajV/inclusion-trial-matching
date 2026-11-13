#!/usr/bin/env python3
"""Picture-lock v2: locked static framings, no per-frame crop rounding jitter.

Never reads clip1.mp4 or clip4-sam.mp4.
Chrome chrome is cropped at y=104. App shots are a single 16:9 crop plus
one lanczos scale to 1920x1080. Holds are freeze frames. Hard cuts replace
slow Ken Burns drifts. The 162.0 s timeline is preserved so the existing
audio mix can be muxed unchanged.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path("/workspace/competitions/firebase-hybridai/inclusion/demo/video")
TAKES = ROOT / "think-takes"
WORK = ROOT / "render/work"
SEG = WORK / "segments-v2"
PICTURE = WORK / "picture-lock-v2.mp4"
TITLE = ROOT / "title-slide-1920x1080.png"
ENDING = WORK / "ending-card-1920x1080.png"
FONT = "/usr/share/fonts/truetype/sand-box/google/IBM Plex Sans/IBMPlexSans-VariableFont_wdth,wght.ttf"
PRINT_PAGES = WORK / "print-src"
BG = (8, 10, 14)

CLIP2 = TAKES / "clip2.mp4"
CLIP3 = TAKES / "clip3.mp4"
CLIP5 = TAKES / "clip5-sam.mp4"
FORBIDDEN = {TAKES / "clip1.mp4", TAKES / "clip4-sam.mp4"}

CHROME_Y = 104
APP_W, APP_H = 1824, 976
FPS = 30
BASE_H, BASE_W, BASE_X, BASE_Y = 972, 1728, 48, 0


def even(n: int) -> int:
    return int(n) // 2 * 2


def run(cmd: list[str], desc: str = "") -> None:
    if desc:
        print(">>", desc)
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
        h = even(max(16, self.h))
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


# Locked windows (cropped-app coordinates)
BRIEF = Rect(1210, 0, 608, 342).clamp()
BRIEF_STATUS = Rect(1210, 80, 608, 342).clamp()
BRIEF_DRIVER = Rect(1210, 460, 608, 342).clamp()
BRIEF_DISC = Rect(1210, 548, 608, 342).clamp()
SAM_TOP = Rect(1210, 0, 608, 342).clamp()
SAM_ALK_Q = Rect(1210, 580, 608, 342).clamp()
SAM_OPEN = Rect(0, 0, 992, 558).clamp()
FACTS = full()
FACTS_TIGHT = Rect(480, 8, 1408, 792).clamp()
PROOF_WIDE = Rect(900, 0, 900, 506).clamp()
PROOF_TIGHT = Rect(1180, 0, 640, 360).clamp()
NINE = full()
LAND = full()


def sped_overlay() -> str:
    return (
        f"drawtext=fontfile='{FONT}':text='Sped up':fontsize=36:"
        "fontcolor=white:x=w-280:y=h-96:box=1:boxcolor=0x000000cc:boxborderw=16"
    )


def static_scale(r: Rect) -> str:
    r = r.clamp()
    return (
        f"crop={APP_W}:{APP_H}:0:{CHROME_Y},"
        f"crop={r.w}:{r.h}:{r.x}:{r.y},"
        "scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p"
    )


def render_still(image: Path, duration: float, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    ff(
        "-loop", "1", "-framerate", str(FPS), "-t", f"{duration:.3f}",
        "-i", str(image),
        "-vf", "fps=30,scale=1920:1080:flags=lanczos,setsar=1,format=yuv420p",
        "-an", "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(dest),
        desc=f"still {dest.name} {duration:.2f}s",
    )


def render_freeze(src: Path, t: float, out_dur: float, dest: Path, r: Rect, label_sped: bool = False) -> None:
    """One source frame, one crop, one lanczos scale, held perfectly still."""
    if src in FORBIDDEN:
        raise RuntimeError(f"Refusing forbidden take: {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    still = dest.with_suffix(".png")
    vf = static_scale(r)
    if label_sped:
        vf = vf.replace(",format=yuv420p", f",{sped_overlay()},format=yuv420p")
    ff("-ss", f"{t:.4f}", "-i", str(src), "-vf", vf, "-frames:v", "1", str(still),
       desc=f"grab freeze {dest.name} @ {t:.3f}")
    render_still(still, out_dur, dest)
    still.unlink(missing_ok=True)


def render_static_clip(
    src: Path,
    t0: float,
    t1: float,
    out_dur: float,
    dest: Path,
    r: Rect,
    speed: float = 1.0,
    label_sped: bool = False,
    freeze_at: float | None = None,
) -> None:
    """Locked-crop playback, then a freeze hold if out_dur is longer.

    If freeze_at is set (source time), the hold uses that frame instead of
    the last playback frame, so a wandering cursor can be kept off the hold.
    """
    if src in FORBIDDEN:
        raise RuntimeError(f"Refusing forbidden take: {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    r = r.clamp()
    src_len = max(0.05, t1 - t0)
    media = src_len / speed
    vf_core = [
        f"trim=start=0:duration={src_len:.4f}",
        "setpts=PTS-STARTPTS",
        f"crop={APP_W}:{APP_H}:0:{CHROME_Y}",
    ]
    if abs(speed - 1.0) > 0.001:
        vf_core.append(f"setpts=PTS/{speed:.6f}")
    vf_core.append(f"fps={FPS}")
    vf_core.append(f"crop={r.w}:{r.h}:{r.x}:{r.y}")
    vf_core.append("scale=1920:1080:flags=lanczos")
    vf_core.append("setsar=1")
    if label_sped:
        vf_core.append(sped_overlay())
    vf_core.append("format=yuv420p")

    live_dur = min(media, out_dur)
    live = dest.with_name(dest.stem + "-live.mp4") if (out_dur - live_dur) > 0.04 else dest
    ff(
        "-ss", f"{t0:.4f}", "-i", str(src),
        "-vf", ",".join(vf_core),
        "-an", "-t", f"{live_dur:.4f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        str(live),
        desc=f"static-clip {dest.name} src {t0:.2f}-{t1:.2f} @ {speed}x live={live_dur:.2f}s",
    )
    hold = out_dur - live_dur
    if hold <= 0.04:
        if live != dest:
            live.replace(dest)
        return
    # Hold: freeze a chosen source frame, or the last live frame.
    hold_path = dest.with_name(dest.stem + "-hold.mp4")
    if freeze_at is not None:
        render_freeze(src, freeze_at, hold, hold_path, r, label_sped=label_sped)
    else:
        # Last frame of the live clip, already at 1920x1080.
        still = dest.with_name(dest.stem + "-last.png")
        ff("-sseof", "-0.04", "-i", str(live), "-frames:v", "1", str(still), desc=f"last frame {dest.name}")
        render_still(still, hold, hold_path)
        still.unlink(missing_ok=True)
    concat([live, hold_path], dest)
    live.unlink(missing_ok=True)
    hold_path.unlink(missing_ok=True)


def concat(paths: list[Path], dest: Path) -> None:
    lst = dest.with_suffix(".concat.txt")
    lines = [f"file '{p}'" for p in paths]
    for p in paths:
        if not p.exists():
            raise FileNotFoundError(p)
    lst.write_text("\n".join(lines) + "\n")
    ff(
        "-f", "concat", "-safe", "0", "-i", str(lst),
        "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        "-an",
        str(dest),
        desc=f"concat {len(paths)} -> {dest.name}",
    )
    lst.unlink(missing_ok=True)


def compose_letter(page: Path, box: tuple[int, int, int, int], dest: Path) -> Path:
    """Crop a 16:9 window from a letter-page raster and fit it to 1920x1080 on the dark ground."""
    im = Image.open(page).convert("RGB")
    x, y, w, h = box
    x, y, w, h = max(0, x), max(0, y), w, h
    if x + w > im.width:
        x = max(0, im.width - w)
    if y + h > im.height:
        y = max(0, im.height - h)
    crop = im.crop((x, y, x + w, y + h))
    # Scale to cover 1920x1080 as tightly as possible, then center-crop.
    scale = max(1920 / crop.width, 1080 / crop.height)
    nw, nh = int(round(crop.width * scale)), int(round(crop.height * scale))
    # Keep even
    nw, nh = even(max(1920, nw)), even(max(1080, nh))
    fitted = crop.resize((nw, nh), Image.Resampling.LANCZOS)
    left = (nw - 1920) // 2
    top = (nh - 1080) // 2
    framed = fitted.crop((left, top, left + 1920, top + 1080))
    # If the source wasn't large enough and we have letterboxing, paste on BG
    canvas = Image.new("RGB", (1920, 1080), BG)
    canvas.paste(framed, (0, 0))
    dest.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(dest, "PNG")
    return dest


def render_letter_still(page: Path, box: tuple[int, int, int, int], duration: float, dest: Path) -> None:
    png = dest.with_suffix(".png")
    compose_letter(page, box, png)
    render_still(png, duration, dest)
    # keep the png for QA
    qa = WORK / "print-v2" / png.name
    qa.parent.mkdir(parents=True, exist_ok=True)
    png.replace(qa)


def main() -> None:
    SEG.mkdir(parents=True, exist_ok=True)
    parts: list[tuple[str, float, Path]] = []

    def add(name: str, dur: float, path: Path) -> None:
        parts.append((name, dur, path))

    # 0:00-0:03 title
    p = SEG / "00-title.mp4"
    render_still(TITLE, 3.0, p)
    add("title", 3.0, p)

    # 0:03-0:15 landing, locked full frame, freeze a clean frame after the walk-in
    p = SEG / "01-problem.mp4"
    render_static_clip(CLIP2, 0.00, 6.20, 12.0, p, LAND, freeze_at=5.60)
    add("problem", 12.0, p)

    # 0:15-0:23 chart walk-in / paste, locked
    p = SEG / "02-chart.mp4"
    render_static_clip(CLIP2, 6.20, 13.50, 8.0, p, full())
    add("chart", 8.0, p)

    # 0:23-0:26 paste + click Read, locked full
    p = SEG / "03a-paste.mp4"
    render_static_clip(CLIP2, 13.50, 16.15, 3.0, p, full())
    add("nano-paste", 3.0, p)

    # 0:26-0:30 sped wait, locked full, visible Sped up
    p = SEG / "03b-wait.mp4"
    render_static_clip(
        CLIP2, 16.15, 36.875, 4.0, p, full(),
        speed=20.725 / 4.0, label_sped=True,
    )
    add("nano-wait", 4.0, p)

    # 0:30-0:37 facts, locked (chips + quotes, no drift)
    p = SEG / "03c-facts-a.mp4"
    render_static_clip(CLIP2, 36.875, 49.85, 7.0, p, FACTS)
    add("nano-facts-a", 7.0, p)

    # 0:37-0:40 hold the real Nano status line (freeze, no Sped up)
    p = SEG / "03c-status.mp4"
    render_freeze(CLIP2, 28.00, 3.0, p, full())
    add("nano-status", 3.0, p)

    # 0:40-0:46 facts again, hard cut to a tighter locked crop of chips + quotes
    p = SEG / "03c-facts-b.mp4"
    render_freeze(CLIP2, 47.20, 6.0, p, FACTS)
    add("nano-facts-b", 6.0, p)

    # 0:46-0:58 Proof pill: short locked wide, hard cut to locked tight
    p = SEG / "04-proof.mp4"
    a, b = SEG / "04a-proof-wide.mp4", SEG / "04b-proof-tight.mp4"
    render_static_clip(CLIP2, 47.50, 49.90, 3.0, a, PROOF_WIDE, freeze_at=49.20)
    render_freeze(CLIP2, 49.40, 9.0, b, PROOF_TIGHT)
    concat([a, b], p)
    add("proof", 12.0, p)

    # 0:58-1:16 nine strong, locked full (no drift). Freeze after 277 settles.
    p = SEG / "05-nine.mp4"
    render_static_clip(CLIP3, 7.40, 15.40, 18.0, p, NINE, freeze_at=14.80)
    add("nine", 18.0, p)

    # 1:16-1:21 open briefing: locked results, hard cut to locked briefing panel
    p = SEG / "06a-open-brief.mp4"
    a, b = SEG / "06a1-results.mp4", SEG / "06a2-brief.mp4"
    render_static_clip(CLIP3, 18.80, 20.80, 2.0, a, full())
    render_static_clip(CLIP3, 20.80, 22.85, 3.0, b, BRIEF_STATUS)
    concat([a, b], p)
    add("brief-open", 5.0, p)

    # 1:21-1:23 click Refresh, locked on the briefing status window
    p = SEG / "06b-click.mp4"
    render_static_clip(CLIP3, 22.85, 24.85, 2.0, p, BRIEF_STATUS)
    add("refresh-click", 2.0, p)

    # 1:23-1:35 hold the in-progress status (covers most of the 1:30-1:36 VO)
    p = SEG / "06c-progress.mp4"
    render_freeze(CLIP3, 26.00, 12.0, p, BRIEF_STATUS)
    add("refresh-progress", 12.0, p)

    # 1:35-1:39 completed status, held 4 s
    p = SEG / "06d-done.mp4"
    render_freeze(CLIP3, 36.40, 4.0, p, BRIEF_STATUS)
    add("refresh-done", 4.0, p)

    # 1:39-1:50 locked EGFR driver quote (hard cut, no pan drift)
    p = SEG / "06e-driver.mp4"
    render_freeze(CLIP3, 38.90, 11.0, p, BRIEF_DRIVER)
    add("brief-driver", 11.0, p)

    # 1:50-2:08 discuss, locked freeze on brain mets
    p = SEG / "07-discuss.mp4"
    render_freeze(CLIP3, 40.25, 18.0, p, BRIEF_DISC)
    add("discuss", 18.0, p)

    # 2:08-2:26 print: two locked framings, page 1 questions then page 2 quotes
    # Page rasters are 1275x1650. 16:9 height for full width = 717.
    p = SEG / "08a-print1.mp4"
    render_letter_still(PRINT_PAGES / "p-01.png", (40, 40, 1195, 672), 8.0, p)
    add("print1", 8.0, p)
    p = SEG / "08b-print2.mp4"
    render_letter_still(PRINT_PAGES / "p-02.png", (40, 20, 1195, 672), 10.0, p)
    add("print2", 10.0, p)

    # 2:26-2:34 Sam: locked opener, hard cut to ALK quote
    p = SEG / "09a-sam-open.mp4"
    render_static_clip(CLIP5, 10.90, 12.30, 2.5, p, SAM_OPEN, freeze_at=12.10)
    add("sam-open", 2.5, p)
    p = SEG / "09b-sam-alk.mp4"
    a, b = SEG / "09b1-sam-top.mp4", SEG / "09b2-sam-alk.mp4"
    render_freeze(CLIP5, 13.20, 1.5, a, SAM_TOP)
    render_freeze(CLIP5, 14.00, 4.0, b, SAM_ALK_Q)
    concat([a, b], p)
    add("sam-alk", 5.5, p)

    # 2:34-2:42 ending
    p = SEG / "10-ending.mp4"
    render_still(ENDING, 8.0, p)
    add("ending", 8.0, p)

    total = sum(d for _, d, _ in parts)
    print("Scheduled total:", total, "s")
    if abs(total - 162.0) > 0.05:
        raise SystemExit(f"total {total} is not 162s")

    concat([pth for _, _, pth in parts], PICTURE)
    beatlist = []
    t = 0.0
    for name, dur, pth in parts:
        beatlist.append({"name": name, "start": round(t, 3), "end": round(t + dur, 3), "duration": dur, "file": str(pth)})
        t += dur
    (WORK / "beatlist-v2.json").write_text(json.dumps({"total": t, "beats": beatlist}, indent=2))
    print("PICTURE V2 DONE", t, "s ->", PICTURE)


if __name__ == "__main__":
    main()
