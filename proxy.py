#!/usr/bin/env python3
"""Ponte local do Estúdio para a OpenAI.

A API da OpenAI não aceita chamadas diretas de navegador (CORS), então este
mini-servidor roda em 127.0.0.1 e repassa as requisições. A chave de API sai
do navegador direto pra cá e daqui pra OpenAI — nada passa por terceiros.
Iniciado automaticamente pelo "ABRIR ESTUDIO.command".
"""
import http.server
import socketserver
import urllib.error
import urllib.request

PORT = 8787
TARGETS = {"/openai/": "https://api.openai.com/"}
FORWARD_HEADERS = ("Authorization", "Content-Type", "OpenAI-Organization")


class Handler(http.server.BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def _proxy(self):
        target = None
        for prefix, base in TARGETS.items():
            if self.path.startswith(prefix):
                target = base + self.path[len(prefix):]
                break
        if not target:
            self.send_response(404)
            self._cors()
            self.end_headers()
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        req = urllib.request.Request(target, data=body, method=self.command)
        for h in FORWARD_HEADERS:
            v = self.headers.get(h)
            if v:
                req.add_header(h, v)
        try:
            resp = urllib.request.urlopen(req, timeout=600)
            status = resp.status
            data = resp.read()
            ctype = resp.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as e:
            status = e.code
            data = e.read()
            ctype = e.headers.get("Content-Type", "application/json")
        except Exception as e:  # rede fora etc.
            status = 502
            data = str(e).encode()
            ctype = "text/plain"
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = _proxy
    do_POST = _proxy

    def log_message(self, *args):
        pass


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True


if __name__ == "__main__":
    try:
        Server(("127.0.0.1", PORT), Handler).serve_forever()
    except OSError:
        pass  # já tem uma ponte rodando nesta porta
