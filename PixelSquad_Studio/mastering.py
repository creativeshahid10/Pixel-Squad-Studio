"""Audio mastering engine for PixelSquad Studio.

Applies professional multi-band EQ, mid-side stereo widening, glue compression,
and true-peak loudness normalization to match commercial streaming standards.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from loguru import logger

# Preset FFmpeg audio filter chains for commercial-grade studio mastering
MASTERING_PRESETS: dict[str, dict[str, str]] = {
    "suno_studio": {
        "name": "Suno Studio Master",
        "description": "Balanced, wide stereo field, de-mudded low-mids, silky air, -11 LUFS",
        "filters": (
            "highpass=f=28,"
            "equalizer=f=320:t=q:w=1.2:g=-1.8,"
            "equalizer=f=3500:t=q:w=1.5:g=1.5,"
            "equalizer=f=12000:t=q:w=0.8:g=2.2,"
            "stereotools=mlev=1.0:slev=1.2,"
            "acompressor=threshold=-12dB:ratio=2.2:attack=15:release=120:makeup=1.5dB,"
            "loudnorm=I=-11:TP=-0.5:LRA=10"
        ),
    },
    "bass_club": {
        "name": "Bass Boost & Club Master",
        "description": "Deep 808 sub-bass, punchy transients, club-ready loudness, -10 LUFS",
        "filters": (
            "highpass=f=25,"
            "equalizer=f=55:t=q:w=1.0:g=2.5,"
            "equalizer=f=300:t=q:w=1.3:g=-2.2,"
            "equalizer=f=4500:t=q:w=1.2:g=1.8,"
            "equalizer=f=11000:t=q:w=0.8:g=1.5,"
            "stereotools=mlev=1.0:slev=1.15,"
            "acompressor=threshold=-14dB:ratio=2.8:attack=10:release=100:makeup=2.0dB,"
            "loudnorm=I=-10:TP=-0.3:LRA=8"
        ),
    },
    "vocal_air": {
        "name": "Vocal Clarity & Air",
        "description": "Silky presence, transparent dynamics, broadcast dialogue/vocal presence",
        "filters": (
            "highpass=f=60,"
            "equalizer=f=250:t=q:w=1.0:g=-2.0,"
            "equalizer=f=3000:t=q:w=1.5:g=2.2,"
            "equalizer=f=10000:t=q:w=0.7:g=2.5,"
            "stereotools=mlev=1.0:slev=1.05,"
            "acompressor=threshold=-15dB:ratio=2.0:attack=20:release=150:makeup=2.0dB,"
            "loudnorm=I=-12:TP=-0.5:LRA=9"
        ),
    },
}


def get_mastering_preset_keys() -> list[str]:
    """Return list of available mastering preset keys."""
    return list(MASTERING_PRESETS.keys())


def build_mastering_filtergraph(preset: str = "suno_studio") -> str:
    """Build the audio filter graph string for the selected mastering preset.

    Args:
        preset: Preset identifier ('suno_studio', 'bass_club', 'vocal_air').

    Returns:
        FFmpeg filtergraph string.
    """
    preset_data = MASTERING_PRESETS.get(preset) or MASTERING_PRESETS["suno_studio"]
    return preset_data["filters"]


def master_audio_file(
    input_path: str,
    output_path: str,
    preset: str = "suno_studio",
    bitrate: str = "320k",
    sample_rate: int = 48000,
) -> str:
    """Master raw audio using FFmpeg filtergraph to commercial loudness and fidelity.

    Args:
        input_path: Path to source audio (WAV, FLAC, or MP3).
        output_path: Destination path for mastered audio file.
        preset: Mastering profile name.
        bitrate: Output MP3 bitrate (e.g. '320k').
        sample_rate: Output sample rate in Hz (default 48000).

    Returns:
        str: Absolute path to the mastered output file.
    """
    if not os.path.exists(input_path) or os.path.getsize(input_path) < 100:
        logger.warning(f"[Mastering] Input file missing or empty: {input_path}")
        return input_path

    filtergraph = build_mastering_filtergraph(preset)
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    is_wav = str(output_path).lower().endswith(".wav")
    suffix = ".wav" if is_wav else ".mp3"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_file:
        tmp_output = tmp_file.name

    try:
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(input_path),
            "-af", filtergraph,
        ]
        if is_wav:
            cmd.extend([
                "-codec:a", "pcm_s24le",
                "-ar", str(sample_rate),
                "-ac", "2",
            ])
        else:
            cmd.extend([
                "-codec:a", "libmp3lame",
                "-b:a", str(bitrate),
                "-ar", str(sample_rate),
                "-ac", "2",
                "-id3v2_version", "3",
                "-write_xing", "0",
            ])
        cmd.append(str(tmp_output))
        res = subprocess.run(cmd, capture_output=True, timeout=120)
        if res.returncode == 0 and os.path.exists(tmp_output) and os.path.getsize(tmp_output) > 500:
            shutil.move(tmp_output, output_path)
            logger.info(f"[Mastering] Successfully mastered audio via '{preset}' -> {output_path}")
            return output_path

        err_msg = res.stderr.decode("utf-8", errors="ignore") if res.stderr else "Unknown error"
        logger.warning(f"[Mastering] FFmpeg returned code {res.returncode}: {err_msg}, falling back to copy")
        shutil.copyfile(input_path, output_path)
        return output_path

    except Exception as exc:
        logger.warning(f"[Mastering] Failed with exception: {exc}, preserving source audio")
        shutil.copyfile(input_path, output_path)
        return output_path
    finally:
        if os.path.exists(tmp_output):
            try:
                os.remove(tmp_output)
            except Exception:
                pass
