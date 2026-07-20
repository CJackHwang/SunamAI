import sharp from 'sharp';
import fs from 'fs';

async function processImage(filepath, outputSize) {
  try {
    console.log(`Processing ${filepath}...`);
    const buffer = fs.readFileSync(filepath);
    
    // First trim the transparent pixels, using a threshold to ignore near-transparent noise
    // sharp's trim() uses a default threshold of 10 for exactly this reason.
    // We'll extract the trim info to see how much was trimmed.
    const image = sharp(buffer);
    const { info, data: trimmed } = await image
      .trim({ threshold: 40 }) // slightly higher threshold just in case
      .toBuffer({ resolveWithObject: true });

    console.log(`Trimmed ${filepath} to ${info.width}x${info.height}`);

    // Now fit the trimmed image tightly into a square.
    // By passing outputSize x outputSize with 'contain', 
    // it scales the image so the longest dimension is outputSize,
    // and pads the shorter dimension with transparency to make it a perfect square.
    const finalBuffer = await sharp(trimmed)
      .resize(outputSize, outputSize, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .toBuffer();

    fs.writeFileSync(filepath, finalBuffer);
    console.log(`Successfully processed ${filepath} into a ${outputSize}x${outputSize} tight square.`);
  } catch (err) {
    console.error(`Error processing ${filepath}:`, err);
  }
}

async function main() {
  // Keep the legacy transparent icon tightly fitted. The app icon has an
  // intentional white background and must not be trimmed.
  await processImage('public/icon.png', 500);
}

main();
