"""Produce small, disposable media challenges with known observable properties."""

from array import array
from base64 import b64encode
from io import BytesIO
import math
import secrets
import subprocess
import wave

from PIL import Image

from app.core.contracts.model_capabilities import VerifiedModelCapability

_COLORS = {"RED": (255, 0, 0), "GREEN": (0, 255, 0), "BLUE": (0, 0, 255)}
_SIZE = 128
_RATE = 16_000


def _encode(content: bytes) -> str:
    return b64encode(content).decode("ascii")


def _image(color: str) -> bytes:
    output = BytesIO()
    Image.new("RGB", (_SIZE, _SIZE), _COLORS[color]).save(output, format="PNG")
    return output.getvalue()


def _video(colors: list[str]) -> bytes:
    frames = b"".join(bytes(_COLORS[color]) * (_SIZE * _SIZE * 8) for color in colors)
    output = subprocess.run(
        [
            "ffmpeg", "-v", "error", "-nostdin", "-f", "rawvideo", "-pixel_format", "rgb24",
            "-video_size", f"{_SIZE}x{_SIZE}", "-framerate", "4", "-i", "pipe:0",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-threads", "1",
            "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1",
        ],
        input=frames, capture_output=True, check=True, timeout=5,
    )
    return output.stdout


def _audio(beeps: int) -> bytes:
    length = _RATE // 2
    tone = array("h", (int(12_000 * math.sin(2 * math.pi * 600 * i / _RATE)) for i in range(length)))
    silence = bytes(length * 2)
    output = BytesIO()
    with wave.Wave_write(output) as stream:
        stream.setnchannels(1)
        stream.setsampwidth(2)
        stream.setframerate(_RATE)
        stream.writeframes(silence + (tone.tobytes() + silence) * beeps)
    return output.getvalue()


def make_media_probe(
    capability: VerifiedModelCapability, provider_key: str,
) -> tuple[list[dict], str]:
    """Build the prompt and payload without disclosing the expected answer as text."""
    if capability == "image_inputs":
        answer = secrets.choice(tuple(_COLORS))
        prompt = "Name the main color in the picture. Reply with only its English name."
        block = {"type": "image_url", "image_url": {"url": "data:image/png;base64," + _encode(_image(answer))}}
    elif capability == "video_inputs":
        colors = secrets.SystemRandom().sample(list(_COLORS), k=len(_COLORS))
        answer = " ".join(colors)
        prompt = "List the background colors throughout the video in order. Reply only with the names in English."
        block = {"type": "video_url", "video_url": {"url": "data:video/mp4;base64," + _encode(_video(colors))}}
    elif capability == "audio_inputs":
        beeps = secrets.randbelow(4) + 2
        answer = str(beeps)
        prompt = "Listen to the audio and count the separate beeps. Reply only with the number."
        encoded = _encode(_audio(beeps))
        if provider_key == "aliyun_bailian":
            encoded = "data:audio/wav;base64," + encoded
        block = {"type": "input_audio", "input_audio": {"data": encoded, "format": "wav"}}
    else:
        raise ValueError("Media capability required")
    return [{"type": "text", "text": prompt}, block], answer
