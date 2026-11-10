import { createDatabase, resolveDatabasePath } from "./db";

const database = createDatabase();
database.close();
console.log(`Database migrations applied: ${resolveDatabasePath()}`);
