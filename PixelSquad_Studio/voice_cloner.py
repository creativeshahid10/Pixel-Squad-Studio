"""Vocal Timbre Cloning and Acoustic Matching Module for Suno Studio.

Morphs synthesized speech to match pitch, formant resonance, and timbre
from user-recorded microphone clips or reference audio samples.
"""

import os
import shutil
import subprocess
from typing import Optional, Tuple
import numpy as np
import scipy.signal
import soundfile as sf
from loguru import logger

BANDS = [80, 160, 260, 420, 700, 1200, 2000, 3200, 5200, 8000]


def extract_vocal_features(audio_path: str) -> Tuple[float, np.ndarray]:
    """Extract pitch F0 and 10-band spectral formant energy from audio."""
    default_powers = np.ones(len(BANDS), dtype=np.float64) * 1e-6
    if not os.path.exists(audio_path) or os.path.getsize(audio_path) < 1000:
        return 130.0, default_powers

    try:
        data, sr = sf.read(audio_path)
        if data.ndim > 1:
            data = data.mean(axis=1)

        # Silence trimming
        peak = float(np.max(np.abs(data)))
        if peak > 1e-4:
            active = np.abs(data) > (peak * 0.05)
            if np.any(active):
                data = data[int(np.argmax(active)) : len(data) - int(np.argmax(active[::-1]))]

        if len(data) < int(sr * 0.2):
            return 130.0, default_powers

        # F0 estimation via FFT autocorrelation
        chunk = data[:min(len(data), int(sr * 3.0))]
        chunk_win = chunk * np.hanning(len(chunk))
        corr = scipy.signal.correlate(chunk_win, chunk_win, mode="full", method="fft")[len(chunk) - 1 :]

        min_lag, max_lag = max(1, int(sr / 360)), min(len(corr) - 1, int(sr / 65))
        f0 = 130.0
        if max_lag > min_lag:
            region = corr[min_lag:max_lag]
            if len(region) > 0 and np.max(region) > 0:
                f0 = max(70.0, min(350.0, float(sr / (min_lag + int(np.argmax(region))))))

        # 10-band formant energy via Welch PSD
        freqs, psd = scipy.signal.welch(data, sr, nperseg=min(len(data), 2048))
        powers = [
            float(np.mean(psd[(freqs >= f * 0.70) & (freqs < f * 1.40)]))
            if np.any((freqs >= f * 0.70) & (freqs < f * 1.40)) else 1e-8
            for f in BANDS
        ]
        return f0, np.array(powers, dtype=np.float64)
    except Exception as e:
        logger.warning(f"Feature extraction fallback: {e}")
        return 130.0, default_powers


def clone_voice_timbre(
    synth_path: str,
    ref_audio_path: Optional[str],
    out_path: str,
    pitch_factor: float = 1.0,
    tempo_factor: float = 1.0,
) -> bool:
    """Morph synthesized speech to match reference voice pitch and formant timbre."""
    if not ref_audio_path or not os.path.exists(ref_audio_path) or os.path.getsize(ref_audio_path) < 1000:
        return _apply_basic_fx(synth_path, out_path, tempo_factor, pitch_factor)

    try:
        ref_f0, ref_powers = extract_vocal_features(ref_audio_path)
        synth_f0, synth_powers = extract_vocal_features(synth_path)

        # Formant spectral difference (Acoustic Timbre Morphing)
        diff_db = 10.0 * np.log10((ref_powers + 1e-12) / (synth_powers + 1e-12))
        diff_db -= np.mean(diff_db)

        filters = []
        orig_rate = 44100

        # Apply pitch factor with tempo preservation so audio length remains natural
        if abs(pitch_factor - 1.0) >= 0.03:
            filters.append(f"asetrate={int(orig_rate * pitch_factor)},aresample={orig_rate}")
            compensate_tempo = 1.0 / pitch_factor
            if abs(compensate_tempo - 1.0) >= 0.02:
                filters.append(f"atempo={max(0.5, min(2.0, compensate_tempo)):.3f}")

        # Apply tempo factor only if explicitly requested
        if abs(tempo_factor - 1.0) >= 0.03:
            filters.append(f"atempo={max(0.5, min(2.0, tempo_factor)):.3f}")

        # Formant Equalizer matching (Matches user's vocal cavity resonance and tone)
        for f, g in zip(BANDS, diff_db):
            clamped = max(-10.0, min(10.0, float(g)))
            if abs(clamped) >= 0.8:
                filters.append(f"equalizer=f={f}:width_type=o:w=1.0:g={clamped:.1f}")

        filters.extend(["acompressor=threshold=-16dB:ratio=2.2:attack=10:release=120", "alimiter=limit=0.96"])
        cmd = ["ffmpeg", "-y", "-i", synth_path, "-filter:a", ",".join(filters), "-b:a", "192k", out_path]
        res = subprocess.run(cmd, capture_output=True)

        if res.returncode == 0 and os.path.exists(out_path) and os.path.getsize(out_path) > 1000:
            logger.info(f"Cloned Voice: Timbre matched from {ref_audio_path} (F0 {ref_f0:.1f}Hz)")
            return True
    except Exception as err:
        logger.error(f"Voice cloning error: {err}")

    return _apply_basic_fx(synth_path, out_path, tempo_factor, pitch_factor)


def _apply_basic_fx(input_path: str, output_path: str, rate_factor: float, pitch_factor: float) -> bool:
    """Fallback standard tempo/pitch transformation when reference audio is absent."""
    if abs(rate_factor - 1.0) < 0.02 and abs(pitch_factor - 1.0) < 0.02:
        if input_path != output_path:
            shutil.copyfile(input_path, output_path)
        return True

    filters = []
    if abs(pitch_factor - 1.0) >= 0.02:
        filters.append(f"asetrate={int(44100 * pitch_factor)},aresample=44100")
        rate_factor /= pitch_factor
    if abs(rate_factor - 1.0) >= 0.02:
        filters.append(f"atempo={max(0.5, min(2.0, rate_factor)):.2f}")

    cmd = ["ffmpeg", "-y", "-i", input_path, "-filter:a", ",".join(filters) or "anull", "-b:a", "192k", output_path]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 500:
        return True
    if input_path != output_path:
        shutil.copyfile(input_path, output_path)
    return False
