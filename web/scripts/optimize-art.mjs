import sharp from "sharp";
import { readdir, readFile, writeFile } from "node:fs/promises";
const directory = new URL("../public/art/", import.meta.url);
for (const name of await readdir(directory)) {
  if (!name.endsWith(".jpg")) continue;
  const file = new URL(name, directory);
  const original = await readFile(file);
  const optimized = await sharp(original)
    .resize({
      width: 640,
      height: 800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  if (optimized.length < original.length) await writeFile(file, optimized);
}
console.log("Cover art optimized for the web.");
