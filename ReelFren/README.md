# ReelFren (aplicatie Android personala)

WebView pentru https://reelfren.net — pe tot ecranul, video fullscreen, pop-up-uri si linkuri externe blocate.

In fullscreen, atinge ecranul: apar butoanele **-10s / +10s / -1m / +1m** si **Episodul urmator**
(cauta butonul de "urmatorul episod" din pagina sau din player si il apasa).

Pe paginile cu liste apare butonul **Filtru** (jos-dreapta): sortare dupa episoade / nota,
interval de episoade, platforma si cuvinte in titlu. Setarile se pastreaza. Cod: `app/src/main/assets/filter.js`.

## Cum iei APK-ul
1. Orice push in folderul `ReelFren/` porneste workflow-ul **Build ReelFren APK** (sau il pornesti manual din tab-ul *Actions* → *Run workflow*).
2. APK-ul apare in **Releases** (`ReelFren vN` → `ReelFren.apk`) — deschide pagina de pe telefon si descarca-l.
3. Pe telefon permite "Instalare aplicatii necunoscute" pentru browser si instaleaza.

## Cheia de semnare (optional, pentru update-uri fara dezinstalare)
Fara secrets, fiecare build e semnat cu o cheie temporara noua, deci la update trebuie
sa dezinstalezi versiunea veche (pierzi login-ul din aplicatie). Ca sa eviti asta,
genereaza o data o cheie si pune-o in *Settings → Secrets and variables → Actions*:

```bash
keytool -genkeypair -keystore reelfren.keystore -alias reelfren -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=ReelFren"
base64 -w0 reelfren.keystore   # rezultatul -> secret REELFREN_KEYSTORE_BASE64
```
Parola aleasa -> secret `REELFREN_KEYSTORE_PASSWORD`. Pastreaza fisierul `.keystore` doar la tine, nu in repo.

Mareste `versionCode` in `app/build.gradle` la fiecare update.

## Personalizare
- Domenii permise / URL de start: `ALLOWED_DOMAINS` si `HOME_URL` in `MainActivity.java`
  (daca site-ul se muta pe alt domeniu, adauga-l acolo).
- Nume: `app/src/main/res/values/strings.xml`.
