// GENERATED FILE -- do not edit by hand.
// Source: assets/template/data-entry-template.xlsx
// Regenerate: python3 scripts/gen_taxonomy.py
//
// Item names and row numbers are read straight from the chapter's Excel
// template so the two can never drift. Section boundaries come from the
// template's own shared-formula blocks.

export type CardSide = "front" | "back";

export interface TaxonomyItem {
  /** 1-based row in the Excel template. Also the stable id for an item. */
  readonly row: number;
  /** Item label exactly as it appears in column A of the template. */
  readonly name: string;
  /** Printed section heading on the data card. */
  readonly section: string;
  /** Which side of the card this item is printed on. */
  readonly side: CardSide;
}

export const TAXONOMY: readonly TaxonomyItem[] = [
  { row: 18, name: "Cigarette Butts", section: "Plastic", side: "front" },
  { row: 19, name: "Plastic Bottles (beverage)", section: "Plastic", side: "front" },
  { row: 20, name: "Plastic Bags (shopping / grocery)", section: "Plastic", side: "front" },
  { row: 21, name: "Plastic Straws", section: "Plastic", side: "front" },
  { row: 22, name: "Plastic Cutlery", section: "Plastic", side: "front" },
  { row: 23, name: "Plastic Cups", section: "Plastic", side: "front" },
  { row: 24, name: "Foam Cups", section: "Plastic", side: "front" },
  { row: 25, name: "Foam Take-Out Food Containers", section: "Plastic", side: "front" },
  { row: 26, name: "Plastic Lids (yogurt lids, coffee lids, etc.)", section: "Plastic", side: "front" },
  { row: 27, name: "Plastic Food Wrappers (candy, chip bags, etc.)", section: "Plastic", side: "front" },
  { row: 28, name: "Balloons", section: "Plastic", side: "front" },
  { row: 29, name: "Large Foam Fragments (larger than a dime)", section: "Plastic", side: "front" },
  { row: 30, name: "Small Foam Fragments (smaller than a dime)", section: "Plastic", side: "front" },
  { row: 31, name: "Large Plastic Fragments (larger than a dime)", section: "Plastic", side: "front" },
  { row: 32, name: "Small Plastic Fragments (smaller than a dime)", section: "Plastic", side: "front" },
  { row: 33, name: "Nurdles (small pre-production plastic pellets)", section: "Plastic", side: "front" },
  { row: 35, name: "Plastic 6-Pack Holders", section: "Plastic", side: "front" },
  { row: 36, name: "Plastic Bags (other: zip-lock, trash, etc.)", section: "Plastic", side: "front" },
  { row: 37, name: "Plastic Bottle Caps + Rings", section: "Plastic", side: "front" },
  { row: 38, name: "Juice Boxes", section: "Plastic", side: "front" },
  { row: 39, name: "Foam Plates", section: "Plastic", side: "front" },
  { row: 40, name: "Plastic Plates", section: "Plastic", side: "front" },
  { row: 41, name: "Plastic Stirrers", section: "Plastic", side: "front" },
  { row: 42, name: "Plastic Take-Out Food Containers", section: "Plastic", side: "front" },
  { row: 44, name: "Diapers", section: "Personal Care / Hygiene", side: "front" },
  { row: 45, name: "Syringes", section: "Personal Care / Hygiene", side: "front" },
  { row: 46, name: "Tampons/Tampon Applicators", section: "Personal Care / Hygiene", side: "front" },
  { row: 47, name: "Toothbrushes", section: "Personal Care / Hygiene", side: "front" },
  { row: 48, name: "Toothpicks/Floss", section: "Personal Care / Hygiene", side: "front" },
  { row: 49, name: "Bandaids", section: "Personal Care / Hygiene", side: "front" },
  { row: 50, name: "Wipes", section: "Personal Care / Hygiene", side: "front" },
  { row: 51, name: "Single Use Surgical Mask", section: "Personal Care / Hygiene", side: "front" },
  { row: 53, name: "Lighters", section: "Smoking / Tobacco", side: "front" },
  { row: 54, name: "Cigar Tips", section: "Smoking / Tobacco", side: "front" },
  { row: 55, name: "Plastic Tobacco Packaging/Wrap", section: "Smoking / Tobacco", side: "front" },
  { row: 56, name: "Vape Cartridges", section: "Smoking / Tobacco", side: "front" },
  { row: 57, name: "Single-Use Weed Containers", section: "Smoking / Tobacco", side: "front" },
  { row: 59, name: "Bait Bags/Containers", section: "Fishing / Marine Debris", side: "back" },
  { row: 60, name: "Buoys/Floats", section: "Fishing / Marine Debris", side: "back" },
  { row: 61, name: "Large Foam Pieces", section: "Fishing / Marine Debris", side: "back" },
  { row: 62, name: "Fishing Line (1 yard = 1 piece)", section: "Fishing / Marine Debris", side: "back" },
  { row: 63, name: "Hooks/Sinkers/Lures", section: "Fishing / Marine Debris", side: "back" },
  { row: 64, name: "Light Sticks", section: "Fishing / Marine Debris", side: "back" },
  { row: 65, name: "Nets", section: "Fishing / Marine Debris", side: "back" },
  { row: 66, name: "Pots and Traps", section: "Fishing / Marine Debris", side: "back" },
  { row: 67, name: "Rope (1 yard = 1 piece)", section: "Fishing / Marine Debris", side: "back" },
  { row: 68, name: "Hagfish Traps", section: "Fishing / Marine Debris", side: "back" },
  { row: 69, name: "Oyster Spacers", section: "Fishing / Marine Debris", side: "back" },
  { row: 71, name: "Non-Beverage Bottles (bleach, cleaners, oil, etc.)", section: "Plastic - Other", side: "back" },
  { row: 72, name: "Foam Coolers", section: "Plastic - Other", side: "back" },
  { row: 73, name: "Shotgun Wads", section: "Plastic - Other", side: "back" },
  { row: 74, name: "Plastic Film/Wrapper (non-food or unknown)", section: "Plastic - Other", side: "back" },
  { row: 75, name: "Zip Ties", section: "Plastic - Other", side: "back" },
  { row: 76, name: "Dog Poop Bags", section: "Plastic - Other", side: "back" },
  { row: 77, name: "Mini Toiletry Bottles", section: "Plastic - Other", side: "back" },
  { row: 78, name: "Other (do not write in the item name, just a number)", section: "Plastic - Other", side: "back" },
  { row: 80, name: "Bottles", section: "Glass / Ceramic", side: "back" },
  { row: 81, name: "Fragments", section: "Glass / Ceramic", side: "back" },
  { row: 82, name: "Other (do not write in the item name, just a number)", section: "Glass / Ceramic", side: "back" },
  { row: 84, name: "Paper Bags", section: "Paper / Wood", side: "back" },
  { row: 85, name: "Paper Cigarette Box", section: "Paper / Wood", side: "back" },
  { row: 86, name: "Paper/Wood Cups", section: "Paper / Wood", side: "back" },
  { row: 87, name: "Paper/Wood Fragments/Pieces", section: "Paper / Wood", side: "back" },
  { row: 88, name: "Paper Napkins", section: "Paper / Wood", side: "back" },
  { row: 89, name: "Paper/Wood Plates", section: "Paper / Wood", side: "back" },
  { row: 90, name: "Paper/Wood Straws", section: "Paper / Wood", side: "back" },
  { row: 91, name: "Wood Coffee/Drink Stirrers", section: "Paper / Wood", side: "back" },
  { row: 92, name: "Paper/Wood Take-Out Food Containers", section: "Paper / Wood", side: "back" },
  { row: 93, name: "Treated Wood (i.e. pallets; NOT driftwood)", section: "Paper / Wood", side: "back" },
  { row: 94, name: "Other (do not write in the item name, just a number)", section: "Paper / Wood", side: "back" },
  { row: 96, name: "Metal Bottle Caps", section: "Metal", side: "back" },
  { row: 97, name: "Aluminum Cans (beverage)", section: "Metal", side: "back" },
  { row: 98, name: "Cans (other metal)", section: "Metal", side: "back" },
  { row: 99, name: "Metal Fragments", section: "Metal", side: "back" },
  { row: 100, name: "Other (do not write in the item name, just a number)", section: "Metal", side: "back" },
  { row: 102, name: "Condoms", section: "Rubber / Latex", side: "back" },
  { row: 103, name: "Latex Gloves", section: "Rubber / Latex", side: "back" },
  { row: 104, name: "Tires", section: "Rubber / Latex", side: "back" },
  { row: 105, name: "Other (do not write in the item name, just a number)", section: "Rubber / Latex", side: "back" },
  { row: 107, name: "Fireworks", section: "Other Materials", side: "back" },
  { row: 108, name: "Tarps", section: "Other Materials", side: "back" },
  { row: 109, name: "Fabric/Textiles", section: "Other Materials", side: "back" },
  { row: 110, name: "Other (do not write in the item name, just a number)", section: "Other Materials", side: "back" },
] as const;

/** Header field -> row in column B of the template. */
export const HEADER_ROWS = {
  dataEntryVolunteer: { row: 1, label: "Data Entry Volunteer Name" },
  club: { row: 3, label: "Club & Email Contact" },
  date: { row: 5, label: "Date" },
  shoreline: { row: 7, label: "Shoreline" },
  volunteers: { row: 9, label: "Number of volunteers" },
  pounds: { row: 11, label: "Pounds of Trash" },
  duration: { row: 13, label: "Duration" },
} as const;

export type HeaderField = keyof typeof HEADER_ROWS;

/** First volunteer column. Column B holds SUM formulas and is never written. */
export const FIRST_DATA_COLUMN = 3; // C
/** Last column covered by the template's SUM(C:BZ) formulas. */
export const LAST_DATA_COLUMN = 78; // BZ
export const MAX_VOLUNTEERS = LAST_DATA_COLUMN - FIRST_DATA_COLUMN + 1;

const BY_ROW = new Map(TAXONOMY.map((i) => [i.row, i]));

export function itemForRow(row: number): TaxonomyItem | undefined {
  return BY_ROW.get(row);
}

export function itemsForSide(side: CardSide): TaxonomyItem[] {
  return TAXONOMY.filter((i) => i.side === side);
}
