import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDatabase } from "../src/db";

test("closing a database finalizes retained prepared statements and releases the file immediately", () => {
  const directory = mkdtempSync(join(tmpdir(), "film-shelf-close-"));
  const database = createDatabase(join(directory, "library.sqlite"));
  const statement = database.sqlite.prepare("SELECT count(*) AS count FROM movies");
  expect(statement.get()).toEqual({ count: 0 });
  database.close();
  expect(() => statement.get()).toThrow();
  expect(() => rmSync(directory, { recursive: true, force: true })).not.toThrow();
});
