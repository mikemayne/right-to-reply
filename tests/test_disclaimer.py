import json
import tempfile
import unittest
from pathlib import Path
from tools.package import disclaimer_script


class DisclaimerTests(unittest.TestCase):
    def test_optional_and_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "disclaimer.json"
            self.assertIn("Object.freeze({})", disclaimer_script(path))
            for data in ({}, {"message": "Owner notice"}, {"link": "https://example.org"},
                         {"message": "<b>plain text</b>", "link": "https://example.org", "linkText": "Details"}):
                path.write_text(json.dumps(data))
                self.assertIn(json.dumps(data), disclaimer_script(path))

    def test_invalid(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "disclaimer.json"
            for data in ([], {"html": "<script>"}, {"message": 5}, {"linkText": "Details"},
                         {"link": "javascript:alert(1)"}, {"link": "https://user:pass@example.org"},
                         {"link": "https://example.org:invalid"}, {"link": "//example.org"}):
                path.write_text(json.dumps(data))
                with self.assertRaises(ValueError):
                    disclaimer_script(path)
