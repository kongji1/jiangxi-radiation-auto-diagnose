import pathlib
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

import tools.captcha_ocr_server as server
from tools.captcha_ocr_server import captcha_answer


class CaptchaAnswerTests(unittest.TestCase):
    def test_arithmetic(self):
        self.assertEqual(captcha_answer("99-40="), "59")
        self.assertEqual(captcha_answer("12 + 8"), "20")
        self.assertEqual(captcha_answer("9×8="), "72")

    def test_portal_four_digits(self):
        self.assertEqual(captcha_answer("a1b2c3d4"), "1234")

    def test_invalid_expression(self):
        self.assertEqual(captcha_answer("99/0="), "")
        self.assertEqual(captcha_answer("123"), "")

    def test_recognize_accepts_arithmetic_result_length(self):
        class FakeOCR:
            def classification(self, _image):
                return "99-40="

        old = server._ocr_standard
        try:
            server._ocr_standard = FakeOCR()
            self.assertEqual(server.recognize(b"fake-image"), "59")
        finally:
            server._ocr_standard = old


if __name__ == "__main__":
    unittest.main()
