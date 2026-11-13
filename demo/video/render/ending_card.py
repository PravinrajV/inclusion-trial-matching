"""Ending slide and print-sheet composites for the Inclusion demo video."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/usr/share/fonts/truetype/sand-box/google/IBM Plex Sans/IBMPlexSans-VariableFont_wdth,wght.ttf"
BG = (8, 10, 14)
NEAR_WHITE = (244, 244, 242)
SECONDARY = (220, 220, 216)
MUTED = (196, 196, 192)
RULE = (196, 140, 72)  # copper, matches the title slide
PILL_STROKE = (210, 210, 206)

OUT_DIR = Path("/workspace/competitions/firebase-hybridai/inclusion/demo/video/render/work")
VIDEO_DIR = Path("/workspace/competitions/firebase-hybridai/inclusion/demo/video")


def plex(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    font = ImageFont.truetype(FONT_PATH, size)
    try:
        # axes: wdth, wght
        font.set_variation_by_axes([weight, 100])  # Weight, Width
    except Exception:
        pass
    return font


def wrap(draw, text, font, width):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = w if not cur else cur + " " + w
        if draw.textlength(trial, font=font) <= width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def make_ending_card(path: Path | None = None) -> Path:
    path = path or OUT_DIR / "ending-card-1920x1080.png"
    path.parent.mkdir(parents=True, exist_ok=True)
    im = Image.new("RGB", (1920, 1080), BG)
    d = ImageDraw.Draw(im)
    left, right = 160, 1760
    width = right - left
    y = 150

    f_hero = plex(108, 700)
    f_sub = plex(48, 600)
    f_try = plex(36, 500)
    f_url = plex(44, 600)
    f_body = plex(34, 500)
    f_eval = plex(36, 600)
    f_eval2 = plex(34, 500)

    def text(s, font, fill, y, gap=0):
        d.text((left, y), s, font=font, fill=fill)
        bbox = d.textbbox((left, y), s, font=font)
        return bbox[3] + gap

    y = text("Inclusion", f_hero, NEAR_WHITE, y, gap=8)
    y = text("Private clinical-trial matching", f_sub, SECONDARY, y, gap=18)
    d.rectangle((left, y, left + 220, y + 4), fill=RULE)
    y += 36

    y = text("Try it: inclusion-hybridai.web.app", f_url, NEAR_WHITE, y, gap=16)
    for line in wrap(
        d,
        "Synthetic patients only. Clinic-note reading needs Chrome's on-device model; the rest works on any Chrome.",
        f_body,
        width,
    ):
        y = text(line, f_body, MUTED, y, gap=8)
    y += 48

    eval1 = "What users see: 0 unsafe typed checks on all three held-out sets."
    eval2 = (
        "Model level: 1 prior-therapy miss on set 3, so prior-therapy rules aren't "
        "automated from the parser."
    )
    for line in wrap(d, eval1, f_eval, width):
        y = text(line, f_eval, NEAR_WHITE, y, gap=10)
    y += 10
    for line in wrap(d, eval2, f_eval2, width):
        y = text(line, f_eval2, SECONDARY, y, gap=10)

    im.save(path, "PNG")
    print("wrote", path, "last y", y)
    return path


def make_print_frame(page_path: Path, out_path: Path, scale: float = 1.0) -> Path:
    """Place a letter page on the dark 1920x1080 ground, optionally slightly scaled up."""
    bg = Image.new("RGB", (1920, 1080), BG)
    page = Image.open(page_path).convert("RGB")
    # fit with margins
    max_h = int(1000 * scale)
    max_w = int(820 * scale)
    pw, ph = page.size
    fit = min(max_w / pw, max_h / ph)
    nw, nh = int(pw * fit), int(ph * fit)
    page = page.resize((nw, nh), Image.Resampling.LANCZOS)
    # subtle shadow
    shadow = Image.new("RGB", (nw + 24, nh + 24), (4, 5, 7))
    sx = (1920 - (nw + 24)) // 2 + 6
    sy = (1080 - (nh + 24)) // 2 + 8
    bg.paste(shadow, (sx, sy))
    x = (1920 - nw) // 2
    y = (1080 - nh) // 2
    bg.paste(page, (x, y))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    bg.save(out_path, "PNG")
    return out_path


if __name__ == "__main__":
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    make_ending_card()
    print_src = Path("/tmp/inclusion-video/print")
    for i, name in [(1, "p-01.png"), (2, "p-02.png")]:
        make_print_frame(print_src / name, OUT_DIR / f"print-page-{i}-1920x1080.png", scale=1.0)
        make_print_frame(print_src / name, OUT_DIR / f"print-page-{i}-zoom-1920x1080.png", scale=1.08)
    print("print frames ready")
