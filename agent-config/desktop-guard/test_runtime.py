#!/usr/bin/env python3
"""US-043: refuse an oomd ancestor without mutating the host's oomd policy."""

import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("desktop_guard", Path(__file__).with_name("desktop-guard.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class MonitorBoundaryTest(unittest.TestCase):
    def test_us043_pressure_or_swap_ancestor_refuses_but_sibling_does_not(self):
        root = "/user.slice/user-1000.slice/user@1000.service"
        fleet = root + "/dev.slice/dev-fleet.slice"
        for section in ("Swap", "Memory Pressure"):
            for monitor, refused in (
                (root + "/app.slice", False),
                (root + "/dev.slice/dev-fleet-extra.slice", False),
                (fleet, True),
                (root + "/dev.slice", True),
                (root, True),
                ("/", True),
            ):
                with self.subTest(section=section, monitor=monitor):
                    inventory = "Swap Monitored CGroups:\nMemory Pressure Monitored CGroups:\n"
                    inventory = inventory.replace(section + " Monitored CGroups:\n", section + " Monitored CGroups:\n\tPath: " + monitor + "\n")
                    with patch.object(guard, "command", return_value=inventory):
                        if refused:
                            with self.assertRaises(guard.GuardError):
                                guard.assert_oomd_safe(fleet)
                        else:
                            guard.assert_oomd_safe(fleet)

    def test_unknown_inventory_is_not_treated_as_no_monitors(self):
        with patch.object(guard, "command", return_value="oomd inventory unavailable\n"):
            with self.assertRaises(guard.GuardError):
                guard.assert_oomd_safe("/user.slice/user-1000.slice/user@1000.service/dev.slice/dev-fleet.slice")


if __name__ == "__main__":
    unittest.main()
