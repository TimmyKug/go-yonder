export type DatabaseMigration = {
  version: number;
  name: string;
  sql: string;
};
