# Card Formats and Palette Names

## 1. Color Analysis Card Format

### TypeScript Type Definition
```typescript
{
  reply_type: 'color_analysis_card';
  palette_name: SeasonalPalette;  // One of the 12 palette names (see below)
  description: string;             // Palette description text
  top_colors: ColorWithHex[];      // Array of color objects
  two_color_combos: ColorWithHex[][]; // Array of arrays (each combo is an array of 2 colors)
  user_image_url: string | null;   // User's uploaded photo URL
}
```

### ColorWithHex Interface
```typescript
interface ColorWithHex {
  name: string;  // e.g., "Peach Blossom"
  hex: string;   // e.g., "#FFB380"
}
```

### Example JSON Response
```json
{
  "reply_type": "color_analysis_card",
  "palette_name": "TRUE_AUTUMN",
  "description": "Warm, golden, peachy coloring with medium contrast - ideal for rich, earthy tones that enhance your natural warmth.",
  "top_colors": [
    { "name": "Tomato Red", "hex": "#FF6347" },
    { "name": "Warm Coral", "hex": "#FF7F50" },
    { "name": "Pumpkin Orange", "hex": "#FF8C42" }
    // ... up to 20 colors
  ],
  "two_color_combos": [
    [
      { "name": "Tomato Red", "hex": "#FF6347" },
      { "name": "Warm Coral", "hex": "#FF7F50" }
    ],
    [
      { "name": "Pumpkin Orange", "hex": "#FF8C42" },
      { "name": "Golden Amber", "hex": "#FFBF00" }
    ]
    // ... more combinations
  ],
  "user_image_url": "https://example.com/user-photo.jpg"
}
```

---

## 2. Vibe Check Card Format

### TypeScript Type Definition
```typescript
{
  reply_type: 'vibe_check_card';
  comment: string;                    // Overall comment (10-15 words)
  fit: ScoringCategory;              // Fit category score and explanation
  hair_and_skin: ScoringCategory;    // Hair and Skin category
  accessories: ScoringCategory;       // Accessories category
  vibe_check_result: number;         // Average of the 3 scores (6.0-10.0)
  recommendations: string[];         // Array of actionable suggestions
  user_image_url: string | null;    // User's outfit photo URL
}
```

### ScoringCategory Interface
```typescript
interface ScoringCategory {
  score: number;      // 6.0-10.0 (enforced minimum 6.0)
  explanation: string; // Short explanation for the score
}
```

### Example JSON Response
```json
{
  "reply_type": "vibe_check_card",
  "comment": "You're absolutely slaying this look!",
  "fit": {
    "score": 7.5,
    "explanation": "Relaxed, casual fit that suits the vibe; slight tailoring could refine the silhouette."
  },
  "hair_and_skin": {
    "score": 8.0,
    "explanation": "Healthy-looking skin and expressive, tousled hair that adds character and authenticity."
  },
  "accessories": {
    "score": 8.0,
    "explanation": "Bold green scarf creates a lovely focal contrast; minimal other accessories keep it clean."
  },
  "vibe_check_result": 7.83,  // (7.5 + 8.0 + 8.0) / 3
  "recommendations": [
    "Try a statement belt to define your waist",
    "Consider adding a structured jacket for more polish"
  ],
  "user_image_url": "https://example.com/outfit-photo.jpg"
}
```

---

## 3. Seasonal Palette Names (for PDFs)

### All 12 Palette Names (TypeScript Enum)
```typescript
type SeasonalPalette =
  | 'LIGHT_SPRING'
  | 'TRUE_SPRING'
  | 'BRIGHT_SPRING'
  | 'LIGHT_SUMMER'
  | 'TRUE_SUMMER'
  | 'SOFT_SUMMER'
  | 'SOFT_AUTUMN'
  | 'TRUE_AUTUMN'
  | 'DARK_AUTUMN'
  | 'TRUE_WINTER'
  | 'BRIGHT_WINTER'
  | 'DARK_WINTER';
```

### PDF Path Mapping
Each palette has a corresponding PDF file path:

| Palette Name | PDF Path |
|-------------|----------|
| `LIGHT_SPRING` | `palettes/LIGHT_SPRING.pdf` |
| `TRUE_SPRING` | `palettes/TRUE_SPRING.pdf` |
| `BRIGHT_SPRING` | `palettes/BRIGHT_SPRING.pdf` |
| `LIGHT_SUMMER` | `palettes/LIGHT_SUMMER.pdf` |
| `TRUE_SUMMER` | `palettes/TRUE_SUMMER.pdf` |
| `SOFT_SUMMER` | `palettes/SOFT_SUMMER.pdf` |
| `SOFT_AUTUMN` | `palettes/SOFT_AUTUMN.pdf` |
| `TRUE_AUTUMN` | `palettes/TRUE_AUTUMN.pdf` |
| `DARK_AUTUMN` | `palettes/DARK_AUTUMN.pdf` |
| `TRUE_WINTER` | `palettes/TRUE_WINTER.pdf` |
| `BRIGHT_WINTER` | `palettes/BRIGHT_WINTER.pdf` |
| `DARK_WINTER` | `palettes/DARK_WINTER.pdf` |

### Frontend PDF Access
The frontend receives the `palette_name` in the color analysis card response. To construct the PDF URL:

```javascript
// Example: palette_name = "TRUE_AUTUMN"
const pdfUrl = `${SERVER_URL}/palettes/${palette_name}.pdf`;
// Result: "https://example.com/palettes/TRUE_AUTUMN.pdf"
```

**Note**: All palettes now use unified PDF paths (no gender-specific paths like `_MEN` or `_WOMEN`).

---

## Summary

- **Color Analysis Card**: Contains palette name, description, top colors, color combinations, and user image
- **Vibe Check Card**: Contains 3 scoring categories (Fit, Hair and Skin, Accessories), vibe check result (average), recommendations, and user image
- **Palette Names**: 12 seasonal palettes, each with a corresponding PDF at `palettes/{PALETTE_NAME}.pdf`

