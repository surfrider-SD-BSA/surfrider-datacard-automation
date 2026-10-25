/**
 * Each item's label as it is PRINTED on the paper card, by template row.
 *
 * `taxonomy.ts` is generated from the chapter's Excel template and its names
 * are the template's column A, which is what the spreadsheet must keep. They
 * are not what the volunteer is holding: the card says "Other (write-in):"
 * where the template says "Other (do not write in the item name, just a
 * number)", "Other Metal Cans" where it says "Cans (other metal)", and so on.
 * Eric checked a South Ponto pile against the card in his hand (24 Oct 2026)
 * and asked for the card's words, not ours. So the checking screens show these
 * and the export never sees them.
 *
 * Transcribed from assets/reference/blank-front.png and blank-back.png. `note`
 * is the smaller second line some items have on the card.
 */
export interface CardLabel {
  readonly label: string;
  readonly note?: string;
}

const OTHER: CardLabel = { label: "Other (write-in)" };

export const CARD_LABELS: Readonly<Record<number, CardLabel>> = {
  // Front, left: Common & Priority Items
  18: { label: "Cigarette Butts" },
  19: { label: "Plastic Bottles" },
  20: { label: "Plastic Bags", note: "shopping / grocery" },
  21: { label: "Plastic Straws" },
  22: { label: "Plastic Cutlery" },
  23: { label: "Plastic Cups" },
  24: { label: "Foam Cups" },
  25: { label: "Foam Take-Out Food Containers" },
  26: { label: "Plastic Lids" },
  27: { label: "Plastic Food Wrappers" },
  28: { label: "Balloons" },
  29: { label: "Large Foam Fragments", note: "larger than a dime" },
  30: { label: "Small Foam Fragments", note: "smaller than a dime" },
  31: { label: "Large Plastic Fragments", note: "larger than a dime" },
  32: { label: "Small Plastic Fragments", note: "smaller than a dime" },
  33: { label: "Nurdles", note: "small pre production plastic pellets" },
  // Front, right: Food & Beverage Packaging
  35: { label: "Plastic 6-Pack Holders" },
  36: { label: "Plastic Bags", note: "zip-lock, trash, etc." },
  37: { label: "Plastic Bottle Caps / Rings" },
  38: { label: "Juice Boxes" },
  39: { label: "Foam Plates" },
  40: { label: "Plastic Plates" },
  41: { label: "Plastic Stirrers" },
  42: { label: "Plastic Take-Out Food Containers" },
  // Front, right: Personal Care
  44: { label: "Diapers" },
  45: { label: "Syringes" },
  46: { label: "Tampons / Applicators" },
  47: { label: "Toothbrushes" },
  48: { label: "Toothpicks / Floss" },
  49: { label: "Bandaids" },
  50: { label: "Wipes" },
  51: { label: "Single-Use Surgical Mask" },
  // Back, left: Smoking
  53: { label: "Lighters" },
  54: { label: "Cigar Tips" },
  55: { label: "Plastic Tobacco Packaging" },
  56: { label: "Vape Cartridges" },
  57: { label: "Single-Use Weed Containers" },
  // Back, left: Fishing
  59: { label: "Bait Bags / Containers" },
  60: { label: "Buoys / Floats" },
  61: { label: "Large Foam Pieces" },
  62: { label: "Fishing Line", note: "1 yard = 1 piece" },
  63: { label: "Hooks / Lures / Sinkers" },
  64: { label: "Light Sticks" },
  65: { label: "Nets" },
  66: { label: "Pots / Traps" },
  67: { label: "Rope", note: "1 yard = 1 piece" },
  68: { label: "Hagfish Traps" },
  69: { label: "Oyster Spacers" },
  // Back, left: Other (Plastic / Foam)
  71: { label: "Non-Beverage Bottles", note: "bleach, oil, etc." },
  72: { label: "Foam Coolers" },
  73: { label: "Shotgun Wads" },
  74: { label: "Non-Food Plastic Film / Wrappers" },
  75: { label: "Zip Ties" },
  76: { label: "Dog Poop Bags" },
  77: { label: "Mini Toiletry Bottles" },
  78: OTHER,
  // Back, right: Glass
  80: { label: "Bottles" },
  81: { label: "Fragments" },
  82: OTHER,
  // Back, right: Paper & Wood
  84: { label: "Paper Bags" },
  85: { label: "Paper Cigarette Box" },
  86: { label: "Paper / Wood Cups" },
  87: { label: "Paper / Wood Fragments" },
  88: { label: "Paper Napkins" },
  89: { label: "Paper / Wood Plates" },
  90: { label: "Paper / Wood Straws" },
  91: { label: "Coffee / Drink Stirrers" },
  92: { label: "Paper / Wood Take-Out Food Containers" },
  93: { label: "Treated Wood", note: "i.e. pallets; NOT driftwood" },
  94: OTHER,
  // Back, right: Metal
  96: { label: "Metal Bottle Caps" },
  97: { label: "Aluminum Beverage Cans" },
  98: { label: "Other Metal Cans" },
  99: { label: "Metal Fragments" },
  100: OTHER,
  // Back, right: Rubber & Latex
  102: { label: "Condoms" },
  103: { label: "Latex Gloves" },
  104: { label: "Tires" },
  105: OTHER,
  // Back, right: Other Materials
  107: { label: "Fireworks" },
  108: { label: "Tarps" },
  109: { label: "Fabric / Textiles" },
  110: OTHER,
};
