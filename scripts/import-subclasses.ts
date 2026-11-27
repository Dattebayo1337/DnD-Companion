import { db } from "../src/database/client";
import { importBundledFile } from "./bundled-catalog";

try {
  for (const year of [2014, 2024]) {
    const path = `data/phb/subclasses-${year}.json`;
    console.log(year, await importBundledFile(path));
  }
} finally {
  await db.$disconnect();
}
