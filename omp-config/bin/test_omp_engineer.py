"""Native flag boundaries must not let prompt data bypass desktop isolation."""

import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("omp_engineer", Path(__file__).with_name("omp-engineer.py"))
core = importlib.util.module_from_spec(spec)
spec.loader.exec_module(core)


class NativeDispatchTests(unittest.TestCase):
    def test_administration_is_distinct_from_model_and_tool_execution(self):
        for args in (["models"], ["skills"], ["wt"], ["--model", "opus", "models"],
                     ["update", "--check"], ["--version"]):
            with self.subTest(args=args):
                self.assertFalse(core.display_invocation(args))
        for args in (["join"], ["img"], ["q"], ["launch"], ["-p"], ["--mode=rpc"],
                     ["cleanse"], ["bench"], ["collab"]):
            with self.subTest(args=args):
                self.assertTrue(core.display_invocation(args))

    def test_flag_values_and_prompt_data_cannot_bypass_desktop_isolation(self):
        for args in (["--model", "models"], ["--resume", "update"],
                     ["--metadata", "models"], ["--", "models"],
                     ["launch", "models"], ["a prompt", "models"],
                     ["--system-prompt", "--help"], ["--system-prompt=--version"],
                     ["--model", "--help"], ["--", "--help"]):
            with self.subTest(args=args):
                self.assertTrue(core.display_invocation(args))


if __name__ == "__main__":
    unittest.main()
