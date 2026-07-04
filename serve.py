#!/usr/bin/env python3
"""CodeMap launcher — static server with correct MIME types for PWA (manifest, SW).
Usage:  python serve.py [port]   (default 8777)  ->  http://localhost:8777
"""
import http.server, socketserver, sys, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))   # always serve the app folder
# first numeric CLI arg is the port (so flags like --lan can appear in any position)
_ports = [a for a in sys.argv[1:] if a.isdigit()]
PORT = int(_ports[0]) if _ports else int(os.environ.get('PORT', 8777))

# Threaded server: a single-threaded server can deadlock when the browser holds a
# connection open while the HTML parser blocks on the next <script> — serve concurrently.
ServerClass = getattr(http.server, 'ThreadingHTTPServer', None) or socketserver.ThreadingTCPServer

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.webmanifest': 'application/manifest+json',
        '.js':   'text/javascript',
        '.mjs':  'text/javascript',
        '.json': 'application/json',
        '.svg':  'image/svg+xml',
        '.css':  'text/css',
        '.png':  'image/png',
    }
    def end_headers(self):
        self.send_header('Service-Worker-Allowed', '/')   # allow SW to control the whole scope
        super().end_headers()

if __name__ == '__main__':
    ServerClass.allow_reuse_address = True
    ServerClass.daemon_threads = True
    # Bind to loopback by default — the whole D:\codemap folder is served, so exposing it on every
    # LAN interface (the old '' / 0.0.0.0) leaked local files to the network. Pass --lan to opt in.
    HOST = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
    with ServerClass((HOST, PORT), Handler) as httpd:
        where = f'0.0.0.0:{PORT} (LAN)' if HOST == '0.0.0.0' else f'localhost:{PORT}'
        print(f'CodeMap (PWA) -> http://{where}   (Ctrl+C aby zatrzymać)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
