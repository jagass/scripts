# Flashscore -> Excel

Preia meciurile de pe Flashscore și le pune într-un tabel Excel (`.xlsx`) cu coloanele:
Data, Sport, Țară, Competiție, Gazde, Oaspeți, Scor, Status, Link.
Tabelul are antet fixat și filtre, ca să poți sorta/filtra direct în Excel.

## Instalare
```
pip install requests openpyxl
```

## Utilizare
```
python flashscore_excel.py                                  # fotbal, azi
python flashscore_excel.py --days -1 0 1                    # ieri, azi, mâine
python flashscore_excel.py --sport fotbal tenis baschet     # mai multe sporturi
python flashscore_excel.py --out meciuri.xlsx               # alt nume de fișier
```
Sporturi disponibile: fotbal, tenis, baschet, hochei, handbal, volei.
Zilele sunt relative la azi, de la -7 la 7.

## Observații
- Scriptul folosește feed-ul intern pe care îl încarcă site-ul în browser. Dacă Flashscore
  schimbă ceva (de ex. valoarea `x-fsign`), scriptul trebuie actualizat.
- Pentru date actualizate, rulează din nou scriptul (sau programează-l cu Task Scheduler / cron).
- Folosește-l doar pentru uz personal și nu-l rula foarte des, ca să nu încarci serverele Flashscore.
