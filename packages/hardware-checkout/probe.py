#!/usr/bin/env python3
"""Dump the connected PaXini Ego device as JSON, via the OrbbecSDK C API.

    python probe.py [--sdk-bin DIR] [--indent N]

--sdk-bin defaults to ./tools/orbbec/bin under the repo root (extract
OrbbecSDK_v2.9.0_..._win_x64.zip there; tools/ is gitignored).

Exit codes: 0 ok, 1 SDK not loadable, 2 SDK call failed, 3 no device found.
"""
import argparse
import ctypes
import json
import os
import sys
from pathlib import Path

# From SDK include/libobsensor/h/ObTypes.h (OBSensorType). The values are NOT
# contiguous with the v1 SDK's; do not "simplify" this table from memory.
SENSOR_TYPES = {
    0: "UNKNOWN", 1: "IR", 2: "COLOR", 3: "DEPTH", 4: "ACCEL", 5: "GYRO",
    6: "IR_LEFT", 7: "IR_RIGHT", 8: "RAW_PHASE", 9: "CONFIDENCE", 10: "LIDAR",
    11: "COLOR_LEFT", 12: "COLOR_RIGHT", 13: "AUDIO",
}

P = ctypes.c_void_p
STR_GETTERS = {
    "name": "ob_device_info_get_name",
    "serial": "ob_device_info_get_serial_number",
    "firmware": "ob_device_info_get_firmware_version",
    "hardware": "ob_device_info_get_hardware_version",
    "connection": "ob_device_info_get_connection_type",
    "uid": "ob_device_info_get_uid",
    "min_sdk": "ob_device_info_get_supported_min_sdk_version",
    "asic": "ob_device_info_get_asicName",
    "subsystem": "ob_device_info_get_subsystem_version",
}


class ObError(Exception):
    pass


class Sdk:
    """ctypes wrapper that checks ob_error after every call."""

    def __init__(self, bin_dir: Path):
        dll = bin_dir / "OrbbecSDK.dll"
        if not dll.exists():
            raise FileNotFoundError(dll)
        os.add_dll_directory(str(bin_dir))
        self.lib = ctypes.CDLL(str(dll))
        L = self.lib
        for fn, res, args in [
            ("ob_error_get_message", ctypes.c_char_p, [P]),
            ("ob_delete_error", None, [P]),
            ("ob_create_context", P, [P]),
            ("ob_delete_context", None, [P, P]),
            ("ob_query_device_list", P, [P, P]),
            ("ob_delete_device_list", None, [P, P]),
            ("ob_device_list_get_count", ctypes.c_uint32, [P, P]),
            ("ob_device_list_get_device", P, [P, ctypes.c_uint32, P]),
            ("ob_delete_device", None, [P, P]),
            ("ob_device_get_device_info", P, [P, P]),
            ("ob_delete_device_info", None, [P, P]),
            ("ob_device_get_sensor_list", P, [P, P]),
            ("ob_delete_sensor_list", None, [P, P]),
            ("ob_sensor_list_get_count", ctypes.c_uint32, [P, P]),
            ("ob_sensor_list_get_sensor_type", ctypes.c_int, [P, ctypes.c_uint32, P]),
        ]:
            f = getattr(L, fn)
            f.restype = res
            f.argtypes = args
        for fn in STR_GETTERS.values():
            f = getattr(L, fn)
            f.restype = ctypes.c_char_p
            f.argtypes = [P, P]

    def call(self, fn, *args):
        err = P()
        out = getattr(self.lib, fn)(*args, ctypes.byref(err))
        if err:
            msg = self.lib.ob_error_get_message(err)
            self.lib.ob_delete_error(err)
            raise ObError(f"{fn}: {msg.decode(errors='replace') if msg else '?'}")
        return out


def probe(bin_dir: Path):
    sdk = Sdk(bin_dir)
    ctx = sdk.call("ob_create_context")
    lst = sdk.call("ob_query_device_list", ctx)
    devices = []
    try:
        for i in range(sdk.call("ob_device_list_get_count", lst)):
            dev = sdk.call("ob_device_list_get_device", lst, i)
            try:
                info = sdk.call("ob_device_get_device_info", dev)
                d = {}
                for key, fn in STR_GETTERS.items():
                    v = sdk.call(fn, info)
                    d[key] = v.decode(errors="replace") if v else None
                sl = sdk.call("ob_device_get_sensor_list", dev)
                try:
                    ids = [
                        sdk.call("ob_sensor_list_get_sensor_type", sl, j)
                        for j in range(sdk.call("ob_sensor_list_get_count", sl))
                    ]
                    # Raw values are kept alongside the names so a stale table
                    # cannot launder itself into the record: an off-by-one map
                    # turns [4,5,11,12,13] into GYRO/IR_LEFT/IR_RIGHT/COLOR_LEFT
                    # and reads perfectly plausible.
                    d["sensor_ids"] = ids
                    d["sensors"] = [SENSOR_TYPES.get(t, str(t)) for t in ids]
                finally:
                    sdk.call("ob_delete_sensor_list", sl)
                sdk.call("ob_delete_device_info", info)
                devices.append(d)
            finally:
                sdk.call("ob_delete_device", dev)
    finally:
        sdk.call("ob_delete_device_list", lst)
        sdk.call("ob_delete_context", ctx)
    return devices


def main(argv=None):
    here = Path(__file__).resolve()
    default_bin = here.parents[2] / "tools" / "orbbec" / "bin"
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sdk-bin", type=Path, default=default_bin)
    ap.add_argument("--indent", type=int, default=2)
    a = ap.parse_args(argv)
    try:
        devices = probe(a.sdk_bin)
    except (OSError, FileNotFoundError) as e:
        print(f"cannot load OrbbecSDK.dll: {e}", file=sys.stderr)
        return 1
    except ObError as e:
        print(f"SDK call failed: {e}", file=sys.stderr)
        return 2
    print(json.dumps({"devices": devices}, indent=a.indent, ensure_ascii=False))
    return 0 if devices else 3


if __name__ == "__main__":
    sys.exit(main())
