import { db } from "../src/database/client";
import { importBundledFile, libraryFiles } from "./bundled-catalog";

try {
  const sets = [
    "srd/spells",
    "srd/monsters",
    "srd/references",
    "phb/backgrounds",
    "dndsu/supplement",
    "phb/subclasses",
    "phb/feats",
    "dndsu/options",
  ];
  const paths = sets.flatMap((name) =>
    [2014, 2024].map((year) => `data/${name}-${year}.json`),
  );
  for (const path of [...paths, ...libraryFiles()])
    console.log(path, await importBundledFile(path));
} finally {
  await db.$disconnect();
}
