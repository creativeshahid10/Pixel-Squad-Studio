"""Security and API audit test suite for PixelSquad Studio."""

import os
import re
import tempfile
import unittest
from pathlib import Path

from PixelSquad_Studio.server import (
    ALLOWED_AUDIO_EXTENSIONS,
    is_safe_audio_path,
    OUTPUTS_DIR,
    CUSTOM_VOICES_DIR,
    save_custom_voices,
    load_custom_voices,
    CUSTOM_VOICES_FILE,
)
from PixelSquad_Studio.voice_cloner import _apply_basic_fx


class TestSecurityAudit(unittest.TestCase):
    """Test suite validating trust boundaries, path traversal defense, and input sanitization."""

    def test_safe_audio_path_permits_authorized_roots(self) -> None:
        """Legitimate audio files in outputs, custom voices, or temp directory must be permitted."""
        valid_paths = [
            os.path.join(OUTPUTS_DIR, "test.mp3"),
            os.path.join(OUTPUTS_DIR, "batch_123", "track.wav"),
            os.path.join(CUSTOM_VOICES_DIR, "voice_sample.flac"),
            os.path.join(tempfile.gettempdir(), "test_preview.ogg"),
        ]
        for p in valid_paths:
            self.assertTrue(
                is_safe_audio_path(p),
                f"Expected authorized path {p} to pass boundary check"
            )

    def test_safe_audio_path_rejects_path_traversal_and_sensitive_files(self) -> None:
        """Path traversal or access to arbitrary host files must be strictly rejected."""
        malicious_paths = [
            "C:\\Windows\\win.ini",
            "C:\\Windows\\System32\\drivers\\etc\\hosts",
            os.path.join(OUTPUTS_DIR, "..", "..", ".env"),
            os.path.join(OUTPUTS_DIR, "..", "server.py"),
            "/etc/passwd",
            "/var/log/syslog",
            "../secret.key",
        ]
        for p in malicious_paths:
            self.assertFalse(
                is_safe_audio_path(p),
                f"Expected unauthorized path {p} to be blocked"
            )

    def test_safe_audio_path_rejects_unauthorized_extensions(self) -> None:
        """Non-audio extensions must be rejected even if residing inside output directory."""
        dangerous_extensions = [
            os.path.join(OUTPUTS_DIR, "malicious.exe"),
            os.path.join(OUTPUTS_DIR, "payload.bat"),
            os.path.join(OUTPUTS_DIR, "script.py"),
            os.path.join(OUTPUTS_DIR, "exploit.sh"),
            os.path.join(OUTPUTS_DIR, "data.json"),
        ]
        for p in dangerous_extensions:
            self.assertFalse(
                is_safe_audio_path(p),
                f"Expected dangerous extension for {p} to be blocked"
            )

    def test_identifier_sanitization_blocks_wildcards_and_traversal(self) -> None:
        """Track and voice identifiers must strictly permit only alphanumeric and hyphens/underscores."""
        id_pattern = r"^[a-zA-Z0-9_\-]+$"
        valid_ids = [
            "d13013b3-623e-46c8-8b8c-72cd061c5bc0",
            "voice_1794584234_1",
            "track_42",
        ]
        for vid in valid_ids:
            self.assertIsNotNone(re.match(id_pattern, vid))

        malicious_ids = [
            "*",
            "*.json",
            "../../etc/passwd",
            "track; rm -rf /",
            "test*123",
            "id with spaces",
            "track/sub",
        ]
        for mid in malicious_ids:
            self.assertIsNone(
                re.match(id_pattern, mid),
                f"Expected malicious ID '{mid}' to fail regex validation"
            )

    def test_atomic_voice_storage_and_integrity(self) -> None:
        """Saving custom voices must produce valid JSON without corruption."""
        import json
        with tempfile.TemporaryDirectory() as td:
            temp_voices_file = os.path.join(td, "voices.json")
            from unittest.mock import patch
            with patch("PixelSquad_Studio.server.CUSTOM_VOICES_FILE", temp_voices_file):
                test_voices = [
                    {"id": "test_voice_1", "name": "Audit Test Voice 1", "gender": "female"},
                    {"id": "test_voice_2", "name": "Audit Test Voice 2", "gender": "male"},
                ]
                save_custom_voices(test_voices)
                loaded = load_custom_voices()
                self.assertEqual(len(loaded), 2)
                self.assertEqual(loaded[0]["id"], "test_voice_1")
                self.assertEqual(loaded[1]["id"], "test_voice_2")

    def test_sanitize_audio_filename_premiere_compatibility(self) -> None:
        """Sanitized filenames must strip URI fragments (#), percent signs, and emojis."""
        from PixelSquad_Studio.server import sanitize_audio_filename
        
        self.assertEqual(
            sanitize_audio_filename("# तेरे संग मेरी दुनिया ❤️", "mp3"),
            "तेरे_संग_मेरी_दुनिया.mp3"
        )
        self.assertEqual(
            sanitize_audio_filename("Fast CUDA VAE Test 🔥 Option 2", "wav"),
            "Fast_CUDA_VAE_Test_Option_2.wav"
        )
        self.assertEqual(
            sanitize_audio_filename("# Track%20Name 123 *?<>|", "mp3"),
            "Track20Name_123.mp3"
        )
        self.assertEqual(
            sanitize_audio_filename("", "mp3"),
            "PixelSquad_Audio.mp3"
        )


if __name__ == "__main__":
    unittest.main()
