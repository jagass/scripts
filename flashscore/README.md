# Flashscore -> Excel

Preia meciurile de fotbal de pe Flashscore pentru ziua aleasă și le pune într-un tabel Excel,
împreună cu forma fiecărei echipe (gazde și oaspeți):

- goluri marcate / primite în ultimele 5 și ultimele 10 meciuri
- victorii / egaluri / înfrângeri în ultimele 10 meciuri
- total șuturi pe poartă, offside-uri și cornere în ultimele 10 meciuri

## Instalare (o singură dată)
1. Instalează Python de pe https://www.python.org/downloads/ (bifează **"Add python.exe to PATH"**).
2. Dezarhivează folderul oriunde (ex. pe Desktop).

## Utilizare
Dublu-click pe **Porneste.bat** → se deschide o fereastră:
1. Alege **ziua** (de acum 7 zile până peste 7 zile).
2. Opțional, scrie un **filtru** (ex: `romania, premier league`). Gol = toate meciurile.
3. Apasă **Actualizează datele**. La final se deschide automat `meciuri_flashscore.xlsx`.

Prima rulare pe toate meciurile unei zile poate dura mult (pentru fiecare meci se descarcă
statisticile a 20 de meciuri anterioare). Statisticile se salvează în `cache_statistici.json`,
așa că rulările următoare sunt mult mai rapide.

Din linia de comandă:
```
python flashscore_excel.py --day 1 --filter romania england
```

## Dacă ceva nu merge
Scriptul folosește datele interne ale site-ului, care nu sunt documentate public. Dacă
coloanele de formă ies goale, rulează pentru un meci (ID-ul din link-ul meciului):
```
python flashscore_excel.py --debug ID_MECI
```
și trimite fișierele din folderul `debug`.

Folosește-l doar pentru uz personal și nu-l rula foarte des.
