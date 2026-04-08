const fs = require('fs');
const path = require('path');

const fontkitMainPath = path.join(
  __dirname,
  '..',
  'node_modules',
  'fontkit',
  'dist',
  'main.cjs'
);

function patchFontkitAsciiDecoder() {
  if (!fs.existsSync(fontkitMainPath)) {
    console.log('fontkit patch skipped: file not found');
    return;
  }

  const content = fs.readFileSync(fontkitMainPath, 'utf8');
  const unsupportedDecoderPatterns = [
    "new TextDecoder('ascii')",
    'new TextDecoder("ascii")',
    "new TextDecoder('latin1')",
    'new TextDecoder("latin1")'
  ];
  const replacementDecoder = "{ decode: (buffer) => Buffer.from(buffer).toString('ascii') }";

  if (content.includes(replacementDecoder)) {
    console.log('fontkit patch already applied (Buffer decoder)');
    return;
  }

  const hasUnsupportedDecoder = unsupportedDecoderPatterns.some((pattern) =>
    content.includes(pattern)
  );

  if (!hasUnsupportedDecoder) {
    console.log('fontkit patch skipped: target pattern not found');
    return;
  }

  let patched = content;
  for (const pattern of unsupportedDecoderPatterns) {
    patched = patched.replaceAll(pattern, replacementDecoder);
  }

  fs.writeFileSync(fontkitMainPath, patched, 'utf8');
  console.log('fontkit patch applied: TextDecoder -> Buffer decoder');
}

patchFontkitAsciiDecoder();