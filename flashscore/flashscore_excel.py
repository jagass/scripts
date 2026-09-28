"""
Preia meciurile de fotbal de pe Flashscore si le salveaza intr-un tabel Excel (.xlsx),
impreuna cu forma echipelor (goluri, rezultate, suturi pe poarta, cornere, offside-uri).

Foloseste feed-ul intern pe care il incarca si site-ul flashscore.com in browser.
Exemple:
    python flashscore_excel.py                          # azi
    python flashscore_excel.py --day 1                  # maine
    python flashscore_excel.py --filter romania england # doar anumite tari/competitii
    python flashscore_excel.py --debug MATCH_ID         # salveaza feed-urile brute pentru depanare
"""
import argparse
import json
import os
import re
import sys
import threading
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import requests
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE_FILE = os.path.join(HERE, "cache_statistici.json")

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

STAT_NAMES = {
    "suturi": ("shots on target", "shots on goal"),
    "cornere": ("corner kicks", "corners"),
    "offside": ("offsides",),
}

FORM_COLUMNS = [
    "Goluri marcate (ult. 5)",
    "Goluri primite (ult. 5)",
    "Goluri marcate (ult. 10)",
    "Goluri primite (ult. 10)",
    "Victorii (ult. 10)",
    "Egaluri (ult. 10)",
    "Infrangeri (ult. 10)",
    "Suturi pe poarta (ult. 10)",
    "Offside-uri (ult. 10)",
    "Cornere (ult. 10)",
]

MATCH_COLUMNS = ["Data", "Tara", "Competitie", "Gazde", "Oaspeti", "Scor", "Status", "Link"]
MATCH_WIDTHS = [17, 16, 28, 24, 24, 8, 11, 40]

session = requests.Session()
session.headers.update(HEADERS)
working_host = [None]


def fetch(path):
    """Descarca un feed Flashscore, incercand pe rand serverele cunoscute."""
    hosts = [working_host[0]] if working_host[0] else FEED_HOSTS
    last_error = None
    for attempt in range(3):
        for host in hosts:
            try:
                response = session.get(host + path, timeout=20)
                if response.ok:
                    working_host[0] = host
                    return response.text
                last_error = f"HTTP {response.status_code} de la {host}"
                if response.status_code == 404:
                    return ""
            except requests.RequestException as error:
                last_error = error
        time.sleep(1 + attempt)
        hosts = FEED_HOSTS
    raise RuntimeError(f"Nu am putut descarca {path}: {last_error}")


def records(raw):
    """Formatul Flashscore: inregistrari separate de '~', campuri 'cheie÷valoare' separate de '¬'."""
    for record in raw.split("~"):
        fields = {}
        for item in record.split("¬"):
            if "÷" in item:
                key, value = item.split("÷", 1)
                fields.setdefault(key.strip(), value)
        if fields:
            yield fields


def to_int(value):
    match = re.search(r"-?\d+", str(value or ""))
    return int(match.group()) if match else None


# ---------------------------------------------------------------- lista de meciuri

