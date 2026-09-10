"""
Simple image editing backend, using Pillow. Images live in an
in-memory store keyed by a generated id - fine for a local single-user
desktop app; nothing here is meant to be a durable asset library.

Each entry keeps both the ORIGINAL (for Reset) and the CURRENT
(working) image, so operations chain on top of each other.
"""

import base64
import io
import uuid

from PIL import Image, ImageDraw, ImageEnhance, ImageFont

_STORE = {}  # id -> {"original": Image, "current": Image}
_ACTIVE_ID = None  # last image opened/edited - lets chat tools say "this image" with no id
_TOUCHED = []  # image ids touched since the last pop_touched() call

MAX_DIMENSION = 4000  # sanity cap so a huge upload can't blow up memory


def get_active_id():
    return _ACTIVE_ID


def list_images() -> list:
    return [
        {**_state(image_id), "active": image_id == _ACTIVE_ID}
        for image_id in _STORE
    ]


def mark_touched(image_id: str):
    global _ACTIVE_ID
    _ACTIVE_ID = image_id
    if image_id not in _TOUCHED:
        _TOUCHED.append(image_id)


def pop_touched() -> list:
    """Returns and clears the list of image ids touched since the last call."""
    global _TOUCHED
    touched, _TOUCHED = _TOUCHED, []
    return touched


def _to_data_url(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.convert("RGB" if img.mode == "CMYK" else img.mode).save(
        buf, format="PNG" if img.mode in ("RGBA", "LA", "P") else "JPEG",
        quality=90,
    )
    encoded = base64.b64encode(buf.getvalue()).decode("ascii")
    mime = "image/png" if img.mode in ("RGBA", "LA", "P") else "image/jpeg"
    return f"data:{mime};base64,{encoded}"


def load_image(file_bytes: bytes) -> dict:
    img = Image.open(io.BytesIO(file_bytes))
    img.load()

    if img.width > MAX_DIMENSION or img.height > MAX_DIMENSION:
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION))

    image_id = uuid.uuid4().hex[:12]
    _STORE[image_id] = {"original": img.copy(), "current": img.copy()}
    mark_touched(image_id)
    return _state(image_id)


def _state(image_id: str) -> dict:
    entry = _STORE[image_id]
    img = entry["current"]
    return {
        "id": image_id,
        "width": img.width,
        "height": img.height,
        "preview": _to_data_url(img),
    }


def get_state(image_id: str) -> dict:
    if image_id not in _STORE:
        raise KeyError("Unknown image id")
    return _state(image_id)


def reset(image_id: str) -> dict:
    entry = _STORE[image_id]
    entry["current"] = entry["original"].copy()
    mark_touched(image_id)
    return _state(image_id)


def apply_op(image_id: str, op: str, params: dict) -> dict:
    if image_id not in _STORE:
        raise KeyError("Unknown image id")

    entry = _STORE[image_id]
    img = entry["current"]

    if op == "resize":
        width = int(params.get("width") or img.width)
        height = int(params.get("height") or img.height)
        width = max(1, min(width, MAX_DIMENSION))
        height = max(1, min(height, MAX_DIMENSION))
        img = img.resize((width, height), Image.LANCZOS)

    elif op == "rotate":
        degrees = float(params.get("degrees", 90))
        img = img.rotate(-degrees, expand=True, fillcolor=(255, 255, 255) if img.mode != "RGBA" else (255, 255, 255, 0))

    elif op == "flip":
        axis = params.get("axis", "horizontal")
        img = img.transpose(Image.FLIP_LEFT_RIGHT if axis == "horizontal" else Image.FLIP_TOP_BOTTOM)

    elif op == "grayscale":
        img = img.convert("L").convert(img.mode if img.mode in ("RGB", "RGBA") else "RGB")

    elif op == "brightness":
        factor = float(params.get("factor", 1.0))
        img = ImageEnhance.Brightness(img).enhance(factor)

    elif op == "contrast":
        factor = float(params.get("factor", 1.0))
        img = ImageEnhance.Contrast(img).enhance(factor)

    elif op == "saturation":
        factor = float(params.get("factor", 1.0))
        img = ImageEnhance.Color(img).enhance(factor)

    elif op == "blur":
        from PIL import ImageFilter
        radius = float(params.get("radius", 2))
        img = img.filter(ImageFilter.GaussianBlur(radius))

    elif op == "sharpen":
        from PIL import ImageFilter
        img = img.filter(ImageFilter.SHARPEN)

    elif op == "crop":
        x = max(0, int(params.get("x", 0)))
        y = max(0, int(params.get("y", 0)))
        w = int(params.get("width", img.width))
        h = int(params.get("height", img.height))
        x2 = min(img.width, x + max(1, w))
        y2 = min(img.height, y + max(1, h))
        img = img.crop((x, y, x2, y2))

    elif op == "watermark":
        img = img.convert("RGBA")
        text = str(params.get("text", ""))[:200]
        position = params.get("position", "bottom-right")
        opacity = int(float(params.get("opacity", 0.6)) * 255)
        font_size = max(12, int(img.width / 20))

        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)
        try:
            font = ImageFont.truetype("DejaVuSans-Bold.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

        bbox = draw.textbbox((0, 0), text, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        pad = 16
        positions = {
            "bottom-right": (img.width - tw - pad, img.height - th - pad),
            "bottom-left": (pad, img.height - th - pad),
            "top-right": (img.width - tw - pad, pad),
            "top-left": (pad, pad),
            "center": ((img.width - tw) // 2, (img.height - th) // 2),
        }
        pos = positions.get(position, positions["bottom-right"])
        draw.text(pos, text, font=font, fill=(255, 255, 255, opacity))
        img = Image.alpha_composite(img, overlay)

    else:
        raise ValueError(f"Unknown image operation: {op}")

    entry["current"] = img
    mark_touched(image_id)
    return _state(image_id)


def export_bytes(image_id: str, fmt: str = "PNG") -> bytes:
    entry = _STORE[image_id]
    img = entry["current"]
    buf = io.BytesIO()
    save_img = img.convert("RGB") if fmt.upper() in ("JPEG", "JPG") else img
    save_img.save(buf, format=fmt.upper())
    return buf.getvalue()
