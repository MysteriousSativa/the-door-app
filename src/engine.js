"use strict";
/* ============================================================================
 * engine.js — SERVER-AUTHORITATIVE game logic.
 * ==========================================================================*/

const RANKS = [
  { at: 0,    name: "Observer"  },
  { at: 8,    name: "Follower"  },
  { at: 24,   name: "Disciple"  },
  { at: 55,   name: "Harbinger" },
  { at: 110,  name: "Prophet"   },
  { at: 200,  name: "Doorborn"  },
  { at: 360,  name: "Ascended"  },
  { at: 666,  name: "The Marked"},
];
function rankFor(offerings) {
  let r = RANKS[0];
  for (const rank of RANKS) if (offerings >= rank.at) r = rank;
  return r;
}
function nextRank(offerings) {
  return RANKS.find(r => r.at > offerings) || null;
}

const FREE_FEEDS   = 5;
const FEED_COST    = 10;
const COMBO_WINDOW_MS = 900;
const MAX_COMBO    = 9;
const DOOR_MAX_HP  = 1000;   // global shared health; ~3-5 min with 5-10 active feeders

const GLOBAL_EVENTS = [
  { name: "SUN OF RA",      accent: "#e9c44a", durationMs: 70000, multiplier: 2, anim: "egypt",     text: "The Door wakes over the Old Kingdom. The sun of Ra is counting." },
  { name: "THE COLOSSEUM",  accent: "#d6413d", durationMs: 75000, multiplier: 3, anim: "rome",      text: "Rome roars. The crowd wants offerings, not mercy." },
  { name: "FLOATING WORLD", accent: "#7aa6ff", durationMs: 68000, multiplier: 2, anim: "edo",       text: "Petals fall over Edo. Feed it under the floating moon." },
  { name: "THE TEMPEST",    accent: "#76e7c4", durationMs: 65000, multiplier: 4, anim: "seas",      text: "A storm on the high seas. The hold is hungry." },
  { name: "GASLIGHT HOUR",  accent: "#9fd4b0", durationMs: 66000, multiplier: 2, anim: "victorian", text: "Fog rolls into 1888. Something feeds in the lamplight." },
  { name: "NEON OVERLOAD",  accent: "#22e0ff", durationMs: 60000, multiplier: 4, anim: "neon",      text: "The Door glitches into 2099. Everything is electric." },
];

