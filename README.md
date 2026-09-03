# Release Top Tracks

Statische GitHub Pages-app die per opgegeven Spotify-release de N populairste tracks selecteert en alles in één playlist zet.

## Bestanden uploaden

Upload deze bestanden naar de hoofdmap van een nieuwe GitHub-repository:

- `index.html`
- `style.css`
- `app.js`
- `config.js`
- `README.md`

## Spotify instellen

1. Open <https://developer.spotify.com/dashboard> en maak een nieuwe app.
2. Kies **Web API**.
3. Voeg bij **Redirect URIs** exact je GitHub Pages-adres toe, bijvoorbeeld:
   `https://martijnverlaak.github.io/release-top-tracks/`
4. Open `config.js` en vervang `VUL_HIER_JE_CLIENT_ID_IN` door je Client ID.
5. Gebruik nooit een Client Secret in deze publieke repository.

## GitHub Pages activeren

1. Open in de repository **Settings > Pages**.
2. Kies bij **Build and deployment**: **Deploy from a branch**.
3. Kies branch **main** en map **/(root)**.
4. Sla op en open na de deployment het getoonde GitHub Pages-adres.

## Gebruik

Voer één release per regel in:

    Clouds Indoor - Go Sleep
    Artist - Album of EP

Je kunt ook rechtstreeks een Spotify-albumlink op een afzonderlijke regel plakken. Dat is het nauwkeurigst.

## Werking en beperkingen

- De app gebruikt OAuth Authorization Code with PKCE en heeft geen backend of Client Secret nodig.
- Per tekstregel gebeurt normaal één Spotify-zoekopdracht.
- Tracks worden gerangschikt op de `popularity`-score die Spotify in trackresultaten terugstuurt. Dit is geen openbaar aantal streams.
- Bij identieke titels gebruikt de app eerst ISRC en daarna artiest plus genormaliseerde titel om dubbels te vermijden.
- Een albumlink is betrouwbaarder bij releases met dezelfde naam, deluxe-edities of spellingvarianten.
- Als Spotify voor jouw nieuwe app bepaalde trackmetadata beperkt, kan verwerking via albumlink mislukken. Zoeken via `Artiest - Release` blijft dan de voorkeursroute.