def utc_offset_hours():
    offset = datetime.now().astimezone().utcoffset()
    return int(offset.total_seconds() // 3600) if offset else 0


def get_matches(day):
    raw = fetch(f"f_1_{day}_{utc_offset_hours()}_en_1")
    matches = []
    country, league = "", ""
    for fields in records(raw):
        if "ZA" in fields:
            header = fields["ZA"]
            if ": " in header:
                country, league = header.split(": ", 1)
            else:
                country, league = fields.get("ZY", ""), header
        elif "AA" in fields:
            timestamp = to_int(fields.get("AD")) or 0
            home_score, away_score = fields.get("AG", ""), fields.get("AH", "")
            matches.append({
                "id": fields["AA"],
                "Data": datetime.fromtimestamp(timestamp) if timestamp else None,
                "Tara": country.title(),
                "Competitie": league,
                "Gazde": fields.get("AE", ""),
                "Oaspeti": fields.get("AF", ""),
                "Scor": f"{home_score}-{away_score}" if home_score and away_score else "",
                "Status": STATUS.get(fields.get("AB", ""), fields.get("AB", "")),
                "Link": f"https://www.flashscore.com/match/{fields['AA']}/",
            })
    return matches


# ---------------------------------------------------------------- ultimele meciuri (H2H)

def clean_name(name):
    return re.sub(r"\s+", " ", (name or "").replace("*", "")).strip().lower()


def parse_score(fields):
    """Scorul unui meci din feed-ul H2H: (goluri gazde, goluri oaspeti) sau None."""
    if "KL" in fields:
        parts = re.findall(r"\d+", fields["KL"])
        if len(parts) >= 2:
            return int(parts[0]), int(parts[1])
    home, away = to_int(fields.get("KU")), to_int(fields.get("KT"))
    if home is not None and away is not None:
        return home, away
    return None


def get_last_matches(match_id):
    """Returneaza (ultimele meciuri gazde, ultimele meciuri oaspeti) din pagina H2H a meciului.

    Fiecare meci: {"id", "home", "away", "score": (g_home, g_away), "team_is_home"}.
    """
    raw = fetch(f"df_hh_1_{match_id}")
    groups, tabs = [], 0
    for fields in records(raw):
        if "KA" in fields:
            tabs += 1
            if tabs > 1:          # doar primul tab ("Overall")
                break
        if "KB" in fields:
            groups.append([])
        if "KJ" in fields and "KK" in fields and groups:
            score = parse_score(fields)
            if score is None:
                continue
            groups[-1].append({
                "id": fields.get("KP", ""),
                "home": clean_name(fields["KJ"]),
                "away": clean_name(fields["KK"]),
                "score": score,
            })

    result = []
    for group in groups[:2]:
        # echipa analizata este cea care apare in toate meciurile grupului
        names = Counter(name for m in group for name in (m["home"], m["away"]))
        team = names.most_common(1)[0][0] if names else ""
        games = [m for m in group if team in (m["home"], m["away"])][:10]
        for game in games:
            game["team_is_home"] = game["home"] == team
        result.append(games)
    while len(result) < 2:
        result.append([])
    return result[0], result[1]


# ---------------------------------------------------------------- statistici meci

class StatsCache:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        try:
            with open(path, encoding="utf-8") as fh:
                self.data = json.load(fh)
        except (OSError, ValueError):
            self.data = {}

    def get(self, key):
        with self.lock:
            return self.data.get(key)

    def set(self, key, value):
        with self.lock:
            self.data[key] = value

    def save(self):
        with self.lock:
            with open(self.path, "w", encoding="utf-8") as fh:
                json.dump(self.data, fh)


def get_match_stats(match_id, cache):
    """{"suturi": [gazde, oaspeti], "cornere": [...], "offside": [...]} pentru un meci terminat."""
    cached = cache.get(match_id)
    if cached is not None:
        return cached
    raw = fetch(f"df_st_1_{match_id}")
    stats, periods = {}, 0
    for fields in records(raw):
        if "SE" in fields:
            periods += 1
            if periods > 1:       # doar prima sectiune ("Match"), nu reprizele
                break
        name = clean_name(fields.get("SG"))
        for key, aliases in STAT_NAMES.items():
            if name in aliases and key not in stats:
                stats[key] = [to_int(fields.get("SH")), to_int(fields.get("SI"))]
    cache.set(match_id, stats)
    return stats


# ---------------------------------------------------------------- calcul forma

def team_form(games, cache):
    """Calculeaza cele 10 coloane de forma pentru o echipa, din ultimele ei meciuri."""
    if not games:
        return [None] * len(FORM_COLUMNS)

    scored, conceded, results = [], [], []
    totals = {key: None for key in STAT_NAMES}
    for game in games:
        home_goals, away_goals = game["score"]
        own, other = (home_goals, away_goals) if game["team_is_home"] else (away_goals, home_goals)
        scored.append(own)
        conceded.append(other)
        results.append("V" if own > other else "E" if own == other else "I")

        stats = get_match_stats(game["id"], cache) if game["id"] else {}
        side = 0 if game["team_is_home"] else 1
        for key in STAT_NAMES:
            value = (stats.get(key) or [None, None])[side]
            if value is not None:
                totals[key] = (totals[key] or 0) + value

    return [
        sum(scored[:5]), sum(conceded[:5]),
        sum(scored), sum(conceded),
        results.count("V"), results.count("E"), results.count("I"),
        totals["suturi"], totals["offside"], totals["cornere"],
    ]


def collect(day, filters=None, progress=print, workers=8):
    """Descarca meciurile zilei si forma echipelor. progress(text) primeste mesaje de stare."""
    progress("Descarc lista de meciuri...")
    matches = get_matches(day)
    if filters:
        wanted = [f.strip().lower() for f in filters if f.strip()]
        matches = [m for m in matches
                   if any(w in f"{m['Tara']} {m['Competitie']}".lower() for w in wanted)]
    progress(f"{len(matches)} meciuri gasite. Descarc forma echipelor...")

    cache = StatsCache(CACHE_FILE)
    done = [0]
    lock = threading.Lock()

    def enrich(match):
        try:
            home_games, away_games = get_last_matches(match["id"])
            match["form_home"] = team_form(home_games, cache)
            match["form_away"] = team_form(away_games, cache)
        except RuntimeError as error:
            match["form_home"] = match["form_away"] = [None] * len(FORM_COLUMNS)
            progress(f"  eroare la {match['Gazde']} - {match['Oaspeti']}: {error}")
        with lock:
            done[0] += 1
            if done[0] % 10 == 0 or done[0] == len(matches):
                progress(f"  {done[0]}/{len(matches)} meciuri procesate")
                cache.save()

    with ThreadPoolExecutor(max_workers=workers) as pool:
        list(pool.map(enrich, matches))
    cache.save()

    matches.sort(key=lambda m: (m["Data"] or datetime.min, m["Tara"], m["Competitie"]))
    return matches


# ---------------------------------------------------------------- Excel

def write_excel(matches, path):
    wb = Workbook()
    ws = wb.active
    ws.title = "Meciuri"

    n_base, n_form = len(MATCH_COLUMNS), len(FORM_COLUMNS)
    dark = PatternFill("solid", start_color="1F4E78")
    home_fill = PatternFill("solid", start_color="2E75B6")
    away_fill = PatternFill("solid", start_color="C55A11")
    white_bold = Font(bold=True, color="FFFFFF")
    center = Alignment(horizontal="center", vertical="center", wrap_text=True)
    thin = Side(style="thin", color="BFBFBF")

    # rândul 1: grupuri, rândul 2: numele coloanelor
    ws.cell(row=1, column=1, value="MECI")
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_base)
    ws.cell(row=1, column=n_base + 1, value="GAZDE - ultimele meciuri")
    ws.merge_cells(start_row=1, start_column=n_base + 1, end_row=1, end_column=n_base + n_form)
    ws.cell(row=1, column=n_base + n_form + 1, value="OASPETI - ultimele meciuri")
    ws.merge_cells(start_row=1, start_column=n_base + n_form + 1,
                   end_row=1, end_column=n_base + 2 * n_form)
    for column in range(1, n_base + 2 * n_form + 1):
        cell = ws.cell(row=1, column=column)
        cell.font, cell.alignment = white_bold, center
        cell.fill = dark if column <= n_base else home_fill if column <= n_base + n_form else away_fill

    headers = MATCH_COLUMNS + FORM_COLUMNS + FORM_COLUMNS
    for column, title in enumerate(headers, start=1):
        cell = ws.cell(row=2, column=column, value=title)
        cell.font, cell.alignment = white_bold, center
        cell.fill = dark if column <= n_base else home_fill if column <= n_base + n_form else away_fill
    ws.row_dimensions[2].height = 45

    for match in matches:
        ws.append([match[c] for c in MATCH_COLUMNS]
                  + match.get("form_home", [None] * n_form)
                  + match.get("form_away", [None] * n_form))

    for index, width in enumerate(MATCH_WIDTHS + [11] * (2 * n_form), start=1):
        ws.column_dimensions[get_column_letter(index)].width = width
    for row in ws.iter_rows(min_row=3):
        row[0].number_format = "dd.mm.yyyy hh:mm"
        for cell in row[5:7] + row[n_base:]:
            cell.alignment = Alignment(horizontal="center")
        row[n_base].border = Border(left=thin)
        row[n_base + n_form].border = Border(left=thin)

    ws.freeze_panes = "F3"
    ws.auto_filter.ref = f"A2:{get_column_letter(len(headers))}{max(ws.max_row, 2)}"
    wb.save(path)


