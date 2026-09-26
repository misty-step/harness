#!/usr/bin/env python3
"""US-043: the same transcript must not silently resume in a different checkout."""
import copy
import unittest

from cutover_inventory import verify_inventory


class RecoveryDirectoryTest(unittest.TestCase):
    def test_same_transcript_in_wrong_working_directory_is_rejected(self):
        engineer = {
            "kind": "omp", "name": "engineer", "workspace_id": "w1", "tab_id": "w1:t1", "pane_id": "w1:p1",
            "cwd": "/projects/expected", "foreground_cwd": "/projects/expected", "agent_status": "idle",
            "agent_session": {"agent": "omp", "kind": "path", "source": "herdr:omp", "value": "/sessions/engineer.jsonl"},
            "transcript": {"kind": "path", "value": "/sessions/engineer.jsonl"},
            "resume_argv": ["omp", "--resume=/sessions/engineer.jsonl"],
            "process": {"shell_pid": 101, "foreground_process_group_id": 102,
                        "foreground_processes": [{"pid": 102, "name": "omp", "cwd": "/projects/expected"}]},
        }
        before = {
            "schema": 1, "blockers": [],
            "engineers": [engineer],
            "panes": [{"workspace_id": "w1", "classification": "engineer"}],
            "workspaces": [{"workspace_id": "w1", "label": "Project", "pane_count": 1, "tab_count": 1}],
            "layouts": [{"workspace_id": "w1", "tab_id": "w1:t1", "pane_count": 1, "split_directions": []}],
        }
        self.assertEqual(verify_inventory(before, copy.deepcopy(before)), [])
        for field in ("cwd", "foreground_cwd"):
            with self.subTest(field=field):
                after = copy.deepcopy(before)
                after["engineers"][0][field] = "/projects/wrong-checkout"
                if field == "foreground_cwd":
                    after["engineers"][0]["process"]["foreground_processes"][0]["cwd"] = "/projects/wrong-checkout"
                self.assertTrue(verify_inventory(before, after), "Wrong-checkout restoration must not pass")


if __name__ == "__main__":
    unittest.main()
