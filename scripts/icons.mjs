// Builds the PNG app icons from public/icon.svg (run automatically before `npm run build`).
import sharp from "sharp";
const src = new URL("../public/icon.svg", import.meta.url);
for (const size of [192, 512]) {
  await sharp(src.pathname, { density: 300 }).resize(size, size).png().toFile(new URL(`../public/icon-${size}.png`, import.meta.url).pathname);
}
console.log("icons ready");