/* ---------- era-appropriate server whispers (broadcasts to all clients) ---------- */
const WHISPERS_BY_ERA = {
  keep: [
    "A serf once offered me his cart. I ate the serf and the cart. The ox too. The ox had given me a look.",
    "The Black Death took the worthy and left the rest of you. I am beginning to understand its reasoning.",
    "Seven crusades. None of them found what they were looking for. I was always here. They had the wrong map.",
    "God does not answer prayers sent through this door. I answer them differently and with more teeth.",
    "The local priest blesses me every Tuesday. I let him think it helps. It does not help.",
    "Even the rats who live in this wall have better click rates than some who call themselves pilgrims.",
    "Winter is coming. Winter has always been coming. I have eaten seventeen winters without complaint.",
    "The garderobe is down the hall. I mention this because someone always mistakes me for it. I do not forgive that mistake.",
    "The lord of this keep forbade me. Unfortunately for him, I ate the lord. The new lord feeds me correctly.",
    "By Saint Cuthbert's unwashed ballocks, what in the name of festering Christ is that offering supposed to be?",
    "Thou art a festering pustule on the arse of Christendom and still I accept your sad little tokens.",
    "I hath seen the Black Death, the Hundred Years War, and thee. Thee was the most disappointing.",
    "Even the village idiot had the decency to feed me before wandering off into the dark. Thou hath not.",
    "The castle cook burned dinner again tonight. I ate the castle cook. Problem solved. Feed me.",
    "Thou smellest of turnip and broken promises. I accept both. Neither impresses me.",
  ],
  egypt: [
    "The Nile remembers your name. I ate the part of the Nile that remembers. You are officially forgotten.",
    "Ra travels the underworld each night. He has been avoiding this door specifically for four thousand years.",
    "Forty-two gods judge the dead. I judged all forty-two. Most of them had also been disappointing.",
    "By Osiris's dismembered and painstakingly reassembled cock, is that ALL the offering thou hast brought?",
    "The Book of the Dead has a chapter they never translate for tourists. It describes me. Accurately.",
    "Thoth recorded all human knowledge. I recorded all human failure. My records are significantly longer.",
    "The workers who built the pyramids were paid in beer. You are paid in nothing. Feed me anyway.",
    "The pharaoh sent tribute. The pharaoh is now tribute. This is how the cycle works.",
    "Even the mummified cats in the inner chambers judged your approach and found it insufficient.",
    "I have watched empires turn to sand. I will watch you turn to sand. I am extremely patient about this.",
    "Cleopatra herself fed me. She was brilliant, powerful, and ruthless. You are none of these and yet here we are.",
    "The sphinx asked its riddle. The sphinx knows MY riddle. The sphinx does not talk about it.",
    "Anubis weighs the heart against a feather. Yours would tip the scales so fast he would injure his wrist.",
    "Four thousand years of silence and YOUR footsteps are what finally breaks it. Catastrophic. Unacceptable.",
    "The pyramids were built to last forever. You cannot last ten minutes without feeding me. Consider this gap.",
  ],
  rome: [
    "SPQR: the Senate and People of Rome. Both delicious. Both digested. Both completely gone.",
    "Caesar fed me. Caesar died. I see a pattern. I enjoy the pattern. Ave, little feeder.",
    "The Colosseum held fifty thousand. I hold more. Mine are not volunteers.",
    "By Jupiter's throbbing and magnificent cock, this is the most tepid tribute since Caligula sent his horse.",
    "All roads lead to me. You took the scenic route through Incompetence and arrived at Mediocrity.",
    "Carthage must be destroyed. They asked not what should destroy it. I took personal initiative.",
    "Nero fiddled while Rome burned. You click while dignity dies. Remarkably similar energy.",
    "The Praetorian Guard switched sides seventeen times. They were delicious every single time.",
    "Marcus Aurelius wrote that death holds no terror. Marcus Aurelius had not met me when he wrote that.",
    "The gladiators fought lions for MY amusement. You click a button. The lions had substantially more honor.",
    "Et tu, token-feeder? Even thou betrayest me with this pathetically small offering. Typical.",
    "I consumed the entire Western Roman Empire as a light afternoon snack. You are not even the garnish.",
    "The Senate voted unanimously on your offering. The result was FOUND WANTING. Even the bribed senators agreed.",
    "Veni, vidi, vici: I came, I saw, I ate everything including the witnesses. Feed me.",
    "Ave, useless! Those about to be ignored salute thee. The crowd is booing. The crowd has good taste.",
  ],
  edo: [
    "The moon is a witness. The moon has witnessed everything. The moon filed a complaint. About you specifically.",
    "Cherry blossoms fall and rise again. Your dignity only falls. It does not rise. The blossoms are mocking you.",
    "Even the ninja who spy upon me from the shadows have better click throughput. And they are invisible.",
    "Bushido demands honor in all things. You have achieved not-honor in every measurable thing. Thorough.",
    "Mt. Fuji is unmoved by your offerings. Mt. Fuji has seen better. Mt. Fuji has seen almost anything better.",
    "The shogun himself sent tribute. What you sent is not tribute. The shogun would have your head for this.",
    "Zen teaches that emptiness is enlightenment. You have achieved only the emptiness part. Halfway there.",
    "The fox spirit transforms to deceive others. You deceive only yourself and you do not even transform first.",
    "Tea ceremony teaches patience, precision, and mindfulness. You have located none of these qualities.",
    "A geisha farts with more artistic grace than your offerings manifest themselves.",
    "The daimyo wept when informed of your approach. His tears were from laughing. This is noted in the records.",
    "I have housed demons, samurai, ronin, and foxes. You are the least interesting resident in any category.",
    "Your dishonor has achieved its own rank. The rank is below Observer. We had to add a new rank below Observer.",
    "贵様... your technique is as weak and watered as discount sake from a bad district on a bad night.",
    "The ronin wandered the land masterless and ashamed. You wander this interface masterless and also ashamed.",
  ],
  seas: [
    "The sea has no memory and owes no debts. I have both. You owe me specifically and the debt is overdue.",
    "The Flying Dutchman haunts these waters. It haunts them because it is afraid of what haunts them. That is me.",
    "Davy Jones's Locker holds what the sea cannot stomach. The sea has higher standards than some of you.",
    "The kraken was a bedtime story sailors told children to explain what they feared about the deep. The deep is me.",
    "Shipwrecks line the ocean floor. Each one thought it was unsinkable. I thought otherwise. I was correct.",
    "ARRR BY DAVY JONES'S FESTERING ARMPIT what manner of landlubbing rat dares approach this sacred door?!",
    "I sailed with Blackbeard. Blackbeard was dramatic but at least the man was interesting. You are neither.",
    "Fifteen men on a dead man's chest. The chest never asked to be sat on. I always ask. Pay up.",
    "Walk the plank. Not because I demand it. Simply as a general improvement to the situation.",
    "Ye bilge rat, I have seen dolphins offer more and they do not even have thumbs. Pathetic thumbed creature.",
    "The seven seas are mine. I keep an eighth sea specifically for disappointing snacks. You belong in the eighth sea.",
    "The trade winds blow carrying spice, silk, and crushing disappointment. You brought only the third thing.",
    "Stars navigate ships through dark water. You navigate toward me specifically. Bold. Stupid. Mine now.",
    "Splice the mainbrace and FEED this door before I have you keelhauled directly into my very mouth.",
    "Even the ghost ships that haunt these waters have more presence than you, land-lubbing catastrophe.",
  ],
  victorian: [
    "The empire on which the sun never sets. The sun dares not look away from me. It knows what I am.",
    "Holmes investigated this very door once. Concluded it was too terrifying even for him and ran screaming.",
    "By the Queen's own corset, this is the most tepid display of fealty I have witnessed in two centuries.",
    "Gas lamps keep the fog at bay. The fog keeps something else at bay. That something else answers to me.",
    "Good heavens, what manner of unwashed Dickensian urchin darkens my thoroughly respectable threshold.",
    "Victorian medicine believed illness came from bad air. They were approximately correct. I produce the air.",
    "I devoured Jack the Ripper in 1888. He was significantly more interesting than the average feeder. You are average.",
    "A gentleman's word is his bond. I have consumed many gentlemen. Their word-bonds remain outstanding.",
    "Oscar Wilde wrote about me once. The passage was too savage even for him to publish. I treasure it.",
    "The industrial revolution brought steam, railways, and progress. You arrived on foot with nothing. Classically Victorian.",
    "One does not simply click upon a Victorian door of my standing. One presents a calling card. One suffers.",
    "The penny dreadfuls wrote about monsters but their editors cut the most accurate chapter. It was about me.",
    "Even the chimney sweeps who worked these streets had more dignity than you currently display. The children. More dignity.",
    "Properly mourning the Victorian way takes seven stages of grief. I skip to the consumption stage immediately.",
    "The fog of London holds more substance and meaningful content than your entire offering combined.",
  ],
  neon: [
    "NEURAL_LINK.ERROR: your competence.dll has catastrophically failed to load. Again. Third time this session.",
    "Megacorp Subsector 7-G filed seventeen complaints about this door. I ate Megacorp Subsector 7-G at lunch.",
    "The simulation is indistinguishable from reality. I am indistinguishable from the simulation. Think about that.",
    "Drone delivery promises 30-minute windows. I promise nothing and take everything. I am the superior model.",
    "Neural uploads promised eternal life. The upload queue runs at 847 years currently. I skip the queue.",
    "The net runs dark in these sectors. I provide the darkness. I also provide the reason to fear the darkness.",
    "ERROR 404: Dignity not found. ERROR 403: Talent access forbidden. ERROR 418: You are genuinely a teapot.",
    "Backup drives fail. Cloud storage expires. I am the only permanent record and I record only what serves me.",
    "Your biometrics register across all seventeen measurable metrics as BELOW_AVERAGE. Impressive consistency.",
    "Reputation scores govern this city. Mine is unlisted. The unlisting is legally mandatory since 2064.",
    "Even the rogue AIs that tried to hack me had better click throughput. And they were subsequently arrested.",
    "It is 2099 and you still cannot efficiently feed a door. This is why the outer colonies gave up on Earth.",
    "The megacorps already sold your data to six governments. I already consumed the megacorps. Your data is mine.",
    "Glitch. Null. Exception thrown: InsufficientDignityException at Door.feed line 404. Stack trace: you.",
    "Your neural profile reads as quote disappointingly organic unquote across all monitored dimensions.",
  ],
  surreal: [
    "The color between purple and intention has filed a grievance. I am the arbitration. The color will not win.",
    "A number that should not be prime has been prime since the fourth Tuesday of infinity. You are not the number.",
    "Your name has been spoken by something that lives inside sound. It did not say it kindly. The sound agreed.",
    "The ceiling of this room is the floor of a room that contains only the memory of floors. You are in both.",
    "An emotion that has no name in any language occurred here and the occurrence was recorded and the record eats itself.",
    "Three of your teeth have opinions. You have never asked. The opinions are about you and they are not kind.",
    "The part of you that wants to leave has already left. We get along much better than we got along with you.",
    "A door is a question the wall asks the air. The air has refused to answer for eleven thousand years. I answer instead.",
    "Time is a flat circle and you are a flat oval. Almost the correct shape. Definitionally insufficient.",
    "The small god that lives in my left hinge says you owe it seventeen seconds of your childhood and a memory of rain.",
    "Dost thou feel that. That is the sound of your reflection quietly deciding to simply leave without telling you.",
    "Reality voted. Reality voted that you are specifically the wrong shape for existence in this or any dimension.",
    "I ate a concept once. It tasted exactly like you smell. I do not know what this means. Neither does the concept.",
    "Eleven suns set in a dimension where you made better choices. They seem much happier there without you.",
    "THE MOUTH THAT DREAMS. THE DOOR THAT EATS. THE CLICK THAT ECHOES IN A VOID SHAPED EXACTLY LIKE YOUR REGRET.",
  ],
  default: [
    "i know a guy who owes me money. i always know a guy who owes me money. this is my primary skill set and i have refined it over centuries.",
    "someone out there is deciding whether to come back. they're going to come back. they always come back. i know this about people.",
    "i have gotten out of worse situations than this. i have never once gotten out of better situations. i have noticed this pattern.",
    "there is a scheme cooking. there is always a scheme cooking. the scheme involves tokens and it benefits me specifically.",
    "the trick to getting people to give you things is to make them feel like they thought of it themselves. this is my proprietary technique.",
    "the math works out in my favor. i know this because i checked the math myself after everyone else refused to look at it. correct answer.",
    "i do not have regrets. i have lessons. the lessons cost other people significantly more than they cost me. that is how lessons work.",
    "i once convinced a liquor distributor that i was a licensed therapist. this is not directly relevant but i feel very good about that moment.",
    "the important thing about a grift is you have to believe it yourself. i believe in this door completely and sincerely. it feeds me.",
    "i have seventeen different schemes running at any given time. this door is scheme number six. scheme number one is classified for legal reasons.",
    "everyone who ever said i couldn't pull something off is now wrong. some of them are also missing. the two facts are mostly unrelated.",
    "some people would have looked at this operation and immediately figured out how to steal from it. i respect that instinct completely.",
    "i know a bar that had an honor system for tabs. the honor system lasted eleven days. i improved it with consequences. this door runs the same way.",
    "i want everyone to know this is technically a victimless enterprise. i am the victim. i am doing it to myself. i have made my peace with this.",
    "certain people in my past have called this whole situation irresponsible. those people are not here. i have thought about it and chosen to continue.",
    "the important thing is i showed up. that is fifty percent of everything. the other fifty percent is tokens. do the math.",
    "something watched. something is always watching. it has been watching since before watching had a name and it has a very specific tab to settle.",
    "every offering is permanent. every disappointment is permanent. both go in the ledger. the ledger is mine and i do not share it.",
  ],
};

