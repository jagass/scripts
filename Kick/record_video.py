"""
Inregistreaza un livestream Kick direct in fisiere video (.ts).

Foloseste streamlink pentru a rezolva URL-ul real al stream-ului si pentru
a citi octetii bruti ai fluxului (HLS), pe care ii scrie direct intr-un
fisier .ts (MPEG-TS), redabil in orice player (VLC etc.) sau convertibil
ulterior cu ffmpeg (ex: `ffmpeg -i fisier.ts -c copy fisier.mp4`).

Instalare:
    pip install streamlink

Exemple de utilizare:
    python record_video.py xqc
    python record_video.py xqc --output ./recordings --quality 720p
    python record_video.py xqc --segment-minutes 30
    python record_video.py xqc --segment-minutes 30 --max-segments 4
"""

import argparse
import datetime
import logging
import time
from pathlib import Path

import streamlink

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("kick-record")

CHUNK_SIZE = 1024 * 64


def resolve_stream(channel: str, quality: str):
    channel_url = f"https://kick.com/{channel}"
    streams = streamlink.streams(channel_url)
    if not streams:
        raise RuntimeError(f"Canalul '{channel}' nu are niciun stream live disponibil momentan.")

    if quality not in streams:
        available = ", ".join(streams.keys())
        log.warning("Calitatea '%s' nu e disponibila, folosesc 'best'. Disponibile: %s", quality, available)
        quality = "best"

    return streams[quality]


def new_segment_path(output_dir: Path, channel: str) -> Path:
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return output_dir / f"{channel}_{timestamp}.ts"


def record(channel: str, output_dir: Path, quality: str, segment_minutes: float | None, max_segments: int | None):
    output_dir.mkdir(parents=True, exist_ok=True)

    segment_seconds = segment_minutes * 60 if segment_minutes else None
    segments_done = 0

    while True:
        if max_segments and segments_done >= max_segments:
            log.info("Am atins numarul maxim de segmente (%d), opresc inregistrarea.", max_segments)
            break

        stream = resolve_stream(channel, quality)
        filepath = new_segment_path(output_dir, channel)
        log.info("Incep inregistrarea in %s", filepath.name)

        segment_start = time.monotonic()
        bytes_written = 0

        try:
            with stream.open() as stream_fd, open(filepath, "wb") as out_fd:
                while True:
                    data = stream_fd.read(CHUNK_SIZE)
                    if not data:
                        log.warning("Fluxul s-a terminat/intrerupt.")
                        break

                    out_fd.write(data)
                    bytes_written += len(data)

                    if segment_seconds and (time.monotonic() - segment_start) >= segment_seconds:
                        log.info("Segment de %d min atins, trec la fisierul urmator.", segment_minutes)
                        break
        except KeyboardInterrupt:
            log.info("Oprit de utilizator.")
            return
        except Exception as exc:
            log.warning("Eroare in timpul citirii fluxului: %s", exc)

        segments_done += 1
        log.info("Am salvat %s (%.1f MB)", filepath.name, bytes_written / (1024 * 1024))

        if bytes_written == 0:
            log.info("Niciun byte primit, astept 5s inainte de reconectare...")
            time.sleep(5)


def parse_args():
    parser = argparse.ArgumentParser(description="Inregistreaza un livestream Kick in fisiere .ts")
    parser.add_argument("channel", help="Numele canalului Kick (ex: xqc, din kick.com/xqc)")
    parser.add_argument("--output", type=Path, default=Path("recordings"), help="Folder unde se salveaza video")
    parser.add_argument("--quality", default="best", help="Calitate stream (best, worst, 720p, 480p...)")
    parser.add_argument(
        "--segment-minutes",
        type=float,
        default=None,
        help="Imparte inregistrarea in fisiere separate de N minute (default: un singur fisier continuu)",
    )
    parser.add_argument("--max-segments", type=int, default=None, help="Opreste dupa N segmente/fisiere salvate")
    return parser.parse_args()


def main():
    args = parse_args()
    record(
        channel=args.channel,
        output_dir=args.output,
        quality=args.quality,
        segment_minutes=args.segment_minutes,
        max_segments=args.max_segments,
    )


if __name__ == "__main__":
    main()
