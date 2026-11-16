"""Unit tests for suno_studio.voice_cloner."""

import os
import unittest
import numpy as np
import soundfile as sf
import tempfile
from PixelSquad_Studio.voice_cloner import extract_vocal_features, clone_voice_timbre, BANDS


class TestVoiceCloner(unittest.TestCase):
    """Test vocal feature extraction and timbre cloning."""

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.sr = 44100
        # Create a synthetic 120Hz sine wave as reference audio
        t = np.linspace(0, 1.0, self.sr, endpoint=False)
        audio = 0.5 * np.sin(2 * np.pi * 120.0 * t)
        self.ref_audio_path = os.path.join(self.temp_dir.name, "test_ref.wav")
        sf.write(self.ref_audio_path, audio, self.sr)

        # Create a synthetic 200Hz sine wave as synthesized audio
        audio_synth = 0.5 * np.sin(2 * np.pi * 200.0 * t)
        self.synth_audio_path = os.path.join(self.temp_dir.name, "test_synth.wav")
        sf.write(self.synth_audio_path, audio_synth, self.sr)

        self.out_audio_path = os.path.join(self.temp_dir.name, "test_out.mp3")

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_extract_vocal_features_valid(self):
        """Test extraction returns F0 and power array matching BANDS length."""
        f0, powers = extract_vocal_features(self.ref_audio_path)
        self.assertTrue(70.0 <= f0 <= 350.0)
        self.assertEqual(len(powers), len(BANDS))
        self.assertTrue(np.all(powers >= 0))

    def test_extract_vocal_features_nonexistent(self):
        """Test fallback on non-existent audio path."""
        f0, powers = extract_vocal_features("non_existent_file.wav")
        self.assertEqual(f0, 130.0)
        self.assertEqual(len(powers), len(BANDS))

    def test_clone_voice_timbre_success(self):
        """Test end-to-end timbre cloning output generation."""
        success = clone_voice_timbre(
            synth_path=self.synth_audio_path,
            ref_audio_path=self.ref_audio_path,
            out_path=self.out_audio_path
        )
        self.assertTrue(success)
        self.assertTrue(os.path.exists(self.out_audio_path))
        self.assertGreater(os.path.getsize(self.out_audio_path), 500)


if __name__ == "__main__":
    unittest.main()
