"""Read Dungeondraft packs (Godot PCK archives): index them and optionally unpack.

Usage: python -I ddpack.py <packs_dir> <out_dir>
Writes <out_dir>/index.json (every entry of every pack) and unpacks files to
<out_dir>/unpacked/<pack file stem>/<path inside pack>.
"""
import json
import struct
import sys
from pathlib import Path, PurePosixPath

MAGIC = 0x43504447  # "GDPC"


def read_index(f):
    magic, fmt = struct.unpack("<II", f.read(8))
    if magic != MAGIC:
        raise ValueError("not a Godot PCK file")
    major, minor, patch = struct.unpack("<III", f.read(12))
    file_base = 0
    if fmt >= 2:  # Godot 4 layout: flags + file base offset
        _flags, file_base = struct.unpack("<IQ", f.read(12))
    f.read(16 * 4)  # reserved
    (count,) = struct.unpack("<I", f.read(4))
    entries = []
    for _ in range(count):
        (plen,) = struct.unpack("<I", f.read(4))
        path = f.read(plen).rstrip(b"\x00").decode("utf-8")
        offset, size = struct.unpack("<QQ", f.read(16))
        f.read(16)  # md5
        if fmt >= 2:
            f.read(4)  # per-file flags
        entries.append({"path": path, "offset": offset + file_base, "size": size})
    return {"format": fmt, "godot": f"{major}.{minor}.{patch}", "entries": entries}


def safe_rel(path):
    p = path.removeprefix("res://")
    parts = PurePosixPath(p).parts
    if any(x in ("..", "") for x in parts) or PurePosixPath(p).is_absolute():
        raise ValueError(f"unsafe path in pack: {path!r}")
    return Path(*parts)


def main():
    packs_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)
    index = {}
    for pack in sorted(packs_dir.glob("*.dungeondraft_pack")):
        with pack.open("rb") as f:
            info = read_index(f)
            target = out_dir / "unpacked" / pack.stem
            for e in info["entries"]:
                dest = target / safe_rel(e["path"])
                dest.parent.mkdir(parents=True, exist_ok=True)
                f.seek(e["offset"])
                dest.write_bytes(f.read(e["size"]))
        index[pack.stem] = info
        print(f"{pack.stem}: format {info['format']}, godot {info['godot']}, {len(info['entries'])} files")
    (out_dir / "index.json").write_text(json.dumps(index, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
