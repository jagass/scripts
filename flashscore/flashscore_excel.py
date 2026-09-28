"""
Preia meciurile de pe Flashscore si le salveaza intr-un tabel Excel (.xlsx).

Foloseste feed-ul intern pe care il incarca si site-ul flashscore.com in browser.
Exemple:
    python flashscore_excel.py                      # fotbal, azi
    python flashscore_excel.py --days -1 0 1        # ieri, azi, maine
    python flashscore_excel.py --sport tenis baschet --out meciuri.xlsx
"""
import argparse
import sys
from datetime import datetime

import requests
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

SPORTS = {
    "fotbal": 1,
    "tenis": 2,
    "baschet": 3,
    "hochei": 4,
    "handbal": 7,
    "volei": 12,
}

FEED_HOSTS = [
    "https://global.flashscore.ninja/2/x/feed/",
    "https://local-global.flashscore.ninja/2/x/feed/",
    "https://d.flashscore.com/x/feed/",
]

HEADERS = {
    "x-fsign": "SW9D1eZo",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Referer": "https://www.flashscore.com/",
    "Origin": "https://www.flashscore.com",
}

STATUS = {"1": "Programat", "2": "Live", "3": "Terminat"}


def fetch_feed(sport_id, day):
    """Descarca feed-ul brut pentru un sport si o zi (0 = azi, -1 = ieri, 1 = maine)."""
    path = f"f_{sport_id}_{day}_3_en_1"
    last_error = None
    for host in FEED_HOSTS:
        try:
            response = requests.get(host + path, headers=HEADERS, timeout=20)
            if response.ok and "¬" in response.text:
                return response.text
            last_error = f"HTTP {response.status_code} de la {host}"
        except requests.RequestException as error:
            last_error = error
    raise RuntimeError(f"Nu am putut descarca feed-ul {path}: {last_error}")


def parse_feed(raw, sport_name):
    """Transforma formatul Flashscore (inregistrari cu '~', campuri 'cheie÷valoare¬') in randuri."""
    matches = []
    country, league = "", ""
    for record in raw.split("~"):
        fields = {}
        for item in record.split("¬"):
            if "÷" in item:
                key, value = item.split("÷", 1)
                fields.setdefault(key, value)
        if "ZA" in fields:
            header = fields["ZA"]
            if ": " in header:
                country, league = header.split(": ", 1)
            else:
                country, league = fields.get("ZY", ""), header
        elif "AA" in fields:
            timestamp = int(fields.get("AD", 0) or 0)
            home_score, away_score = fields.get("AG", ""), fields.get("AH", "")
            score = f"{home_score}-{away_score}" if home_score != "" and away_score != "" else ""
            matches.append({
                "Data": datetime.fromtimestamp(timestamp) if timestamp else None,
                "Sport": sport_name,
                "Tara": country,
                "Competitie": league,
                "Gazde": fields.get("AE", ""),
                "Oaspeti": fields.get("AF", ""),
                "Scor": score,
                "Status": STATUS.get(fields.get("AB", ""), fields.get("AB", "")),
                "Link": f"https://www.flashscore.com/match/{fields['AA']}/",
            })
    return matches


def write_excel(matches, path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Meciuri"
    columns = ["Data", "Sport", "Tara", "Competitie", "Gazde", "Oaspeti", "Scor", "Status", "Link"]
    widths = [17, 10, 18, 32, 28, 28, 8, 11, 45]
    ws.append(columns)
    for match in matches:
        ws.append([match[column] for column in columns])

    header_fill = PatternFill("solid", start_color="1F4E78")
    for cell in ws[1]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
    for index, width in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(index)].width = width
    for row in ws.iter_rows(min_row=2):
        row[0].number_format = "dd.mm.yyyy hh:mm"
        row[6].alignment = Alignment(horizontal="center")
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = ws.dimensions
    wb.save(path)


def main():
    parser = argparse.ArgumentParser(description="Exporta meciurile de pe Flashscore in Excel.")
    parser.add_argument("--sport", nargs="+", default=["fotbal"], choices=SPORTS,
                        help="sporturile dorite (implicit: fotbal)")
    parser.add_argument("--days", nargs="+", type=int, default=[0],
                        help="zilele fata de azi, intre -7 si 7 (implicit: 0 = azi)")
    parser.add_argument("--out", default=f"flashscore_{datetime.now():%Y-%m-%d}.xlsx",
                        help="fisierul Excel rezultat")
    args = parser.parse_args()

    matches = []
    for sport in args.sport:
        for day in args.days:
            try:
                found = parse_feed(fetch_feed(SPORTS[sport], day), sport)
            except RuntimeError as error:
                print(error, file=sys.stderr)
                continue
            print(f"{sport}, ziua {day:+d}: {len(found)} meciuri")
            matches.extend(found)

    if not matches:
        sys.exit("Nu am gasit niciun meci.")
    matches.sort(key=lambda m: (m["Data"] or datetime.min, m["Tara"], m["Competitie"]))
    write_excel(matches, args.out)
    print(f"Salvat {len(matches)} meciuri in {args.out}")


if __name__ == "__main__":
    main()
