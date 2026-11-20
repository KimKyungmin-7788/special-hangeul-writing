"""연습 화면·검수표를 같은 와이파이의 아이패드에서 열 수 있게 띄우는 서버.

- 이 폴더(프로젝트 루트)를 내부망 전체(0.0.0.0)에 연다. 인터넷에는 열리지 않는다.
- 캐시를 끄므로 파일을 고치면 아이패드에서 새로고침만 해도 새 버전이 보인다.
실행: python3 tools/serve.py   (포트를 바꾸려면 python3 tools/serve.py 5179)
"""
import http.server
import os
import socket
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5178
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # 실제로 보내지 않음, 내부망 주소만 알아냄
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    ip = lan_ip()
    print(f"맥북에서:   http://localhost:{PORT}/demo/")
    print(f"아이패드에서: http://{ip}:{PORT}/demo/  (검수표: http://{ip}:{PORT}/demo/review.html)", flush=True)
    http.server.ThreadingHTTPServer(("0.0.0.0", PORT), NoCacheHandler).serve_forever()
