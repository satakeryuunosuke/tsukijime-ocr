import http.server
import socketserver
import os
import sys

PORT = 8000
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

if __name__ == '__main__':
    # 0.0.0.0 でバインドし、localhost / 127.0.0.1 どちらからでも受信可能にする
    server_address = ('0.0.0.0', PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, Handler)
    print(f'Server running at http://127.0.0.1:{PORT}/')
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