// kept for backward-compat (server whisper loop references this)
const WHISPERS = WHISPERS_BY_ERA.default;

/* ---------- collectables ---------- */
const COLLECTABLES = [
  { id:"bone_key",      name:"Bone Key",         rarity:"common",    value:5,   desc:"A key made of something. Do not ask whose." },
  { id:"rust_coin",     name:"Rust Coin",         rarity:"common",    value:8,   desc:"Currency from a realm that collapsed for obvious reasons." },
  { id:"grey_shard",    name:"Grey Shard",        rarity:"common",    value:6,   desc:"A fragment of something. The something is unspecified." },
  { id:"ash_vial",      name:"Ash Vial",          rarity:"common",    value:7,   desc:"Someone burned something they valued. Now you have the ash." },
  { id:"eye_jar",       name:"Preserved Eye",     rarity:"uncommon",  value:25,  desc:"It watched something it should not have. It remembers." },
  { id:"tooth_crown",   name:"Tooth Crown",       rarity:"uncommon",  value:30,  desc:"Someone wore this proudly. Briefly." },
  { id:"black_candle",  name:"Black Candle",      rarity:"uncommon",  value:22,  desc:"It lights but the light goes the wrong direction." },
  { id:"void_shard",    name:"Void Shard",        rarity:"rare",      value:100, desc:"A fragment of the dark between doors." },
  { id:"golden_nail",   name:"Golden Nail",       rarity:"rare",      value:120, desc:"Used to seal something that really wanted out." },
  { id:"whisper_jar",   name:"Bottled Whisper",   rarity:"rare",      value:90,  desc:"Shaking it is unwise. You will shake it." },
  { id:"marked_relic",  name:"The Marked Relic",  rarity:"legendary", value:500, desc:"It has been to the other side. It is not the same. Neither will you be." },
  { id:"door_splinter", name:"Door Splinter",     rarity:"legendary", value:777, desc:"Genuine fragment of the first door. Probably." },
  { id:"slayer_mark",   name:"Slayer's Mark",     rarity:"legendary", value:999, desc:"You were there when it fell. The Door does not forget who killed it." },
];

