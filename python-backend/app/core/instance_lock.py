"""
One backend at a time.

Two backends on the same PC both run the outbound dialer (the same
applicant gets called twice), both try to register the same SIP account
and port, and both write data/outbound_calls.json. On Windows a second
uvicorn can even bind port 8000 alongside the first, so nothing warns you.

The backend holds an exclusive lock on data/backend.lock while it runs; a
second one refuses to start. The operating system releases the lock when
the process exits or crashes, so a stale lock file never blocks a restart.
"""

import os
from pathlib import Path

LOCK_FILE = Path(__file__).resolve().parents[2] / "data" / "backend.lock"

_LOCK_OFFSET = 4096
_handle = None


class AlreadyRunning(RuntimeError):
    pass


def acquire() -> None:
    """Take the lock, or raise AlreadyRunning naming the other process."""
    global _handle
    LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    f = open(LOCK_FILE, "a+")
    try:
        if os.name == "nt":
            import msvcrt
            # Lock a byte past the PID text, so the other process can still read the PID.
            f.seek(_LOCK_OFFSET)
            msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        f.close()
        try:
            other = LOCK_FILE.read_text().strip() or "unknown"
        except OSError:
            other = "unknown"
        raise AlreadyRunning(
            f"Another AI Receptionist backend is already running (process {other}). "
            "Close its window first: two backends would dial the same applicants twice "
            "and fight over the SIP account.")
    f.seek(0)
    f.truncate()
    f.write(str(os.getpid()))
    f.flush()
    _handle = f


def release() -> None:
    global _handle
    if _handle is not None:
        try:
            _handle.close()
        except OSError:
            pass
        _handle = None
