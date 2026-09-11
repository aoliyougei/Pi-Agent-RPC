"""Run in a task-owned image test container with Python installed; no provider needed."""
import errno
import fcntl
import hashlib
import json
import os
import pty
import select
import signal
import subprocess
import tempfile
import time

with tempfile.TemporaryDirectory(prefix="pi-tui-lock-") as root:
    env = dict(os.environ, HOME=root, PI_CODING_AGENT_DIR=root + "/agent", TERM="xterm-256color")
    sessions = root + "/sessions"
    os.makedirs(sessions)
    path = sessions + "/test.jsonl"
    with open(path, "w") as out:
        out.write(json.dumps(dict(type="session", version=3, id="abcdef01-2345-4678-9abc-def012345678", timestamp="2026-01-01T00:00:00.000Z", cwd=root)) + "\n")
    locks = root + "/agent/locks/sessions"
    os.makedirs(locks)
    lock = locks + "/" + hashlib.sha256(os.path.realpath(path).encode()).hexdigest() + ".lock"

    def busy():
        with open(lock, "a+") as fd:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                return False
            except BlockingIOError:
                return True

    for args in [["--session", path], ["--resume", "--session-dir", sessions]]:
        master, slave = pty.openpty()
        # Real terminal size rather than a zero-width fake descriptor.
        import struct, termios
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
        child = subprocess.Popen(["pi", "--no-extensions", *args], cwd=root, env=env,
                                 stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        os.close(slave)
        output = b""
        try:
            for i in range(150):
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        output += os.read(master, 65536)
                    except OSError as error:
                        if error.errno != errno.EIO:
                            raise
                if child.poll() is not None:
                    raise AssertionError("TUI exited before owning Session: " + output.decode(errors="replace"))
                if "--resume" in args and i in (25, 45, 65):
                    os.write(master, b"\r")
                if busy():
                    break
            else:
                raise AssertionError("TUI never acquired Session: " + output.decode(errors="replace"))
            # A fresh cli invocation must reject while the interactive terminal owns it.
            refused = subprocess.run(["pi", "--mode", "rpc", "--no-extensions", "--session", path],
                                     cwd=root, env=env, capture_output=True, timeout=10)
            assert refused.returncode != 0
            assert b"Session is already owned" in refused.stdout + refused.stderr
        finally:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait(timeout=10)
            os.close(master)
        assert not busy(), "TUI lock survived process death"
    print("PASS: actual PTY TUI --session and --resume own Session; conflict rejection and exit release")
