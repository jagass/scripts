"""
Captureaza periodic frame-uri (imagini) dintr-un livestream Kick.

Foloseste streamlink pentru a rezolva URL-ul real al stream-ului (HLS)
pornind de la numele canalului, apoi OpenCV pentru a citi fluxul video
si a salva cate o imagine la fiecare `interval` secunde.

Instalare:
    pip install streamlink opencv-python

Exemple de utilizare:
    python capture_frames.py xqc
    python capture_frames.py xqc --interval 10 --output ./frames --quality 720p
    python capture_frames.py xqc --max-frames 50
"""

import argparse
import datetime
import logging
import time
from pathlib import Path

import cv2
import streamlink

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("kick-capture")


def resolve_stream_url(channel: str, quality: str) -> str:
    channel_url = f"https://kick.com/{channel}"
    streams = streamlink.streams(channel_url)
    if not streams:
        raise RuntimeError(f"Canalul '{channel}' nu are niciun stream live disponibil momentan.")

    if quality not in streams:
        available = ", ".join(streams.keys())
        log.warning("Calitatea '%s' nu e disponibila, folosesc 'best'. Disponibile: %s", quality, available)
        quality = "best"

    return streams[quality].url


def capture_loop(channel: str, output_dir: Path, interval: float, quality: str, max_frames: int | None):
    output_dir.mkdir(parents=True, exist_ok=True)

    stream_url = resolve_stream_url(channel, quality)
    log.info("Stream gasit pentru '%s', deschid fluxul video...", channel)

    cap = cv2.VideoCapture(stream_url)
    if not cap.isOpened():
        raise RuntimeError("Nu am putut deschide fluxul video (VideoCapture).")

    saved = 0
    last_saved_at = 0.0

    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                log.warning("Fluxul s-a intrerupt, incerc sa reconectez in 5s...")
                cap.release()
                time.sleep(5)
                stream_url = resolve_stream_url(channel, quality)
                cap = cv2.VideoCapture(stream_url)
                continue

            now = time.monotonic()
            if now - last_saved_at >= interval:
                last_saved_at = now
                timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
                filepath = output_dir / f"{channel}_{timestamp}.jpg"
                cv2.imwrite(str(filepath), frame)
                saved += 1
                log.info("Salvat %s (%d/%s)", filepath.name, saved, max_frames or "∞")

                if max_frames and saved >= max_frames:
                    log.info("Am atins numarul maxim de frame-uri (%d), opresc captura.", max_frames)
                    break
    except KeyboardInterrupt:
        log.info("Oprit de utilizator.")
    finally:
        cap.release()


def parse_args():
    parser = argparse.ArgumentParser(description="Captureaza frame-uri dintr-un livestream Kick.")
    parser.add_argument("channel", help="Numele canalului Kick (ex: xqc, din kick.com/xqc)")
    parser.add_argument("--interval", type=float, default=5.0, help="Secunde intre doua capturi (default: 5)")
    parser.add_argument("--output", type=Path, default=Path("frames"), help="Folder unde se salveaza imaginile")
    parser.add_argument("--quality", default="best", help="Calitate stream (best, worst, 720p, 480p...)")
    parser.add_argument("--max-frames", type=int, default=None, help="Opreste dupa N frame-uri salvate")
    return parser.parse_args()


def main():
    args = parse_args()
    capture_loop(
        channel=args.channel,
        output_dir=args.output,
        interval=args.interval,
        quality=args.quality,
        max_frames=args.max_frames,
    )


if __name__ == "__main__":
    main()
