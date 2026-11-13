#!/usr/bin/env python3
"""Generate George VO + optional music_v2 bed, mix, mux, and write SRT.

Loads ELEVENLABS_API_KEY from work/.elevenlabs.env and never prints it.
Avoids Beta features (no eleven_v3, cloning, inpainting, finetunes).
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path("/workspace/competitions/firebase-hybridai/inclusion/demo/video")
WORK = ROOT / "render/work"
AUDIO = WORK / "audio"
ENVFILE = WORK / ".elevenlabs.env"
NARRATION = ROOT / "render/narration.txt"
PICTURE = ROOT / "inclusion-demo-2026-11-12.mp4"
FINAL = ROOT / "inclusion-demo-2026-11-12-final.mp4"
SRT = ROOT / "inclusion-demo-2026-11-12.srt"
VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
TTS_MODEL = "eleven_multilingual_v2"
MUSIC_MODEL = "music_v2"
DURATION = 162.0
FPS = 30
API = "https://api.elevenlabs.io"

# Preferred start of each VO line, and the visual window it must serve.
# briefing-a may spill a few seconds into the refresh UI (Canton stays on screen).
# refresh VO then starts after briefing-a ends, still inside the refreshed hold.
LINES = [
    {
        "id": "problem",
        "prefer": 3.00,
        "window_end": 15.00,
        "text": (
            "Trial eligibility is written for researchers, not for the visit you are about to walk into. "
            "Inclusion keeps your chart on this computer and turns nearby public trial language into a short briefing for you and your oncologist."
        ),
    },
    {
        "id": "chart",
        "prefer": 15.15,
        "window_end": 23.00,
        "text": "On a computer that can run Chrome's on-device model, you can paste a synthetic clinic note and read it here.",
    },
    {
        "id": "nano",
        "prefer": 23.15,
        "window_end": 46.00,
        "text": (
            "This is Alex Rivera, a synthetic demo patient, not a real person. "
            "Gemini Nano reads the note on this device. "
            "The fact chips fill in, and an On this device badge stays on the fact sheet. "
            "The status line says nothing is sent to a cloud model."
        ),
    },
    {
        "id": "proof",
        "prefer": 46.15,
        "window_end": 58.00,
        "text": (
            "The Proof pill counted 0 chart bytes. "
            "Public trial lookups do leave this computer, and they are kept separate from the chart."
        ),
    },
    {
        "id": "nine",
        "prefer": 58.15,
        "window_end": 76.00,
        "text": (
            "Matching runs on this computer, against a cache of 277 nearby trials. "
            "For Alex, this build finds nine strong matches, ranked by strength of evidence. "
            "Strong means there is quoted evidence to take to clinic, not a decision that Alex belongs on the study."
        ),
    },
    {
        "id": "briefing-a",
        "prefer": 76.15,
        "window_end": 88.00,  # may spill into refresh; Canton remains visible
        "text": (
            "The first card is NCT04486833, an EGFR-mutant study for patients who progressed on osimertinib, "
            "with a site in Canton, Ohio, 103 miles from Columbus."
        ),
    },
    {
        "id": "refresh",
        "prefer": 88.00,  # will be pushed to after briefing-a if needed
        "window_end": 97.00,
        "text": "Public trial text is parsed in the cloud, twice, through Firebase AI Logic, then checked.",
    },
    {
        "id": "briefing-b",
        "prefer": 97.15,
        "window_end": 110.00,
        "text": (
            "The briefing quotes the trial's own words, and it names what the chart shows, including EGFR exon 19 deletion. "
            "These are the trial's sentences, not a verdict from the app."
        ),
    },
    {
        "id": "discuss",
        "prefer": 110.15,
        "window_end": 128.00,
        "text": (
            "It also leaves an honest open question. "
            "Brain metastases are not checked automatically, and that still needs a conversation. "
            "That is the point of the briefing: what to ask, not what to conclude."
        ),
    },
    {
        "id": "print",
        "prefer": 128.15,
        "window_end": 146.00,
        "text": (
            "Print the sheet and take it to the oncologist. "
            "It lists quoted findings and questions, plus the source, ClinicalTrials.gov. "
            "The conversation still belongs in the clinic."
        ),
    },
    {
        "id": "sam",
        "prefer": 146.15,
        "window_end": 154.00,
        "text": (
            "For Sam, this build finds four strong matches. "
            "His top card meets four of six key criteria, including the ALK driver."
        ),
    },
    {
        "id": "ending",
        "prefer": 154.15,
        "window_end": 161.20,  # leave room for the last-second fade
        "text": (
            "Try the hosted demo. Synthetic patients only. "
            "Clinic-note reading needs Chrome's on-device model. The rest works on any Chrome."
        ),
    },
]


def load_key() -> str:
    key = None
    for line in ENVFILE.read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not key:
        raise SystemExit("ELEVENLABS_API_KEY missing from env file")
    return key


def api_request(key: str, method: str, path: str, body: dict | None = None, timeout: int = 300) -> tuple[int, bytes, str]:
    data = None
    headers = {"xi-api-key": key, "Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(API + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        raw = e.read()
        text = raw.decode(errors="replace").replace(key, "[redacted]")
        raise RuntimeError(f"HTTP {e.code} {path.split('?')[0]}: {text[:800]}") from None


def run(cmd: list[str], desc: str = "") -> None:
    if desc:
        print(">>", desc)
    subprocess.check_call(cmd)


def ff(*args: str, desc: str = "") -> None:
    run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args], desc)


def probe_duration(path: Path) -> float:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        text=True,
    ).strip()
    return float(out)


def generate_line(key: str, line: dict, prev_text: str, next_text: str) -> dict:
    AUDIO.mkdir(parents=True, exist_ok=True)
    wav = AUDIO / f"vo-{line['id']}.wav"
    meta = AUDIO / f"vo-{line['id']}.json"
    if wav.exists() and meta.exists():
        info = json.loads(meta.read_text())
        print(f"  cache hit {line['id']} {info['duration']:.3f}s")
        return info
    body = {
        "text": line["text"],
        "model_id": TTS_MODEL,
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.75,
            "speed": 1.0,
        },
        "apply_text_normalization": "on",
    }
    if prev_text:
        body["previous_text"] = prev_text
    if next_text:
        body["next_text"] = next_text
    # Prefer 192 kbps; fall back to 128 if the plan rejects it.
    raw = None
    for fmt in ("mp3_44100_192", "mp3_44100_128"):
        try:
            status, raw, _ = api_request(
                key, "POST",
                f"/v1/text-to-speech/{VOICE_ID}/with-timestamps?output_format={fmt}",
                body,
                timeout=180,
            )
            print(f"  TTS {line['id']} format={fmt} http={status} bytes={len(raw)}")
            break
        except RuntimeError as e:
            if "192" in fmt and ("format" in str(e).lower() or "422" in str(e) or "forbidden" in str(e).lower()):
                print(f"  {fmt} not available, falling back")
                continue
            raise
    data = json.loads(raw)
    mp3 = AUDIO / f"vo-{line['id']}.mp3"
    mp3.write_bytes(base64.b64decode(data["audio_base64"]))
    ff("-i", str(mp3), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(wav), desc=f"decode {mp3.name}")
    dur = probe_duration(wav)
    alignment = data.get("alignment") or {}
    info = {
        "id": line["id"],
        "text": line["text"],
        "duration": dur,
        "characters": alignment.get("characters") or [],
        "starts": alignment.get("character_start_times_seconds") or [],
        "ends": alignment.get("character_end_times_seconds") or [],
        "wav": str(wav),
    }
    meta.write_text(json.dumps({k: v for k, v in info.items() if k != "audio"}, indent=2))
    print(f"  wrote {line['id']} {dur:.3f}s")
    return info


def place_lines(infos: list[dict]) -> list[dict]:
    """Place each clip on the 162s timeline without cutting speech or overlapping."""
    placed = []
    prev_end = 3.00  # title is music only
    for line, info in zip(LINES, infos):
        dur = info["duration"]
        start = max(line["prefer"], prev_end + 0.20)
        end = start + dur
        # If we overflow the window, try pulling the start earlier into unused slack.
        if end > line["window_end"]:
            earliest = prev_end + 0.12
            start2 = max(earliest, line["window_end"] - dur)
            if start2 < start:
                start = start2
                end = start + dur
        overflow = max(0.0, end - line["window_end"])
        # Never trim the VO. Allow a modest spill into the next compatible visual
        # rather than speeding or cutting, and record it.
        if end > DURATION - 0.15:
            # Shift earlier if possible so we finish before the fade.
            earliest = prev_end + 0.12
            need_start = (DURATION - 0.80) - dur
            if need_start >= earliest:
                start = need_start
                end = start + dur
                overflow = max(0.0, end - line["window_end"])
            else:
                # Still may run into the last second; keep the full line.
                start = earliest
                end = start + dur
                overflow = max(0.0, end - line["window_end"])
        rec = {
            **info,
            "start": round(start, 3),
            "end": round(end, 3),
            "overflow": round(overflow, 3),
            "window_end": line["window_end"],
            "prefer": line["prefer"],
        }
        placed.append(rec)
        prev_end = end
        note = f"  PLACE {rec['id']:11} {rec['start']:7.3f}-{rec['end']:7.3f}  dur={dur:.3f}"
        if overflow > 0.05:
            note += f"  SPILL {overflow:.3f}s past window {line['window_end']:.2f}"
        print(note)
    # If the last line runs past the fade, shift the tail (Sam + ending) earlier
    # into unused slack after the print VO. Do not trim or speed the speech.
    fade_limit = 161.80
    if placed and placed[-1]["end"] > fade_limit:
        shift = placed[-1]["end"] - fade_limit
        # Do not start Sam before print VO has finished + a short gap.
        print_end = next((r["end"] for r in placed if r["id"] == "print"), 0.0)
        sam = next((r for r in placed if r["id"] == "sam"), None)
        earliest_sam = print_end + 0.35
        if sam and sam["start"] - shift < earliest_sam:
            shift = sam["start"] - earliest_sam
        if shift > 0.001:
            for rec in placed:
                if rec["start"] >= (sam["start"] if sam else 0):
                    rec["start"] = round(rec["start"] - shift, 3)
                    rec["end"] = round(rec["end"] - shift, 3)
                    rec["prelap"] = round(shift, 3)
            print(f"  ADJUST shifted Sam+ending earlier by {shift:.3f}s so VO ends before 2:41.8")
            for rec in placed:
                if rec["id"] in {"sam", "ending"}:
                    print(f"  PLACE {rec['id']:11} {rec['start']:7.3f}-{rec['end']:7.3f}  (after shift)")
    return placed


def build_vo_timeline(placed: list[dict], dest: Path) -> None:
    """Lay VO clips onto a 162s stereo 48k silence bed."""
    # Use ffmpeg adelay + amix for all clips.
    inputs = ["-f", "lavfi", "-t", f"{DURATION:.3f}", "-i", "anullsrc=r=48000:cl=stereo"]
    filters = []
    mix_ins = []
    for i, rec in enumerate(placed):
        inputs += ["-i", rec["wav"]]
        delay_ms = int(round(rec["start"] * 1000))
        # adelay for stereo
        filters.append(f"[{i+1}:a]adelay={delay_ms}|{delay_ms},apad=whole_dur={DURATION:.3f}[v{i}]")
        mix_ins.append(f"[v{i}]")
    n = len(placed)
    filters.append(
        f"{''.join(mix_ins)}amix=inputs={n}:duration=first:dropout_transition=0:normalize=0[vo]"
    )
    ff(
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[vo]",
        "-t", f"{DURATION:.3f}",
        "-c:a", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
        str(dest),
        desc="assemble VO timeline",
    )


def loudnorm_two_pass(src: Path, dest: Path, I: float = -16.0, TP: float = -1.5, LRA: float = 11.0) -> dict:
    """EBU R128 two-pass loudnorm. Returns measured + target stats."""
    out = subprocess.check_output(
        [
            "ffmpeg", "-hide_banner", "-i", str(src),
            "-af", f"loudnorm=I={I}:TP={TP}:LRA={LRA}:print_format=json",
            "-f", "null", "-",
        ],
        stderr=subprocess.STDOUT,
        text=True,
    )
    # JSON is at the end of stderr (merged)
    start = out.rfind("{")
    end = out.rfind("}")
    if start < 0 or end < 0:
        raise RuntimeError("loudnorm first pass did not print JSON")
    meas = json.loads(out[start : end + 1])
    filt = (
        f"loudnorm=I={I}:TP={TP}:LRA={LRA}:"
        f"measured_I={meas['input_i']}:"
        f"measured_TP={meas['input_tp']}:"
        f"measured_LRA={meas['input_lra']}:"
        f"measured_thresh={meas['input_thresh']}:"
        f"offset={meas['target_offset']}:"
        f"linear=true:print_format=json"
    )
    ff("-i", str(src), "-af", filt, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(dest),
       desc=f"loudnorm {src.name} -> I={I}")
    return meas


def ebur128(path: Path) -> dict:
    out = subprocess.check_output(
        [
            "ffmpeg", "-hide_banner", "-i", str(path),
            "-af", "ebur128=peak=true",
            "-f", "null", "-",
        ],
        stderr=subprocess.STDOUT,
        text=True,
    )
    # Parse the last "Summary:" block
    idx = out.rfind("Summary:")
    block = out[idx:] if idx >= 0 else out
    result = {"raw_tail": "\n".join(block.strip().splitlines()[-20:])}
    for line in block.splitlines():
        s = line.strip()
        if s.startswith("I:"):
            result["I"] = float(s.split()[1])
        elif s.startswith("LRA:"):
            result["LRA"] = float(s.split()[1])
        elif s.startswith("Threshold:"):
            result["Threshold"] = float(s.split()[1])
        elif "Peak:" in s and "True" in s:
            try:
                result["True_peak"] = float(s.split()[-2])
            except Exception:
                pass
        elif s.startswith("S:"):
            pass
    return result


def generate_music(key: str, dest_mp3: Path) -> bool:
    """Compose one instrumental bed with music_v2. Returns False if unavailable/beta."""
    if dest_mp3.exists() and dest_mp3.stat().st_size > 10000:
        print("  music cache hit", dest_mp3, dest_mp3.stat().st_size)
        return True
    prompt = (
        "Instrumental only, no vocals, no lyrics, no choir, no humming. "
        "A quiet, dark, modern underscore for a serious documentary-style product film. "
        "Soft low piano, muted pulses, warm low pads, gentle rhythmic ticks. "
        "No catchy melody that would fight a spoken voiceover. "
        "Calm, premium, restrained, minimal. Do not reference any artist or song."
    )
    # 3 minutes, a little longer than 2:42 so we can fade cleanly at 162s.
    body = {
        "prompt": prompt,
        "music_length_ms": 180000,
        "model_id": MUSIC_MODEL,
    }
    # Try a couple of output formats.
    last_err = None
    for path in (
        "/v1/music?output_format=mp3_44100_192",
        "/v1/music?output_format=mp3_44100_128",
        "/v1/music",
    ):
        try:
            print("  requesting music_v2 180s via", path.split("=")[-1])
            status, raw, ctype = api_request(key, "POST", path, body, timeout=420)
            print(f"  music http={status} type={ctype} bytes={len(raw)}")
            if raw[:3] == b"ID3" or raw[:2] == b"\xff\xfb" or "audio" in (ctype or ""):
                dest_mp3.write_bytes(raw)
                return True
            # maybe JSON wrapper
            try:
                data = json.loads(raw)
            except Exception:
                dest_mp3.write_bytes(raw)
                return True
            if "audio_base64" in data:
                dest_mp3.write_bytes(base64.b64decode(data["audio_base64"]))
                return True
            print("  unexpected music payload keys:", list(data)[:10])
            last_err = "unexpected payload"
        except RuntimeError as e:
            msg = str(e)
            last_err = msg
            print("  music error:", msg[:400])
            low = msg.lower()
            if any(s in low for s in ("beta", "not available", "permission", "forbidden", "403", "402")):
                return False
            continue
    print("  music failed:", last_err)
    return False


def build_music_bed(src_mp3: Path, dest: Path, vo_intervals: list[tuple[float, float]]) -> None:
    """Trim/pad to 162s, lift on title, duck 10 dB under VO, fade out last second."""
    raw = AUDIO / "music-raw.wav"
    ff("-i", str(src_mp3), "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le", str(raw), desc="decode music")
    # First, loudnorm the bed to about -22 LUFS (8-12 dB under a -16 LUFS voice when unducked on title,
    # then we duck another ~2 dB? Wait: duck 8-12 dB under the voice means:
    # VO at -16, ducked music should be about -26 to -28. Title (unducked) can sit around -20 to -22.
    # We'll loudnorm music to -21 (title level), then duck by 8 dB under VO to about -29.
    normed = AUDIO / "music-norm.wav"
    loudnorm_two_pass(raw, normed, I=-20.0, TP=-2.0, LRA=14.0)
    # Build a volume envelope expression. 0-3s title: 1.0 (0 dB).
    # 80ms attack / 250ms release around each VO interval, -10 dB (0.316) during VO.
    # After last VO, lift back toward 1.0, then fade 161->162 to 0.
    # Use ffmpeg volume eval=frame with a piecewise expression is messy for many intervals.
    # Generate a mono envelope wav instead.
    import struct
    import math
    sr = 48000
    n = int(DURATION * sr)
    duck_lin = 10 ** (-6.0 / 20.0)  # -6 dB from unducked bed (~10-12 dB under the -16 LUFS VO)
    env = [1.0] * n
    attack = int(0.080 * sr)
    release = int(0.300 * sr)
    for start, end in vo_intervals:
        a = max(0, int(start * sr))
        b = min(n, int(end * sr))
        # attack just before start
        a0 = max(0, a - attack)
        for i in range(a0, a):
            t = (i - a0) / max(1, a - a0)
            # interpolate from current toward duck
            env[i] = env[i] * (1 - t) + duck_lin * t
        for i in range(a, b):
            env[i] = duck_lin
        b1 = min(n, b + release)
        for i in range(b, b1):
            t = (i - b) / max(1, b1 - b)
            env[i] = duck_lin * (1 - t) + 1.0 * t
    # fade last 1.00s
    fade_n = int(1.0 * sr)
    for i in range(n - fade_n, n):
        env[i] *= (n - 1 - i) / fade_n
    env_path = AUDIO / "music-envelope.wav"
    # write 32-bit float mono envelope as a wav the volume filter can use? We'll apply in python.
    # Apply envelope to music-norm.wav with a short python mix to avoid extra deps: use ffmpeg volume
    # from a generated raw file via 'lut' is hard. Just multiply PCM here.
    raw_pcm = subprocess.check_output(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(normed),
         "-f", "f32le", "-ac", "2", "-ar", "48000", "pipe:1"]
    )
    import array
    samples = array.array("f")
    samples.frombytes(raw_pcm)
    # stereo interleaved
    ns = len(samples) // 2
    if ns < n:
        samples.extend([0.0] * (2 * (n - ns)))
        ns = n
    out = array.array("f")
    for i in range(n):
        g = env[i]
        out.append(samples[2 * i] * g)
        out.append(samples[2 * i + 1] * g)
    p = subprocess.Popen(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-f", "f32le", "-ac", "2", "-ar", "48000", "-i", "pipe:0",
         "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", str(dest)],
        stdin=subprocess.PIPE,
    )
    p.communicate(out.tobytes())
    if p.returncode != 0:
        raise RuntimeError("envelope apply failed")
    print("  music bed with duck + title lift + end fade ->", dest)


def mix(vo: Path, music: Path | None, dest: Path) -> None:
    if music is None:
        ff("-i", str(vo), "-c:a", "pcm_s16le", str(dest), desc="mix VO only")
        return
    # amix without renormalize so levels stay as we set them
    ff(
        "-i", str(vo), "-i", str(music),
        "-filter_complex", "amix=inputs=2:duration=first:dropout_transition=0:normalize=0,volume=-0.5dB,alimiter=limit=0.84:attack=7:release=80:level=false",
        "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2",
        "-t", f"{DURATION:.3f}",
        str(dest),
        desc="mix VO + ducked music",
    )


def srt_time(t: float) -> str:
    if t < 0:
        t = 0
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def cues_from_alignment(rec: dict) -> list[tuple[float, float, str]]:
    """Build readable caption cues from character alignment + timeline offset."""
    chars = rec.get("characters") or []
    starts = rec.get("starts") or []
    ends = rec.get("ends") or []
    if not chars or not starts or not ends or len(chars) != len(starts):
        # fallback: one cue for the whole line
        return [(rec["start"], rec["end"], rec["text"])]
    text = "".join(chars)
    # Split on sentence punctuation, keep the delimiter.
    cues = []
    buf = []
    buf_start = None
    buf_end = None

    def flush():
        nonlocal buf, buf_start, buf_end
        if not buf:
            return
        s = "".join(buf).strip()
        if s:
            cues.append((rec["start"] + buf_start, rec["start"] + buf_end, s))
        buf, buf_start, buf_end = [], None, None

    for ch, st, en in zip(chars, starts, ends):
        if buf_start is None:
            buf_start = st
        buf.append(ch)
        buf_end = en
        if ch in ".!?":
            flush()
    flush()
    # If a cue is very long (> 12s or > 110 chars), split on commas / 'and'
    refined = []
    for a, b, s in cues:
        if (b - a) <= 12.0 and len(s) <= 110:
            refined.append((a, b, s))
            continue
        # split on "; " or ", " at midpoints using original alignment
        # Rebuild from this sentence's characters
        # Simple wrap: split by comma groups
        parts = []
        acc = ""
        for piece in s.replace("; ", ", ").split(", "):
            if acc and len(acc) + len(piece) > 90:
                parts.append(acc.strip())
                acc = piece
            else:
                acc = (acc + ", " + piece) if acc else piece
        if acc:
            parts.append(acc.strip())
        if len(parts) == 1:
            refined.append((a, b, s))
            continue
        # Map parts back onto [a,b] by character weight
        total = sum(len(p) for p in parts) or 1
        t = a
        for i, p in enumerate(parts):
            frac = len(p) / total
            t2 = b if i == len(parts) - 1 else t + (b - a) * frac
            refined.append((t, t2, p))
            t = t2
    return refined


def write_srt(placed: list[dict], dest: Path) -> None:
    cues = []
    for rec in placed:
        cues.extend(cues_from_alignment(rec))
    cues.sort(key=lambda x: x[0])
    lines = []
    for i, (a, b, s) in enumerate(cues, 1):
        if b <= a:
            b = a + 0.4
        lines.append(str(i))
        lines.append(f"{srt_time(a)} --> {srt_time(b)}")
        # wrap at ~42 chars
        words = s.split()
        rows, row = [], []
        for w in words:
            trial = (" ".join(row + [w]))
            if len(trial) > 42 and row:
                rows.append(" ".join(row))
                row = [w]
            else:
                row.append(w)
        if row:
            rows.append(" ".join(row))
        lines.append("\n".join(rows[:2] if len(rows) <= 2 else [" ".join(rows[0].split()), " ".join(" ".join(rows[1:]).split())]))
        # actually if more than 2 rows, keep 2 reasonably
        lines.append("")
    dest.write_text("\n".join(lines) + "\n")
    print("  SRT cues:", len(cues), "->", dest)


def mux(picture: Path, audio: Path, dest: Path) -> None:
    run(
        [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(picture), "-i", str(audio),
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2",
            "-t", f"{DURATION:.3f}",
            "-movflags", "+faststart",
            str(dest),
        ],
        desc=f"mux picture + audio -> {dest.name}",
    )


def transcribe(key: str, wav: Path) -> dict:
    # multipart is easier with the SDK
    from elevenlabs import ElevenLabs
    client = ElevenLabs(api_key=key)
    with open(wav, "rb") as f:
        result = client.speech_to_text.convert(
            file=f,
            model_id="scribe_v2",
            language_code="eng",
            timestamps_granularity="word",
            keyterms=[
                "Inclusion", "Gemini Nano", "NCT04486833", "EGFR", "osimertinib",
                "Canton", "Firebase AI Logic", "ClinicalTrials.gov", "ALK",
                "Chrome", "Alex Rivera", "Columbus",
            ],
        )
    # result.text and result.words
    text = getattr(result, "text", None) or (result.get("text") if isinstance(result, dict) else str(result))
    words = getattr(result, "words", None) or (result.get("words") if isinstance(result, dict) else [])
    payload = {"text": text, "words": []}
    for w in words or []:
        if isinstance(w, dict):
            payload["words"].append(w)
        else:
            payload["words"].append({
                "text": getattr(w, "text", ""),
                "start": getattr(w, "start", None),
                "end": getattr(w, "end", None),
                "type": getattr(w, "type", None),
            })
    (AUDIO / "stt.json").write_text(json.dumps(payload, indent=2))
    return payload


def normalize_words(s: str) -> list[str]:
    import re
    s = s.lower()
    s = s.replace("clinicaltrials.gov", "clinicaltrials.gov")
    s = re.sub(r"[^a-z0-9.\s]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s.split()


def main() -> None:
    AUDIO.mkdir(parents=True, exist_ok=True)
    key = load_key()
    # Confirm narration paragraphs cover the same words, even if we split two briefing sentences.
    expected = " ".join(p.strip() for p in NARRATION.read_text().splitlines() if p.strip())
    got = " ".join(ln["text"] for ln in LINES)
    if expected != got:
        print("WARNING: LINES text does not exactly match narration.txt")
        # show a short context without being huge
        print("  expected len", len(expected), "got", len(got))

    print("== TTS ==")
    infos = []
    for i, line in enumerate(LINES):
        prev_text = LINES[i - 1]["text"] if i else ""
        next_text = LINES[i + 1]["text"] if i + 1 < len(LINES) else ""
        infos.append(generate_line(key, line, prev_text, next_text))

    print("== PLACE ==")
    placed = place_lines(infos)
    (AUDIO / "placement.json").write_text(json.dumps(placed, indent=2))

    print("== VO CLIP LUFS ==")
    # Loudnorm each clip to -16 LUFS so silences on the 162s bed do not inflate speech.
    placed_norm = []
    clip_meas = []
    for rec in placed:
        src = Path(rec["wav"])
        dst = AUDIO / f"vo-{rec['id']}-ln.wav"
        meas = loudnorm_two_pass(src, dst, I=-16.0, TP=-1.5, LRA=11.0)
        rec = {**rec, "wav": str(dst), "loudnorm_in_I": meas.get("input_i")}
        placed_norm.append(rec)
        clip_meas.append({"id": rec["id"], "input_i": meas.get("input_i"), "input_tp": meas.get("input_tp")})
        print(f"  {rec['id']} input_I={meas.get('input_i')} -> -16")
    placed = placed_norm
    (AUDIO / "placement.json").write_text(json.dumps(placed, indent=2))

    print("== VO TIMELINE ==")
    vo_raw = AUDIO / "vo-timeline.wav"
    vo_norm = vo_raw  # already clip-normalized
    build_vo_timeline(placed, vo_raw)
    vo_meas = {"clips": clip_meas}
    vo_ebu = ebur128(vo_norm)
    print("  VO timeline (includes silence) ebur128 I=", vo_ebu.get("I"))

    print("== MUSIC ==")
    music_mp3 = AUDIO / "music-v2.mp3"
    music_ok = generate_music(key, music_mp3)
    music_bed = None
    music_note = "not generated"
    if music_ok:
        music_bed = AUDIO / "music-bed.wav"
        intervals = [(p["start"], p["end"]) for p in placed]
        build_music_bed(music_mp3, music_bed, intervals)
        music_ebu = ebur128(music_bed)
        print("  ducked music ebur128 I=", music_ebu.get("I"), "TP=", music_ebu.get("True_peak"))
        music_note = "generated with music_v2, instrumental, ducked under VO, unducked on title, 1s fade at 2:42"
    else:
        print("  MUSIC UNAVAILABLE OR BETA; mixing without music")
        music_note = "unavailable or rejected; no music used"
        music_ebu = {}

    print("== MIX + MUX ==")
    mix_wav = AUDIO / "mix.wav"
    mix(vo_norm, music_bed, mix_wav)
    mix_ebu = ebur128(mix_wav)
    print("  MIX ebur128 I=", mix_ebu.get("I"), "LRA=", mix_ebu.get("LRA"), "TP=", mix_ebu.get("True_peak"))
    mux(PICTURE, mix_wav, FINAL)

    print("== SRT ==")
    write_srt(placed, SRT)

    # Save loudness report
    report = {
        "vo_first_pass": vo_meas,
        "vo_ebur128": {k: v for k, v in vo_ebu.items() if k != "raw_tail"},
        "music_ebur128": {k: v for k, v in (music_ebu or {}).items() if k != "raw_tail"},
        "mix_ebur128": {k: v for k, v in mix_ebu.items() if k != "raw_tail"},
        "music": music_note,
        "placement": [{"id": p["id"], "start": p["start"], "end": p["end"], "duration": p["duration"], "overflow": p["overflow"]} for p in placed],
    }
    (AUDIO / "loudness.json").write_text(json.dumps(report, indent=2))
    print("DONE picture-audio", FINAL)
    print("MUSIC:", music_note)


if __name__ == "__main__":
    main()
