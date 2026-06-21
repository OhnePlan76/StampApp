# stamp-value-app

Railway-taugliche Next.js-App zur schnellen Erfassung und groben Bewertung grosser Briefmarkensammlungen.

## Stack

- Next.js App Router mit TypeScript
- Prisma und PostgreSQL
- OpenAI Responses API mit Vision-Eingabe
- Railway Deployment

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
OPENAI_API_KEY="sk-..."
OPENAI_VISION_MODEL="gpt-5.5"

R2_ACCOUNT_ID="cloudflare-account-id"
R2_BUCKET_NAME="stampapp"
R2_ACCESS_KEY_ID="r2-access-key-id"
R2_SECRET_ACCESS_KEY="r2-secret-access-key"
R2_PUBLIC_BASE_URL="https://pub-....r2.dev"
```

`OPENAI_VISION_MODEL` ist optional. Ohne Wert nutzt die App `gpt-5.5`.
Die R2-Variablen sind optional. Ohne R2 speichert die App lokal in
`public/uploads`. Auf Railway sollten R2-Variablen gesetzt sein.

## Railway

1. Neues Railway-Projekt erstellen.
2. PostgreSQL-Service hinzufuegen.
3. Im App-Service folgende Variablen setzen:
   - `DATABASE_URL` aus Railway PostgreSQL
   - `OPENAI_API_KEY`
   - optional `OPENAI_VISION_MODEL`
   - `R2_ACCOUNT_ID`
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

Wenn R2 konfiguriert ist, werden Albumfotos, Albumseiten und Marken-Crops in
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
- Cloudflare R2 Free Tier umfasst aktuell 10 GB-month Storage, 1 Mio. Class-A-
  Operationen und 10 Mio. Class-B-Operationen pro Monat.

## Bewertungslogik

- `0`: Massenware
- `1`: 0,10-1 EUR
- `2`: 1-5 EUR
- `3`: 5-25 EUR
- `4`: 25-100 EUR
- `5`: potenziell ueber 100 EUR / Expertenpruefung

Die Analyse ist eine Triage-Hilfe und ersetzt keine philatelistische Pruefung.
