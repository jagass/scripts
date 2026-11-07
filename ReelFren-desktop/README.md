# ReelFren / ShortMax pentru Windows

Aceeasi aplicatie, construita pentru mai multe site-uri (configurarea in `sites/*.json`):
`ReelFren.exe` (reelfren.net) si `ShortMax.exe` (shortmax.shorttw.live). Fiecare are login-ul si setarile ei separate.

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
| A | Mod film pornit/oprit (urmatorul episod porneste automat la final) |
| F11 | ecran complet |
| Esc | iesire din ecran complet; in fereastra unui serial: inchide fereastra si revii la lista |
| F5 | reincarca pagina |
| Alt + ← | inapoi |
| F12 | instrumente de depanare (erori) |

## Rulare / build local (optional)
```bash
npm install
SITE=shortmax npm start        # ruleaza
node build-site.js shortmax    # construieste dist/ShortMax.exe
```

## Adaugare site nou
Creeaza `sites/<nume>.json` (home, domains, productName, appId, icon) si adauga-l in matricea din
`.github/workflows/reelfren-desktop.yml`.
