# Logo Directory

This directory contains logo and image assets for PDF generation.

## Usage

Place your company logo file in this directory. Common formats supported:
- PNG (recommended for transparency)
- JPEG/JPG
- SVG (limited support in PDFKit)

## File Naming Convention

Use descriptive names for logo files:
- `company-logo.png` - Main company logo
- `company-logo-white.png` - White version for dark backgrounds
- `watermark.png` - Watermark for background
- `header-logo.png` - Specific logo for headers

## Logo Specifications

For best results in PDF generation:

### Header Logo
- **Recommended size**: 120x120 pixels or smaller
- **Format**: PNG with transparent background
- **Aspect ratio**: Square or landscape
- **Resolution**: 150 DPI or higher

### Watermark
- **Recommended size**: 200x200 pixels
- **Format**: PNG with 30-50% opacity
- **Color**: Grayscale or light colors

## Example Usage in Code

```typescript
import { createPDFGenerator } from "./utils/pdf";

const pdfGen = createPDFGenerator({
    header: {
        title: "Report Title",
        logo: {
            path: "./logo/company-logo.png",
            width: 80,
            height: 80,
        },
    },
});
```

## Current Files

Place your logo files here. Example:

```
logo/
├── README.md (this file)
├── company-logo.png
├── header-logo.png
└── watermark.png
```

## Image Optimization Tips

1. **Compress images**: Use tools like TinyPNG to reduce file size
2. **Use appropriate dimensions**: Don't use unnecessarily large images
3. **Remove metadata**: Strip EXIF data to reduce file size
4. **Use PNG for logos**: Better for graphics with transparency
5. **Use JPEG for photos**: Better for photographic content

## Supported Image Formats

PDFKit supports:
- ✅ PNG (with transparency)
- ✅ JPEG/JPG
- ⚠️ SVG (limited support, may need conversion)
- ❌ GIF (not recommended)
- ❌ WebP (not supported)

## License Note

Ensure you have the rights to use any logo or image assets placed in this directory.
