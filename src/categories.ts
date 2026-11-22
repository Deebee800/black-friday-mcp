// Fixed categories for get_trending_deals. Amazon has no deals endpoint, so each category is a
// SearchItems query with a minimum saving and a sort, filtered afterwards for deal badges.
export interface Category { id: string; label: string; keywords: string; searchIndex?: string; minSavingPercent: number }

export const CATEGORIES: Category[] = [
  { id: "tvs", label: "TVs", keywords: "4K smart TV", searchIndex: "Electronics", minSavingPercent: 20 },
  { id: "headphones", label: "Headphones & earbuds", keywords: "wireless noise cancelling headphones earbuds", searchIndex: "Electronics", minSavingPercent: 20 },
  { id: "laptops", label: "Laptops", keywords: "laptop", searchIndex: "Computers", minSavingPercent: 15 },
  { id: "tablets", label: "Tablets & e-readers", keywords: "tablet e-reader", searchIndex: "Electronics", minSavingPercent: 15 },
  { id: "smart-home", label: "Smart home", keywords: "smart speaker smart display smart plug", searchIndex: "Electronics", minSavingPercent: 20 },
  { id: "robot-vacuums", label: "Robot vacuums", keywords: "robot vacuum", searchIndex: "HomeAndKitchen", minSavingPercent: 20 },
  { id: "kitchen", label: "Kitchen", keywords: "stand mixer blender coffee maker espresso machine", searchIndex: "HomeAndKitchen", minSavingPercent: 20 },
  { id: "air-fryers", label: "Air fryers", keywords: "air fryer", searchIndex: "HomeAndKitchen", minSavingPercent: 20 },
  { id: "toys", label: "Toys & games", keywords: "toys lego board games", searchIndex: "ToysAndGames", minSavingPercent: 20 },
  { id: "gaming", label: "Gaming", keywords: "gaming headset controller console game", searchIndex: "VideoGames", minSavingPercent: 15 },
  { id: "beauty", label: "Beauty", keywords: "hair dryer skincare electric toothbrush", searchIndex: "Beauty", minSavingPercent: 20 },
  { id: "tools", label: "Tools", keywords: "cordless drill tool set", searchIndex: "Tools", minSavingPercent: 20 },
  { id: "fitness", label: "Fitness", keywords: "fitness tracker smartwatch dumbbells", searchIndex: "SportsAndOutdoors", minSavingPercent: 20 },
  { id: "baby", label: "Baby", keywords: "baby monitor stroller car seat", searchIndex: "Baby", minSavingPercent: 15 },
  { id: "fashion", label: "Fashion", keywords: "sneakers winter jacket boots", searchIndex: "Fashion", minSavingPercent: 25 },
];

export function findCategory(id?: string): Category | undefined {
  if (!id) return undefined;
  const k = id.trim().toLowerCase().replace(/[\s_]+/g, "-");
  return CATEGORIES.find(c => c.id === k || c.label.toLowerCase() === k.replace(/-/g, " "));
}
