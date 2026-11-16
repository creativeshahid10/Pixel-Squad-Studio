"""Unit tests for PixelSquad Studio audio mastering engine."""

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from PixelSquad_Studio.mastering import (
    MASTERING_PRESETS,
    build_mastering_filtergraph,
    get_mastering_preset_keys,
    master_audio_file,
)


class TestMasteringEngine(unittest.TestCase):
    """Test suite verifying audio mastering preset resolution and FFmpeg execution."""

    def test_presets_exist_and_contain_required_filters(self) -> None:
        """Verify all presets define valid filter chains containing EQ and loudnorm."""
        keys = get_mastering_preset_keys()
        self.assertIn("suno_studio", keys)
        self.assertIn("bass_club", keys)
        self.assertIn("vocal_air", keys)

        for key in keys:
            filtergraph = build_mastering_filtergraph(key)
            self.assertIn("loudnorm", filtergraph)
            self.assertIn("equalizer", filtergraph)
            self.assertIn("stereotools", filtergraph)

    def test_fallback_on_missing_input(self) -> None:
        """Gracefully handle missing input without raising unhandled exceptions."""
        result = master_audio_file(
            input_path="non_existent_file_12345.wav",
            output_path="out.mp3",
        )
        self.assertEqual("non_existent_file_12345.wav", result)

    def test_master_audio_file_end_to_end(self) -> None:
        """Generate a synthetic sine tone and master it into a valid 320k MP3 file."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            src_wav = os.path.join(tmp_dir, "synth_tone.wav")
            out_mp3 = os.path.join(tmp_dir, "mastered.mp3")

            # Generate 1 second test WAV using ffmpeg lavfi
            gen_cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
                "-ar", "48000", "-ac", "2",
                src_wav,
            ]
            subprocess.run(gen_cmd, check=True)
            self.assertTrue(os.path.exists(src_wav))

            # Master file
            master_audio_file(src_wav, out_mp3, preset="suno_studio", bitrate="320k")
            self.assertTrue(os.path.exists(out_mp3))
            self.assertGreater(os.path.getsize(out_mp3), 1000)


if __name__ == "__main__":
    unittest.main()
