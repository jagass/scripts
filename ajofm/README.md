# Extragere convenții încheiate la 12 luni sau mai mult de la angajare

`extrage_conventii_peste_12_luni.py` citește foaia `Foaie1` din raportul sursă și
extrage persoanele pentru care **data convenției** este la 12 luni întregi sau
mai mult după **data angajării**.

## Utilizare

```bash
python3 extrage_conventii_peste_12_luni.py <raport_sursa.xlsx> [director_ieșire]
```

Rezultat: `Conventii_peste_12_luni_de_la_angajare.xlsx`, cu trei foi:

| Foaie | Conținut |
|---|---|
| `Sumar` | criteriul aplicat, totaluri, distribuție pe intervale de întârziere, repartizare pe AJOFM |
| `Peste 12 luni` | persoanele identificate, sortate descrescător după zilele scurse |
| `Date eronate` | înregistrări excluse: an de angajare greșit în sursă, sau convenție anterioară angajării |

`Data angajare` (col. I) și `Data conventie` (col. J) sunt coloane separate,
evidențiate; `Luni de la angajare` (K) și `Zile de la angajare` (L) sunt formule
`DATEDIF`/scădere, deci se recalculează la editarea datelor.

## Note

- O înregistrare = o persoană la un angajator (combinația CNP + CUI este unică în sursă).
- Lunile sunt calendaristice întregi, nu zile împărțite la 30.
- Datele cu an anterior anului 1900 (erori de tastare de tip `0023`, `0203`, `0244`)
  se scriu ca text, pentru că Excel nu le poate reprezenta ca dată.
- Valorile formulelor sunt injectate în XML la salvare, astfel încât fișierul să
  afișeze rezultate și fără o recalculare prealabilă în Excel.
