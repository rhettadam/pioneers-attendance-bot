/**
 * Easy-to-say words for meeting passphrases.
 * Three random words → e.g. "coral-bridge-lantern"
 */
export const WORDS = [
  "able", "acid", "acre", "aged", "ally", "amber", "angel", "ankle", "apple", "apron",
  "arena", "arrow", "atlas", "award", "bacon", "badge", "bagel", "baker", "bamboo", "banjo",
  "basin", "beach", "beard", "beast", "berry", "bike", "bird", "blade", "blank", "blast",
  "blaze", "blend", "bliss", "block", "bloom", "blue", "board", "bold", "bolt", "bonus",
  "booth", "boost", "boots", "brace", "brain", "brake", "brand", "brave", "bread", "brick",
  "brief", "brisk", "brook", "broom", "brown", "brush", "buddy", "build", "bunch", "cabin",
  "cable", "cactus", "camel", "camp", "candy", "canoe", "cargo", "carol", "catch", "cedar",
  "cello", "chair", "chalk", "champ", "charm", "chart", "chase", "check", "cheek", "cheer",
  "chess", "chest", "chief", "chili", "chime", "choir", "chord", "cider", "claim", "clamp",
  "clash", "class", "clean", "clear", "click", "cliff", "climb", "clip", "clock", "cloud",
  "clove", "clown", "coach", "coast", "cocoa", "coin", "color", "comet", "comic", "coral",
  "cork", "corn", "couch", "count", "court", "cover", "craft", "crane", "crash", "crate",
  "crawl", "cream", "creek", "crest", "crisp", "cross", "crowd", "crown", "crumb", "crush",
  "crust", "cube", "curve", "cycle", "daily", "dairy", "daisy", "dance", "dart", "dash",
  "dawn", "delta", "demon", "denim", "depot", "desk", "dial", "diary", "dice", "digit",
  "dill", "dime", "diner", "disco", "dish", "dock", "donor", "donut", "door", "dough",
  "dove", "dozen", "draft", "drain", "drama", "drape", "dream", "dress", "drift", "drill",
  "drink", "drive", "drone", "drum", "duck", "dune", "dusk", "dust", "eagle", "earth",
  "easel", "echo", "elbow", "elder", "elite", "ember", "empty", "engine", "entry", "equal",
  "error", "essay", "event", "exact", "excel", "exile", "extra", "fable", "faint", "fairy",
  "faith", "falcon", "fancy", "farm", "feast", "fence", "fern", "ferry", "fever", "fiber",
  "field", "fifth", "fifty", "film", "final", "finch", "first", "flame", "flare", "flash",
  "flask", "fleet", "flint", "float", "flock", "flood", "floor", "flora", "flour", "flute",
  "focus", "force", "forge", "forum", "frame", "fresh", "frost", "fruit", "fudge", "galaxy",
  "garden", "garlic", "gauge", "gecko", "ghost", "giant", "ginger", "glare", "glass", "glaze",
  "gleam", "glide", "globe", "glory", "glove", "goose", "grape", "graph", "grass", "gravel",
  "green", "grill", "grove", "guard", "guest", "guide", "guitar", "habit", "harbor", "haven",
  "hazel", "heart", "hedge", "helmet", "heron", "honey", "horse", "hotel", "hover", "human",
  "humor", "hurdle", "hydra", "igloo", "image", "index", "ink", "iris", "iron", "island",
  "ivory", "jacket", "jade", "jaguar", "jelly", "jewel", "jingle", "jockey", "journal", "jungle",
  "kangaroo", "kayak", "kettle", "kiwi", "knight", "koala", "ladder", "lagoon", "lantern", "laser",
  "latch", "lava", "lawn", "layer", "leaf", "lemon", "leopard", "level", "light", "lilac",
  "lily", "linen", "lion", "lizard", "llama", "lobby", "lotus", "lunar", "magic", "magnet",
  "mango", "maple", "marble", "marsh", "matrix", "meadow", "medal", "melody", "melon", "memory",
  "meteor", "mirror", "mocha", "model", "moon", "moose", "moss", "motor", "mountain", "mouse",
  "muffin", "museum", "music", "mustard", "nacho", "nectar", "needle", "nickel", "ninja", "noble",
  "noodle", "north", "novel", "nugget", "oasis", "ocean", "olive", "onion", "opera", "orange",
  "orbit", "orchid", "otter", "oxide", "oyster", "paddle", "palace", "panda", "panel", "paper",
  "parade", "parrot", "pasta", "patch", "peach", "pearl", "pebble", "pencil", "pepper", "petal",
  "photo", "piano", "picnic", "pigeon", "pilot", "pine", "pixel", "pizza", "planet", "plank",
  "plant", "plaza", "plume", "pocket", "pollen", "pond", "poppy", "portal", "potato", "prism",
  "pulse", "pumpkin", "puzzle", "quail", "quartz", "quest", "quilt", "rabbit", "radar", "radio",
  "raven", "reef", "relay", "ridge", "river", "robot", "rocket", "rodeo", "rover", "royal",
  "ruby", "saber", "saddle", "safari", "salsa", "sandal", "satin", "scale", "scarf", "school",
  "scoop", "scout", "screen", "script", "shadow", "shark", "sheep", "shelf", "shell", "shield",
  "shore", "shovel", "silver", "skate", "skull", "slate", "slide", "slope", "smile", "smoke",
  "snail", "snake", "soccer", "solar", "spark", "sparrow", "spice", "spider", "spike", "spine",
  "spoon", "spring", "sprite", "squad", "stack", "stage", "stamp", "star", "steam", "steel",
  "stone", "storm", "stove", "straw", "stream", "street", "studio", "sugar", "summit", "sunset",
  "sushi", "swan", "swift", "sword", "syrup", "table", "tango", "target", "tempo", "tiger",
  "timber", "toast", "tomato", "torch", "tower", "trail", "train", "travel", "treasure", "tree",
  "tribe", "trophy", "trout", "tulip", "tunnel", "turtle", "twilight", "umbrella", "valley", "vapor",
  "velvet", "vessel", "violet", "violin", "vista", "vocal", "volcano", "voyage", "wagon", "walnut",
  "walrus", "waltz", "water", "wave", "whale", "wheat", "wheel", "willow", "window", "winter",
  "wizard", "wolf", "wonder", "wood", "woven", "yacht", "yellow", "yoga", "yogurt", "zebra",
  "zenith", "zinc", "zipper", "zodiac", "zone",
];

export function generatePassphrase(wordCount = 3) {
  const picks = [];
  for (let i = 0; i < wordCount; i++) {
    const index = Math.floor(Math.random() * WORDS.length);
    picks.push(WORDS[index]);
  }
  return picks.join("-");
}