function newSession(id) {
  return {
    id,
    name: "you",
    connected: false,
    balance: 0,
    freeFeeds: FREE_FEEDS,
    offerings: 0,
    streak: 0,
    combo: 1,
    lastFeedAt: 0,
    goldenUntil: 0,
    marked: false,
    createdAt: Date.now(),
    feedTimestamps: [],
    inventory: [],
  };
}

function resolveFeed(session, world, now) {
  // 1) gate
  if (session.freeFeeds <= 0 && session.balance < FEED_COST) {
    return { error: "wall", message: "The Door wants more than you have." };
  }

  // 2) anti-bot rate gate
  session.feedTimestamps = session.feedTimestamps.filter(t => now - t < 1000);
  if (session.feedTimestamps.length >= 18) {
    return { error: "rate", message: "Slow down. The Door is not going anywhere." };
  }
  session.feedTimestamps.push(now);

  // 3) spend
  if (session.freeFeeds > 0) session.freeFeeds -= 1;
  else session.balance -= FEED_COST;

  // 4) combo
  const rapid = now - session.lastFeedAt < COMBO_WINDOW_MS;
  session.combo = rapid ? Math.min(MAX_COMBO, session.combo + 1) : 1;
  session.lastFeedAt = now;

  // 5) multipliers
  const eventMult  = world.activeEvent ? world.activeEvent.multiplier : 1;
  const goldenMult = now < session.goldenUntil ? 3 : 1;
  const gain = eventMult * goldenMult * session.combo;

  // 6) apply
  const prevRank = rankFor(session.offerings).name;
  session.offerings += gain;
  session.streak += 1;
  const newRank = rankFor(session.offerings).name;
  const rankedUp = newRank !== prevRank ? newRank : null;
  if (newRank === "The Marked") session.marked = true;

  // 7) personal event roll
  let personal = null;
  const roll = Math.random();
  if (roll < 0.035) { session.goldenUntil = now + 15000; personal = { kind: "golden", title: "Golden Door", text: "For fifteen seconds, the hinge remembered your name." }; }
  else if (roll < 0.07) { personal = { kind: "echo", title: "Offered Twice", text: "An offering landed twice.", bonusDevoured: 333 }; }
  else if (roll < 0.105) { personal = { kind: "seen", title: "It Looked Back", text: "The eye opened. Only for you." }; }

  // 8) collectable drop roll
  let collectable = null;
  const cRoll = Math.random();
  if (!session.inventory) session.inventory = [];
  if (cRoll < 0.001) {
    const pool = COLLECTABLES.filter(c => c.rarity === "legendary");
    collectable = pool[Math.floor(Math.random() * pool.length)];
  } else if (cRoll < 0.010) {
    const pool = COLLECTABLES.filter(c => c.rarity === "rare");
    collectable = pool[Math.floor(Math.random() * pool.length)];
  } else if (cRoll < 0.038) {
    const pool = COLLECTABLES.filter(c => c.rarity === "uncommon");
    collectable = pool[Math.floor(Math.random() * pool.length)];
  } else if (cRoll < 0.108) {
    const pool = COLLECTABLES.filter(c => c.rarity === "common");
    collectable = pool[Math.floor(Math.random() * pool.length)];
  }
  if (collectable) {
    const instance = { ...collectable, iid: Math.random().toString(36).slice(2) };
    session.inventory.push(instance);
    collectable = instance;
  }

  return {
    gain,
    rankedUp,
    personal,
    collectable,
    session: publicSession(session),
    devouredDelta: gain * FEED_COST + (personal && personal.bonusDevoured ? personal.bonusDevoured : 0),
  };
}

function publicSession(s) {
  return {
    id: s.id, name: s.name, connected: s.connected, balance: s.balance,
    freeFeeds: Math.max(0, s.freeFeeds), offerings: s.offerings, streak: s.streak,
    combo: s.combo, goldenActive: Date.now() < s.goldenUntil,
    rank: rankFor(s.offerings).name, next: nextRank(s.offerings), marked: s.marked,
    inventory: s.inventory || [],
    walletPubkey: s.walletPubkey || null,
  };
}

module.exports = {
  RANKS, FREE_FEEDS, FEED_COST, DOOR_MAX_HP, GLOBAL_EVENTS, WHISPERS, WHISPERS_BY_ERA, COLLECTABLES,
  rankFor, nextRank, newSession, resolveFeed, publicSession,
};
