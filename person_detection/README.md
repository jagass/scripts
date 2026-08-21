# Detectare persoană în video

Script Python care verifică un fișier video și îți spune la ce momente
(secunde) apare o anumită persoană, pe baza uneia sau mai multor poze de
referință cu fața acelei persoane.

## Cum funcționează

1. Extrage din pozele de referință "amprenta" facială a persoanei
   (128 de numere, generate cu `face_recognition`).
2. Parcurge videoclipul frame cu frame (poți sări frame-uri pentru viteză),
   detectează fețele din fiecare frame analizat și le compară cu amprenta
   persoanei căutate.
3. Afișează și salvează intervalele de timp în care persoana a fost
   recunoscută, opțional generând și un video adnotat cu un chenar verde
   peste fața detectată.

## Instalare

```bash
pip install -r requirements.txt
```

`face_recognition` are nevoie de `dlib`, care la rândul lui are nevoie de
CMake și un compilator C++ instalate pe sistem:

- **Ubuntu/Debian**: `sudo apt install cmake build-essential`
- **macOS**: `brew install cmake`
- **Windows**: instalează [CMake](https://cmake.org/download/) și
  Visual Studio Build Tools, sau folosește `conda install -c conda-forge dlib`
  dacă `pip install dlib` dă erori.

## Utilizare

```bash
python detect_person.py --video clip.mp4 --reference poza_persoana.jpg
```

### Link-uri Kick (sau alte site-uri video)

`--video` poate fi și un link, nu doar un fișier local — de exemplu un VOD
de pe Kick:

```bash
python detect_person.py \
  --video https://kick.com/stefulici/videos/01a01dd6-9408-7a87-b533-6aa7bcdb5788 \
  --reference poza_persoana.jpg
```

Descărcarea se face automat cu [`yt-dlp`](https://github.com/yt-dlp/yt-dlp)
(instalat din `requirements.txt`), care suportă Kick, YouTube și multe alte
site-uri. Videoclipul descărcat e salvat în `./downloads/` (poți schimba
locația cu `--cache-dir`), iar dacă rulezi din nou scriptul pe același
link, folosește copia deja descărcată în loc să descarce iar.

Kick e protejat de Cloudflare, de aceea `requirements.txt` instalează
`yt-dlp[curl-cffi]` — extensia care simulează un browser real, necesară
ca yt-dlp să poată accesa API-ul Kick fără să fie blocat.

Dacă VOD-ul e privat/doar pentru abonați, poți da un fișier de cookies
exportat din browser cu `--cookies-file cookies.txt`.

Poți da mai multe poze de referință (unghiuri/lumini diferite) pentru
acuratețe mai bună:

```bash
python detect_person.py --video clip.mp4 --reference poza1.jpg poza2.jpg poza3.jpg
```

Opțiuni utile:

| Opțiune | Descriere | Implicit |
|---|---|---|
| `--tolerance` | cât de strict e matching-ul (mai mic = mai strict) | `0.6` |
| `--frame-skip` | analizează doar 1 din N frame-uri (viteză) | `5` |
| `--scale` | factor de micșorare a frame-ului la analiză (viteză) | `0.5` |
| `--merge-gap` | secunde de toleranță pentru a uni detectări apropiate într-un singur interval | `1.0` |
| `--output-video` | salvează un video cu chenar verde pe fața detectată | - |
| `--report` | salvează intervalele găsite ca fișier JSON | - |
| `--cache-dir` | unde se salvează video-urile descărcate de la un link | `./downloads` |
| `--cookies-file` | fișier cookies.txt pentru video-uri private/doar pentru abonați | - |

Exemplu complet:

```bash
python detect_person.py \
  --video interviu.mp4 \
  --reference ion_popescu.jpg \
  --output-video interviu_adnotat.mp4 \
  --report rezultate.json
```

Rezultatul afișat arată ceva de genul:

```
Intervals where the person appears:
  00:12 - 00:18
  01:03 - 01:07
```

## Note

- Pentru videoclipuri lungi, mărește `--frame-skip` (ex: `10` sau `15`)
  ca să meargă mai repede — riscul e să rateze apariții foarte scurte.
- Dacă apar multe detectări greșite, scade `--tolerance` (ex: `0.5`).
- Dacă persoana nu e recunoscută deloc, crește `--tolerance` (ex: `0.65`)
  sau adaugă poze de referință mai clare, din față, cu lumină bună.
