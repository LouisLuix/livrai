#!/usr/bin/env python3
# Ponte de PTY do Terminal embutido do Livrai (macOS/Linux).
# Sem módulo nativo no Electron: este wrapper cria o pseudo-terminal de
# verdade (cores, prompt, apps interativos) e repassa tudo por pipes.
#   stdin/stdout  <-> teclado e tela do xterm.js
#   fd 3          <-  controle: linhas JSON {"cols": N, "rows": N} pra redimensionar
# Uso: python3 pty.py <shell> [cols] [rows]
import fcntl
import json
import os
import pty
import select
import struct
import sys
import termios


def setsize(fd, cols, rows):
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    except OSError:
        pass


shell = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('SHELL', '/bin/sh')
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 80
rows = int(sys.argv[3]) if len(sys.argv) > 3 else 24

pid, fd = pty.fork()
if pid == 0:
    env = dict(os.environ)
    env['TERM'] = 'xterm-256color'
    env.setdefault('LANG', 'pt_BR.UTF-8')
    base = os.path.basename(shell)
    argv = [shell, '-il'] if base in ('zsh', 'bash') else [shell]
    try:
        os.execvpe(shell, argv, env)
    except OSError:
        os.execvpe('/bin/sh', ['/bin/sh', '-i'], env)

setsize(fd, cols, rows)

CTL = 3
ctlbuf = b''
while True:
    try:
        ready, _, _ = select.select([fd, 0, CTL], [], [])
    except (OSError, ValueError):
        break
    if fd in ready:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
    if 0 in ready:
        try:
            data = os.read(0, 65536)
        except OSError:
            break
        if not data:  # Electron fechou a entrada — encerra a sessão
            break
        os.write(fd, data)
    if CTL in ready:
        try:
            chunk = os.read(CTL, 1024)
        except OSError:
            chunk = b''
        if chunk:
            ctlbuf += chunk
            while b'\n' in ctlbuf:
                line, ctlbuf = ctlbuf.split(b'\n', 1)
                try:
                    msg = json.loads(line)
                    setsize(fd, int(msg['cols']), int(msg['rows']))
                except (ValueError, KeyError, TypeError):
                    pass

try:
    os.close(fd)
except OSError:
    pass
