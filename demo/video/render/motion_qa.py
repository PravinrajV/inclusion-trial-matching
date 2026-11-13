#!/usr/bin/env python3
"""Frame-to-frame motion QA on held (static) shots of picture-lock-v2."""
from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

PIC = Path("/workspace/competitions/firebase-hybridai/inclusion/demo/video/render/work/picture-lock-v3.mp4")
OUT = Path("/workspace/competitions/firebase-hybridai/inclusion/demo/video/render/work/motion-qa-v3.json")
FPS = 30

# Held interiors: skip the first frame of each hold (the cut into it).
# Times are output-timeline seconds [start, end).
HELD = [
    ("title", 0.00, 3.00),
    ("problem-hold", 9.20, 15.00),      # after live walk-in 3.00-9.20
    ("chart-hold", 22.30, 23.00),
    ("paste-hold", 25.65, 26.00),
    ("nano-status", 37.00, 40.00),
    ("facts-b", 40.00, 46.00),
    ("proof-wide-hold", 48.40, 49.00),  # live 2.40 then 0.60 hold
    ("proof-tight", 49.00, 58.00),
    ("nine-hold", 66.00, 76.00),        # live 8s from 58
    ("brief-open-hold", 80.05, 81.00),
    ("refresh-progress", 83.00, 95.00),
    ("refresh-done", 95.00, 99.00),
    ("brief-driver", 99.00, 110.00),
    ("discuss", 110.00, 128.00),
    ("print1", 128.00, 136.00),
    ("print2", 136.00, 146.00),
    ("sam-open-hold", 147.40, 148.50),
    ("sam-top", 148.50, 150.00),
    ("sam-alk", 150.00, 154.00),
    ("ending", 154.00, 162.00),
]


def phase_shift(a: np.ndarray, b: np.ndarray) -> tuple[float, float, float]:
    # Measure at 960x540 (2x) for speed; report shifts in 1920x1080 pixels.
    scale = 2.0
    ga = cv2.cvtColor(cv2.resize(a, (960, 540), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
    gb = cv2.cvtColor(cv2.resize(b, (960, 540), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY).astype(np.float32)
    win = cv2.createHanningWindow((ga.shape[1], ga.shape[0]), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(ga, gb, window=win)
    dx, dy = float(dx) * scale, float(dy) * scale
    mag = float(np.hypot(dx, dy))
    return dx, dy, mag


def main() -> None:
    cap = cv2.VideoCapture(str(PIC))
    if not cap.isOpened():
        raise SystemExit(f"cannot open {PIC}")
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    print(f"opened {n} frames {w}x{h}")

    # Load all frames is too much (~4860 * 1920*1080*3 ~ 30GB). Stream.
    results = []
    # Build a set of held frame-index ranges; skip the first frame of each hold
    # so a cut into the hold is not counted as jitter.
    held_pairs: list[tuple[str, int, int]] = []
    for name, t0, t1 in HELD:
        i0 = int(round(t0 * FPS))
        i1 = int(round(t1 * FPS))
        if i1 > n:
            i1 = n
        if i1 - i0 < 2:
            continue
        held_pairs.append((name, i0 + 1, i1))  # start at second frame of hold

    prev = None
    prev_i = -1
    # We'll iterate once, computing shifts only when prev is previous frame of same hold.
    current_hold = None
    shifts_by_hold: dict[str, list[float]] = {name: [] for name, _, _ in held_pairs}
    worst: list[tuple[float, str, int, float, float]] = []

    # Map frame -> hold name
    frame_hold = {}
    for name, a, b in held_pairs:
        for i in range(a, b):
            frame_hold[i] = (name, a)

    i = 0
    ok, frame = cap.read()
    while ok:
        if i in frame_hold:
            name, start = frame_hold[i]
            if prev is not None and prev_i == i - 1 and i > start:
                dx, dy, mag = phase_shift(prev, frame)
                shifts_by_hold[name].append(mag)
                if mag >= 0.05:
                    worst.append((mag, name, i, dx, dy))
            prev = frame
            prev_i = i
        else:
            prev = None
            prev_i = -1
        i += 1
        ok, frame = cap.read()
    cap.release()

    report = {"n_frames": n, "holds": [], "fail": []}
    print(f"{'hold':22} {'n':>6} {'max_px':>8} {'p99_px':>8} {'mean_px':>8} {'n>0.5':>6} {'pass'}")
    all_ok = True
    for name, a, b in held_pairs:
        s = np.array(shifts_by_hold[name], dtype=float)
        if s.size == 0:
            print(name, "NO SAMPLES")
            continue
        mx, p99, mean = float(s.max()), float(np.percentile(s, 99)), float(s.mean())
        nbad = int((s > 0.5).sum())
        passed = mx < 0.5
        if not passed:
            all_ok = False
            report["fail"].append({"name": name, "max": mx, "n>0.5": nbad})
        report["holds"].append({
            "name": name, "frames": int(s.size), "max_px": mx, "p99_px": p99,
            "mean_px": mean, "n_over_0_5": nbad, "pass": passed,
        })
        print(f"{name:22} {s.size:6d} {mx:8.4f} {p99:8.4f} {mean:8.4f} {nbad:6d} {'OK' if passed else 'FAIL'}")

    worst.sort(reverse=True)
    report["worst10"] = [
        {"mag": mag, "hold": name, "frame": fr, "t": fr / FPS, "dx": dx, "dy": dy}
        for mag, name, fr, dx, dy in worst[:10]
    ]
    report["all_holds_pass"] = all_ok
    OUT.write_text(json.dumps(report, indent=2))
    print("ALL_HOLDS_PASS" if all_ok else "SOME_HOLDS_FAIL", "->", OUT)


if __name__ == "__main__":
    main()
