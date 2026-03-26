/**
 * Reclassifies markets tagged as "OTHER" into more specific categories
 * using keyword-based pattern matching. Fast, no LLM needed.
 */

import type { MarketCategory } from '@apex/db';

const SPORTS_PATTERNS = [
  /\b(NBA|NFL|MLB|NHL|MLS|UFC|MMA|PGA|ATP|WTA|FIFA|EPL|La Liga|Bundesliga|Serie A|Champions League)\b/i,
  /\b(touchdown|home run|slam dunk|goal scored|assists|rebounds|strikeout|rushing yards)\b/i,
  /\b(win|beat|defeat|playoff|championship|Super Bowl|World Series|Stanley Cup|finals)\b/i,
  /\b(PPG|points\+|rebounds\+|assists\+|yards\+|TDs\+|goals\+)\b/,
  /\b(Lakers|Celtics|Warriors|Heat|Knicks|Nets|Bucks|76ers|Suns|Nuggets|Mavericks|Clippers|Bulls|Hawks|Cavaliers|Pacers|Grizzlies|Timberwolves|Pelicans|Thunder|Magic|Rockets|Pistons|Hornets|Wizards|Kings|Spurs|Raptors|Trail Blazers|Jazz)\b/i,
  /\b(Chiefs|Eagles|Bills|49ers|Ravens|Cowboys|Lions|Dolphins|Bengals|Texans|Vikings|Packers|Jets|Steelers|Chargers|Rams|Broncos|Seahawks|Falcons|Commanders|Bears|Saints|Titans|Jaguars|Raiders|Browns|Panthers|Cardinals|Colts|Buccaneers|Giants|Patriots)\b/i,
  /\b(wins by over|wins by under|over \d+\.5 points|under \d+\.5 points)\b/i,
  /\b(MVP|Rookie of the Year|Defensive Player|Coach of the Year|Cy Young|Heisman)\b/i,
  /\b(ESL|LPL|LCS|Valorant|Dota|Counter-Strike|LoL|League of Legends|esports?)\b/i,
  /\b(Oilers|Avalanche|Panthers|Jets|Senators|Devils|Kings|Wild|Blue Jackets|Ducks|Flames|Predators|Stars|Lightning|Rangers|Islanders|Bruins|Canadiens|Penguins|Capitals|Red Wings|Hurricanes|Kraken|Sabres|Blackhawks|Sharks|Flyers|Blue ?Jackets)\b/i,
  /yes .+,yes .+,yes /i, // Parlay format: "yes TeamA,yes TeamB,yes PlayerX: 20+"
];

const CRYPTO_PATTERNS = [
  /\b(Bitcoin|BTC|Ethereum|ETH|Solana|SOL|Ripple|XRP|Dogecoin|DOGE|BNB|Hyperliquid|HYPE|Cardano|ADA|Polkadot|DOT|Avalanche|AVAX|Chainlink|LINK)\b/i,
  /\b(DeFi|NFT|staking|mining|halving|blockchain|on-chain|token|airdrop|DEX|CEX)\b/i,
  /\bUp or Down\b.*\b(AM|PM)\b/i, // "BTC Up or Down - March 25, 10:00AM" format
  /\bprice (range|at|above|below)\b.*\b(BTC|ETH|SOL|crypto)\b/i,
];

const POLITICS_PATTERNS = [
  /\b(presidential pardon|pardon|impeach|indicted|Congress|Senate|House of Representatives|Supreme Court|SCOTUS)\b/i,
  /\b(election|ballot|vote|governor|senator|representative|cabinet|executive order|veto)\b/i,
  /\b(Hezbollah|Hamas|NATO|UN Security Council|sanctions|military action|invasion|ceasefire)\b/i,
];

const FINANCE_PATTERNS = [
  /\b(S&P 500|Nasdaq|Dow Jones|DJIA|stock market|Treasury|bond yield|Fed|FOMC|interest rate|CPI|inflation|GDP|unemployment|recession|tariff)\b/i,
  /\b(earnings|revenue|EPS|market cap|IPO|M&A|merger|acquisition|SEC|CFTC)\b/i,
  /\b(oil price|gold price|silver|crude|WTI|Brent|commodity)\b/i,
];

const SCIENCE_PATTERNS = [
  /\b(weather|temperature|hurricane|tornado|earthquake|tsunami|wildfire|flood|drought|snowfall|rainfall|heat wave|cold snap|storm)\b/i,
  /\b(NASA|SpaceX|rocket|launch|orbit|Mars|Moon|ISS|satellite|space)\b/i,
  /\b(COVID|pandemic|WHO|CDC|vaccine|clinical trial|FDA approval)\b/i,
  /\b(AI|artificial intelligence|GPT|language model|autonomous|robotics)\b/i,
  /\b(flight.* delay|flights? (cancelled|delayed))\b/i,
];

const CULTURE_PATTERNS = [
  /\b(Oscar|Emmy|Grammy|Golden Globe|Tony Award|Cannes|Sundance|BAFTA)\b/i,
  /\b(box office|Billboard|Spotify|Apple Music|Netflix|Disney\+|streaming)\b/i,
  /\b(Taylor Swift|Drake|Kendrick|Beyoncé|Travis Kelce|wedding|baby|pregnant|divorce|dating)\b/i,
  /\b(Coachella|Super Bowl halftime|VMAs|Met Gala|Oscars|Grammy)\b/i,
  /\b(#1 (Paid |Free )?App|App Store|Play Store|download|trending)\b/i,
  /\b(James Bond|Marvel|DC|Star Wars|sequel|franchise|movie|film|album|song|single)\b/i,
  /\b(Instagram|TikTok|Twitter|X post|YouTube|follower|subscribers|views)\b/i,
  /\b(Zelenskyy.*post|Trump.*post|Elon.*post|tweet)\b/i,
];

export function reclassifyMarket(title: string, currentCategory: string): MarketCategory {
  // Only reclassify OTHER
  if (currentCategory !== 'OTHER') return currentCategory as MarketCategory;

  // Check patterns in priority order (most specific first)
  if (SPORTS_PATTERNS.some(p => p.test(title))) return 'SPORTS';
  if (CRYPTO_PATTERNS.some(p => p.test(title))) return 'CRYPTO';
  if (FINANCE_PATTERNS.some(p => p.test(title))) return 'FINANCE';
  if (POLITICS_PATTERNS.some(p => p.test(title))) return 'POLITICS';
  if (SCIENCE_PATTERNS.some(p => p.test(title))) return 'SCIENCE';
  if (CULTURE_PATTERNS.some(p => p.test(title))) return 'CULTURE';

  return 'OTHER';
}
