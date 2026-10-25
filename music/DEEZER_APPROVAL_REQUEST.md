# Request Deezer approval for Tune Rush public music-preview trivia

**Submit to:** https://www.deezer-techservices.com/contact/ or Deezer for Business at https://deezer-business.com/  
**Applicant:** Operator of https://kalenel.nl/music/ (Tune Rush)  
**Subject:** Licensing/API approval request — 30-second Deezer previews for interactive music trivia

Hello Deezer Partnerships / Developer Relations,

I operate Tune Rush, a browser-based multiplayer music-trivia game at https://kalenel.nl/music/. A tablet acts as the game host, and participating phones act as buzzers and enter song/artist guesses. The game is browser based, includes genre and release-decade filters, and can be used by small parties (up to 24 players per room).

I would like **explicit written authorization** to use Deezer's official catalog metadata and standard approximately 30-second track previews as the audible clues in this public game. The game currently supports 0.5, 1.5, 3, 5, 8, 12 and 20-second clues. Under our proposed integration, only the host would retrieve a temporary authorized preview URL. The same 30-second preview would supply each clue, with a random starting point *inside* the excerpt (never an arbitrary offset into the full song), and the host would pause between clues or immediately on a buzz.

The implementation would stream only the original Deezer-provided preview from the authorized provider endpoint. It would not download, cache, proxy-transcode, block advertisements, bypass DRM, extract full recordings, or expose preview metadata to players before a guess. Attribution and Deezer track links can be displayed to the host and after reveal, as required. Songs would be matched to independently reviewed artist/title/genre/release-year metadata to avoid false answers.

Could you please advise:
1. Is this specific public, interactive music-trivia use of Deezer 30-second previews available under your developer API terms or a partner license? If so, what are the authorization and approval processes?
2. May previews be played, sought within the 30-second excerpt, and automatically paused/started by the host game controls? Is additional rights-holder or performance authorization necessary in the Netherlands or other regions?
3. Do you require an app ID, SDK, approved domain/origin, attribution, branding, Deezer outbound links, user login, reporting, or audience/country restrictions?
4. Are there costs or usage limits, and is there a testing/development sandbox with approved sample preview audio?
5. Would Deezer for Business / Music as a Service be the correct arrangement if standard developer permissions do not allow this activity?

The preview player and metadata matcher are currently **staged but not activated for public gameplay**, pending your response. I can provide technical documentation, a walkthrough, and a demonstration of the host game UI upon request.

Thank you.
