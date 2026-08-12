// GENERATED FILE -- do not edit by hand.
// Source: assets/template/data-entry-template.xlsx
// Regenerate: python3 scripts/gen_taxonomy.py
//
// Item names and row numbers are read straight from the chapter's Excel
// template so the two can never drift. Section boundaries come from the
// template's own shared-formula blocks.

export type CardSide = "front" | "back";
/** Each side of the card is printed as two independent columns. */
export type CardColumn = "left" | "right";

export interface TaxonomyItem {
  /** 1-based row in the Excel template. Also the stable id for an item. */
  readonly row: number;
  /** Item label exactly as it appears in column A of the template. */
  readonly name: string;
  /** Printed section heading on the data card. */
  readonly section: string;
  /** Which side of the card this item is printed on. */
  readonly side: CardSide;
  /** Which printed column of that side, each with its own TOTAL column. */
  readonly column: CardColumn;
}

export const TAXONOMY: readonly TaxonomyItem[] = [
  { row: 18, name: "Cigarette Butts", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 19, name: "Plastic Bottles (beverage)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 20, name: "Plastic Bags (shopping / grocery)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 21, name: "Plastic Straws", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 22, name: "Plastic Cutlery", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 23, name: "Plastic Cups", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 24, name: "Foam Cups", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 25, name: "Foam Take-Out Food Containers", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 26, name: "Plastic Lids (yogurt lids, coffee lids, etc.)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 27, name: "Plastic Food Wrappers (candy, chip bags, etc.)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 28, name: "Balloons", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 29, name: "Large Foam Fragments (larger than a dime)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 30, name: "Small Foam Fragments (smaller than a dime)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 31, name: "Large Plastic Fragments (larger than a dime)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 32, name: "Small Plastic Fragments (smaller than a dime)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 33, name: "Nurdles (small pre-production plastic pellets)", section: "Common & Priority Items", side: "front", column: "left" },
  { row: 35, name: "Plastic 6-Pack Holders", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 36, name: "Plastic Bags (other: zip-lock, trash, etc.)", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 37, name: "Plastic Bottle Caps + Rings", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 38, name: "Juice Boxes", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 39, name: "Foam Plates", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 40, name: "Plastic Plates", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 41, name: "Plastic Stirrers", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 42, name: "Plastic Take-Out Food Containers", section: "Food & Beverage Packaging", side: "front", column: "right" },
  { row: 44, name: "Diapers", section: "Personal Care", side: "front", column: "right" },
  { row: 45, name: "Syringes", section: "Personal Care", side: "front", column: "right" },
  { row: 46, name: "Tampons/Tampon Applicators", section: "Personal Care", side: "front", column: "right" },
  { row: 47, name: "Toothbrushes", section: "Personal Care", side: "front", column: "right" },
  { row: 48, name: "Toothpicks/Floss", section: "Personal Care", side: "front", column: "right" },
  { row: 49, name: "Bandaids", section: "Personal Care", side: "front", column: "right" },
  { row: 50, name: "Wipes", section: "Personal Care", side: "front", column: "right" },
  { row: 51, name: "Single Use Surgical Mask", section: "Personal Care", side: "front", column: "right" },
  { row: 53, name: "Lighters", section: "Smoking", side: "back", column: "left" },
  { row: 54, name: "Cigar Tips", section: "Smoking", side: "back", column: "left" },
  { row: 55, name: "Plastic Tobacco Packaging/Wrap", section: "Smoking", side: "back", column: "left" },
  { row: 56, name: "Vape Cartridges", section: "Smoking", side: "back", column: "left" },
  { row: 57, name: "Single-Use Weed Containers", section: "Smoking", side: "back", column: "left" },
  { row: 59, name: "Bait Bags/Containers", section: "Fishing", side: "back", column: "left" },
  { row: 60, name: "Buoys/Floats", section: "Fishing", side: "back", column: "left" },
  { row: 61, name: "Large Foam Pieces", section: "Fishing", side: "back", column: "left" },
  { row: 62, name: "Fishing Line (1 yard = 1 piece)", section: "Fishing", side: "back", column: "left" },
  { row: 63, name: "Hooks/Sinkers/Lures", section: "Fishing", side: "back", column: "left" },
  { row: 64, name: "Light Sticks", section: "Fishing", side: "back", column: "left" },
  { row: 65, name: "Nets", section: "Fishing", side: "back", column: "left" },
  { row: 66, name: "Pots and Traps", section: "Fishing", side: "back", column: "left" },
  { row: 67, name: "Rope (1 yard = 1 piece)", section: "Fishing", side: "back", column: "left" },
  { row: 68, name: "Hagfish Traps", section: "Fishing", side: "back", column: "left" },
  { row: 69, name: "Oyster Spacers", section: "Fishing", side: "back", column: "left" },
  { row: 71, name: "Non-Beverage Bottles (bleach, cleaners, oil, etc.)", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 72, name: "Foam Coolers", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 73, name: "Shotgun Wads", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 74, name: "Plastic Film/Wrapper (non-food or unknown)", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 75, name: "Zip Ties", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 76, name: "Dog Poop Bags", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 77, name: "Mini Toiletry Bottles", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 78, name: "Other (do not write in the item name, just a number)", section: "Other (Plastic / Foam)", side: "back", column: "left" },
  { row: 80, name: "Bottles", section: "Glass", side: "back", column: "right" },
  { row: 81, name: "Fragments", section: "Glass", side: "back", column: "right" },
  { row: 82, name: "Other (do not write in the item name, just a number)", section: "Glass", side: "back", column: "right" },
  { row: 84, name: "Paper Bags", section: "Paper & Wood", side: "back", column: "right" },
  { row: 85, name: "Paper Cigarette Box", section: "Paper & Wood", side: "back", column: "right" },
  { row: 86, name: "Paper/Wood Cups", section: "Paper & Wood", side: "back", column: "right" },
  { row: 87, name: "Paper/Wood Fragments/Pieces", section: "Paper & Wood", side: "back", column: "right" },
  { row: 88, name: "Paper Napkins", section: "Paper & Wood", side: "back", column: "right" },
  { row: 89, name: "Paper/Wood Plates", section: "Paper & Wood", side: "back", column: "right" },
  { row: 90, name: "Paper/Wood Straws", section: "Paper & Wood", side: "back", column: "right" },
  { row: 91, name: "Wood Coffee/Drink Stirrers", section: "Paper & Wood", side: "back", column: "right" },
  { row: 92, name: "Paper/Wood Take-Out Food Containers", section: "Paper & Wood", side: "back", column: "right" },
  { row: 93, name: "Treated Wood (i.e. pallets; NOT driftwood)", section: "Paper & Wood", side: "back", column: "right" },
  { row: 94, name: "Other (do not write in the item name, just a number)", section: "Paper & Wood", side: "back", column: "right" },
  { row: 96, name: "Metal Bottle Caps", section: "Metal", side: "back", column: "right" },
  { row: 97, name: "Aluminum Cans (beverage)", section: "Metal", side: "back", column: "right" },
  { row: 98, name: "Cans (other metal)", section: "Metal", side: "back", column: "right" },
  { row: 99, name: "Metal Fragments", section: "Metal", side: "back", column: "right" },
  { row: 100, name: "Other (do not write in the item name, just a number)", section: "Metal", side: "back", column: "right" },
  { row: 102, name: "Condoms", section: "Rubber & Latex", side: "back", column: "right" },
  { row: 103, name: "Latex Gloves", section: "Rubber & Latex", side: "back", column: "right" },
  { row: 104, name: "Tires", section: "Rubber & Latex", side: "back", column: "right" },
  { row: 105, name: "Other (do not write in the item name, just a number)", section: "Rubber & Latex", side: "back", column: "right" },
  { row: 107, name: "Fireworks", section: "Other Materials", side: "back", column: "right" },
  { row: 108, name: "Tarps", section: "Other Materials", side: "back", column: "right" },
  { row: 109, name: "Fabric/Textiles", section: "Other Materials", side: "back", column: "right" },
  { row: 110, name: "Other (do not write in the item name, just a number)", section: "Other Materials", side: "back", column: "right" },
] as const;

/**
 * Header fields.
 *
 * The label sits in column A and its VALUE goes in column A on the row
 * BELOW it -- verified against a real completed datasheet from the chapter
 * (A1 "Data Entry Volunteer Name" / A2 "Sophia Holtam", A7 "Shoreline" /
 * A8 "Ocean Beach"). Column B is not used for headers at all.
 *
 * The prototype's write_spreadsheet.py wrote these into column B on the
 * label's own row, which would have put every header in the wrong cell.
 */
export const HEADER_ROWS = {
  dataEntryVolunteer: { labelRow: 1, valueRow: 2, label: "Data Entry Volunteer Name" },
  club: { labelRow: 3, valueRow: 4, label: "Club & Email Contact" },
  date: { labelRow: 5, valueRow: 6, label: "Date" },
  shoreline: { labelRow: 7, valueRow: 8, label: "Shoreline" },
  volunteers: { labelRow: 9, valueRow: 10, label: "Number of volunteers" },
  pounds: { labelRow: 11, valueRow: 12, label: "Pounds of Trash" },
  duration: { labelRow: 13, valueRow: 14, label: "Duration" },
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
