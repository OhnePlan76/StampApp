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
```

`OPENAI_VISION_MODEL` ist optional. Ohne Wert nutzt die App `gpt-5.5`.

## Railway

1. Neues Railway-Projekt erstellen.
2. PostgreSQL-Service hinzufuegen.
3. Im App-Service folgende Variablen setzen:
   - `DATABASE_URL` aus Railway PostgreSQL
   - `OPENAI_API_KEY`
   - optional `OPENAI_VISION_MODEL`
4. Deploy starten.

`railway.json` baut mit `npm run build` und startet mit:

```bash
npx prisma migrate deploy && npm run start
```

## Uploads

Albumseiten und Marken-Crops werden in `public/uploads` gespeichert und als `/uploads/...` referenziert. Das erfuellt das MVP. Fuer dauerhaften Produktivbetrieb auf Railway sollte spaeter ein Volume oder Object Storage genutzt werden, weil das normale App-Dateisystem bei Deploys nicht als dauerhaftes Archiv gedacht ist.

## Bewertungslogik

- `0`: Massenware
- `1`: 0,10-1 EUR
- `2`: 1-5 EUR
- `3`: 5-25 EUR
- `4`: 25-100 EUR
- `5`: potenziell ueber 100 EUR / Expertenpruefung

Die Analyse ist eine Triage-Hilfe und ersetzt keine philatelistische Pruefung.
