#!/usr/bin/env python3
"""Detect when a specific person appears in a video, using one or more
reference photos of that person's face.

Usage:
    python detect_person.py --video clip.mp4 --reference photo1.jpg photo2.jpg

See README.md in this folder for full usage details.
"""
import argparse
import json
import sys
from pathlib import Path

import cv2
import face_recognition


def load_known_encodings(reference_paths):
    encodings = []
    for path in reference_paths:
        image = face_recognition.load_image_file(path)
        faces = face_recognition.face_encodings(image)
        if not faces:
            print(f"Warning: no face found in reference image '{path}', skipping.", file=sys.stderr)
            continue
        encodings.append(faces[0])
    if not encodings:
        raise SystemExit("No usable faces found in any reference image.")
    return encodings


def format_timestamp(seconds):
    minutes, secs = divmod(int(seconds), 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def merge_hits_into_intervals(hit_timestamps, max_gap):
    """Collapse a sorted list of timestamps (seconds) where the person was
    seen into contiguous [start, end] intervals, allowing gaps up to
    max_gap seconds (to bridge brief misses/occlusions)."""
    if not hit_timestamps:
        return []
    intervals = [[hit_timestamps[0], hit_timestamps[0]]]
    for t in hit_timestamps[1:]:
        if t - intervals[-1][1] <= max_gap:
            intervals[-1][1] = t
        else:
            intervals.append([t, t])
    return intervals


def detect(video_path, reference_paths, tolerance=0.6, frame_skip=5,
           scale=0.5, output_video=None, merge_gap=1.0):
    known_encodings = load_known_encodings(reference_paths)

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise SystemExit(f"Could not open video: {video_path}")

    fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))

    writer = None
    if output_video:
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(str(output_video), fourcc, fps, (width, height))

    hit_timestamps = []
    frame_index = 0

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        process_this_frame = frame_index % frame_skip == 0
        matched_this_frame = False
        boxes = []

        if process_this_frame:
            small_frame = cv2.resize(frame, (0, 0), fx=scale, fy=scale)
            rgb_small_frame = cv2.cvtColor(small_frame, cv2.COLOR_BGR2RGB)

            face_locations = face_recognition.face_locations(rgb_small_frame)
            face_encodings = face_recognition.face_encodings(rgb_small_frame, face_locations)

            for (top, right, bottom, left), encoding in zip(face_locations, face_encodings):
                matches = face_recognition.compare_faces(known_encodings, encoding, tolerance=tolerance)
                if any(matches):
                    matched_this_frame = True
                    boxes.append((top, right, bottom, left))

            if matched_this_frame:
                timestamp = frame_index / fps
                hit_timestamps.append(timestamp)
                print(f"Person detected at {format_timestamp(timestamp)} (frame {frame_index})")

        if writer:
            if boxes:
                inv_scale = 1 / scale
                for top, right, bottom, left in boxes:
                    top, right, bottom, left = (int(v * inv_scale) for v in (top, right, bottom, left))
                    cv2.rectangle(frame, (left, top), (right, bottom), (0, 255, 0), 2)
                    cv2.putText(frame, "Match", (left, max(top - 10, 0)),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
            writer.write(frame)

        frame_index += 1
        if frame_count:
            print(f"\rProcessed {frame_index}/{frame_count} frames", end="", file=sys.stderr)

    capture.release()
    if writer:
        writer.release()
    print(file=sys.stderr)

    intervals = merge_hits_into_intervals(hit_timestamps, merge_gap)
    return intervals


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--video", required=True, type=Path, help="Path to the video file to scan")
    parser.add_argument("--reference", required=True, nargs="+", type=Path,
                         help="One or more photos of the person's face (more photos = better accuracy)")
    parser.add_argument("--tolerance", type=float, default=0.6,
                         help="Lower = stricter match (default: 0.6)")
    parser.add_argument("--frame-skip", type=int, default=5,
                         help="Only analyze every Nth frame, for speed (default: 5)")
    parser.add_argument("--scale", type=float, default=0.5,
                         help="Downscale factor for face detection speed (default: 0.5)")
    parser.add_argument("--merge-gap", type=float, default=1.0,
                         help="Max gap in seconds between hits to merge into one interval (default: 1.0)")
    parser.add_argument("--output-video", type=Path, default=None,
                         help="Optional: write an annotated copy of the video with match boxes")
    parser.add_argument("--report", type=Path, default=None,
                         help="Optional: write the detected intervals as JSON to this path")
    args = parser.parse_args()

    intervals = detect(
        video_path=args.video,
        reference_paths=args.reference,
        tolerance=args.tolerance,
        frame_skip=args.frame_skip,
        scale=args.scale,
        output_video=args.output_video,
        merge_gap=args.merge_gap,
    )

    print("\nIntervals where the person appears:")
    if not intervals:
        print("  (not found)")
    for start, end in intervals:
        print(f"  {format_timestamp(start)} - {format_timestamp(end)}")

    if args.report:
        report = [
            {"start_seconds": start, "end_seconds": end,
             "start": format_timestamp(start), "end": format_timestamp(end)}
            for start, end in intervals
        ]
        args.report.write_text(json.dumps(report, indent=2))
        print(f"\nReport written to {args.report}")


if __name__ == "__main__":
    main()
