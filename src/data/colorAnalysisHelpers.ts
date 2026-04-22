import type { ColorWithHex } from './seasonalPalettes';

export function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i]!, shuffled[j]!] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
}

/** Maps palette combo strings to structured colors + hex (same logic as legacy colorAnalysis node). */
export function formatColorCombos(combos: string[], allColors: ColorWithHex[]): ColorWithHex[][] {
  const colorMap = new Map(allColors.map((color) => [color.name.toLowerCase(), color.hex]));

  return combos.map((combo) => {
    const colorNames = combo.split(/ & |, /).map((name) => name.trim());

    return colorNames.map((name) => {
      const hex = colorMap.get(name.toLowerCase());
      return { name, hex: hex || '#000000' };
    });
  });
}
