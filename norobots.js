// Yhteinen hakukone- ja crawler-esto kaikille Render-palveluille.
// 1) /robots.txt kieltää kaiken kaikilta (myös nimetyiltä hakukoneilta ja tekoälyrobottien keräimiltä)
// 2) X-Robots-Tag-otsake jokaiseen vastaukseen: ei indeksointia, ei linkkien seurantaa, ei välimuistikopioita
// Kutsutaan heti express()-luonnin jälkeen, ennen staattisia tiedostoja ja kirjautumista.
const BOTS = ['*', 'Googlebot', 'Googlebot-Image', 'Google-Extended', 'Bingbot', 'Slurp', 'DuckDuckBot', 'Baiduspider', 'YandexBot', 'Applebot', 'Applebot-Extended',
  'GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'CCBot', 'ClaudeBot', 'Claude-Web', 'Claude-SearchBot', 'Claude-User', 'anthropic-ai', 'PerplexityBot', 'Perplexity-User',
  'Bytespider', 'Amazonbot', 'FacebookBot', 'meta-externalagent', 'meta-externalfetcher', 'cohere-ai', 'Diffbot', 'Omgilibot', 'ImagesiftBot', 'DuckAssistBot',
  'MistralAI-User', 'YouBot', 'AhrefsBot', 'SemrushBot', 'MJ12bot', 'DotBot', 'PetalBot', 'Timpibot'];
const ROBOTS = BOTS.map(b => 'User-agent: ' + b + '\nDisallow: /\n').join('\n');
const TAG = 'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai';
module.exports = function noRobots(app) {
  app.use((req, res, next) => { res.set('X-Robots-Tag', TAG); next(); });
  app.get('/robots.txt', (req, res) => res.type('text/plain').set('Cache-Control', 'public, max-age=86400').send(ROBOTS));
};
