declare module "pg" {
  export interface PoolOptions {
    connectionString?: string;
    max?: number;
    connectionTimeoutMillis?: number;
    idleTimeoutMillis?: number;
    ssl?: { rejectUnauthorized: boolean };
  }

  export interface QueryResult<Row extends object> {
    rows: Row[];
  }

  export class Pool {
    constructor(options?: PoolOptions);
    query<Row extends object>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  }
}
