# Personality Discovery

Independent MBTI-style assessment powered by the free Personality.fyi API.

## Deploy on Northflank
1. Upload all files, keeping the `public/` directory structure, to a GitHub repository.
2. Create a Northflank service connected to the repository.
3. Select **Dockerfile** build; Dockerfile location `/Dockerfile`; build context `/`.
4. Add a **public HTTP port 3000**. No API key or environment variables are required.
5. Deploy and visit your public service URL.

## Run locally
`npm install && npm start` then open http://localhost:3000

## Endpoints
- GET `/api/questions` (proxies `/api/v1/test/items`)
- POST `/api/score` (proxies `/api/v1/test/score` then fetches type profile)
- GET `/health`

The 32 answers must be integers 1–5 in the order supplied by the API.

## Notes
- Results live only in the visitor's browser session. No database or account needed.
- No Stripe integration is included yet; the test and results are free.
- Requires the upstream Personality.fyi service to be available.
- Review exact questionnaire commercial licensing independently before accepting payments; the provider describes its data as CC0, but other publications of OEJTS have different licensing claims.
- Not an official MBTI assessment, medical tool, or employment screening instrument.
