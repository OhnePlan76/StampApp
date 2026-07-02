# stamp-value-app

Railway-taugliche Next.js-App zur Erfassung grosser Briefmarkensammlungen.

Die Webapp ist die mobile Erfassungs- und Ergebnisoberflaeche. Sie legt Alben,
Albumseiten, Einzelmarken-Ausnahmen und Belege an, speichert Bilder in R2 und
zeigt spaeter importierte Rechercheergebnisse an. Die eigentliche KI-Bewertung
laeuft nicht mehr in der Webapp.

## Stack

- Next.js App Router mit TypeScript
- Prisma und PostgreSQL
- Cloudflare R2 fuer Bildablage
- Lokale Review-Oberflaeche fuer Markierungen und ChatGPT-Pakete
- Railway Deployment

## Zielworkflow

1. In der Webapp Album anlegen.
2. Albumseiten, Belege oder einzelne Ausnahmebilder fotografieren.
3. Bilder werden in Railway/PostgreSQL referenziert und in Cloudflare R2 gespeichert.
4. Lokal die Review-Oberflaeche starten.
5. Auffaellige Bereiche markieren und als `gesamte Seite`, `Einzelmarke` oder `Beleg` kategorisieren.
6. Daraus ein ZIP-Paket mit Bildern, Ausschnitten, Metadaten und Prompt erstellen.
7. ZIP und Prompt in ChatGPT analysieren lassen.
8. ChatGPT-Ergebnis ueber die lokale Review-/Importstrecke wieder in DB und Frontend einspielen.

Ollama ist nur noch optional fuer lokale Textvorfuellung/OCR-aehnliche Hinweise
in der Review-Oberflaeche gedacht. Es ist nicht mehr die Hauptanalyse.

## Lokal starten

```bash
npm install
npx prisma migrate dev
npm run dev
```

Die App laeuft danach lokal unter `http://localhost:3000`.

## ENV Variablen

Lokal eine `.env` anlegen:

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"

# Optional fuer lokale Textvorfuellung in der Review-Oberflaeche.
OLLAMA_VISION_MODEL="llava:7b"
OLLAMA_SESSION_KEEP_ALIVE="30m"

R2_ACCOUNT_ID="cloudflare-account-id"
R2_ENDPOINT="https://cloudflare-account-id.r2.cloudflarestorage.com"
R2_BUCKET_NAME="stampapp"
R2_ACCESS_KEY_ID="r2-access-key-id"
R2_SECRET_ACCESS_KEY="r2-secret-access-key"
R2_PUBLIC_BASE_URL="https://pub-....r2.dev"
```

Die R2-Variablen sind optional. Ohne R2 speichert die App lokal in
`public/uploads`. Auf Railway sollten R2-Variablen gesetzt sein.

## Railway

1. Neues Railway-Projekt erstellen.
2. PostgreSQL-Service hinzufuegen.
3. Im App-Service folgende Variablen setzen:
   - `DATABASE_URL` aus Railway PostgreSQL
   - `R2_ACCOUNT_ID`
   - optional `R2_ENDPOINT`
   - `R2_BUCKET_NAME`
   - `R2_ACCESS_KEY_ID`
   - `R2_SECRET_ACCESS_KEY`
   - optional `R2_PUBLIC_BASE_URL`
4. Deploy starten.

`railway.json` baut mit `npm run build` und startet mit:

```bash
npx prisma migrate deploy && npm run start
```

## Uploads

Wenn R2 konfiguriert ist, werden Albumfotos, Albumseiten, Belege und Marken-Crops in
Cloudflare R2 gespeichert. Ohne R2 fallen Uploads lokal auf `public/uploads`
zurueck. Fuer Railway-Produktivbetrieb ist R2 empfohlen, weil das normale
App-Dateisystem bei Deploys nicht als dauerhaftes Archiv gedacht ist.

R2-Free-Tier-Planung:

- Standard Storage verwenden, nicht Infrequent Access.
- Kamera-Fotos werden clientseitig verkleinert und komprimiert.
- Pro Foto wird ein Objekt geschrieben.
- `R2_PUBLIC_BASE_URL` nutzt direkte Bildauslieferung, falls der Bucket
  oeffentlich lesbar ist. Ohne Public URL liefert die App Bilder ueber
  `/api/uploads/...` aus.
- `R2_ENDPOINT` ist optional. Standard ist
  `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. Fuer EU-Buckets muss
  `https://<R2_ACCOUNT_ID>.eu.r2.cloudflarestorage.com` gesetzt werden.
- Cloudflare R2 Free Tier umfasst aktuell 10 GB-month Storage, 1 Mio. Class-A-
  Operationen und 10 Mio. Class-B-Operationen pro Monat.

## Lokale Sichtung

Die lokale Review-Oberflaeche arbeitet gegen dieselbe Datenbank und dieselben
Bild-URLs. Sie ist der Arbeitsplatz fuer Markierungen, Paketexport und Import.

Lokale Review-Oberflaeche fuer Windows starten:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start-analysis-review.ps1
```

Die Review-Oberflaeche laeuft unter `http://127.0.0.1:5791`.

Alternativ per Windows-Starter:

```powershell
.\StampDetailAnalyse.exe
```

Die Review-Oberflaeche speichert keine neuen Bilddaten zurueck. Gespeichert
werden Markierungen, Status, Notizen, Review-Metadaten und importierte
Recherchekandidaten in den vorhandenen DB-Feldern.

## ChatGPT-Import

Bestehende lokale ChatGPT-Pakete koennen mit dem Importskript wieder in die App
eingespielt werden:

```bash
npm run import:chatgpt
```

Zum Pruefen ohne DB-Schreibzugriff:

```bash
npm run import:chatgpt -- --dry-run
```

Die importierten Kandidaten erscheinen anschliessend in der Album-Sichtung und
in den Recherchekandidaten der Sammlung.

## Bewertungslogik

- `0`: Massenware
- `1`: 0,10-1 EUR
- `2`: 1-5 EUR
- `3`: 5-25 EUR
- `4`: 25-100 EUR
- `5`: potenziell ueber 100 EUR / Expertenpruefung

Die App ist eine Erfassungs- und Triage-Hilfe und ersetzt keine
philatelistische Pruefung.
