# Episod – catalog de short drame

Prototip de aplicație care adună short drame de pe **YouTube** și **Dailymotion**, le grupează pe seriale și episoade și le redă prin playerul oficial al platformei. Aplicația nu descarcă și nu stochează videoclipuri, ci doar titlul, ID-ul și imaginea.

## Cum o pornești

Deschide `index.html` în browser. Merge și pe GitHub Pages.

- La pornire vezi **date demo**: 12 seriale inventate, ca să vezi interfața.
- Din butonul cu glisoare din dreapta sus poți încărca **date reale**:
  - **Dailymotion**: merge fără cheie.
  - **YouTube**: ai nevoie de o cheie *YouTube Data API v3* (Google Cloud Console → APIs & Services → Credentials). O căutare costă 200 de unități din cele 10.000 pe zi.

## Ce face

- Filtrează după platformă, gen și favorite, și are căutare.
- **Grupează automat episoadele** după titlu (`EP 12`, `Episode 3`, `Part 2`, `第5集`…) și după canal.
- Are secțiunea „Continuă vizionarea” și favorite, salvate local în browser.
- Trece la episodul următor; în modul demo, cu numărătoare inversă.

## Următorii pași posibili

1. Un crawler pe server (Python + cron) care urmărește o listă de canale aprobate, în loc de căutare din browser.
2. O bază de date (Supabase/Postgres) cu seriale și episoade, reîmprospătată la cel mult 30 de zile, cum cer termenii YouTube API.
3. Clasificare mai bună a genurilor și a titlurilor ambigue, eventual cu un LLM.
4. Aplicație mobilă (Flutter / React Native) peste același backend.
