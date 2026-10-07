import http.server
import os
import sys
import urllib.parse

PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8778
ROOT_DIR = os.path.dirname(os.path.abspath(__file__))

# 開発用サーバーでアクセスを禁止するパス（外部・同一LANからの探索や漏洩を防ぐ）
DENIED_PREFIXES = (
    ".git",
    ".claude",
    "monthly_data",
    "dataset_extracted",
    "scratch",
    "tools",
)

class SecureLocalHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def do_GET(self):
        # パス正規化と禁止対象判定
        parsed_path = urllib.parse.urlparse(self.path).path.lstrip("/")
        parts = parsed_path.split("/")
        
        # ドットで始まる隠しファイル・ディレクトリ、または機密フォルダは 403 で拒絶
        for part in parts:
            if part.startswith(".") or part in DENIED_PREFIXES:
                self.send_error(403, "Access denied: confidential or internal resource")
                return

        super().do_GET()

    def end_headers(self):
        # セキュリティヘッダーの付与
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        super().end_headers()

if __name__ == '__main__':
    # 外部・同一LANへ公開せず、開発者PCローカル（127.0.0.1）限定でバインド
    server_address = ('127.0.0.1', PORT)
    httpd = http.server.ThreadingHTTPServer(server_address, SecureLocalHandler)
    print(f'Secure local dev server running at http://127.0.0.1:{PORT}/ (localhost only)')
    sys.stdout.flush()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
