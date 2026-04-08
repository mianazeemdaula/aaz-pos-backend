# Fonts Directory

This directory contains custom fonts for PDF generation, including Urdu/Arabic language support.

## Required Fonts for Urdu Support

To enable Urdu text rendering in PDFs, download and place the following fonts in this directory:

### Option 1: Noto Naskh Arabic (Recommended)
- **Download from**: [Google Fonts - Noto Naskh Arabic](https://fonts.google.com/noto/specimen/Noto+Naskh+Arabic)
- **Files needed**:
  - `NotoNaskhArabic-Regular.ttf`
  - `NotoNaskhArabic-Bold.ttf` (optional)

### Option 2: Jameel Noori Nastaleeq
- **Download from**: [Urdu Fonts Repository](https://github.com/urdufont/jameel-noori-nastaleeq)
- **Files needed**:
  - `JameelNooriNastaleeq.ttf`
  - `JameelNooriNastaleeqKasheeda.ttf` (optional)

## Font File Structure

Place font files directly in this directory:

```
fonts/
├── README.md (this file)
├── NotoNaskhArabic-Regular.ttf
├── NotoNaskhArabic-Bold.ttf
├── JameelNooriNastaleeq.ttf
└── JameelNooriNastaleeqKasheeda.ttf
```

## Usage

Once fonts are placed here, they will be automatically detected and registered by the PDF generation system. No code changes are required.

## Testing Font Availability

To check which fonts are available, use the `checkFontAvailability()` function:

```typescript
import { checkFontAvailability } from "./utils/pdf/pdfkit-fonts";

const { available, missing } = checkFontAvailability();
console.log("Available fonts:", available.map(f => f.name));
console.log("Missing fonts:", missing.map(f => f.name));
```

## Supported Characters

The Urdu font support includes:
- Arabic script (Unicode range: U+0600 to U+06FF)
- Urdu characters
- Persian characters
- Right-to-left (RTL) text rendering

## License Notes

When downloading fonts:
- **Noto fonts**: Licensed under SIL Open Font License (free for commercial use)
- **Jameel Noori**: Check the specific license for the variant you download

Always ensure you comply with font licensing terms for your use case.
