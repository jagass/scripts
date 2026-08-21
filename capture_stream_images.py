"""
Captureaza periodic imagini (frame-uri) dintr-un stream video online:
- YouTube (video normal sau live) - se foloseste yt-dlp pentru a extrage URL-ul real de stream
- TV online / orice link HLS (.m3u8) sau RTMP - se foloseste direct linkul

Dependinte (instalare):
    pip install -r requirements.txt

Exemple de utilizare:
    # O imagine la fiecare 10 secunde, timp de 5 minute, dintr-un live YouTube
    python capture_stream_images.py "https://www.youtube.com/watch?v=XXXXXXXXXXX" --interval 10 --duration 300

    # O singura imagine, dintr-un stream TV online (link .m3u8)
    python capture_stream_images.py "https://exemplu.ro/live/stream.m3u8" --count 1

    # Captura continua (pana la Ctrl+C), o imagine la fiecare 30 de secunde
    python capture_stream_images.py "https://www.youtube.com/watch?v=XXXXXXXXXXX" --interval 30
"""

import argparse
import os
import time
from datetime import datetime
from typing import Optional

import cv2


def resolve_stream_url(url: str) -> str:
    """Daca link-ul este de pe YouTube (sau alt site suportat de yt-dlp),
    extrage URL-ul real al stream-ului video. Altfel, returneaza link-ul neschimbat
    (presupus a fi deja un link direct HLS/RTMP/etc, cum e cazul multor TV-uri online)."""
    if "youtube.com" not in url and "youtu.be" not in url:
        return url

    import yt_dlp

    ydl_opts = {"quiet": True, "no_warnings": True, "format": "best"}
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(url, download=False)
        return info["url"]


def capture_images(source_url: str, output_dir: str, interval: float, count: Optional[int], duration: Optional[float]):
    os.makedirs(output_dir, exist_ok=True)

    stream_url = resolve_stream_url(source_url)
    capture = cv2.VideoCapture(stream_url)
    if not capture.isOpened():
        raise RuntimeError(f"Nu am putut deschide stream-ul: {source_url}")

    start_time = time.time()
    saved = 0

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                print("Nu s-a putut citi un frame din stream, reincerc...")
                time.sleep(1)
                continue

            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = os.path.join(output_dir, f"capture_{timestamp}.jpg")
            cv2.imwrite(filename, frame)
            saved += 1
            print(f"Salvat: {filename}")

            if count is not None and saved >= count:
                break
            if duration is not None and (time.time() - start_time) >= duration:
                break

            time.sleep(interval)
    finally:
        capture.release()

    print(f"Gata. Total imagini salvate: {saved}")


def main():
    parser = argparse.ArgumentParser(description="Captureaza imagini dintr-un stream TV online sau YouTube.")
    parser.add_argument("url", help="URL-ul stream-ului (YouTube sau link direct HLS/RTMP de TV online)")
    parser.add_argument("--output", "-o", default="captures", help="Folderul unde se salveaza imaginile (implicit: captures)")
    parser.add_argument("--interval", "-i", type=float, default=5.0, help="Interval intre capturi, in secunde (implicit: 5)")
    parser.add_argument("--count", "-c", type=int, default=None, help="Numar maxim de imagini de salvat (implicit: nelimitat)")
    parser.add_argument("--duration", "-d", type=float, default=None, help="Durata totala de captura, in secunde (implicit: nelimitat)")
    args = parser.parse_args()

    capture_images(args.url, args.output, args.interval, args.count, args.duration)


if __name__ == "__main__":
    main()