def debug_dump(match_id):
    """Salveaza feed-urile brute ale unui meci, ca sa poata fi verificat formatul."""
    folder = os.path.join(HERE, "debug")
    os.makedirs(folder, exist_ok=True)
    for name in (f"df_hh_1_{match_id}", f"df_st_1_{match_id}"):
        with open(os.path.join(folder, name + ".txt"), "w", encoding="utf-8") as fh:
            fh.write(fetch(name))
    home, away = get_last_matches(match_id)
    print("Gazde:", home)
    print("Oaspeti:", away)
    print(f"Feed-urile brute sunt in {folder}")


def main():
    parser = argparse.ArgumentParser(description="Exporta meciurile de fotbal de pe Flashscore in Excel.")
    parser.add_argument("--day", type=int, default=0,
                        help="ziua fata de azi, intre -7 si 7 (implicit: 0 = azi)")
    parser.add_argument("--filter", nargs="*", default=[],
                        help="doar meciurile ale caror tara/competitie contine unul din cuvinte")
    parser.add_argument("--out", default=None, help="fisierul Excel rezultat")
    parser.add_argument("--debug", metavar="MATCH_ID", help="salveaza feed-urile brute ale unui meci")
    args = parser.parse_args()

    if args.debug:
        debug_dump(args.debug)
        return

    matches = collect(args.day, args.filter)
    if not matches:
        sys.exit("Nu am gasit niciun meci.")
    out = args.out or os.path.join(HERE, "meciuri_flashscore.xlsx")
    write_excel(matches, out)
    print(f"Salvat {len(matches)} meciuri in {out}")


if __name__ == "__main__":
    main()
