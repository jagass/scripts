# ReelFren pentru Windows

Fereastra dedicata pentru https://reelfren.net, cu aceleasi protectii ca aplicatia Android:
linkuri externe si pop-up-uri blocate, retele de reclame blocate, ferestre false ("VPN...") ascunse,
butonul **Filtru** pe listele de seriale.

## Descarcare
Orice modificare in `ReelFren-desktop/` (sau in scripturile comune din aplicatia Android) construieste
automat `ReelFren.exe` (portabil, fara instalare) si il publica in **Releases** (`ReelFren Desktop vN`).

La prima pornire Windows poate afisa "Windows a protejat PC-ul" (aplicatia nu e semnata):
**Mai multe informatii -> Executa oricum**.

## Scurtaturi
| Tasta | Actiune |
|---|---|
| ↓ / PageDown / N | episodul urmator |
| ↑ / PageUp / P | episodul anterior |
| ← / → | -10s / +10s |
| Space / K | pauza / pornire |
| F11 | ecran complet |
| Esc | iesire din ecran complet |
| F5 | reincarca pagina |
| Alt + ← | inapoi |

## Rulare locala (optional)
```bash
npm install
npm start
```
